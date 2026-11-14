// Изометрическая проекция блочных моделей. Без Phaser: на вход блоки чертежа,
// на выход полигоны граней в экранных координатах, отсортированные от дальних к ближним.
//
// Система координат — как в Unity: X вправо, Y вверх, Z вперёд (левая тройка).
// Камера ортографическая, смотрит вдоль +X+Z сверху под углом PITCH.
import type { BlockGeometry, Vec3 } from '../data/types';

export const PITCH_DEG = 30;
const YAW = Math.PI / 4;
const P = (PITCH_DEG * Math.PI) / 180;

// Базис камеры (поворот на 45° вокруг Y, затем наклон вниз).
const RIGHT: Vec3 = [Math.cos(YAW), 0, -Math.sin(YAW)];
const FORWARD: Vec3 = [Math.sin(YAW) * Math.cos(P), -Math.sin(P), Math.cos(YAW) * Math.cos(P)];
const UP: Vec3 = [Math.sin(YAW) * Math.sin(P), Math.cos(P), Math.cos(YAW) * Math.sin(P)];
/** Свет сверху-слева-спереди относительно камеры. */
const LIGHT = normalize([-0.35, 1, -0.55]);

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
function normalize(a: Vec3): Vec3 {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
}

export type Mat3 = [Vec3, Vec3, Vec3]; // строки
export const mul = (m: Mat3, v: Vec3): Vec3 => [dot(m[0], v), dot(m[1], v), dot(m[2], v)];
export const mmul = (a: Mat3, b: Mat3): Mat3 => {
  const col = (j: number): Vec3 => [b[0][j], b[1][j], b[2][j]];
  return [0, 1, 2].map((i) => [dot(a[i], col(0)), dot(a[i], col(1)), dot(a[i], col(2))]) as Mat3;
};
export const rx = (d: number): Mat3 => {
  const r = (d * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r);
  return [[1, 0, 0], [0, c, -s], [0, s, c]];
};
export const ry = (d: number): Mat3 => {
  const r = (d * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r);
  return [[c, 0, s], [0, 1, 0], [-s, 0, c]];
};
const rz = (d: number): Mat3 => {
  const r = (d * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r);
  return [[c, -s, 0], [s, c, 0], [0, 0, 1]];
};

/** Матрица поворота из кватерниона Unity [x, y, z, w]. */
export const quatMatrix = ([x, y, z, w]: [number, number, number, number]): Mat3 => [
  [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
  [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
  [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
];

/** Quaternion.Euler(x, y, z) из Unity: сначала Z, потом X, потом Y. */
export const eulerMatrix = (e: Vec3): Mat3 => mmul(ry(e[1]), mmul(rx(e[0]), rz(e[2])));

interface Shape {
  verts: Vec3[];
  faces: number[][];
  /** Индексы граней, целиком закрывающих сторону единичной клетки: [грань, нормаль]. */
  fullFaces: number[];
}

const h = 0.5;
const CUBE: Shape = {
  verts: [
    [-h, -h, -h], [h, -h, -h], [h, h, -h], [-h, h, -h],
    [-h, -h, h], [h, -h, h], [h, h, h], [-h, h, h],
  ],
  faces: [
    [0, 1, 2, 3], // -Z
    [5, 4, 7, 6], // +Z
    [4, 0, 3, 7], // -X
    [1, 5, 6, 2], // +X
    [3, 2, 6, 7], // +Y
    [4, 5, 1, 0], // -Y
  ],
  fullFaces: [0, 1, 2, 3, 4, 5],
};

/**
 * Клин из TriangleLowPoly.fbx: призма вдоль X, сечение — прямоугольный треугольник.
 * Целые грани — верх (+Y) и задняя (−Z), наклон идёт от нижнего заднего ребра к верхнему переднему.
 * WEDGE_FLIP_Z разворачивает клин, если ось Z при импорте FBX окажется перевёрнутой.
 */
export const WEDGE_FLIP_Z = false;
const wz = WEDGE_FLIP_Z ? -1 : 1;
const WEDGE: Shape = {
  verts: [
    [-h, -h, -h * wz], [-h, h, -h * wz], [-h, h, h * wz],
    [h, -h, -h * wz], [h, h, -h * wz], [h, h, h * wz],
  ],
  faces: [
    [0, 1, 2], // −X
    [3, 5, 4], // +X
    [0, 3, 4, 1], // задняя
    [1, 4, 5, 2], // верх
    [0, 2, 5, 3], // наклон
  ],
  fullFaces: [2, 3],
};

export interface Face {
  block: number;
  /** Экранные точки относительно центра модели, в единицах блока (умножить на размер в px). */
  points: number[];
  depth: number;
  /** Освещённость грани 0..1. */
  light: number;
  /** Непрозрачность блока 0..1. */
  opacity: number;
}

export interface ProjectOpts {
  /** Поворот всей модели вокруг Y, градусы. */
  yaw?: number;
  /** Точка, вокруг которой вращается модель (обычно центр габаритов). */
  pivot?: Vec3;
}

/** Ключ клетки для поиска соседей. */
const cellKey = (p: Vec3) => `${Math.round(p[0] * 2)},${Math.round(p[1] * 2)},${Math.round(p[2] * 2)}`;

interface PreparedBlock {
  opacity: number;
  verts: Vec3[]; // в пространстве модели
  faces: number[][];
  normals: Vec3[];
  hidden: boolean[];
}

/**
 * Переводит блоки в пространство модели и помечает внутренние грани:
 * грань куба скрыта, если к ней вплотную прилегает целая грань соседнего блока.
 * Результат не зависит от поворота камеры — его можно кэшировать.
 */
export type BlockPresence = 'solid' | 'ghost' | 'faint' | 'broken' | 'hidden';

/** Непрозрачность «еле заметного» силуэта — недостроенная часть модели. */
export const FAINT_OPACITY = 0.08;
/** Непрозрачность разбитого куба в бою: заметнее контура недостроенного. */
export const BROKEN_OPACITY = 0.3;

/**
 * presence — как блок участвует в сборке: обычный, силуэт (можно поставить), еле заметный
 * контур (до него сборка ещё не дошла) или отсутствует. Силуэт и контур прозрачные: они не закрывают
 * грани поставленных соседей, но между собой внутренние грани скрывают — виден только внешний контур.
 */
/** Блок с дополнительным преобразованием (предмет в слоте: масштаб, зеркало, анимация). */
export type PlacedBlock = BlockGeometry & { xf?: { m: Mat3; t: Vec3 } };

export function prepareModel(blocks: PlacedBlock[], presence?: (index: number) => BlockPresence): PreparedBlock[] {
  const prepared = blocks.map((b0, index) => {
    const mode = presence?.(index) ?? 'solid';
    const b = mode === 'solid' ? b0 : { ...b0, opacity: mode === 'ghost' ? Math.min(b0.opacity ?? 1, 0.5) : mode === 'faint' ? FAINT_OPACITY : mode === 'broken' ? BROKEN_OPACITY : 0 };
    const shape = b.shape === 'cube' ? CUBE : WEDGE;
    const m = b.quat ? quatMatrix(b.quat) : eulerMatrix(b.rot);
    const k = b.scale ?? 1;
    const xf = b0.xf;
    const place = (v: Vec3) => (xf ? add(mul(xf.m, v), xf.t) : v);
    const verts = shape.verts.map((v) => place(add(mul(m, scale(v, k)), b.pos)));
    const center = shape.verts.reduce((a, v) => add(a, v), [0, 0, 0] as Vec3);
    const c = place(add(mul(m, scale(scale(center, 1 / shape.verts.length), k)), b.pos));
    const normals = shape.faces.map((f) => {
      let n = normalize(cross(sub(verts[f[1]], verts[f[0]]), sub(verts[f[2]], verts[f[0]])));
      const fc = scale(f.reduce((a, i) => add(a, verts[i]), [0, 0, 0] as Vec3), 1 / f.length);
      if (dot(n, sub(fc, c)) < 0) n = scale(n, -1); // наружу
      return n;
    });
    return { b, shape, verts, faces: shape.faces, normals, hidden: shape.faces.map(() => mode === 'hidden'), placed: !!xf };
  });

  // целые грани непрозрачных блоков (opaque) и всех блоков (any) по клеткам:
  // грань скрыта, если её закрывает непрозрачный сосед, а прозрачная — и прозрачным
  const occupied = new Map<string, Set<string>>();
  const opaque = new Map<string, Set<string>>();
  // контур недостроенной части закрывает только свои же грани — иначе спрятал бы доступный силуэт
  const faint = new Map<string, Set<string>>();
  const isFaint = (p: { b: BlockGeometry }) => p.b.opacity === FAINT_OPACITY;
  const axisKey = (n: Vec3) => n.map((x) => Math.round(x)).join(',');
  prepared.forEach((p) => {
    if ((p.b.scale ?? 1) !== 1 || p.b.opacity === 0 || p.placed) return; // отсутствующий блок ничего не закрывает
    for (const fi of p.shape.fullFaces) {
      const n = p.normals[fi];
      if (Math.abs(Math.abs(n[0]) + Math.abs(n[1]) + Math.abs(n[2]) - 1) > 1e-3) continue; // не по оси
      const key = cellKey(p.b.pos);
      const into = isFaint(p) ? faint : occupied;
      if (!into.has(key)) into.set(key, new Set());
      into.get(key)!.add(axisKey(n));
      if ((p.b.opacity ?? 1) >= 1) {
        if (!opaque.has(key)) opaque.set(key, new Set());
        opaque.get(key)!.add(axisKey(n));
      }
    }
  });
  prepared.forEach((p) => {
    if ((p.b.scale ?? 1) !== 1 || p.placed) return;
    for (const fi of p.shape.fullFaces) {
      const n = p.normals[fi];
      const axis = n.map((x) => Math.round(x)) as Vec3;
      if (Math.abs(Math.abs(axis[0]) + Math.abs(axis[1]) + Math.abs(axis[2]) - 1) > 1e-3) continue;
      const cell = cellKey(add(p.b.pos, axis));
      const back = axisKey(scale(axis, -1));
      const cover = ((p.b.opacity ?? 1) < 1 ? occupied : opaque).get(cell);
      if (cover?.has(back) || (isFaint(p) && faint.get(cell)?.has(back))) p.hidden[fi] = true;
    }
  });
  return prepared.map(({ b, verts, faces, normals, hidden }) => ({ opacity: b.opacity ?? 1, verts, faces, normals, hidden }));
}

/** Габариты модели в пространстве модели. */
export function bounds(prepared: PreparedBlock[]): { min: Vec3; max: Vec3; center: Vec3 } {
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const p of prepared)
    for (const v of p.verts)
      for (let i = 0; i < 3; i++) {
        min[i] = Math.min(min[i], v[i]);
        max[i] = Math.max(max[i], v[i]);
      }
  return { min, max, center: scale(add(min, max), 0.5) };
}

/** Повернуть точку модели вокруг pivot на yaw и спроецировать на экран (y вниз). */
export function projectPoint(p: Vec3, yaw = 0, pivot: Vec3 = [0, 0, 0]): { x: number; y: number; depth: number } {
  const w = add(mul(ry(yaw), sub(p, pivot)), [0, 0, 0]);
  return { x: dot(w, RIGHT), y: -dot(w, UP), depth: dot(w, FORWARD) };
}

/** Видимые грани в порядке отрисовки (дальние первыми). */
export function projectModel(prepared: PreparedBlock[], opts: ProjectOpts = {}): Face[] {
  const yaw = opts.yaw ?? 0;
  const pivot = opts.pivot ?? [0, 0, 0];
  const rot = ry(yaw);
  const faces: Face[] = [];
  prepared.forEach((p, block) => {
    const world = p.verts.map((v) => mul(rot, sub(v, pivot)));
    p.faces.forEach((f, fi) => {
      if (p.hidden[fi]) return;
      const n = mul(rot, p.normals[fi]);
      if (dot(n, FORWARD) >= -1e-6) return; // смотрит от камеры
      const points: number[] = [];
      let depth = 0;
      for (const i of f) {
        points.push(dot(world[i], RIGHT), -dot(world[i], UP));
        depth += dot(world[i], FORWARD);
      }
      faces.push({ block, points, depth: depth / f.length, light: 0.55 + 0.45 * Math.max(0, dot(n, LIGHT)), opacity: p.opacity });
    });
  });
  return faces.sort((a, b) => b.depth - a.depth);
}

/** Габариты проекции в единицах блока — для вписывания модели в рамку. */
export function projectedExtent(faces: Face[]): { minX: number; maxX: number; minY: number; maxY: number } {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const f of faces)
    for (let i = 0; i < f.points.length; i += 2) {
      minX = Math.min(minX, f.points[i]);
      maxX = Math.max(maxX, f.points[i]);
      minY = Math.min(minY, f.points[i + 1]);
      maxY = Math.max(maxY, f.points[i + 1]);
    }
  return { minX, maxX, minY, maxY };
}

/** Затемнить/осветлить цвет 0xRRGGBB множителем. */
export function shade(color: number, k: number): number {
  const r = Math.min(255, Math.round(((color >> 16) & 255) * k));
  const g = Math.min(255, Math.round(((color >> 8) & 255) * k));
  const b = Math.min(255, Math.round((color & 255) * k));
  return (r << 16) | (g << 8) | b;
}
