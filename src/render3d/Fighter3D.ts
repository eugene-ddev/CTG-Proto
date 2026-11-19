// Боец в 3D-бою: модель из кубов, оружие в слотах, клипы ударов, отдача, уворот, рассыпание.
// Внутри группы unity координаты — как в чертежах (Unity: X вправо, Y вверх, Z вперёд); зеркало по Z переводит их в three.js.
import {
  BackSide, BufferGeometry, Color, Group, LineBasicMaterial, LineSegments, Matrix4, Mesh,
  MeshBasicMaterial, MeshStandardMaterial, Quaternion, SphereGeometry, Vector3,
} from 'three';
import type { BlockGeometry, CharacterBlueprintSlot, ItemModel } from '../data/types';
import { IDLE_KEYS, IDLE_PERIOD_MS, SLOT_SCALE, samplePose } from '../render/anim';
import { eulerMatrix, quatMatrix, type Mat3 } from '../render/iso';
import { skinColorOf } from '../data/skins';
import type { Arena3D } from './Arena3D';
import { BLOCK_EDGES, blockGeometry, blockMaterial, unityColor } from './blocks';
import { CLIPS, sampleBody, sampleWeapon, weaponStyleOf, type BodyPose, type Clip, type WeaponStyle } from './clips';
import { Trail } from './fx';

const NEUTRAL = 0xc2b8a3;
const DEG = Math.PI / 180;
/** Тело длинное — полный разворот из клипа выглядел бы заносом; берём долю. */
const YAW_SCALE = 0.5;
const hex = (color?: string) => (color ? parseInt(color.slice(1), 16) : NEUTRAL);
/** Цвета стихий: горение, яд, лёд, щит. */
export const EFFECT_TINT: Record<string, number> = { burn: 0xff7a1a, poison: 0x62f03c, freeze: 0x7fd4ff, shield: 0x7fb8ff };
const ICE = new Color(0xbfe9ff);

// контуры — по габариту блока (без шипа): у целых кубов еле заметные (рёбра и пазы уже в карте нормалей),
// у разбитых — светлый контур на месте куба
const CUBE_EDGES = BLOCK_EDGES.cube;
const WEDGE_EDGES = BLOCK_EDGES.wedge;
const EDGE_MAT = new LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.16 });
const GHOST_EDGE_MAT = new LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.1, depthWrite: false });

export const setFromMat3 = (out: Matrix4, m: Mat3, k: number, t: [number, number, number]) =>
  out.set(m[0][0] * k, m[0][1] * k, m[0][2] * k, t[0], m[1][0] * k, m[1][1] * k, m[1][2] * k, t[1], m[2][0] * k, m[2][1] * k, m[2][2] * k, t[2], 0, 0, 0, 1);

type BlockMesh = Mesh<BufferGeometry, MeshStandardMaterial>;

/** Блок — меш и материал из Unity-клиента (render3d/blocks.ts). */
function blockMesh(b: BlockGeometry, color: number, pattern?: 'spots'): BlockMesh {
  const cube = b.shape === 'cube';
  const opacity = b.opacity ?? 1;
  const mesh = new Mesh(blockGeometry(b.shape), blockMaterial(b.shape, color, opacity, pattern));
  mesh.matrixAutoUpdate = false;
  setFromMat3(mesh.matrix, b.quat ? quatMatrix(b.quat) : eulerMatrix(b.rot), b.scale ?? 1, b.pos);
  mesh.castShadow = opacity >= 1;
  mesh.receiveShadow = true;
  const edges = new LineSegments(cube ? CUBE_EDGES : WEDGE_EDGES, EDGE_MAT);
  mesh.add(edges);
  return mesh;
}

/** Цвет стихии удара: первый эффект оружия с известным цветом. */
function gemTint(effects?: readonly string[]): number | undefined {
  const id = effects?.find((e) => EFFECT_TINT[e] !== undefined && e !== 'shield');
  return id ? EFFECT_TINT[id] : undefined;
}

export interface Fighter3DOpts {
  side: 'player' | 'enemy';
  blueprintId: string;
  skinId?: string;
  pattern?: 'spots';
  blocks: BlockGeometry[];
  slots: CharacterBlueprintSlot[];
  equipped: Array<ItemModel | null>;
  colorOf: (index: number) => number;
  alive: (index: number) => boolean;
  /** Эффекты удара по слотам (камни в оружии): оружие светится и искрит цветом стихии. */
  slotEffects?: Array<readonly string[] | undefined>;
}

/** Что известно об ударе заранее — чтобы прицелиться в куб и вовремя увернуться. */
export interface AttackCtx {
  itemId?: string | null;
  pattern?: string;
  target?: Fighter3D;
  block?: number;
  outcome?: 'hit' | 'evade' | 'shield';
  crit?: boolean;
  /** Эффекты удара (камни в оружии) — красят шлейф и искры. */
  effects?: readonly string[];
}

interface Action {
  kind: 'attack' | 'artifact';
  slot: number;
  clip?: Clip;
  style?: WeaponStyle;
  start: number;
  dur: number;
  hit?: () => void;
  ctx?: AttackCtx;
  /** Удар начат, когда боец уже стоял у цели (вторая рука, серия кинжала): тело не возвращается между ударами. */
  chained: boolean;
  /** Смещение тела к цели (локально: x — вбок, z — вперёд со знаком минус) и поправка высоты оружия. */
  reach: Vector3;
  aimY: number;
  evadeSent?: boolean;
}

interface SlotRig {
  slot: CharacterBlueprintSlot;
  holder: Group;
  pose: Group;
  model: ItemModel;
  tip: Vector3;
  base: Vector3;
  trail?: Trail;
  /** Цвет стихии оружия (камень) и клинок — блоки, которые светятся. */
  tint?: number;
  blade: Array<BlockMesh>;
}

const tmpQ = new Quaternion(), restQ = new Quaternion();
const tmpP = new Vector3(), restP = new Vector3();
const tmpM = new Matrix4();
const v1 = new Vector3(), v2 = new Vector3(), v3 = new Vector3();
const bodyPose: BodyPose = { adv: 0, hop: 0, yaw: 0, pitch: 0 };

export class Fighter3D {
  readonly root = new Group();
  private readonly body = new Group();
  private readonly unity = new Group();
  private readonly meshes: Array<BlockMesh> = [];
  private readonly solid: boolean[];
  private readonly flashes = new Map<number, { left: number; total: number }>();
  private readonly rigs = new Map<number, SlotRig>();
  private readonly actions = new Map<number, Action>();
  private readonly home = new Vector3();
  /** Центр модели (Unity) и её габариты. */
  private readonly centre: Vector3;
  readonly halfLength: number;
  readonly halfWidth: number;
  private readonly frontZ: number;
  private facing = 1;
  private readonly bodyOffset = new Vector3();
  private readonly knock = new Vector3();
  private readonly knockVel = new Vector3();
  private tilt = 0;
  private tiltVel = 0;
  private evade?: { start: number; dur: number; landed: boolean };
  private crumbled = false;
  /** Эффекты на кубах (горение, яд, лёд) и таймеры их частиц. */
  private readonly statuses = new Map<number, Set<string>>();
  private readonly baseColors: Color[] = [];
  private statusClock = 0;
  private glowClock = 0;
  private shield?: Mesh<SphereGeometry, MeshBasicMaterial>;
  private readonly phase = Math.random() * 10;
  private readonly t0: number;

  constructor(private readonly arena: Arena3D, private readonly opts: Fighter3DOpts) {
    this.t0 = arena.now;
    const xs = opts.blocks.map((b) => b.pos[0]), ys = opts.blocks.map((b) => b.pos[1]), zs = opts.blocks.map((b) => b.pos[2]);
    const [x0, x1, y0, z0, z1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.min(...zs), Math.max(...zs)];
    this.centre = new Vector3((x0 + x1) / 2, y0 - 0.5, (z0 + z1) / 2);
    this.halfLength = (z1 - z0) / 2 + 0.5;
    this.halfWidth = (x1 - x0) / 2 + 0.5;
    this.frontZ = z1 + 0.5;
    this.unity.scale.set(1, 1, -1);
    this.unity.position.set(-this.centre.x, -this.centre.y, this.centre.z);
    this.body.rotation.order = 'YXZ';
    this.body.add(this.unity);
    this.root.add(this.body);

    this.solid = opts.blocks.map((_, i) => opts.alive(i));
    opts.blocks.forEach((b, i) => {
      const mesh = blockMesh(b, skinColorOf(opts.blueprintId, opts.skinId, i) ?? opts.colorOf(i), opts.pattern);
      this.meshes.push(mesh);
      this.baseColors.push(mesh.material.color.clone());
      this.unity.add(mesh);
      if (!this.solid[i]) this.applyLook(i);
    });

    opts.equipped.forEach((model, k) => {
      const slot = opts.slots[k];
      if (!model || !slot) return;
      const holder = new Group();
      const scale = slot.scale ?? SLOT_SCALE;
      holder.position.set(...slot.pos);
      holder.scale.set(slot.isLeftHand ? -scale : scale, scale, scale);
      const pose = new Group();
      const inner = new Group();
      inner.scale.setScalar(model.scale);
      const tint = slot.type === 'Hand' ? gemTint(opts.slotEffects?.[k]) : undefined;
      const blade: SlotRig['blade'] = [];
      const top = Math.max(...model.blocks.map((b) => b.pos[1])) + 0.5;
      const bottom = Math.min(...model.blocks.map((b) => b.pos[1])) - 0.5;
      for (const b of model.blocks) {
        const mesh = blockMesh(b, hex(b.color));
        inner.add(mesh);
        // клинок — верхняя часть оружия: она и светится стихией
        if (tint !== undefined && b.pos[1] >= bottom + (top - bottom) * 0.4) {
          mesh.material.emissive.set(tint);
          blade.push(mesh);
        }
      }
      pose.add(inner);
      holder.add(pose);
      this.unity.add(holder);
      this.rigs.set(k, {
        slot, holder, pose, model, tint, blade,
        tip: new Vector3(0, top * model.scale, 0),
        base: new Vector3(0, (bottom + (top - bottom) * 0.58) * model.scale, 0),
      });
    });
    arena.scene.add(this.root);
  }

  /** Поставить бойца: x — мировая координата центра, facing: +1 — смотрит вправо (+X), −1 — влево. */
  place(x: number, facing: 1 | -1) {
    this.facing = facing;
    this.home.set(x, 0, 0);
    this.root.position.copy(this.home);
    this.root.rotation.y = (-facing * Math.PI) / 2;
    this.root.updateMatrixWorld(true);
  }

  /** Направление «вперёд» бойца в мире. */
  get forward(): Vector3 {
    return new Vector3(this.facing, 0, 0);
  }

  /** Экранная X центра бойца (для подписей над ним). */
  get x(): number {
    return this.arena.project(v1.copy(this.home).setY(1)).x;
  }

  /** Центр куба на экране — для чисел урона и надписей. */
  blockWorldPos(index: number): { x: number; y: number } {
    return this.arena.project(this.blockPoint(index, v1));
  }

  /** Центр куба в мире. */
  blockPoint(index: number, out = new Vector3()): Vector3 {
    const mesh = this.meshes[index];
    if (!mesh) return out.copy(this.root.position).setY(1);
    this.root.updateMatrixWorld(true);
    return out.setFromMatrixPosition(mesh.matrixWorld);
  }

  // ───────────── действия ─────────────

  /** Удар слотом: клип по типу оружия, рывок к кубу-цели. Возвращает задержку до попадания, мс. */
  playAttack(slot: number, _style: unknown, dur: number, onHit?: () => void, ctx: AttackCtx = {}): number {
    const prev = this.actions.get(slot);
    prev?.hit?.();
    const rig = this.rigs.get(slot);
    const forward = this.advance();
    let style = weaponStyleOf(rig ? ctx.itemId : null, ctx.pattern);
    const chained = forward > 0.6;
    if (style === 'stab' && chained && prev?.kind === 'attack' && (prev.style === 'stab' || prev.style === 'stabCombo')) style = 'stabCombo';
    const clip = CLIPS[style];
    const action: Action = { kind: 'attack', slot, clip, style, start: this.arena.now, dur, hit: onHit, ctx, chained, reach: new Vector3(), aimY: 0 };
    // рывок с места — пыль из-под хвоста
    if (!chained) this.arena.fx.dust(this.footPoint(-0.5), 5, { dir: this.forward.negate(), speed: 2.5, size: 0.9 });
    this.solveReach(action, rig);
    this.actions.set(slot, action);
    if (rig && clip.trail[1] > clip.trail[0]) {
      rig.trail ??= new Trail(this.arena.scene);
      rig.trail.setColor(ctx.crit ? 0xffd24a : gemTint(ctx.effects) ?? clip.trailColor);
    }
    return dur * clip.hit;
  }

  /** Насколько тело сейчас выдвинуто к цели, 0..1. */
  private advance(): number {
    let best = 0;
    for (const a of this.actions.values()) {
      if (a.kind !== 'attack' || !a.clip) continue;
      const u = (this.arena.now - a.start) / a.dur;
      best = Math.max(best, this.advOf(a, u));
    }
    return best;
  }

  private advOf(a: Action, u: number): number {
    const adv = sampleBody(a.clip!, u, bodyPose).adv;
    return a.chained && u <= a.clip!.hit ? Math.max(adv, 1) : adv;
  }

  /** Куда и насколько шагнуть, чтобы в момент попадания остриё пришло в куб-цель. */
  private solveReach(a: Action, rig?: SlotRig) {
    const clip = a.clip!;
    const target = a.ctx?.target;
    const gap = this.arena.gap;
    if (!target || a.ctx?.block === undefined) {
      a.reach.set(0, 0, -(gap - 1));
      return;
    }
    // поза в момент попадания при теле «дома»
    const keepPos = this.body.position.clone(), keepRot = this.body.rotation.clone(), keepRoot = this.root.position.clone();
    const hitBody = sampleBody(clip, clip.hit, bodyPose);
    this.root.position.copy(this.home);
    this.body.position.set(0, hitBody.hop, 0);
    this.applyBodyRotation(hitBody.yaw, hitBody.pitch, rig?.slot.isLeftHand ?? false, 0);
    if (rig) {
      this.idlePose(a.slot, rig);
      sampleWeapon(clip, clip.hit, restQ, restP, tmpQ, tmpP);
      rig.pose.quaternion.copy(tmpQ);
      rig.pose.position.copy(tmpP);
    }
    this.root.updateMatrixWorld(true);
    const tip = rig ? rig.pose.localToWorld(v1.copy(rig.tip)) : this.unity.localToWorld(v1.set(this.centre.x, this.centre.y + 1.2, this.frontZ));
    const aim = target.blockPoint(a.ctx.block, v2).addScaledVector(this.forward, -0.35);
    const local = this.root.worldToLocal(v3.copy(aim)).sub(this.root.worldToLocal(tip));
    // вперёд — это −Z локально; не заходить вглубь противника дальше пары кубов
    const maxForward = gap + 0.6;
    a.reach.set(Math.max(-4, Math.min(4, local.x)), 0, -Math.max(gap * 0.35, Math.min(maxForward, -local.z)));
    a.aimY = rig ? Math.max(-2.6, Math.min(1.6, local.y)) / (rig.slot.scale ?? SLOT_SCALE) : 0;
    this.body.position.copy(keepPos);
    this.body.rotation.copy(keepRot);
    this.root.position.copy(keepRoot);
  }

  /** Уворот: отскок назад, от удара; пыль из-под ног на старте и при приземлении. */
  playEvade(dur: number) {
    if (this.evade && this.arena.now - this.evade.start < this.evade.dur * 0.8) return this;
    this.evade = { start: this.arena.now, dur, landed: false };
    this.arena.fx.dust(this.footPoint(0.6), 7, { dir: this.forward, speed: 3.5 });
    return this;
  }

  /** Точка на земле под бойцом: along — доля длины тела вперёд (+1 — нос, −1 — хвост), с учётом текущего смещения. */
  private footPoint(along: number): Vector3 {
    this.root.updateMatrixWorld(true);
    return this.body.localToWorld(new Vector3(0, 0, -along * this.halfLength)).setY(0.05);
  }

  /** Срабатывание артефакта: подпрыгивает, увеличивается, вспышка и кольца. */
  playArtifact(slot: number, dur: number) {
    this.actions.set(slot, { kind: 'artifact', slot, start: this.arena.now, dur, chained: false, reach: new Vector3(), aimY: 0 });
    const rig = this.rigs.get(slot);
    if (rig) {
      this.root.updateMatrixWorld(true);
      const at = rig.holder.localToWorld(new Vector3(0, 1.5, 0));
      this.arena.fx.flash(at, 0x7fb8ff, 5, 0.3, 50);
      this.arena.fx.ring(at, 0x7fb8ff, 0.4, 3.2, 0.45, new Vector3(0, 0.25, 1));
      this.arena.fx.sparksAt(at, 0x9fd0ff, 18, { speed: 9, grav: -0.15, life: [0.3, 0.7] });
    }
    return this;
  }

  /** Вспышка куба цветом (попадание, тик эффекта). */
  flashBlock(index: number, color: number, ms = 160) {
    const mesh = this.meshes[index];
    if (!mesh) return this;
    mesh.material.emissive.set(color);
    this.flashes.set(index, { left: ms, total: ms });
    return this;
  }

  /** Какие кубы целы: разбитые отлетают осколками и остаются полупрозрачным контуром. */
  setLookOf(fn: (index: number) => string) {
    this.meshes.forEach((_, i) => {
      const alive = fn(i) === 'solid';
      if (alive === this.solid[i]) return;
      this.solid[i] = alive;
      this.applyLook(i);
      if (!alive && !this.crumbled) this.breakFx(i);
      if (!alive && this.statuses.delete(i)) {
        this.meshes[i].material.color.copy(this.baseColors[i]);
        this.meshes[i].material.emissiveIntensity = 0;
      }
    });
    return this;
  }

  redraw() {
    return this;
  }

  private applyLook(index: number) {
    const mesh = this.meshes[index];
    const alive = this.solid[index];
    mesh.material.transparent = !alive;
    mesh.material.opacity = alive ? 1 : 0.1;
    mesh.material.depthWrite = alive;
    mesh.material.needsUpdate = true;
    mesh.castShadow = alive;
    mesh.renderOrder = alive ? 0 : 2;
    (mesh.children[0] as LineSegments).material = alive ? EDGE_MAT : GHOST_EDGE_MAT;
  }

  private breakFx(index: number) {
    const at = this.blockPoint(index);
    const color = unityColor(this.opts.colorOf(index));
    const dir = this.arena.lastHit?.dir ?? this.forward.negate();
    const weight = this.arena.lastHit?.weight ?? 0.4;
    this.arena.fx.cube(at, color, v1.copy(dir).multiplyScalar(4 + 6 * weight).add(v2.set((Math.random() - 0.5) * 5, 7 + Math.random() * 4, (Math.random() - 0.5) * 7)), 0.85, 1.5);
    this.arena.fx.debris(at, color, 14, { dir, speed: 5 + 4 * weight, size: [0.14, 0.36] });
    this.arena.fx.sparksAt(at, 0xffffff, 8, { speed: 12 });
    this.arena.fx.flash(at, 0xffffff, 2.6, 0.14);
    this.arena.shake(0.18 + 0.12 * weight, dir);
  }

  /** Удар пришёл в этого бойца: искры, вспышка, тряска, стоп-кадр, отдача. */
  struck(block: number, outcome: 'hit' | 'evade' | 'shield', crit: boolean) {
    const hit = this.arena.lastHit;
    const dir = hit?.dir.clone() ?? this.forward.negate();
    const weight = (hit?.weight ?? 0.4) * (crit ? 1.35 : 1);
    const at = this.blockPoint(block).addScaledVector(dir, -0.5);
    const fx = this.arena.fx;
    const back = dir.clone().negate();
    if (outcome === 'evade') {
      fx.sparksAt(at, 0xffffff, 6, { dir, speed: 20, cone: 0.15, life: [0.1, 0.2] });
      return;
    }
    if (outcome === 'shield') {
      const centre = v1.copy(this.root.position).setY(1.4);
      fx.ring(centre, 0x7fb8ff, 2.5, this.halfLength + 2.5, 0.35, new Vector3(0, 0.3, 1), 0.7);
      fx.ring(at, 0x9fd0ff, 0.3, 2.4, 0.25, back);
      fx.flash(at, 0x7fb8ff, 4, 0.2, 40);
      fx.sparksAt(at, 0x9fd0ff, 16, { dir: back, speed: 14, cone: 0.9 });
      this.arena.shake(0.2, dir);
      this.arena.hitStop(30);
      return;
    }
    const tint = crit ? 0xffd24a : 0xfff4dc;
    fx.flash(at, tint, 2.4 + 3.2 * weight, 0.16, 40 + 110 * weight);
    fx.ring(at, tint, 0.25, 1.5 + 2.4 * weight, 0.2 + 0.1 * weight, back);
    const count = Math.round(10 + 24 * weight);
    switch (hit?.impact ?? 'cut') {
      case 'cut':
        fx.sparksAt(at, 0xffe9b0, count, { dir: v2.copy(back).multiplyScalar(0.6).add(v3.set(0, 0.7, 0)), speed: 20, cone: 0.7 });
        break;
      case 'pierce':
        fx.sparksAt(at, 0xffe9b0, Math.round(count * 0.6), { dir: back, speed: 24, cone: 0.25, len: 1.5 });
        fx.sparksAt(at, 0xffffff, Math.round(count * 0.5), { dir, speed: 16, cone: 0.35 });
        break;
      case 'crush': {
        const ground = v2.copy(at).setY(0.06);
        fx.sparksAt(at, 0xffd9a0, count, { speed: 18, cone: 1 });
        fx.ring(ground, 0xffffff, 0.6, 4 + 3 * weight, 0.45, undefined, 0.28);
        fx.ring(ground, 0xffd9a0, 0.3, 2.4 + 2 * weight, 0.3, undefined, 0.4);
        fx.debris(ground, 0x55565c, Math.round(14 * weight), { speed: 6, size: [0.1, 0.26], up: 5, life: [0.5, 0.9] });
        fx.dust(ground, Math.round(8 + 8 * weight), { speed: 5 + 3 * weight, size: 1.3 });
        break;
      }
      case 'punch':
        fx.sparksAt(at, 0xffffff, Math.round(count * 0.6), { dir: back, speed: 14, cone: 0.9 });
        break;
    }
    if (hit?.tint !== undefined) {
      // стихия камня: свои искры и кольцо поверх обычных
      fx.sparksAt(at, hit.tint, 18, { speed: 15, cone: 1, life: [0.3, 0.7], grav: hit.tint === EFFECT_TINT.burn ? -0.2 : 0.3 });
      fx.ring(at, hit.tint, 0.3, 2.6, 0.3, back, 0.8);
      fx.flash(at, hit.tint, 3.2, 0.22);
    }
    if (crit) {
      fx.sparksAt(at, 0xffd24a, 26, { speed: 26, cone: 1, life: [0.25, 0.6] });
      fx.ring(at, 0xffd24a, 0.4, 4.5, 0.35, back, 0.9);
      this.arena.punchZoom(1);
    }
    this.arena.shake(0.22 + 0.6 * weight, dir);
    this.arena.hitStop(28 + 70 * weight);
    this.knockVel.addScaledVector(dir, 6 + 18 * weight);
    if (weight >= 0.4) fx.dust(this.footPoint(-0.2), Math.round(3 + 5 * weight), { dir, speed: 2 + 3 * weight });
    this.tiltVel += (40 + 110 * weight) * DEG;
  }

  /** Куб получил урон: вспышка и мелкие осколки его цвета; горение и яд — свои искры. */
  damaged(block: number, source: string, spread: boolean) {
    const at = this.blockPoint(block);
    const color = unityColor(this.opts.colorOf(block));
    const fx = this.arena.fx;
    if (source === 'burn') {
      this.flashBlock(block, 0xff8a2a, 260);
      fx.sparksAt(at, 0xff8a1f, 12, { dir: new Vector3(0, 1, 0), speed: 7, cone: 0.6, grav: -0.25, life: [0.35, 0.8] });
      fx.flash(at, 0xff7a1a, 2.2, 0.25);
    } else if (source === 'poison') {
      this.flashBlock(block, 0x8af06a, 260);
      fx.sparksAt(at, 0x7dff4f, 10, { dir: new Vector3(0, 1, 0), speed: 5, cone: 0.8, grav: -0.1, life: [0.4, 0.9] });
    } else {
      this.flashBlock(block, 0xffffff, spread ? 140 : 200);
      const dir = this.arena.lastHit?.dir;
      fx.debris(at, color, spread ? 4 : 8, { dir: dir?.clone().multiplyScalar(-0.35), speed: spread ? 4 : 6, size: [0.08, 0.2], life: [0.5, 0.9] });
    }
  }

  /** Эффект на кубе появился / прошёл (block null — на всём бойце: щит). */
  setEffect(block: number | null, effect: string, on: boolean) {
    if (block === null) {
      if (effect === 'shield') this.setShield(on);
      return;
    }
    const mesh = this.meshes[block];
    if (!mesh) return;
    let set = this.statuses.get(block);
    if (on) {
      if (!set) this.statuses.set(block, (set = new Set()));
      if (!set.has(effect)) {
        const at = this.blockPoint(block);
        this.arena.fx.flash(at, EFFECT_TINT[effect] ?? 0xffffff, 2.6, 0.25);
        this.arena.fx.ring(at, EFFECT_TINT[effect] ?? 0xffffff, 0.3, 1.6, 0.3, new Vector3(0, 1, 0.4), 0.7);
      }
      set.add(effect);
    } else if (set) {
      set.delete(effect);
      if (!set.size) {
        this.statuses.delete(block);
        mesh.material.color.copy(this.baseColors[block]);
        if (!this.flashes.has(block)) mesh.material.emissiveIntensity = 0;
      }
    }
  }

  private setShield(on: boolean) {
    if (on && !this.shield) {
      const radius = Math.max(this.halfLength, this.halfWidth) + 1.6;
      this.shield = new Mesh(new SphereGeometry(radius, 28, 18), new MeshBasicMaterial({ color: EFFECT_TINT.shield, transparent: true, opacity: 0.16, depthWrite: false, side: BackSide }));
      this.shield.position.y = 1;
      this.shield.scale.y = 0.6;
      this.body.add(this.shield);
      this.arena.fx.ring(v1.copy(this.root.position).setY(0.06), EFFECT_TINT.shield, 1, radius + 1, 0.4, undefined, 0.6);
    } else if (!on && this.shield) {
      this.body.remove(this.shield);
      this.shield.geometry.dispose();
      this.shield.material.dispose();
      this.shield = undefined;
    }
  }

  /** Оружие с камнем: клинок светится цветом стихии, по нему бегут язычки и искры. */
  private updateWeaponGlow(dt: number) {
    this.glowClock += dt;
    const emit = this.glowClock >= 0.07 && !this.crumbled;
    if (emit) this.glowClock = 0;
    const pulse = 0.5 + 0.5 * Math.sin(this.arena.now / 170);
    for (const rig of this.rigs.values()) {
      if (rig.tint === undefined || !rig.holder.visible) continue;
      for (const mesh of rig.blade) mesh.material.emissiveIntensity = 0.35 + 0.3 * pulse;
      if (!emit) continue;
      const at = rig.pose.localToWorld(v1.copy(rig.base).lerp(rig.tip, Math.random()));
      const burn = rig.tint === EFFECT_TINT.burn;
      this.arena.fx.flame(at, burn && Math.random() < 0.5 ? 0xffb347 : rig.tint, 1, burn ? 0.9 : 0.7, burn ? 2.6 : rig.tint === EFFECT_TINT.freeze ? 0.5 : 1.2);
      if (Math.random() < 0.3) this.arena.fx.sparksAt(at, rig.tint, 1, { speed: 3, cone: 1, grav: burn ? -0.2 : 0.2, life: [0.25, 0.6], len: 0.5 });
    }
  }

  /** Кадр эффектов на кубах: свечение и частицы стихии. */
  private updateStatuses(dt: number) {
    if (this.shield) this.shield.material.opacity = 0.13 + 0.06 * Math.sin(this.arena.now / 260);
    if (!this.statuses.size || this.crumbled) return;
    this.statusClock += dt;
    const emit = this.statusClock >= 0.09;
    if (emit) this.statusClock = 0;
    const pulse = 0.5 + 0.5 * Math.sin(this.arena.now / 140);
    for (const [index, set] of this.statuses) {
      const mesh = this.meshes[index];
      if (!this.solid[index]) continue;
      const frozen = set.has('freeze'), burning = set.has('burn'), poisoned = set.has('poison');
      mesh.material.color.copy(this.baseColors[index]);
      if (frozen) mesh.material.color.lerp(ICE, 0.7);
      if (!this.flashes.has(index)) {
        mesh.material.emissive.set(burning ? EFFECT_TINT.burn : poisoned ? EFFECT_TINT.poison : EFFECT_TINT.freeze);
        mesh.material.emissiveIntensity = burning ? 0.45 + 0.35 * pulse : poisoned ? 0.25 + 0.2 * pulse : 0.18;
      }
      if (!emit) continue;
      const at = this.blockPoint(index, v1);
      const up = v2.set(0, 1, 0);
      if (burning) {
        // куб горит: языки пламени над ним, искры и дым
        this.arena.fx.flame(v3.copy(at).setY(at.y + 0.45), Math.random() < 0.5 ? 0xffb347 : EFFECT_TINT.burn, 2, 1.25, 3.4);
        this.arena.fx.sparksAt(v3.copy(at).setY(at.y + 0.5), 0xffd27a, 1, { dir: up, speed: 6, cone: 0.5, grav: -0.3, life: [0.3, 0.7], len: 0.7 });
        if (Math.random() < 0.25) this.arena.fx.dust(at, 1, { speed: 0.6, size: 0.5, color: 0x3a3632 });
      }
      if (poisoned && Math.random() < 0.5) this.arena.fx.flame(v3.copy(at).setY(at.y + 0.4), EFFECT_TINT.poison, 1, 0.9, 1.4);
      if (poisoned && Math.random() < 0.6) this.arena.fx.sparksAt(v3.copy(at).setY(at.y + 0.5), EFFECT_TINT.poison, 1, { dir: up, speed: 2.2, cone: 0.9, grav: -0.08, life: [0.5, 1], len: 0.5 });
      if (frozen && Math.random() < 0.35) this.arena.fx.flame(v3.copy(at).setY(at.y + 0.3), 0xcfefff, 1, 0.8, 0.6);
      if (frozen && Math.random() < 0.3) this.arena.fx.sparksAt(at, 0xffffff, 1, { speed: 1.5, cone: 1, grav: 0.05, life: [0.3, 0.6], len: 0.4 });
    }
  }

  /** Поражение: модель рассыпается на кубы. Возвращает длительность, мс. */
  playCrumble(dur = 1400): number {
    if (this.crumbled) return dur;
    this.crumbled = true;
    this.root.updateMatrixWorld(true);
    const centre = v3.copy(this.root.position).setY(0.5);
    const life = (dur / 1000) * 1.25;
    const scatter = (mesh: BlockMesh, size: number) => {
      const at = new Vector3().setFromMatrixPosition(mesh.matrixWorld);
      const out = at.clone().sub(centre).setY(0).normalize().multiplyScalar(2 + Math.random() * 5);
      out.y = 5 + Math.random() * 8;
      out.addScaledVector(this.forward, -3);
      this.arena.fx.cube(at, mesh.material.color.getHex(), out, size, life * (0.7 + Math.random() * 0.5));
      mesh.visible = false;
    };
    this.meshes.forEach((mesh, i) => this.solid[i] && scatter(mesh, 0.92));
    this.meshes.forEach((mesh) => (mesh.visible = false));
    for (const rig of this.rigs.values()) {
      rig.pose.traverse((o) => o instanceof Mesh && scatter(o as BlockMesh, 0.6));
      rig.holder.visible = false;
    }
    this.arena.fx.ring(v1.copy(centre).setY(0.06), 0xffffff, 1, this.halfLength + 4, 0.6, undefined, 0.3);
    this.arena.fx.flash(v1.copy(centre).setY(1.5), 0xffffff, 9, 0.3, 80);
    this.arena.fx.dust(centre.clone().setY(0.05), 22, { speed: 6, size: 1.6, spread: 1.2 });
    this.arena.shake(0.7, this.forward.negate());
    return dur;
  }

  // ───────────── кадр ─────────────

  private idlePose(slot: number, rig: SlotRig) {
    const phase = ((((this.arena.now - this.t0) / IDLE_PERIOD_MS + slot * 0.21) % 1) + 1) % 1;
    if (rig.slot.type === 'Artifact') {
      restQ.identity();
      restP.set(0, 0.15 * Math.sin(phase * Math.PI * 2), 0);
      return;
    }
    const pose = samplePose(IDLE_KEYS, phase);
    restQ.setFromRotationMatrix(setFromMat3(tmpM, eulerMatrix(pose.rot), 1, [0, 0, 0]));
    restP.set(...pose.pos);
  }

  private applyBodyRotation(yaw: number, pitch: number, leftHand: boolean, extraPitch: number) {
    // разворот «к оружейной руке»: для правой — носом к +X, это отрицательный угол вокруг Y
    this.body.rotation.y = -yaw * YAW_SCALE * DEG * (leftHand ? -1 : 1);
    this.body.rotation.x = -pitch * 0.6 * DEG + extraPitch;
  }

  update(dt: number) {
    const now = this.arena.now;
    // действия: момент попадания, упреждающий уворот цели, завершение
    for (const a of [...this.actions.values()]) {
      const u = (now - a.start) / a.dur;
      if (a.kind === 'attack' && a.clip) {
        if (!a.evadeSent && a.ctx?.outcome === 'evade' && u >= a.clip.hit - 0.09) {
          a.evadeSent = true;
          a.ctx.target?.playEvade(a.dur * 0.6);
        }
        if (a.hit && u >= a.clip.hit) {
          const hit = a.hit;
          a.hit = undefined;
          this.arena.lastHit = { dir: this.forward, weight: a.clip.weight, impact: a.clip.impact, tint: gemTint(a.ctx?.effects) };
          // тяжёлый удар — боец впечатывается в землю
          if (a.clip.weight >= 0.5) this.arena.fx.dust(this.footPoint(0.7), Math.round(4 + 8 * a.clip.weight), { speed: 2.5 + 3 * a.clip.weight, size: 0.8 + 0.5 * a.clip.weight });
          hit();
        }
      }
      if (u >= 1 && this.actions.get(a.slot) === a) this.actions.delete(a.slot);
    }

    // тело: рывок к цели ведёт самое «выдвинутое» действие; прыжок и повороты складываются
    let lead: Action | undefined;
    let leadAdv = 0, hop = 0, yaw = 0, pitch = 0;
    for (const a of this.actions.values()) {
      if (a.kind !== 'attack' || !a.clip) continue;
      const u = (now - a.start) / a.dur;
      const adv = this.advOf(a, u);
      const pose = sampleBody(a.clip, u, bodyPose);
      const sign = this.rigs.get(a.slot)?.slot.isLeftHand ?? this.opts.slots[a.slot]?.isLeftHand ? -1 : 1;
      hop += pose.hop;
      yaw += pose.yaw * sign;
      pitch += pose.pitch;
      if (!lead || adv >= leadAdv) {
        lead = a;
        leadAdv = adv;
      }
    }
    const target = lead ? v1.copy(lead.reach).multiplyScalar(leadAdv) : v1.set(0, 0, 0);
    this.bodyOffset.lerp(target, 1 - Math.exp(-26 * dt));

    // уворот
    let retreat = 0, lean = 0, evadeHop = 0;
    if (this.evade) {
      const u = (now - this.evade.start) / this.evade.dur;
      if (u >= 1) this.evade = undefined;
      else {
        // быстро назад (первая четверть), пауза и плавный возврат
        const back = u < 0.22 ? 1 - (1 - u / 0.22) ** 3 : u < 0.5 ? 1 : 1 - ((u - 0.5) / 0.5) ** 2 * (3 - 2 * ((u - 0.5) / 0.5));
        retreat = 3.4 * back;
        const air = Math.min(1, u / 0.3);
        evadeHop = 0.9 * Math.sin(Math.PI * air);
        lean = -10 * DEG * Math.sin(Math.PI * air);
        if (!this.evade.landed && air >= 1) {
          this.evade.landed = true;
          this.arena.fx.dust(this.footPoint(0), 8, { speed: 3, size: 1.1 });
        }
      }
    }

    // отдача от удара: пружина по положению и по наклону
    this.knockVel.addScaledVector(this.knock, -170 * dt).multiplyScalar(Math.max(0, 1 - 15 * dt));
    this.knock.addScaledVector(this.knockVel, dt);
    this.tiltVel += -150 * this.tilt * dt;
    this.tiltVel *= Math.max(0, 1 - 11 * dt);
    this.tilt += this.tiltVel * dt;

    const breathe = this.crumbled ? 0 : 0.05 * Math.sin((now / 1000) * 2.1 + this.phase);
    this.root.position.copy(this.home).add(this.knock);
    this.body.position.set(this.bodyOffset.x, hop + evadeHop + breathe, this.bodyOffset.z + retreat);
    this.body.rotation.y = -yaw * YAW_SCALE * DEG;
    this.body.rotation.x = -pitch * 0.6 * DEG + this.tilt * 0.35 - lean;

    // оружие и артефакты
    for (const [k, rig] of this.rigs) {
      this.idlePose(k, rig);
      const a = this.actions.get(k);
      let scale = 1, lift = 0;
      if (a?.kind === 'attack' && a.clip) {
        const u = (now - a.start) / a.dur;
        sampleWeapon(a.clip, u, restQ, restP, tmpQ, tmpP);
        // поправка высоты — чтобы остриё пришло в куб-цель; действует, пока боец у цели
        tmpP.y += a.aimY * Math.max(0, Math.min(1, sampleBody(a.clip, u, bodyPose).adv));
        rig.pose.quaternion.copy(tmpQ);
        rig.pose.position.copy(tmpP);
      } else {
        rig.pose.quaternion.copy(restQ);
        rig.pose.position.copy(restP);
        if (a?.kind === 'artifact') {
          const bump = Math.sin(Math.PI * Math.min(1, (now - a.start) / a.dur));
          scale = 1 + 0.6 * bump;
          lift = 2 * bump;
        }
      }
      const base = rig.slot.scale ?? SLOT_SCALE;
      rig.holder.scale.set((rig.slot.isLeftHand ? -base : base) * scale, base * scale, base * scale);
      rig.holder.position.set(rig.slot.pos[0], rig.slot.pos[1] + lift, rig.slot.pos[2]);
    }

    // вспышки кубов
    for (const [i, f] of this.flashes) {
      f.left -= dt * 1000;
      const mesh = this.meshes[i];
      if (f.left <= 0) {
        mesh.material.emissiveIntensity = 0;
        mesh.material.emissive.set(0x000000);
        this.flashes.delete(i);
      } else mesh.material.emissiveIntensity = 0.9 * (f.left / f.total);
    }

    this.updateStatuses(dt);

    // шлейфы
    this.root.updateMatrixWorld(true);
    this.updateWeaponGlow(dt);
    for (const [k, rig] of this.rigs) {
      if (!rig.trail) continue;
      const a = this.actions.get(k);
      if (a?.kind === 'attack' && a.clip) {
        const u = (now - a.start) / a.dur;
        if (u >= a.clip.trail[0] && u <= a.clip.trail[1]) rig.trail.push(rig.pose.localToWorld(v1.copy(rig.tip)), rig.pose.localToWorld(v2.copy(rig.base)));
      }
      rig.trail.update(dt);
    }
  }

  dispose() {
    for (const mesh of this.meshes) mesh.material.dispose();
    for (const rig of this.rigs.values()) {
      rig.trail?.dispose();
      rig.pose.traverse((o) => o instanceof Mesh && (o.material as MeshStandardMaterial).dispose());
    }
  }
}
