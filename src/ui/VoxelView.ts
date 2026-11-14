import Phaser from 'phaser';
import { setDragging } from './dragGuard';
import type { BlockGeometry, CharacterBlueprintSlot, ItemModel } from '../data/types';
import { bounds, prepareModel, projectModel, projectPoint, projectedExtent, shade, type Face, type PlacedBlock } from '../render/iso';
import {
  ATTACK_HIT, ATTACK_KEYS, EVADE_KEYS, IDLE_KEYS, IDLE_PERIOD_MS, LUNGE_KEYS, artifactPose, placeItem, sampleOffset, samplePose, type AttackStyle,
} from '../render/anim';
import type { Vec3 } from '../data/types';
import { COLOR } from './theme';
import { text } from './text';

/** Цвет блока без стат и без цвета из чертежа (неокрашенная модель). */
export const NEUTRAL_BLOCK = 0xc2b8a3;
/** Силуэт непоставленного блока при крафте. */
export const GHOST_BLOCK = 0x7d7262;
/** Подсветка мест, куда можно поставить куб (по умолчанию). */
export const GHOST_ACCENT = 0x2e9bd6;

export type BlockLook = 'solid' | 'ghost' | 'faint' | 'broken' | 'hidden';

export interface VoxelViewOpts {
  blocks: BlockGeometry[];
  /** Рамка, в которую вписывается модель при любом повороте. */
  width: number;
  height: number;
  /** Цвет блока; undefined — цвет из чертежа или нейтральный. */
  colorOf?: (index: number) => number | undefined;
  /** Как рисовать блок: обычный, силуэт (можно поставить), еле заметный контур (ещё нельзя), не рисовать. */
  lookOf?: (index: number) => BlockLook;
  /** Цвет подсветки пустых мест (ghost); по умолчанию GHOST_ACCENT. */
  ghostColor?: (index: number) => number;
  /** Блок, который сейчас восстанавливается: обводка и кольцо прогресса 0..1 над ним. */
  focusBlock?: () => { index: number; progress: number } | null;
  /** Бесцветная модель — так выглядят все чертежи. Стекло остаётся полупрозрачным. */
  neutral?: boolean;
  /** Слоты персонажа (руки, артефакты): маркеры и места для предметов. */
  slots?: CharacterBlueprintSlot[];
  /** Рисовать маркеры пустых слотов (по умолчанию да). */
  slotMarkers?: boolean;
  /** Модели предметов по слотам (null — пусто). Если задано, модель вписывается в рамку с запасом под оружие. */
  equipped?: Array<ItemModel | null>;
  /** Покачивание предметов (Idle из клиента) — только в бою; на превью предметы неподвижны. */
  idle?: boolean;
  /** Запас по высоте над слотами под предметы, в блоках (по умолчанию 3). */
  reserve?: number;
  /** Начальный поворот, градусы, кратно 90. */
  yaw?: number;
  /** Наведение на блок: подсветка и события blockover / blockout / blockclick. */
  interactive?: boolean;
  /** Поворот жестом (по умолчанию да); false — модель стоит, клики по блокам работают. */
  rotatable?: boolean;
  /** Максимальный размер блока в px — маленькие модели не раздуваются. */
  maxBlockPx?: number;
  /** Обводка блока цветом (предпросмотр раскопки); undefined — без обводки. */
  outlineOf?: (index: number) => number | undefined;
  /** Треугольник у пола перед моделью: куда смотрит перёд (+Z) — с этой стороны её бьют (этап 5). */
  showFront?: boolean;
}

/** Пунктирный замкнутый контур (в Phaser Graphics нет пунктира). Фаза сквозная по периметру. */
function dashedPolygon(g: Phaser.GameObjects.Graphics, pts: Phaser.Math.Vector2[], dash: number, gap: number) {
  let phase = 0; // сколько уже пройдено в текущем периоде dash+gap
  const period = dash + gap;
  for (let k = 0; k < pts.length; k++) {
    const a = pts[k], b = pts[(k + 1) % pts.length];
    const len = Phaser.Math.Distance.Between(a.x, a.y, b.x, b.y);
    if (len === 0) continue;
    const dx = (b.x - a.x) / len, dy = (b.y - a.y) / len;
    let t = 0;
    while (t < len) {
      const inDash = phase < dash;
      const step = Math.min(len - t, inDash ? dash - phase : period - phase);
      if (inDash) g.lineBetween(a.x + dx * t, a.y + dy * t, a.x + dx * (t + step), a.y + dy * (t + step));
      t += step;
      phase = (phase + step) % period;
    }
  }
}

/** Предметы в позе покоя — для вписывания в рамку. */
function restItems(eq: Array<ItemModel | null>, slots: CharacterBlueprintSlot[]): PlacedBlock[] {
  return eq.flatMap((model, k) => {
    const sl = slots[k];
    if (!model || !sl) return [];
    const pose = sl.type === 'Artifact' ? artifactPose(0) : samplePose(IDLE_KEYS, 0);
    return placeItem(model.blocks, sl.pos, sl.isLeftHand, pose, { slot: sl.scale, model: model.scale });
  });
}

/**
 * Вписать модель в рамку изометрии: центр вращения (центр габаритов в координатах чертежа), размер блока в px и
 * сдвиг по вертикали. Масштаб и центр — по всем четырём поворотам и с запасом под предметы, чтобы модель не «прыгала».
 * Общий для 2D (VoxelView) и 3D (VoxelView3D) — превью одинаково занимают рамку.
 */
export function fitModel(opts: VoxelViewOpts): { pivot: [number, number, number]; px: number; offsetY: number } {
  // габариты и масштаб — по полной модели, чтобы при сборке она не прыгала
  const full = prepareModel(opts.blocks);
  const pivot = bounds(full).center;
  // с предметами — запас вверх над каждым слотом (оружие высотой ~4), чтобы смена снаряжения не меняла масштаб
  const fit = opts.equipped && opts.slots
    ? prepareModel([...opts.blocks, ...opts.slots.flatMap((sl) => Array.from({ length: Math.ceil(opts.reserve ?? 3) + 1 }, (_, dy) => dy).map((dy) => ({ shape: 'cube' as const, pos: [sl.pos[0], sl.pos[1] + dy - 0.5, sl.pos[2]] as Vec3, rot: [0, 0, 0] as Vec3 })))])
    : full;
  // и сами предметы в позе покоя — иначе наклонённое оружие вылезает за рамку
  const items = opts.equipped && opts.slots ? restItems(opts.equipped, opts.slots) : [];
  const fitAll = items.length ? [...fit, ...prepareModel(items)] : fit;
  let w = 0, top = Infinity, bottom = -Infinity;
  for (const yaw of [0, 90, 180, 270, opts.yaw ?? 0]) {
    const e = projectedExtent(projectModel(fitAll, { yaw, pivot }));
    w = Math.max(w, e.maxX - e.minX, -e.minX * 2, e.maxX * 2);
    top = Math.min(top, e.minY);
    bottom = Math.max(bottom, e.maxY);
  }
  const px = Math.min(opts.width / Math.max(w, 1e-3), opts.height / Math.max(bottom - top, 1e-3), opts.maxBlockPx ?? 40);
  return { pivot, px, offsetY: -((top + bottom) / 2) * px };
}

/** Порог, после которого нажатие считается жестом поворота, px. */
export const DRAG_THRESHOLD = 6;
/** Скорость поворота жестом: градусов на пиксель. */
export const DRAG_DEG_PER_PX = 0.6;

/** Смешать цвет с белым: k = 0 — исходный, 1 — белый. */
export function lighten(c: number, k: number): number {
  const ch = (sh: number) => {
    const v = (c >> sh) & 0xff;
    return Math.round(v + (255 - v) * k) << sh;
  };
  return ch(16) | ch(8) | ch(0);
}

export const hexToNum = (hex: string) => parseInt(hex.slice(1), 16);

/**
 * Изометрическая модель из кубов и клиньев. Центр в (x, y).
 * События: 'blockover' (index), 'blockout', 'blockclick' (index).
 */
export class VoxelView extends Phaser.GameObjects.Container {
  private readonly gfx: Phaser.GameObjects.Graphics;
  private readonly markers: Phaser.GameObjects.Container;
  private prepared: ReturnType<typeof prepareModel>;
  private readonly pivot: [number, number, number];
  private readonly px: number;
  private readonly offsetY: number;
  private faces: Face[] = [];
  private yaw: number;
  private hovered: number | null = null;
  private rotating?: Phaser.Tweens.Tween;
  /** Прозрачность заливки пустых мест — пульсирует, чтобы их было видно. */
  private pulse = 0.4;
  private hasGhost = false;
  private readonly flashes = new Map<number, number>();
  private drag?: { id: number; x0: number; yaw0: number; active: boolean };
  /** Подготовленные блоки предметов на кадр и их цвета/свечение. */
  private attColor: number[] = [];
  private attGlow: number[] = [];
  private readonly t0: number;
  private markersKey = '';
  /** Анимации слотов: удар оружием или срабатывание артефакта. */
  private readonly actions = new Map<number, { kind: 'attack' | 'artifact'; style?: AttackStyle; start: number; dur: number; hit?: () => void }>();
  /** Анимация тела: выпад или уворот. */
  private bodyAnim?: { keys: Array<[number, Vec3]>; start: number; dur: number };
  /** Рассыпание (поражение): смещение на экране и прозрачность каждого блока и предмета. */
  private scatter?: Map<number, { x: number; y: number; a: number }>;

  constructor(scene: Phaser.Scene, x: number, y: number, private opts: VoxelViewOpts) {
    super(scene, x, y);
    this.yaw = opts.yaw ?? 0;
    this.t0 = scene.time.now;
    const fit = fitModel(opts);
    this.pivot = fit.pivot;
    this.px = fit.px;
    this.offsetY = fit.offsetY;
    this.prepared = opts.lookOf ? prepareModel(opts.blocks, opts.lookOf) : prepareModel(opts.blocks);

    this.gfx = scene.add.graphics();
    this.markers = scene.add.container(0, 0);
    this.add([this.gfx, this.markers]);
    this.setSize(opts.width, opts.height);

    if (opts.interactive) {
      const zone = scene.add.zone(0, 0, opts.width, opts.height).setInteractive();
      this.add(zone);
      zone.on('pointermove', (p: Phaser.Input.Pointer) => {
        if (!this.drag?.active) this.hover(this.blockAt(p));
      });
      zone.on('pointerout', () => this.hover(null));
      zone.on('pointerdown', (p: Phaser.Input.Pointer) => {
        this.drag = { id: p.id, x0: p.x, yaw0: this.yaw, active: false };
      });
      zone.on('pointerup', (p: Phaser.Input.Pointer) => {
        if (this.drag?.active) return; // был жест поворота — не клик
        const i = this.blockAt(p);
        if (i !== null) this.emit('blockclick', i);
      });
      // жест поворота: тянем по горизонтали; отслеживаем и за пределами зоны
      const onMove = (p: Phaser.Input.Pointer) => {
        const d = this.drag;
        if (opts.rotatable === false || !d || p.id !== d.id || !p.isDown) return;
        const dx = p.x - d.x0;
        if (!d.active && Math.abs(dx) < DRAG_THRESHOLD) return;
        if (!d.active) {
          d.active = true;
          setDragging(scene, true);
          this.rotating?.stop();
          this.hover(null);
          scene.input.setDefaultCursor('grabbing');
        }
        this.yaw = d.yaw0 + dx * DRAG_DEG_PER_PX;
        this.redraw();
      };
      const onUp = (p: Phaser.Input.Pointer) => {
        const d = this.drag;
        if (!d || p.id !== d.id) return;
        // сбросить после того, как зона получит свой pointerup
        scene.time.delayedCall(0, () => (this.drag = undefined));
        if (!d.active) return;
        scene.time.delayedCall(0, () => setDragging(scene, false));
        scene.input.setDefaultCursor('default');
        this.rotateTo(Math.round(this.yaw / 90) * 90);
      };
      scene.input.on('pointermove', onMove);
      scene.input.on('pointerup', onUp);
      scene.input.on('pointerupoutside', onUp);
      this.once(Phaser.GameObjects.Events.DESTROY, () => {
        scene.input.off('pointermove', onMove);
        scene.input.off('pointerup', onUp);
        scene.input.off('pointerupoutside', onUp);
        if (this.drag?.active) scene.input.setDefaultCursor('default');
      });
    }
    if (opts.lookOf) {
      const pulse = scene.tweens.addCounter({
        from: 0.22, to: 0.6, duration: 650, yoyo: true, repeat: -1, ease: 'Sine.easeInOut',
        onUpdate: (tw) => {
          this.pulse = tw.getValue() ?? 0.4;
          if (this.hasGhost) this.redraw();
        },
      });
      this.once(Phaser.GameObjects.Events.DESTROY, () => pulse.remove());
    }
    if (opts.equipped) {
      const onUpdate = () => this.animTick();
      scene.events.on(Phaser.Scenes.Events.UPDATE, onUpdate);
      this.once(Phaser.GameObjects.Events.DESTROY, () => scene.events.off(Phaser.Scenes.Events.UPDATE, onUpdate));
    }
    this.redraw();
    scene.add.existing(this);
  }

  /** Кадр анимации предметов: покачивание, удары, артефакты. */
  private animTick() {
    if (!this.active) return;
    const now = this.scene.time.now;
    for (const [slot, a] of this.actions) {
      const u = (now - a.start) / a.dur;
      if (a.hit && a.style && u >= ATTACK_HIT[a.style]) {
        const hit = a.hit;
        a.hit = undefined;
        hit();
      }
      if (u >= 1) this.actions.delete(slot);
    }
    if (this.bodyAnim && now - this.bodyAnim.start >= this.bodyAnim.dur) this.bodyAnim = undefined;
    if ((this.opts.idle && this.opts.equipped?.some((e) => e)) || this.actions.size || this.bodyAnim) this.redraw();
  }

  /** Сменить предметы в слотах. */
  setEquipped(equipped: VoxelViewOpts['equipped']) {
    this.opts.equipped = equipped;
    return this.redraw();
  }

  /**
   * Удар предметом слота (клип меча или кинжала) с выпадом тела. Пустой слот — только выпад.
   * onHit вызывается в момент попадания. Возвращает задержку до попадания, мс.
   */
  playAttack(slot: number, style: AttackStyle, dur: number, onHit?: () => void): number {
    const now = this.scene.time.now;
    const prev = this.actions.get(slot);
    prev?.hit?.();
    const hitMs = dur * ATTACK_HIT[style];
    if (this.opts.equipped?.[slot]) this.actions.set(slot, { kind: 'attack', style, start: now, dur, hit: onHit });
    else if (onHit) this.scene.time.delayedCall(hitMs, () => this.active && onHit());
    this.bodyAnim = { keys: LUNGE_KEYS, start: now, dur };
    this.redraw();
    return hitMs;
  }

  /** Шаг в сторону — уворот. */
  playEvade(dur: number) {
    this.bodyAnim = { keys: EVADE_KEYS, start: this.scene.time.now, dur };
    return this.redraw();
  }

  /** Срабатывание артефакта: подпрыгивает, увеличивается и вспыхивает. */
  playArtifact(slot: number, dur: number) {
    this.actions.set(slot, { kind: 'artifact', start: this.scene.time.now, dur });
    return this.redraw();
  }

  /** Восстанавливающийся куб: яркая обводка и кольцо прогресса над ним. */
  private drawFocus(g: Phaser.GameObjects.Graphics) {
    const f = this.opts.focusBlock?.();
    if (!f) return;
    g.lineStyle(3, COLOR.highlight, 0.6 + 0.4 * this.pulse);
    for (const face of this.faces) if (face.block === f.index) g.strokePoints(this.toScreen(face), true);
    const b = this.opts.blocks[f.index];
    const p = projectPoint([b.pos[0], b.pos[1] + 0.5, b.pos[2]], this.yaw, this.effPivot());
    const x = p.x * this.px, y = p.y * this.px + this.offsetY - Math.max(14, this.px * 0.9);
    const r = Math.max(7, this.px * 0.38);
    g.fillStyle(0x2b1a0a, 0.85).fillCircle(x, y, r + 3);
    g.lineStyle(3, 0x6b5a45, 1).strokeCircle(x, y, r);
    g.lineStyle(3, COLOR.highlight, 1).beginPath();
    g.arc(x, y, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, Math.max(0, f.progress)), false);
    g.strokePath();
  }

  /** Кольца-вспышки вокруг срабатывающих артефактов. */
  private drawArtifactBursts(g: Phaser.GameObjects.Graphics) {
    const now = this.scene.time.now;
    const pivot = this.effPivot();
    for (const [k, a] of this.actions) {
      const sl = this.opts.slots?.[k];
      if (a.kind !== 'artifact' || !sl) continue;
      const u = Math.min(1, (now - a.start) / a.dur);
      const lift = 2 * Math.sin(Math.PI * u);
      const p = projectPoint([sl.pos[0], sl.pos[1] + 1.2 + lift, sl.pos[2]], this.yaw, pivot);
      const x = p.x * this.px, y = p.y * this.px + this.offsetY;
      for (const [d, w] of [[0, 4], [0.18, 2]] as const) {
        const v = u - d;
        if (v <= 0 || v >= 0.8) continue;
        const r = this.px * (0.8 + 4 * v);
        g.lineStyle(w, 0xbfe3ff, 1 - v / 0.8).strokeCircle(x, y, r);
      }
      // искры
      for (let i = 0; i < 8; i++) {
        const ang = (i / 8) * Math.PI * 2 + u;
        const r = this.px * (1 + 3.5 * u);
        g.fillStyle(0xffffff, Math.max(0, 1 - u * 1.2)).fillCircle(x + Math.cos(ang) * r, y + Math.sin(ang) * r * 0.6, Math.max(1.5, this.px * 0.12));
      }
    }
  }

  /**
   * Небольшой треугольник на полу перед моделью, остриём вдоль +Z (куда смотрит перёд). Вершины задаются в мире
   * и проецируются — треугольник лежит в плоскости пола по сетке модели и поворачивается вместе с ней.
   */
  private drawFront(g: Phaser.GameObjects.Graphics) {
    if (!this.opts.showFront) return;
    const bl = this.opts.blocks;
    const xs = bl.map((b) => b.pos[0]);
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
    const y = Math.min(...bl.map((b) => b.pos[1])) - 0.5; // пол — нижняя грань модели
    const z = Math.max(...bl.map((b) => b.pos[2])) + 0.9; // чуть впереди переднего куба
    const at = (x: number, zz: number) => {
      const p = projectPoint([x, y, zz], this.yaw, this.effPivot());
      return { x: p.x * this.px, y: p.y * this.px + this.offsetY };
    };
    const tip = at(cx, z + 0.9);
    const l = at(cx - 0.55, z);
    const r = at(cx + 0.55, z);
    g.fillStyle(COLOR.highlight, 0.95).fillTriangle(tip.x, tip.y, l.x, l.y, r.x, r.y);
    g.lineStyle(1.5, 0x140a02, 0.8).strokeTriangle(tip.x, tip.y, l.x, l.y, r.x, r.y);
  }

  /** Точка, вокруг которой вращается модель, со сдвигом тела (выпад, уворот). */
  private effPivot(): [number, number, number] {
    if (!this.bodyAnim) return this.pivot;
    const off = sampleOffset(this.bodyAnim.keys, (this.scene.time.now - this.bodyAnim.start) / this.bodyAnim.dur);
    return [this.pivot[0] - off[0], this.pivot[1] - off[1], this.pivot[2] - off[2]];
  }

  /** Блоки предметов в текущей позе. */
  private placedItems(): PlacedBlock[] {
    this.attColor = [];
    this.attGlow = [];
    const eq = this.opts.equipped;
    const slots = this.opts.slots;
    if (!eq || !slots) return [];
    const now = this.scene.time.now;
    const out: PlacedBlock[] = [];
    eq.forEach((model, k) => {
      const sl = slots[k];
      if (!model || !sl) return;
      const a = this.actions.get(k);
      const u = a ? Math.min(1, (now - a.start) / a.dur) : 0;
      // покачивание со сдвигом фазы по слотам, чтобы предметы не двигались синхронно; на превью — неподвижно
      const phase = this.opts.idle ? ((((now - this.t0) / IDLE_PERIOD_MS + k * 0.21) % 1) + 1) % 1 : 0;
      const isArtifact = sl.type === 'Artifact';
      const rest = isArtifact ? artifactPose(this.opts.idle ? 0.15 * Math.sin(phase * Math.PI * 2) : 0) : samplePose(IDLE_KEYS, phase);
      const pose = a?.kind === 'attack' && a.style ? samplePose(ATTACK_KEYS[a.style], u) : rest;
      const bump = a?.kind === 'artifact' ? Math.sin(Math.PI * u) : 0;
      const placed = placeItem(model.blocks, sl.pos, sl.isLeftHand, pose, { slot: sl.scale, model: model.scale }, { scale: 1 + 0.6 * bump, lift: 2 * bump });
      for (const b of placed) {
        out.push(b);
        this.attColor.push(b.color ? hexToNum(b.color) : NEUTRAL_BLOCK);
        this.attGlow.push(bump);
      }
    });
    return out;
  }

  get blockPx() {
    return this.px;
  }

  get currentYaw() {
    return ((this.yaw % 360) + 360) % 360;
  }

  /** Повернуть модель на step·90° с анимацией. */
  rotateBy(step: number) {
    return this.rotateTo(Math.round(this.yaw / 90) * 90 + step * 90);
  }

  /** Довернуть модель до угла (градусы) с анимацией. */
  rotateTo(target: number) {
    this.rotating?.stop();
    const state = { yaw: this.yaw };
    this.rotating = this.scene.tweens.add({
      targets: state,
      yaw: target,
      duration: 220,
      ease: 'Cubic.easeOut',
      onUpdate: () => {
        this.yaw = state.yaw;
        this.redraw();
      },
    });
    return this;
  }

  setColorOf(fn: VoxelViewOpts['colorOf']) {
    this.opts.colorOf = fn;
    return this.redraw();
  }

  setNeutral(neutral: boolean) {
    this.opts.neutral = neutral;
    return this.redraw();
  }

  /** Сменить вид блоков (силуэт / поставлен). Пересчитывает, какие грани закрыты соседями. */
  setLookOf(fn: VoxelViewOpts['lookOf']) {
    this.opts.lookOf = fn;
    this.prepared = prepareModel(this.opts.blocks, fn);
    return this.redraw();
  }

  /** Центр блока на экране (мировые координаты) — для всплывающих чисел урона. */
  blockWorldPos(i: number): { x: number; y: number } {
    const p = projectPoint(this.opts.blocks[i].pos, this.yaw, this.effPivot());
    const m = this.getWorldTransformMatrix();
    const w = m.transformPoint(p.x * this.px, p.y * this.px + this.offsetY);
    return { x: w.x, y: w.y };
  }

  /** Подсветить блок цветом на время (попадание, разлом). */
  flashBlock(i: number, color: number, ms = 160) {
    this.flashes.set(i, color);
    this.redraw();
    this.scene.time.delayedCall(ms, () => {
      if (!this.active) return;
      this.flashes.delete(i);
      this.redraw();
    });
  }

  setFocusBlock(fn: VoxelViewOpts['focusBlock']) {
    this.opts.focusBlock = fn;
    return this.redraw();
  }

  setGhostColor(fn: VoxelViewOpts['ghostColor']) {
    this.opts.ghostColor = fn;
    return this.redraw();
  }

  setOutlineOf(fn: VoxelViewOpts['outlineOf']) {
    this.opts.outlineOf = fn;
    return this.redraw();
  }

  setSlotsVisible(visible: boolean) {
    this.markers.setVisible(visible);
    return this;
  }

  redraw() {
    const items = this.placedItems();
    const n = this.prepared.length;
    this.faces = projectModel(items.length ? [...this.prepared, ...prepareModel(items)] : this.prepared, { yaw: this.yaw, pivot: this.effPivot() });
    const g = this.gfx.clear();
    const look = this.opts.lookOf;
    const ghostOf = (i: number) => this.opts.ghostColor?.(i) ?? GHOST_ACCENT;
    let hasGhost = false;
    for (const f of this.faces) {
      const sc = this.scatter?.get(f.block);
      if (sc && sc.a <= 0.01) continue;
      const pts = this.toScreen(f);
      const alpha = sc ? sc.a : 1;
      if (f.block >= n) {
        // предмет в слоте; при срабатывании артефакта — вспышка к белому
        const k = f.block - n;
        const c = this.attGlow[k] ? lighten(this.attColor[k], 0.85 * this.attGlow[k]) : this.attColor[k];
        g.fillStyle(shade(c, f.light), (f.opacity < 1 ? f.opacity * 0.55 : 1) * alpha).fillPoints(pts, true);
        g.lineStyle(1, shade(c, f.light * 0.62), 0.9 * f.opacity * alpha).strokePoints(pts, true);
        continue;
      }
      const mode = look ? look(f.block) : 'solid';
      if (mode === 'hidden') continue;
      const base = this.baseColor(f.block);
      if (mode === 'faint') {
        // недостроенная часть: чуть видна, чтобы угадывалась вся фигура; не нажимается
        g.fillStyle(shade(GHOST_BLOCK, f.light), 0.05 * alpha).fillPoints(pts, true);
        g.lineStyle(1, GHOST_BLOCK, 0.13 * alpha).strokePoints(pts, true);
      } else if (mode === 'broken') {
        // разбитый куб в бою: цвет статы, полупрозрачный, с заметным контуром
        g.fillStyle(shade(base, f.light), 0.22 * alpha).fillPoints(pts, true);
        g.lineStyle(1.5, shade(base, f.light * 0.55), 0.7 * alpha).strokePoints(pts, true);
      } else if (mode === 'ghost') {
        // пустое место: заливка цветом подсветки + пунктирный контур
        const ghost = ghostOf(f.block);
        g.fillStyle(shade(lighten(ghost, 0.45), f.light), this.pulse).fillPoints(pts, true);
        hasGhost = true;
        g.lineStyle(2, shade(ghost, 0.62), 0.95);
        dashedPolygon(g, pts, Math.max(3, this.px * 0.12), Math.max(2, this.px * 0.08));
      } else {
        // стекло: светлое и полупрозрачное, контур заметнее заливки
        g.fillStyle(shade(base, f.light), (f.opacity < 1 ? f.opacity * 0.55 : 1) * alpha).fillPoints(pts, true);
        g.lineStyle(1, shade(base, f.light * 0.62), 0.9 * f.opacity * alpha).strokePoints(pts, true);
      }
    }
    if (this.opts.outlineOf) {
      for (const f of this.faces) {
        if (f.block >= n) continue;
        const c = this.opts.outlineOf(f.block);
        if (c !== undefined) g.lineStyle(2.5, c, 1).strokePoints(this.toScreen(f), true);
      }
    }
    this.drawFront(g);
    this.drawArtifactBursts(g);
    this.drawFocus(g);
    if (this.hovered !== null) {
      g.lineStyle(2, COLOR.highlight, 1);
      for (const f of this.faces) if (f.block === this.hovered) g.strokePoints(this.toScreen(f), true);
    }
    this.hasGhost = hasGhost;
    this.drawSlots();
    return this;
  }

  private baseColor(i: number): number {
    const fl = this.flashes.get(i);
    if (fl !== undefined) return fl;
    const c = this.opts.colorOf?.(i);
    if (c !== undefined) return c;
    if (this.opts.neutral) return NEUTRAL_BLOCK;
    const own = this.opts.blocks[i].color;
    return own ? hexToNum(own) : NEUTRAL_BLOCK;
  }

  private toScreen(f: Face): Phaser.Math.Vector2[] {
    const pts: Phaser.Math.Vector2[] = [];
    const sc = this.scatter?.get(f.block);
    const dx = sc?.x ?? 0;
    const dy = sc?.y ?? 0;
    for (let i = 0; i < f.points.length; i += 2) pts.push(new Phaser.Math.Vector2(f.points[i] * this.px + dx, f.points[i + 1] * this.px + this.offsetY + dy));
    return pts;
  }

  /**
   * Рассыпаться в частицы: модель тает сверху вниз, каждый куб и предмет на месте распадается
   * на мелкие осколки своего цвета — они вспархивают, падают и гаснут. Возвращает длительность, мс.
   */
  playCrumble(dur = 1400): number {
    this.hover(null);
    this.markers.setVisible(false);
    const n = this.prepared.length;
    // центр и цвет каждого блока/предмета на экране — по текущим граням
    const acc = new Map<number, { x: number; y: number; k: number; color: number }>();
    for (const f of this.faces) {
      const c = acc.get(f.block) ?? { x: 0, y: 0, k: 0, color: f.block >= n ? this.attColor[f.block - n] : this.baseColor(f.block) };
      for (let i = 0; i < f.points.length; i += 2) {
        c.x += f.points[i] * this.px;
        c.y += f.points[i + 1] * this.px + this.offsetY;
        c.k++;
      }
      acc.set(f.block, c);
    }
    const look = this.opts.lookOf;
    const centers = [...acc].map(([block, c]) => ({ block, x: c.x / c.k, y: c.y / c.k, color: c.color, dim: block < n && !!look && look(block) !== 'solid' }));
    if (!centers.length) return 0;
    const top = Math.min(...centers.map((c) => c.y));
    const bottom = Math.max(...centers.map((c) => c.y));
    const span = Math.max(1, bottom - top);
    const sweep = dur * 0.45; // волна распада сверху вниз
    const life = dur - sweep;
    const size = Math.max(2, this.px * 0.22);
    this.scatter = new Map(centers.map((c) => [c.block, { x: 0, y: 0, a: 1 }]));
    const layer = this.scene.add.container(0, 0);
    this.add(layer);
    for (const c of centers) {
      const delay = ((c.y - top) / span) * sweep + Math.random() * dur * 0.06;
      // куб гаснет быстро, на его месте — осколки
      this.scene.time.delayedCall(delay, () => {
        if (!this.active || !this.scatter) return;
        this.scatter.set(c.block, { x: 0, y: 0, a: 0 });
        this.redraw();
        const count = c.dim ? 2 : c.block >= n ? 7 : 5;
        for (let k = 0; k < count; k++) {
          const s0 = size * (0.6 + Math.random() * 0.8);
          const col = shade(c.color, 0.75 + Math.random() * 0.45);
          const r = this.scene.add.rectangle(c.x + (Math.random() - 0.5) * this.px * 0.6, c.y + (Math.random() - 0.5) * this.px * 0.6, s0, s0, col, c.dim ? 0.35 : 1);
          r.setAngle(Math.random() * 90);
          layer.add(r);
          const vx = (Math.random() - 0.5) * this.px * 2.4;
          const up = this.px * (0.4 + Math.random() * 0.9);
          const fall = this.px * (1.5 + Math.random() * 2.5);
          const t = life * (0.7 + Math.random() * 0.3);
          this.scene.tweens.add({ targets: r, x: r.x + vx, duration: t, ease: 'Sine.easeOut' });
          // вверх и вниз — как подброшенная пыль
          this.scene.tweens.add({ targets: r, y: r.y - up, duration: t * 0.3, ease: 'Quad.easeOut', onComplete: () => r.active && this.scene.tweens.add({ targets: r, y: r.y + up + fall, duration: t * 0.7, ease: 'Quad.easeIn' }) });
          this.scene.tweens.add({ targets: r, angle: r.angle + (Math.random() - 0.5) * 540, scale: 0.3, alpha: 0, duration: t, ease: 'Quad.easeIn', onComplete: () => r.destroy() });
        }
      });
    }
    this.scene.time.delayedCall(dur + 50, () => layer.active && layer.destroy());
    return dur;
  }

  private blockAt(p: Phaser.Input.Pointer): number | null {
    const m = this.getWorldTransformMatrix();
    const local = m.applyInverse(p.x, p.y);
    const look = this.opts.lookOf;
    for (let k = this.faces.length - 1; k >= 0; k--) {
      const f = this.faces[k];
      if (f.block >= this.prepared.length) continue; // предметы не нажимаются
      if (look && (look(f.block) === 'hidden' || look(f.block) === 'faint')) continue;
      const poly = new Phaser.Geom.Polygon(this.toScreen(f));
      if (Phaser.Geom.Polygon.Contains(poly, local.x, local.y)) return f.block;
    }
    return null;
  }

  private hover(i: number | null) {
    if (i === this.hovered) return;
    this.hovered = i;
    this.redraw();
    this.emit(i === null ? 'blockout' : 'blockover', i);
  }

  private drawSlots() {
    const pivot = this.effPivot();
    // маркеры пересоздаются, только если что-то сдвинулось — redraw идёт каждый кадр
    const key = `${this.yaw}|${pivot.join()}|${this.px}|${(this.opts.equipped ?? []).map((e) => (e ? 1 : 0)).join('')}|${this.opts.slotMarkers}`;
    if (key === this.markersKey) return;
    this.markersKey = key;
    this.markers.removeAll(true);
    if (this.opts.slotMarkers === false) return;
    for (const [k, s] of (this.opts.slots ?? []).entries()) {
      if (this.opts.equipped?.[k]) continue; // занятый слот показывает сам предмет
      const p = projectPoint(s.pos, this.yaw, pivot);
      const x = p.x * this.px;
      const y = p.y * this.px + this.offsetY;
      const hand = s.type === 'Hand';
      const g = this.scene.add.graphics();
      const color = hand ? COLOR.highlight : COLOR.mana;
      g.fillStyle(color, 0.95).lineStyle(2, 0x2b1a0a, 0.8);
      if (hand) g.fillPoints([new Phaser.Math.Vector2(x, y - 9), new Phaser.Math.Vector2(x + 9, y), new Phaser.Math.Vector2(x, y + 9), new Phaser.Math.Vector2(x - 9, y)], true).strokePoints([new Phaser.Math.Vector2(x, y - 9), new Phaser.Math.Vector2(x + 9, y), new Phaser.Math.Vector2(x, y + 9), new Phaser.Math.Vector2(x - 9, y)], true);
      else g.fillCircle(x, y, 8).strokeCircle(x, y, 8);
      this.markers.add(g);
      this.markers.add(text(this.scene, x, y, hand ? (s.isLeftHand ? 'Л' : 'П') : 'А', { kind: 'mono', size: 10, weight: 700, color: hand ? COLOR.ink : '#ffffff' }).setOrigin(0.5));
    }
  }
}
