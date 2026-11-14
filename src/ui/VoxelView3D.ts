// Превью модели в three.js — замена VoxelView на главной, в «Персонаже», в сборке и в «Новом противнике».
// Тот же API и та же рамка (fitModel), что у 2D-изометрии: камера ортографическая под тем же углом (45° по
// горизонтали, 30° сверху), блоки — меши и материалы клиента (render3d/blocks.ts), кадр — через общий рендерер
// (render3d/preview.ts) в текстуру Phaser. Подписи и кольцо починки поверх — графикой Phaser.
import Phaser from 'phaser';
import {
  BufferGeometry, DirectionalLight, DoubleSide, Float32BufferAttribute, Group, HemisphereLight, LineBasicMaterial, LineSegments, Matrix4, Mesh,
  MeshBasicMaterial, MeshStandardMaterial, OrthographicCamera, PlaneGeometry, Raycaster, Scene, ShadowMaterial, Vector2, Vector3,
} from 'three';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import type { BlockShape, CharacterBlueprintSlot, ItemModel, Vec3 } from '../data/types';
import { IDLE_KEYS, artifactPose, placeItem, samplePose } from '../render/anim';
import { PITCH_DEG, eulerMatrix, mmul, mul, quatMatrix, shade, type Mat3 } from '../render/iso';
import { BLOCK_EDGES, blockEdges, blockGeometry, blockMapsLoaded, blockMaterial, unityColor } from '../render3d/blocks';
import { renderPreview } from '../render3d/preview';
import { setDragging } from './dragGuard';
import { text } from './text';
import { COLOR } from './theme';
import {
  DRAG_DEG_PER_PX, DRAG_THRESHOLD, GHOST_ACCENT, GHOST_BLOCK, NEUTRAL_BLOCK, fitModel, hexToNum, lighten, type BlockLook, type VoxelViewOpts,
} from './VoxelView';

/** Запас вокруг рамки, px: тень, треугольник «перёд» и кольцо починки не обрезаются. */
const MARGIN = 28;
/** Сила отражений окружения на блоках превью. */
const ENV_INTENSITY = 0.35;
/** Прозрачность тени на полу. */
const SHADOW_OPACITY = 0.22;
const DEG = Math.PI / 180;
/** Кадр рисуется крупнее и уменьшается при выводе — ровнее края, чётче на больших экранах. */
const RES = 2;

// базис камеры изометрии (render/iso.ts) в координатах three.js: Z у Unity зеркальный
const YAW = 45 * DEG, P = PITCH_DEG * DEG;
const CAM_UP = new Vector3(Math.sin(YAW) * Math.sin(P), Math.cos(P), -Math.cos(YAW) * Math.sin(P));
const CAM_FORWARD = new Vector3(Math.sin(YAW) * Math.cos(P), -Math.sin(P), -Math.cos(YAW) * Math.cos(P));
/** Свет изометрии (render/iso.ts → LIGHT), в three.js. */
const LIGHT_DIR = new Vector3(-0.35, 1, 0.55).normalize();

const FAT_EDGES: Record<'cube' | 'wedge', LineSegmentsGeometry> = {
  cube: new LineSegmentsGeometry().fromEdgesGeometry(BLOCK_EDGES.cube),
  wedge: new LineSegmentsGeometry().fromEdgesGeometry(BLOCK_EDGES.wedge),
};
const fatEdges = (shape: BlockShape) => (shape === 'cube' ? FAT_EDGES.cube : FAT_EDGES.wedge);

const setFromMat3 = (out: Matrix4, m: Mat3, t: Vec3) =>
  out.set(m[0][0], m[0][1], m[0][2], t[0], m[1][0], m[1][1], m[1][2], t[1], m[2][0], m[2][1], m[2][2], t[2], 0, 0, 0, 1);

interface BlockObj {
  mesh: Mesh<BufferGeometry, MeshStandardMaterial>;
  /** Тонкий контур (целый куб, недостроенная часть). */
  thin: LineSegments;
  /** Толстый контур: разбитый (сплошной), пустое место (пунктир). */
  fat: LineSegments2;
  /** Обводка поверх (наведение, раскопка, починка) и её тень сквозь модель. */
  mark: LineSegments2;
  markBack: LineSegments2;
}

let counter = 0;

export class VoxelView3D extends Phaser.GameObjects.Container {
  private readonly three = new Scene();
  private readonly camera: OrthographicCamera;
  private readonly yawGroup = new Group();
  private readonly model = new Group();
  private readonly items = new Group();
  private readonly blocks: BlockObj[] = [];
  private readonly lineMats: LineMaterial[] = [];
  private readonly thinSolid = new LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.16 });
  private readonly thinFaint = new LineBasicMaterial({ color: GHOST_BLOCK, transparent: true, opacity: 0.13, depthWrite: false });
  private readonly sun: DirectionalLight;
  private readonly disposables: Array<{ dispose(): void }> = [];
  private readonly key = `voxel3d-${++counter}`;
  private readonly tex: Phaser.Textures.CanvasTexture;
  private readonly overlay: Phaser.GameObjects.Graphics;
  private readonly markers: Phaser.GameObjects.Container;
  private readonly rw: number;
  private readonly rh: number;
  private readonly px: number;
  private readonly pivot: [number, number, number];
  private yaw: number;
  private hovered: number | null = null;
  private rotating?: Phaser.Tweens.Tween;
  private drag?: { id: number; x0: number; yaw0: number; active: boolean };
  private pulse = 0.4;
  private hasGhost = false;
  private dirty = true;
  private markersKey = '';
  /** Сколько карт блоков было загружено на прошлом кадре — догрузились, перерисовать. */
  private maps = -1;
  private readonly raycaster = new Raycaster();

  constructor(scene: Phaser.Scene, x: number, y: number, private opts: VoxelViewOpts) {
    super(scene, x, y);
    this.yaw = opts.yaw ?? 0;
    const fit = fitModel(opts);
    this.px = fit.px;
    this.pivot = fit.pivot;
    this.rw = Math.ceil(opts.width + MARGIN * 2);
    this.rh = Math.ceil(opts.height + MARGIN * 2);

    // камера: та же проекция, что у изометрии; центр вращения модели — в точке, сдвинутой на offsetY от центра рамки
    const k = this.px;
    this.camera = new OrthographicCamera(-this.rw / 2 / k, this.rw / 2 / k, (this.rh / 2 + fit.offsetY) / k, (-this.rh / 2 + fit.offsetY) / k, 0.1, 400);
    this.camera.position.copy(CAM_FORWARD).multiplyScalar(-150);
    this.camera.up.copy(CAM_UP);
    this.camera.lookAt(0, 0, 0);
    this.camera.updateMatrixWorld(true);

    // модель: зеркало Z (координаты Unity) → поворот → сдвиг центра вращения в начало координат
    const mirror = new Group();
    mirror.scale.set(1, 1, -1);
    this.model.position.set(-this.pivot[0], -this.pivot[1], -this.pivot[2]);
    this.yawGroup.add(this.model);
    mirror.add(this.yawGroup);
    this.three.add(mirror);
    this.three.environmentIntensity = ENV_INTENSITY;

    // свет: небо + солнце с тенью на прозрачный пол
    this.three.add(new HemisphereLight(0xf2f0ff, 0x5a4c3c, 1.6));
    this.sun = new DirectionalLight(0xfff4e2, 2.2);
    const span = Math.max(...opts.blocks.map((b) => Math.max(Math.abs(b.pos[0] - this.pivot[0]), Math.abs(b.pos[2] - this.pivot[2])))) + 6;
    this.sun.position.copy(LIGHT_DIR).multiplyScalar(40);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(1024, 1024);
    this.sun.shadow.bias = -0.0005;
    this.sun.shadow.normalBias = 0.02;
    Object.assign(this.sun.shadow.camera, { left: -span, right: span, top: span, bottom: -span, near: 1, far: 100 });
    this.three.add(this.sun, this.sun.target);
    const floorY = Math.min(...opts.blocks.map((b) => b.pos[1])) - 0.5 - this.pivot[1];
    const floor = new Mesh(new PlaneGeometry(200, 200), new ShadowMaterial({ opacity: SHADOW_OPACITY, depthWrite: false }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = floorY;
    floor.receiveShadow = true;
    this.three.add(floor);
    this.disposables.push(floor.geometry, floor.material, this.thinSolid, this.thinFaint);

    opts.blocks.forEach((b, i) => {
      const mesh = new Mesh(blockGeometry(b.shape), blockMaterial(b.shape, NEUTRAL_BLOCK, b.opacity ?? 1));
      mesh.matrixAutoUpdate = false;
      setFromMat3(mesh.matrix, (b.quat ? quatMatrix(b.quat) : eulerMatrix(b.rot)).map((row) => row.map((v) => v * (b.scale ?? 1))) as Mat3, b.pos);
      mesh.receiveShadow = true;
      mesh.userData.index = i;
      const thin = new LineSegments(blockEdges(b.shape), this.thinSolid);
      const fat = new LineSegments2(fatEdges(b.shape), this.lineMat({}));
      fat.computeLineDistances();
      const mark = new LineSegments2(fatEdges(b.shape), this.lineMat({ width: 2.5 }));
      const markBack = new LineSegments2(fatEdges(b.shape), this.lineMat({ width: 2, depthTest: false }));
      markBack.renderOrder = 10;
      for (const line of [thin, fat, mark, markBack]) {
        line.matrixAutoUpdate = false;
        line.matrix.copy(mesh.matrix);
      }
      fat.visible = mark.visible = markBack.visible = false;
      this.model.add(mesh, thin, fat, mark, markBack);
      this.blocks.push({ mesh, thin, fat, mark, markBack });
    });
    this.model.add(this.items);
    this.buildItems();
    if (opts.showFront) this.buildFront();

    // картинка Phaser и графика поверх
    this.tex = scene.textures.createCanvas(this.key, this.rw * RES, this.rh * RES)!;
    const image = scene.add.image(0, 0, this.key).setScale(1 / RES);
    this.overlay = scene.add.graphics();
    this.markers = scene.add.container(0, 0);
    this.add([image, this.overlay, this.markers]);
    this.setSize(opts.width, opts.height);
    this.applyYaw();

    if (opts.interactive) this.bindInput();
    const onUpdate = () => this.tick();
    scene.events.on(Phaser.Scenes.Events.UPDATE, onUpdate);
    this.once(Phaser.GameObjects.Events.DESTROY, () => {
      scene.events.off(Phaser.Scenes.Events.UPDATE, onUpdate);
      this.rotating?.stop();
      this.dispose();
      // текстуру убираем после того, как картинка уничтожена
      queueMicrotask(() => scene.textures.exists(this.key) && scene.textures.remove(this.key));
    });
    this.tick();
    scene.add.existing(this);
  }

  private lineMat(o: { width?: number; depthTest?: boolean }): LineMaterial {
    // DoubleSide: модель под зеркалом Z (отрицательный определитель) — иначе полоски линий отсекаются как задние грани
    const m = new LineMaterial({ side: DoubleSide, color: 0xffffff, linewidth: (o.width ?? 2) * RES, transparent: true, depthWrite: false, depthTest: o.depthTest ?? true, dashSize: 0.16, gapSize: 0.1 });
    this.lineMats.push(m);
    return m;
  }

  /** Предметы в слотах — неподвижно, в позе покоя (на превью не качаются). */
  private buildItems() {
    for (const child of [...this.items.children]) {
      this.items.remove(child);
      if (child instanceof Mesh) (child.material as MeshStandardMaterial).dispose();
    }
    const eq = this.opts.equipped, slots = this.opts.slots;
    if (!eq || !slots) return;
    eq.forEach((model: ItemModel | null, k) => {
      const sl: CharacterBlueprintSlot | undefined = slots[k];
      if (!model || !sl) return;
      const pose = sl.type === 'Artifact' ? artifactPose(0) : samplePose(IDLE_KEYS, 0);
      for (const b of placeItem(model.blocks, sl.pos, sl.isLeftHand, pose, { slot: sl.scale, model: model.scale })) {
        const color = b.color ? hexToNum(b.color) : NEUTRAL_BLOCK;
        const mesh = new Mesh(blockGeometry(b.shape), blockMaterial(b.shape, color, b.opacity ?? 1));
        const r = (b.quat ? quatMatrix(b.quat) : eulerMatrix(b.rot)).map((row) => row.map((v) => v * (b.scale ?? 1))) as Mat3;
        const xf = b.xf!;
        const t = mul(xf.m, b.pos);
        mesh.matrixAutoUpdate = false;
        setFromMat3(mesh.matrix, mmul(xf.m, r), [t[0] + xf.t[0], t[1] + xf.t[1], t[2] + xf.t[2]]);
        mesh.castShadow = (b.opacity ?? 1) >= 1;
        mesh.receiveShadow = true;
        this.items.add(mesh);
      }
    });
  }

  /** Треугольник у пола перед моделью, остриём вдоль +Z (куда смотрит перёд): с этой стороны её бьют. */
  private buildFront(): Group {
    const bl = this.opts.blocks;
    const xs = bl.map((b) => b.pos[0]);
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
    const y = Math.min(...bl.map((b) => b.pos[1])) - 0.5 + 0.02;
    const z = Math.max(...bl.map((b) => b.pos[2])) + 0.9;
    const pts = [cx, y, z + 0.9, cx - 0.55, y, z, cx + 0.55, y, z];
    const geo = new BufferGeometry();
    geo.setAttribute('position', new Float32BufferAttribute(pts, 3));
    const mat = new MeshBasicMaterial({ color: COLOR.highlight, side: DoubleSide });
    const edge = new LineSegmentsGeometry().setPositions([...pts.slice(0, 6), ...pts.slice(3, 9), ...pts.slice(6, 9), ...pts.slice(0, 3)]);
    const line = new LineSegments2(edge, this.lineMat({ width: 1.5 }));
    line.material.color.set(0x140a02);
    line.material.opacity = 0.8;
    const g = new Group();
    g.add(new Mesh(geo, mat), line);
    this.model.add(g);
    this.disposables.push(geo, mat, edge);
    return g;
  }

  // ───────────── ввод ─────────────

  private bindInput() {
    const scene = this.scene;
    const zone = scene.add.zone(0, 0, this.opts.width, this.opts.height).setInteractive();
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
      if (this.opts.rotatable === false || !d || p.id !== d.id || !p.isDown) return;
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
      this.applyYaw();
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

  /** Блок под указателем: луч из камеры; недостроенные и скрытые блоки пропускаются, предметы не нажимаются. */
  private blockAt(p: Phaser.Input.Pointer): number | null {
    const local = this.getWorldTransformMatrix().applyInverse(p.x, p.y);
    if (Math.abs(local.x) > this.opts.width / 2 || Math.abs(local.y) > this.opts.height / 2) return null;
    this.raycaster.setFromCamera(new Vector2(local.x / (this.rw / 2), -local.y / (this.rh / 2)), this.camera);
    this.three.updateMatrixWorld(true);
    const look = this.opts.lookOf;
    for (const hit of this.raycaster.intersectObjects(this.blocks.map((b) => b.mesh), false)) {
      const i = hit.object.userData.index as number;
      const mode = look?.(i) ?? 'solid';
      if (mode === 'hidden' || mode === 'faint') continue;
      return i;
    }
    return null;
  }

  private hover(i: number | null) {
    if (i === this.hovered) return;
    this.hovered = i;
    this.redraw();
    this.emit(i === null ? 'blockout' : 'blockover', i);
  }

  // ───────────── API как у VoxelView ─────────────

  get blockPx() {
    return this.px;
  }

  get currentYaw() {
    return ((this.yaw % 360) + 360) % 360;
  }

  rotateBy(step: number) {
    return this.rotateTo(Math.round(this.yaw / 90) * 90 + step * 90);
  }

  rotateTo(target: number) {
    this.rotating?.stop();
    const state = { yaw: this.yaw };
    this.rotating = this.scene.tweens.add({
      targets: state, yaw: target, duration: 220, ease: 'Cubic.easeOut',
      onUpdate: () => {
        this.yaw = state.yaw;
        this.applyYaw();
      },
    });
    return this;
  }

  private applyYaw() {
    this.yawGroup.rotation.y = this.yaw * DEG;
    this.redraw();
  }

  setEquipped(equipped: VoxelViewOpts['equipped']) {
    this.opts.equipped = equipped;
    this.buildItems();
    return this.redraw();
  }

  setColorOf(fn: VoxelViewOpts['colorOf']) {
    this.opts.colorOf = fn;
    return this.redraw();
  }

  setNeutral(neutral: boolean) {
    this.opts.neutral = neutral;
    return this.redraw();
  }

  setLookOf(fn: VoxelViewOpts['lookOf']) {
    this.opts.lookOf = fn;
    return this.redraw();
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

  /** Перерисовать в ближайшем кадре (цвета и вид блоков читаются заново). */
  redraw() {
    this.dirty = true;
    return this;
  }

  /** Точка модели (координаты чертежа) → координаты внутри контейнера. */
  private toLocal(p: Vec3): { x: number; y: number } {
    this.three.updateMatrixWorld(true);
    const v = this.model.localToWorld(new Vector3(...p)).project(this.camera);
    return { x: (v.x * this.rw) / 2, y: (-v.y * this.rh) / 2 };
  }

  /** Центр блока на экране (мировые координаты) — для пути раскопки и чисел. */
  blockWorldPos(i: number): { x: number; y: number } {
    const l = this.toLocal(this.opts.blocks[i].pos);
    const w = this.getWorldTransformMatrix().transformPoint(l.x, l.y);
    return { x: w.x, y: w.y };
  }

  // ───────────── кадр ─────────────

  private baseColor(i: number): number {
    const c = this.opts.colorOf?.(i);
    if (c !== undefined) return c;
    if (this.opts.neutral) return NEUTRAL_BLOCK;
    const own = this.opts.blocks[i].color;
    return own ? hexToNum(own) : NEUTRAL_BLOCK;
  }

  private tick() {
    if (!this.active) return;
    const focus = this.opts.focusBlock?.() ?? null;
    if (this.maps !== blockMapsLoaded()) {
      this.maps = blockMapsLoaded();
      this.dirty = true;
    }
    if (!this.dirty && !this.hasGhost && !focus) return;
    this.dirty = false;
    // пульс пустых мест и починки — как у 2D (0.22 ↔ 0.6, 650 мс в одну сторону)
    this.pulse = 0.41 + 0.19 * Math.sin((this.scene.time.now / 650) * Math.PI);
    this.sync(focus?.index ?? null);
    for (const m of this.lineMats) m.resolution.set(this.rw * RES, this.rh * RES);
    renderPreview(this.three, this.camera, this.rw * RES, this.rh * RES, this.tex.context);
    this.tex.refresh();
    this.drawOverlay(focus);
    this.drawSlots();
  }

  /** Вид блоков: цвет, прозрачность, контуры и обводки — по lookOf / colorOf / outlineOf. */
  private sync(focus: number | null) {
    const look = this.opts.lookOf;
    let hasGhost = false;
    this.blocks.forEach((o, i) => {
      const mode: BlockLook = look ? look(i) : 'solid';
      const b = this.opts.blocks[i];
      const base = unityColor(this.baseColor(i));
      const m = o.mesh.material;
      const fat = o.fat.material;
      let color = base, opacity = b.opacity ?? 1;
      let thin: LineBasicMaterial | null = this.thinSolid;
      let fatOn = false;
      if (mode === 'broken') {
        // разбитый куб: цвет статы, полупрозрачный, с заметным контуром
        opacity = 0.22;
        thin = null;
        fatOn = true;
        fat.color.set(shade(base, 0.55));
        fat.opacity = 0.7;
        fat.linewidth = 1.5 * RES;
        fat.dashed = false;
      } else if (mode === 'ghost') {
        // пустое место: заливка цветом подсветки + пунктирный контур
        const ghost = unityColor(this.opts.ghostColor?.(i) ?? GHOST_ACCENT);
        color = lighten(ghost, 0.45);
        opacity = this.pulse;
        thin = null;
        fatOn = true;
        fat.color.set(shade(ghost, 0.62));
        fat.opacity = 0.95;
        fat.linewidth = 2 * RES;
        fat.dashed = true;
        hasGhost = true;
      } else if (mode === 'faint') {
        // недостроенная часть: чуть видна, чтобы угадывалась вся фигура
        color = GHOST_BLOCK;
        opacity = 0.05;
        thin = this.thinFaint;
      }
      const visible = mode !== 'hidden';
      o.mesh.visible = visible;
      m.color.set(color);
      const transparent = opacity < 1;
      if (m.transparent !== transparent) {
        m.transparent = transparent;
        m.needsUpdate = true;
      }
      m.opacity = opacity;
      m.depthWrite = !transparent;
      o.mesh.castShadow = visible && !transparent;
      o.mesh.renderOrder = transparent ? 1 : 0;
      o.thin.visible = visible && !!thin;
      if (thin) o.thin.material = thin;
      o.fat.visible = visible && fatOn;
      o.fat.renderOrder = 2;

      // обводка поверх: наведение, куб починки, раскопка / подсвеченная стата
      const outline = this.hovered === i ? COLOR.highlight : focus === i ? COLOR.highlight : this.opts.outlineOf?.(i);
      const markOn = visible && outline !== undefined;
      o.mark.visible = o.markBack.visible = markOn;
      if (markOn) {
        const a = focus === i && this.hovered !== i ? 0.6 + 0.4 * this.pulse : 1;
        o.mark.material.color.set(outline);
        o.mark.material.opacity = a;
        o.markBack.material.color.set(outline);
        o.markBack.material.opacity = 0.35 * a;
        o.mark.renderOrder = 11;
      }
    });
    this.hasGhost = hasGhost;
  }

  /** Кольцо прогресса над кубом, который чинится. */
  private drawOverlay(focus: { index: number; progress: number } | null) {
    const g = this.overlay.clear();
    if (!focus) return;
    const b = this.opts.blocks[focus.index];
    const p = this.toLocal([b.pos[0], b.pos[1] + 0.5, b.pos[2]]);
    const x = p.x, y = p.y - Math.max(14, this.px * 0.9);
    const r = Math.max(7, this.px * 0.38);
    g.fillStyle(0x2b1a0a, 0.85).fillCircle(x, y, r + 3);
    g.lineStyle(3, 0x6b5a45, 1).strokeCircle(x, y, r);
    g.lineStyle(3, COLOR.highlight, 1).beginPath();
    g.arc(x, y, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, Math.max(0, focus.progress)), false);
    g.strokePath();
  }

  /** Маркеры пустых слотов (рука — ромб, артефакт — круг). */
  private drawSlots() {
    const key = `${this.yaw}|${(this.opts.equipped ?? []).map((e) => (e ? 1 : 0)).join('')}|${this.opts.slotMarkers}`;
    if (key === this.markersKey) return;
    this.markersKey = key;
    this.markers.removeAll(true);
    if (this.opts.slotMarkers === false) return;
    for (const [k, s] of (this.opts.slots ?? []).entries()) {
      if (this.opts.equipped?.[k]) continue; // занятый слот показывает сам предмет
      const { x, y } = this.toLocal(s.pos);
      const hand = s.type === 'Hand';
      const g = this.scene.add.graphics();
      g.fillStyle(hand ? COLOR.highlight : COLOR.mana, 0.95).lineStyle(2, 0x2b1a0a, 0.8);
      if (hand) {
        const pts = [new Phaser.Math.Vector2(x, y - 9), new Phaser.Math.Vector2(x + 9, y), new Phaser.Math.Vector2(x, y + 9), new Phaser.Math.Vector2(x - 9, y)];
        g.fillPoints(pts, true).strokePoints(pts, true);
      } else g.fillCircle(x, y, 8).strokeCircle(x, y, 8);
      this.markers.add(g);
      this.markers.add(text(this.scene, x, y, hand ? (s.isLeftHand ? 'Л' : 'П') : 'А', { kind: 'mono', size: 10, weight: 700, color: hand ? COLOR.ink : '#ffffff' }).setOrigin(0.5));
    }
  }

  private dispose() {
    for (const o of this.blocks) o.mesh.material.dispose();
    for (const m of this.lineMats) m.dispose();
    this.items.traverse((c) => c instanceof Mesh && (c.material as MeshStandardMaterial).dispose());
    for (const d of this.disposables) d.dispose();
    this.sun.shadow.dispose();
  }
}
