// Эффекты 3D-боя: осколки кубов, искры, шлейфы оружия, кольца ударной волны, вспышки.
// Всё на пулах и InstancedMesh — без создания объектов на каждый удар.
import {
  AdditiveBlending, BoxGeometry, BufferAttribute, BufferGeometry, CanvasTexture, Color, DoubleSide, DynamicDrawUsage, InstancedMesh,
  Matrix4, Mesh, MeshBasicMaterial, MeshLambertMaterial, MeshStandardMaterial, PointLight, Quaternion, RingGeometry, Scene, Sprite, SpriteMaterial, Vector3,
} from 'three';
import { BLOCK_GEO, chunkBlockMaterial } from './blocks';

const GRAVITY = -34;
const rand = (a: number, b: number) => a + Math.random() * (b - a);

interface Chunk {
  pos: Vector3; vel: Vector3; rot: Quaternion; axis: Vector3; spin: number;
  size: number; life: number; max: number; color: Color; bounce: number;
  /** Целый куб — рисуется мешем куба из клиента; иначе осколок-коробка. */
  block?: boolean;
}
interface Spark { pos: Vector3; vel: Vector3; life: number; max: number; color: Color; len: number; drag: number; grav: number }
interface Ring { mesh: Mesh; life: number; max: number; from: number; to: number; alpha: number }
interface Flash { sprite: Sprite; life: number; max: number; size: number }
interface Puff { sprite: Sprite; vel: Vector3; life: number; max: number; from: number; to: number; alpha: number }
const MAX_PUFFS = 260;
/** Густота пыли: множитель числа клубов. */
const DUST_DENSITY = 1.8;

const MAX_CHUNKS = 700;
const MAX_SPARKS = 500;
const m4 = new Matrix4();
const q = new Quaternion();
const v = new Vector3();
const s = new Vector3();
const UP = new Vector3(0, 1, 0);
const hidden = new Matrix4().makeScale(0, 0, 0);

function glowTexture(): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.25, 'rgba(255,255,255,0.7)');
  grad.addColorStop(0.6, 'rgba(255,255,255,0.15)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  return new CanvasTexture(c);
}

/** Шлейф за оружием: лента между остриём и серединой клинка, тает к хвосту. */
export class Trail {
  readonly mesh: Mesh;
  private readonly n = 22;
  private readonly tips: Vector3[] = [];
  private readonly bases: Vector3[] = [];
  private readonly ages: number[] = [];
  private readonly posAttr: BufferAttribute;
  private readonly colAttr: BufferAttribute;
  private readonly color = new Color();
  private readonly life = 0.16;

  constructor(scene: Scene) {
    const geo = new BufferGeometry();
    this.posAttr = new BufferAttribute(new Float32Array(this.n * 2 * 3), 3).setUsage(DynamicDrawUsage);
    this.colAttr = new BufferAttribute(new Float32Array(this.n * 2 * 4), 4).setUsage(DynamicDrawUsage);
    geo.setAttribute('position', this.posAttr);
    geo.setAttribute('color', this.colAttr);
    const idx: number[] = [];
    for (let i = 0; i < this.n - 1; i++) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
    geo.setIndex(idx);
    this.mesh = new Mesh(geo, new MeshBasicMaterial({ vertexColors: true, transparent: true, blending: AdditiveBlending, side: DoubleSide, depthWrite: false }));
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    scene.add(this.mesh);
  }

  setColor(hex: number) {
    this.color.set(hex);
  }

  /** Добавить срез ленты (мировые координаты острия и основания клинка). */
  push(tip: Vector3, base: Vector3) {
    this.tips.unshift(tip.clone());
    this.bases.unshift(base.clone());
    this.ages.unshift(0);
    if (this.tips.length > this.n) {
      this.tips.pop();
      this.bases.pop();
      this.ages.pop();
    }
  }

  update(dt: number) {
    for (let i = this.ages.length - 1; i >= 0; i--) {
      this.ages[i] += dt;
      if (this.ages[i] > this.life) {
        this.ages.pop();
        this.tips.pop();
        this.bases.pop();
      }
    }
    const count = this.tips.length;
    this.mesh.visible = count >= 2;
    if (!this.mesh.visible) return;
    const p = this.posAttr.array as Float32Array;
    const c = this.colAttr.array as Float32Array;
    for (let i = 0; i < this.n; i++) {
      const k = Math.min(i, count - 1);
      const a = i < count ? Math.max(0, 1 - this.ages[k] / this.life) : 0;
      const tip = this.tips[k], base = this.bases[k];
      p.set([tip.x, tip.y, tip.z, base.x, base.y, base.z], i * 6);
      c.set([this.color.r, this.color.g, this.color.b, a * 0.5, this.color.r, this.color.g, this.color.b, 0], i * 8);
    }
    this.posAttr.needsUpdate = true;
    this.colAttr.needsUpdate = true;
  }

  dispose() {
    this.mesh.geometry.dispose();
    (this.mesh.material as MeshBasicMaterial).dispose();
  }
}

export class Fx {
  private readonly chunks: Chunk[] = [];
  private readonly sparks: Spark[] = [];
  private readonly rings: Ring[] = [];
  private readonly flashes: Flash[] = [];
  private readonly puffs: Puff[] = [];
  private readonly chunkMesh: InstancedMesh;
  private readonly blockMesh: InstancedMesh;
  private readonly sparkMesh: InstancedMesh;
  private readonly glow = glowTexture();
  private readonly light: PointLight;
  private lightLife = 0;
  private readonly tmpColor = new Color();

  constructor(private readonly scene: Scene) {
    this.chunkMesh = new InstancedMesh(new BoxGeometry(1, 1, 1), new MeshLambertMaterial(), MAX_CHUNKS);
    this.chunkMesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.chunkMesh.castShadow = true;
    this.chunkMesh.frustumCulled = false;
    this.chunkMesh.count = 0;
    this.chunkMesh.setColorAt(0, new Color(0xffffff));
    this.blockMesh = new InstancedMesh(BLOCK_GEO.cube, chunkBlockMaterial(), MAX_CHUNKS);
    this.blockMesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.blockMesh.castShadow = true;
    this.blockMesh.frustumCulled = false;
    this.blockMesh.count = 0;
    this.blockMesh.setColorAt(0, new Color(0xffffff));
    this.sparkMesh = new InstancedMesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial({ transparent: true, blending: AdditiveBlending, depthWrite: false }), MAX_SPARKS);
    this.sparkMesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.sparkMesh.frustumCulled = false;
    this.sparkMesh.count = 0;
    this.sparkMesh.setColorAt(0, new Color(0xffffff));
    this.light = new PointLight(0xffe2b0, 0, 26, 1.6);
    scene.add(this.chunkMesh, this.blockMesh, this.sparkMesh, this.light);
  }

  /** Осколки куба: разлетаются, падают, отскакивают от пола и тают. */
  debris(at: Vector3, color: number, count: number, opts: { dir?: Vector3; speed?: number; size?: [number, number]; spread?: number; life?: [number, number]; up?: number } = {}) {
    const [s0, s1] = opts.size ?? [0.12, 0.3];
    const [l0, l1] = opts.life ?? [0.7, 1.3];
    const speed = opts.speed ?? 7;
    for (let i = 0; i < count && this.chunks.length < MAX_CHUNKS; i++) {
      const vel = new Vector3(rand(-1, 1), rand(-0.2, 1), rand(-1, 1)).normalize().multiplyScalar(rand(0.4, 1) * speed * (opts.spread ?? 1));
      if (opts.dir) vel.addScaledVector(opts.dir, rand(0.5, 1.1) * speed);
      vel.y += opts.up ?? 4;
      const max = rand(l0, l1);
      this.chunks.push({
        pos: at.clone().add(v.set(rand(-0.35, 0.35), rand(-0.35, 0.35), rand(-0.35, 0.35))),
        vel, rot: new Quaternion().random(), axis: new Vector3(rand(-1, 1), rand(-1, 1), rand(-1, 1)).normalize(), spin: rand(4, 16),
        size: rand(s0, s1), life: max, max, color: new Color(color).offsetHSL(0, 0, rand(-0.08, 0.08)), bounce: rand(0.25, 0.5),
      });
    }
  }

  /** Целый куб, отлетающий от модели (разбитый куб, рассыпание проигравшего). */
  cube(at: Vector3, color: number, vel: Vector3, size = 0.9, life = 1.6) {
    if (this.chunks.length >= MAX_CHUNKS) this.chunks.shift();
    this.chunks.push({
      pos: at.clone(), vel: vel.clone(), rot: new Quaternion(), axis: new Vector3(rand(-1, 1), rand(-1, 1), rand(-1, 1)).normalize(), spin: rand(2, 9),
      size, life, max: life, color: new Color(color), bounce: rand(0.3, 0.45), block: true,
    });
  }

  /** Искры: яркие вытянутые чёрточки вдоль скорости. */
  sparksAt(at: Vector3, color: number, count: number, opts: { dir?: Vector3; speed?: number; cone?: number; life?: [number, number]; grav?: number; len?: number } = {}) {
    const [l0, l1] = opts.life ?? [0.18, 0.42];
    const speed = opts.speed ?? 16;
    for (let i = 0; i < count && this.sparks.length < MAX_SPARKS; i++) {
      const vel = new Vector3(rand(-1, 1), rand(-1, 1), rand(-1, 1)).normalize().multiplyScalar(opts.cone ?? 1);
      if (opts.dir) vel.add(opts.dir);
      vel.normalize().multiplyScalar(speed * rand(0.35, 1));
      const max = rand(l0, l1);
      this.sparks.push({ pos: at.clone(), vel, life: max, max, color: new Color(color), len: (opts.len ?? 1) * rand(0.6, 1.4), drag: rand(2.5, 5), grav: opts.grav ?? 0.5 });
    }
  }

  /** Кольцо: на земле (ударная волна) или лицом вдоль normal (вспышка удара). */
  ring(at: Vector3, color: number, from: number, to: number, life: number, normal: Vector3 = UP, alpha = 0.8) {
    const mesh = new Mesh(new RingGeometry(0.9, 1, 48), new MeshBasicMaterial({ color, transparent: true, blending: AdditiveBlending, side: DoubleSide, depthWrite: false }));
    mesh.position.copy(at);
    mesh.quaternion.setFromUnitVectors(v.set(0, 0, 1), normal.clone().normalize());
    this.scene.add(mesh);
    this.rings.push({ mesh, life, max: life, from, to, alpha });
  }

  /** Пыль у земли: мягкие клубы расходятся от точки (dir — куда сносит), растут и тают. */
  dust(at: Vector3, count: number, opts: { dir?: Vector3; speed?: number; size?: number; spread?: number; color?: number } = {}) {
    const speed = opts.speed ?? 3;
    const size = opts.size ?? 1;
    for (let i = 0; i < Math.round(count * DUST_DENSITY); i++) {
      if (this.puffs.length >= MAX_PUFFS) {
        const old = this.puffs.shift()!;
        this.scene.remove(old.sprite);
        old.sprite.material.dispose();
      }
      const angle = rand(0, Math.PI * 2);
      const vel = new Vector3(Math.cos(angle), 0, Math.sin(angle)).multiplyScalar(rand(0.3, 1) * speed * (opts.spread ?? 1));
      if (opts.dir) vel.addScaledVector(opts.dir, rand(0.5, 1) * speed);
      vel.y = rand(0.4, 1.4);
      const sprite = new Sprite(new SpriteMaterial({ map: this.glow, color: opts.color ?? 0xc9bca4, transparent: true, depthWrite: false, opacity: 0 }));
      sprite.position.copy(at).add(v.set(rand(-0.5, 0.5), rand(0.15, 0.5), rand(-0.5, 0.5)));
      this.scene.add(sprite);
      const max = rand(0.6, 1.15);
      this.puffs.push({ sprite, vel, life: max, max, from: rand(0.9, 1.5) * size, to: rand(2.6, 4.2) * size, alpha: rand(0.45, 0.7) });
    }
  }

  /** Язычки стихии (пламя, морозный пар, ядовитый дым): светящиеся клубы поднимаются и тают. */
  flame(at: Vector3, color: number, count = 1, size = 1, rise = 3) {
    for (let i = 0; i < count; i++) {
      if (this.puffs.length >= MAX_PUFFS) {
        const old = this.puffs.shift()!;
        this.scene.remove(old.sprite);
        old.sprite.material.dispose();
      }
      const sprite = new Sprite(new SpriteMaterial({ map: this.glow, color, transparent: true, depthWrite: false, opacity: 0, blending: AdditiveBlending }));
      sprite.position.copy(at).add(v.set(rand(-0.3, 0.3), rand(-0.1, 0.3), rand(-0.3, 0.3)));
      this.scene.add(sprite);
      const max = rand(0.35, 0.7);
      this.puffs.push({ sprite, vel: new Vector3(rand(-0.5, 0.5), rand(0.7, 1.3) * rise, rand(-0.5, 0.5)), life: max, max, from: rand(1.1, 1.6) * size, to: rand(0.2, 0.5) * size, alpha: rand(0.7, 1) });
    }
  }

  /** Мягкая вспышка-блик и короткий точечный свет. */
  flash(at: Vector3, color: number, size: number, life = 0.16, lightPower = 0) {
    const sprite = new Sprite(new SpriteMaterial({ map: this.glow, color, transparent: true, blending: AdditiveBlending, depthWrite: false, depthTest: false }));
    sprite.position.copy(at);
    this.scene.add(sprite);
    this.flashes.push({ sprite, life, max: life, size });
    if (lightPower > 0) {
      this.light.position.copy(at).add(v.set(0, 1.5, 2));
      this.light.color.set(color);
      this.light.intensity = lightPower;
      this.lightLife = 0.22;
    }
  }

  update(dt: number) {
    // осколки
    let n = 0;
    for (let i = this.chunks.length - 1; i >= 0; i--) {
      const c = this.chunks[i];
      c.life -= dt;
      if (c.life <= 0) {
        this.chunks.splice(i, 1);
        continue;
      }
      c.vel.y += GRAVITY * dt;
      c.pos.addScaledVector(c.vel, dt);
      const floor = c.size / 2;
      if (c.pos.y < floor) {
        c.pos.y = floor;
        if (c.vel.y < -1.5) {
          c.vel.y *= -c.bounce;
          c.vel.x *= 0.7;
          c.vel.z *= 0.7;
          c.spin *= 0.6;
        } else {
          c.vel.set(c.vel.x * (1 - 6 * dt), 0, c.vel.z * (1 - 6 * dt));
          c.spin *= 1 - 5 * dt;
        }
      }
      c.rot.premultiply(q.setFromAxisAngle(c.axis, c.spin * dt));
    }
    let b = 0;
    for (const c of this.chunks) {
      const k = c.size * Math.min(1, (c.life / c.max) * 3.5);
      m4.compose(c.pos, c.rot, s.set(k, k, k));
      if (c.block) {
        this.blockMesh.setMatrixAt(b, m4);
        this.blockMesh.setColorAt(b++, c.color);
      } else {
        this.chunkMesh.setMatrixAt(n, m4);
        this.chunkMesh.setColorAt(n++, c.color);
      }
    }
    for (const mesh of [this.chunkMesh, this.blockMesh]) {
      mesh.count = mesh === this.chunkMesh ? n : b;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }

    // искры
    n = 0;
    for (let i = this.sparks.length - 1; i >= 0; i--) {
      const p = this.sparks[i];
      p.life -= dt;
      if (p.life <= 0) {
        this.sparks.splice(i, 1);
        continue;
      }
      p.vel.multiplyScalar(Math.max(0, 1 - p.drag * dt));
      p.vel.y += GRAVITY * p.grav * dt;
      p.pos.addScaledVector(p.vel, dt);
      if (p.pos.y < 0.03) {
        p.pos.y = 0.03;
        p.vel.y *= -0.4;
      }
    }
    for (const p of this.sparks) {
      const a = p.life / p.max;
      const speed = p.vel.length();
      const len = Math.max(0.08, Math.min(1.6, speed * 0.045)) * p.len;
      q.setFromUnitVectors(UP, v.copy(p.vel).normalize());
      this.sparkMesh.setMatrixAt(n, m4.compose(p.pos, q, s.set(0.05 + 0.05 * a, len, 0.05 + 0.05 * a)));
      this.sparkMesh.setColorAt(n, this.tmpColor.copy(p.color).multiplyScalar(0.25 + 1.4 * a));
      n++;
    }
    this.sparkMesh.count = n;
    this.sparkMesh.instanceMatrix.needsUpdate = true;
    if (this.sparkMesh.instanceColor) this.sparkMesh.instanceColor.needsUpdate = true;
    if (n === 0) this.sparkMesh.setMatrixAt(0, hidden);

    // кольца
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i];
      r.life -= dt;
      const u = 1 - Math.max(0, r.life) / r.max;
      const k = r.from + (r.to - r.from) * (1 - (1 - u) ** 3);
      r.mesh.scale.setScalar(k);
      (r.mesh.material as MeshBasicMaterial).opacity = r.alpha * (1 - u) ** 1.5;
      if (r.life <= 0) {
        this.scene.remove(r.mesh);
        r.mesh.geometry.dispose();
        (r.mesh.material as MeshBasicMaterial).dispose();
        this.rings.splice(i, 1);
      }
    }

    // вспышки
    for (let i = this.flashes.length - 1; i >= 0; i--) {
      const f = this.flashes[i];
      f.life -= dt;
      const u = 1 - Math.max(0, f.life) / f.max;
      f.sprite.scale.setScalar(f.size * (0.5 + 0.9 * u));
      f.sprite.material.opacity = (1 - u) ** 2;
      if (f.life <= 0) {
        this.scene.remove(f.sprite);
        f.sprite.material.dispose();
        this.flashes.splice(i, 1);
      }
    }
    // пыль
    for (let i = this.puffs.length - 1; i >= 0; i--) {
      const p = this.puffs[i];
      p.life -= dt;
      if (p.life <= 0) {
        this.scene.remove(p.sprite);
        p.sprite.material.dispose();
        this.puffs.splice(i, 1);
        continue;
      }
      const u = 1 - p.life / p.max;
      p.vel.multiplyScalar(Math.max(0, 1 - 3.2 * dt));
      p.sprite.position.addScaledVector(p.vel, dt);
      p.sprite.scale.setScalar(p.from + (p.to - p.from) * (1 - (1 - u) ** 2));
      p.sprite.material.opacity = p.alpha * Math.min(1, u * 8) * (1 - u) ** 1.3;
    }
    if (this.lightLife > 0) {
      this.lightLife -= dt;
      this.light.intensity *= Math.max(0, 1 - 14 * dt);
      if (this.lightLife <= 0) this.light.intensity = 0;
    }
  }

  dispose() {
    this.chunkMesh.geometry.dispose();
    (this.chunkMesh.material as MeshLambertMaterial).dispose();
    (this.blockMesh.material as MeshStandardMaterial).dispose();
    this.sparkMesh.geometry.dispose();
    (this.sparkMesh.material as MeshBasicMaterial).dispose();
    this.glow.dispose();
    for (const r of this.rings) r.mesh.geometry.dispose();
    for (const p of this.puffs) p.sprite.material.dispose();
  }
}
