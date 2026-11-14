// Сцена 3D-боя на three.js: два бойца лицом друг к другу, пол с сеткой, свет с тенями, камера с тряской.
// Рисует в свой canvas; Phaser показывает его как текстуру под интерфейсом (Battle3DLayer).
import {
  CanvasTexture, Color, DirectionalLight, Fog, HemisphereLight, Mesh, MeshBasicMaterial, MeshLambertMaterial, PCFShadowMap, PerspectiveCamera,
  PlaneGeometry, PMREMGenerator, RepeatWrapping, RingGeometry, SRGBColorSpace, Scene, Vector3, WebGLRenderer,
} from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { Fighter3D, type Fighter3DOpts } from './Fighter3D';
import { Fx } from './fx';

const BG = 0x25262a;
const FLOOR = 0x2f3035;
/** Расстояние между передними гранями бойцов, в кубах. */
const GAP = 6.5;
const FOV = 26;
/** Сила отражений окружения на блоках. */
const ENV_INTENSITY = 0.35;

export interface HitInfo {
  /** Куда бил атакующий (мир). */
  dir: Vector3;
  weight: number;
  impact: 'cut' | 'pierce' | 'crush' | 'punch';
  /** Цвет стихии оружия (камень): искры и шлейф этого цвета. */
  tint?: number;
}

function gridTexture(): CanvasTexture {
  const size = 256;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, size, size);
  g.strokeStyle = 'rgba(0,0,0,0.22)';
  g.lineWidth = 3;
  g.strokeRect(0, 0, size, size);
  const tex = new CanvasTexture(c);
  tex.wrapS = tex.wrapT = RepeatWrapping;
  tex.colorSpace = SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

export class Arena3D {
  readonly scene = new Scene();
  readonly camera: PerspectiveCamera;
  readonly fx: Fx;
  readonly gap = GAP;
  /** Время сцены, мс: замирает на стоп-кадре удара и затем догоняет реальное. */
  now = 0;
  /** Последний удар — по нему цель выбирает силу и направление эффектов. */
  lastHit?: HitInfo;
  private readonly renderer: WebGLRenderer;
  private readonly fighters: Fighter3D[] = [];
  private readonly camHome = new Vector3();
  private readonly camLook = new Vector3(0, 1.2, 0);
  private readonly kick = new Vector3();
  private readonly kickVel = new Vector3();
  private trauma = 0;
  private zoom = 0;
  private freeze = 0;
  private lag = 0;
  private clock = 0;
  private readonly sun: DirectionalLight;
  private readonly disposables: Array<{ dispose(): void }> = [];

  constructor(readonly canvas: HTMLCanvasElement, private readonly width: number, private readonly height: number) {
    this.renderer = new WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(width, height, false);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = PCFShadowMap;
    this.scene.background = new Color(BG);
    this.scene.fog = new Fog(BG, 48, 120);

    this.camera = new PerspectiveCamera(FOV, width / height, 0.5, 300);
    // модели — чуть ниже центра экрана: сверху шапка с полосками, снизу слоты
    this.camera.setViewOffset(width, height, 0, -20, width, height);

    // отражения для материалов блоков (URP Lit в клиенте отражает окружение; гладкость 0.7–1)
    const pmrem = new PMREMGenerator(this.renderer);
    const room = new RoomEnvironment();
    const env = pmrem.fromScene(room, 0.04).texture;
    room.dispose();
    pmrem.dispose();
    this.scene.environment = env;
    this.scene.environmentIntensity = ENV_INTENSITY;
    this.disposables.push(env);

    this.scene.add(new HemisphereLight(0xcfd8ff, 0x3b332c, 1.5));
    this.sun = new DirectionalLight(0xfff2de, 2.6);
    this.sun.position.set(-14, 26, 18);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.03;
    const cam = this.sun.shadow.camera;
    cam.left = -30;
    cam.right = 30;
    cam.top = 18;
    cam.bottom = -18;
    cam.near = 1;
    cam.far = 90;
    this.scene.add(this.sun, this.sun.target);
    const rim = new DirectionalLight(0x8fb4ff, 0.9);
    rim.position.set(10, 12, -22);
    this.scene.add(rim);

    const grid = gridTexture();
    grid.repeat.set(200, 200);
    const floor = new Mesh(new PlaneGeometry(400, 400), new MeshLambertMaterial({ color: FLOOR, map: grid }));
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.scene.add(floor);
    const ringMat = new MeshBasicMaterial({ color: 0xf2b312, transparent: true, opacity: 0.16, depthWrite: false });
    const ring = new Mesh(new RingGeometry(GAP / 2 - 0.12, GAP / 2, 64), ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.02;
    this.scene.add(ring);
    this.disposables.push(grid, floor.geometry, floor.material, ring.geometry, ringMat);

    this.fx = new Fx(this.scene);
  }

  addFighter(opts: Fighter3DOpts): Fighter3D {
    const fighter = new Fighter3D(this, opts);
    this.fighters.push(fighter);
    this.layout();
    return fighter;
  }

  /** Расставить бойцов (игрок слева) и подобрать камеру, чтобы оба помещались. */
  private layout() {
    let extent = GAP / 2 + 4;
    for (const [i, f] of this.fighters.entries()) {
      const facing = i === 0 ? 1 : -1;
      f.place(-facing * (GAP / 2 + f.halfLength), facing);
      extent = Math.max(extent, GAP / 2 + f.halfLength * 2);
    }
    const halfTan = Math.tan((FOV * Math.PI) / 360) * (this.width / this.height);
    const dist = Math.max(30, (extent + 2.5) / halfTan);
    const pitch = (38 * Math.PI) / 180;
    this.camHome.set(0, this.camLook.y + Math.sin(pitch) * dist, Math.cos(pitch) * dist);
    this.camera.position.copy(this.camHome);
    this.camera.lookAt(this.camLook);
    this.camera.updateMatrixWorld(true);
  }

  /** Мировая точка → координаты экрана игры. */
  project(world: Vector3): { x: number; y: number } {
    const p = world.clone().project(this.camera);
    return { x: (p.x * 0.5 + 0.5) * this.width, y: (-p.y * 0.5 + 0.5) * this.height };
  }

  /** Тряска камеры: amount 0..1 копится, dir — толчок вдоль удара. */
  shake(amount: number, dir?: Vector3) {
    this.trauma = Math.min(1, this.trauma + amount);
    if (dir) this.kickVel.addScaledVector(dir, 9 * amount);
  }

  /** Стоп-кадр удара: сцена замирает на ms, затем догоняет. */
  hitStop(ms: number) {
    this.freeze = Math.max(this.freeze, Math.min(110, ms));
  }

  /** Короткий наезд камеры (крит). */
  punchZoom(amount: number) {
    this.zoom = Math.min(1.4, this.zoom + amount);
  }

  update(dtMs: number) {
    const real = Math.min(50, Math.max(0, dtMs));
    let sim = real;
    if (this.freeze > 0) {
      const used = Math.min(real, this.freeze);
      this.freeze -= used;
      this.lag += used;
      sim = real - used;
    } else if (this.lag > 0) {
      const extra = Math.min(this.lag, real);
      this.lag -= extra;
      sim = real + extra;
    }
    this.now += sim;
    this.clock += real / 1000;
    const dt = sim / 1000;
    for (const f of this.fighters) f.update(dt);
    this.fx.update(this.freeze > 0 ? (real / 1000) * 0.12 : dt);

    // камера: толчок-пружина + дрожь + лёгкое дыхание
    const rdt = real / 1000;
    this.kickVel.addScaledVector(this.kick, -120 * rdt).multiplyScalar(Math.max(0, 1 - 12 * rdt));
    this.kick.addScaledVector(this.kickVel, rdt);
    this.trauma = Math.max(0, this.trauma - 1.9 * rdt);
    this.zoom = Math.max(0, this.zoom - this.zoom * 7 * rdt - 0.2 * rdt);
    const t = this.clock;
    const power = this.trauma * this.trauma;
    const sx = (Math.sin(t * 91.7) + Math.sin(t * 57.3 + 1.3)) * 0.5 * power * 0.85;
    const sy = (Math.sin(t * 83.1 + 2.1) + Math.sin(t * 49.9 + 0.4)) * 0.5 * power * 0.7;
    const drift = Math.sin(t * 0.35) * 0.5;
    this.camera.position.copy(this.camHome).add(this.kick);
    this.camera.position.x += sx + drift;
    this.camera.position.y += sy;
    this.camera.position.addScaledVector(this.camHome, -0.045 * this.zoom);
    this.camera.lookAt(this.camLook.x + this.kick.x * 0.5 + sx * 0.4, this.camLook.y + sy * 0.4, this.camLook.z);
    this.camera.rotateZ(Math.sin(t * 71.3) * power * 0.012);
    this.camera.updateMatrixWorld(true);
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    for (const f of this.fighters) f.dispose();
    this.fx.dispose();
    for (const d of this.disposables) d.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }
}
