// Анимации слотов снаряжения и тела персонажа — ключи перенесены из клиента
// (Assets/_CTG/Animations/Equipment/*.anim и Character/*.anim, кость Root).
// Время ключей — доля длительности клипа 0..1. Между ключами — плавная интерполяция по компонентам,
// как у эйлеровых кривых Unity.
import type { BlockGeometry, Vec3 } from '../data/types';
import { eulerMatrix, mmul, mul, type Mat3, type PlacedBlock } from './iso';

/** Повороты модели: перёд (+Z) смотрит вправо-вниз / влево-вниз по диагонали — бойцы вполоборота друг к другу. */
export const FACE_RIGHT = 180;
export const FACE_LEFT = 270;

export interface Pose {
  /** Эйлеры Root, градусы (Unity: Z, потом X, потом Y). */
  rot: Vec3;
  /** Смещение Root в пространстве слота. */
  pos: Vec3;
}

type Key = [t: number, rot: Vec3, pos: Vec3];

/** Base/Idle.anim — оружие покачивается в руке, период 1 с. */
export const IDLE_KEYS: Key[] = [
  [0, [21.798, -15.493, 6.653], [0, -0.35, 0]],
  [0.25, [20.732, -7.479, 9.564], [0, -0.06, 0]],
  [0.5, [21.517, -13.066, 7.549], [0, -0.38, 0]],
  [0.75, [20.89, -8.499, 9.202], [0, 0.03, 0]],
  [1, [21.798, -15.493, 6.653], [0, -0.35, 0]],
];
/** В клиенте клип 1 с; в прототипе медленнее — спокойнее смотрится в изометрии. */
export const IDLE_PERIOD_MS = 1600;

const IDLE0 = IDLE_KEYS[0];

/**
 * SwordAttack.anim: замах (0–0.5), удар поперёк перед собой (0.58 — попадание), затем возврат в покой
 * (в клиенте его делает переход аниматора).
 */
const SWING_KEYS: Key[] = [
  [0, IDLE0[1], IDLE0[2]],
  [0.18, [-7.193, 3.151, -36.107], [0, 0, 0]],
  [0.36, [-15.885, 9.767, -37.436], [0, 0, 0]],
  [0.5, [-7.193, 3.151, -36.107], [0, 0, 0]],
  [0.5833, [-0.563, -90.32, -87.544], [-2.76, 0, 3.63]],
  [0.6667, [-15.807, -128.85, -74.897], [-7.93, 0, 2.35]],
  [0.84, [-15.807, -128.85, -74.897], [-7.93, 0, 2.35]],
  [1, IDLE0[1], IDLE0[2]],
];

/** DaggerAttack.anim: подбросить, развернуть остриём вперёд и ткнуть. */
const THRUST_KEYS: Key[] = [
  [0, IDLE0[1], IDLE0[2]],
  [0.1667, [12.118, -16.791, -82.873], [0, 1.78, 0]],
  [0.3333, [12.118, -16.791, -82.873], [0, -0.97, 0]],
  [0.55, [12.118, -16.791, -82.873], [0, -0.86, 0]],
  [0.6167, [-15.639, -119.109, -85.254], [-8.02, 1.03, 1.57]],
  [0.8333, [-15.639, -119.109, -85.254], [-8.02, 1.03, 1.57]],
  [1, IDLE0[1], IDLE0[2]],
];

export type AttackStyle = 'swing' | 'thrust';

export const ATTACK_KEYS: Record<AttackStyle, Key[]> = { swing: SWING_KEYS, thrust: THRUST_KEYS };
/** Момент попадания (событие DispatchAttackHit), доля клипа. */
export const ATTACK_HIT: Record<AttackStyle, number> = { swing: 0.5833, thrust: 0.6167 };

// Пока всё оружие бьёт клипом меча (решение по прототипу); клип кинжала оставлен на будущее.
export const attackStyleOf = (_itemId?: string): AttackStyle => 'swing';

/** CharacterAttack.anim — выпад тела вперёд на 3 к моменту удара. */
export const LUNGE_KEYS: Array<[number, Vec3]> = [
  [0, [0, 0, 0]], [0.5333, [0, 0, 0]], [0.5833, [0, 0, 3]], [0.9167, [0, 0, 3]], [1, [0, 0, 0]],
];
/** CharacterEvade.anim — шаг в сторону. */
export const EVADE_KEYS: Array<[number, Vec3]> = [
  [0, [0, 0, 0]], [0.2, [-2, 0.5, 0]], [1, [0, 0, 0]],
];

const smooth = (u: number) => u * u * (3 - 2 * u);
const lerp3 = (a: Vec3, b: Vec3, u: number): Vec3 => [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u];

function segment<T>(keys: Array<[number, ...T[]]>, t: number): [number, number, number] {
  const tt = Math.min(1, Math.max(0, t));
  let i = 0;
  while (i < keys.length - 2 && tt > keys[i + 1][0]) i++;
  const span = keys[i + 1][0] - keys[i][0];
  return [i, i + 1, span > 0 ? smooth((tt - keys[i][0]) / span) : 1];
}

export function samplePose(keys: Key[], t: number): Pose {
  const [a, b, u] = segment(keys as Array<[number, Vec3, Vec3]>, t);
  return { rot: lerp3(keys[a][1], keys[b][1], u), pos: lerp3(keys[a][2], keys[b][2], u) };
}

export function sampleOffset(keys: Array<[number, Vec3]>, t: number): Vec3 {
  const [a, b, u] = segment(keys, t);
  return lerp3(keys[a][1], keys[b][1], u);
}

/** Масштаб слота по умолчанию (в чертежах клиента scale 0.8). */
export const SLOT_SCALE = 0.8;

/** Артефакты стоят ровно (без наклона оружия), только чуть покачиваются вверх-вниз. */
export const artifactPose = (bob: number): Pose => ({ rot: [0, 0, 0], pos: [0, bob, 0] });

/**
 * Блоки предмета в пространстве персонажа: слот (позиция, масштаб из чертежа, зеркало для левой руки)
 * ∘ поза Root ∘ модель предмета (масштаб корня префаба). extra — подъём и увеличение (срабатывание артефакта).
 */
export function placeItem(
  blocks: BlockGeometry[], slotPos: Vec3, leftHand: boolean, pose: Pose,
  scales: { slot?: number; model?: number } = {}, extra: { scale?: number; lift?: number } = {},
): PlacedBlock[] {
  const k = (scales.slot ?? SLOT_SCALE) * (extra.scale ?? 1);
  const s: Mat3 = [[leftHand ? -k : k, 0, 0], [0, k, 0], [0, 0, k]];
  const mk = scales.model ?? 1;
  const r = eulerMatrix(pose.rot).map((row) => row.map((v) => v * mk)) as Mat3;
  const m = mmul(s, r);
  const off = mul(s, pose.pos);
  const t: Vec3 = [slotPos[0] + off[0], slotPos[1] + off[1] + (extra.lift ?? 0), slotPos[2] + off[2]];
  return blocks.map((b) => ({ ...b, xf: { m, t } }));
}
