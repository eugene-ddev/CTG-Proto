// Клипы ударов для 3D-боя: у каждого типа оружия — своя анимация.
// Поза оружия задаётся в пространстве слота (как в Unity): X — вбок от тела (левая рука зеркалится слотом),
// Y — вверх, Z — вперёд, к противнику. dir — куда смотрит остриё (ось +Y модели), edge — куда смотрит
// лезвие/боёк (ось +Z модели), pos — смещение рукояти. Время ключей — доля клипа 0..1.
import { Matrix4, Quaternion, Vector3 } from 'three';

type V3 = [number, number, number];
type Ease = 'io' | 'in' | 'out' | 'lin';

export type WeaponStyle = 'slash' | 'chop' | 'smash' | 'whirl' | 'stab' | 'stabCombo' | 'thrust' | 'flick' | 'punch';

interface PoseKey {
  t: number;
  /** Ключ — поза покоя (покачивание в руке): начало и конец клипа. */
  rest?: boolean;
  dir?: V3;
  edge?: V3;
  pos?: V3;
  /** Как приходим в этот ключ: in — с разгоном (удар), out — с торможением. */
  ease?: Ease;
}

interface BodyKey {
  t: number;
  /** Доля рывка к цели: 0 — на месте, 1 — на дистанции удара. */
  adv?: number;
  /** Подъём тела, в кубах. */
  hop?: number;
  /** Разворот тела, градусы (плюс — в сторону оружейной руки). */
  yaw?: number;
  /** Наклон вперёд, градусы. */
  pitch?: number;
  ease?: Ease;
}

export interface Clip {
  /** Момент попадания, доля клипа (не больше 0.6 — бой ждёт удар по этой доле). */
  hit: number;
  keys: PoseKey[];
  body: BodyKey[];
  /** Окно шлейфа за оружием, доли клипа. */
  trail: [number, number];
  /** Тяжесть удара 0..1: тряска, стоп-кадр, отдача, осколки. */
  weight: number;
  /** Цвет шлейфа. */
  trailColor: number;
  /** Что остаётся на земле/в воздухе при попадании. */
  impact: 'cut' | 'pierce' | 'crush' | 'punch';
}

const STEEL = 0xdfe9ff;

/** Меч: широкий горизонтальный мах из-за плеча через всё тело. */
const SLASH: Clip = {
  hit: 0.5,
  weight: 0.5,
  trail: [0.4, 0.66],
  trailColor: STEEL,
  impact: 'cut',
  keys: [
    { t: 0, rest: true },
    { t: 0.2, dir: [0.8, 0.5, -0.35], edge: [0.3, 0, 1], pos: [0.7, 0.5, -0.6], ease: 'out' },
    { t: 0.4, dir: [0.7, 0.35, -0.65], edge: [0.6, 0, 0.8], pos: [1.0, 0.4, -1.1], ease: 'io' },
    { t: 0.5, dir: [0.05, -0.2, 1], edge: [-1, 0, 0.05], pos: [-0.5, -0.7, 1.5], ease: 'in' },
    { t: 0.6, dir: [-0.9, -0.25, 0.35], edge: [-0.35, 0, -0.9], pos: [-1.7, -0.9, 0.9], ease: 'out' },
    { t: 0.78, dir: [-0.95, -0.2, 0.2], edge: [-0.2, 0, -0.95], pos: [-1.8, -0.8, 0.7], ease: 'io' },
    { t: 1, rest: true },
  ],
  body: [
    { t: 0 },
    { t: 0.2, adv: -0.06, yaw: 14 },
    { t: 0.4, adv: 0.55, yaw: 24 },
    { t: 0.5, adv: 1, yaw: -8, pitch: 6, ease: 'in' },
    { t: 0.62, adv: 1, yaw: -26, pitch: 4, ease: 'out' },
    { t: 0.76, adv: 0.95, yaw: -22 },
    { t: 1, ease: 'io' },
  ],
};

/** Топор: замах над головой и рубящий удар сверху вниз, лезвие застревает. */
const CHOP: Clip = {
  hit: 0.55,
  weight: 0.7,
  trail: [0.44, 0.6],
  trailColor: STEEL,
  impact: 'cut',
  keys: [
    { t: 0, rest: true },
    { t: 0.26, dir: [0.1, 0.9, -0.4], edge: [0, 0.4, 0.9], pos: [0, 1.5, -0.6], ease: 'out' },
    { t: 0.45, dir: [0.05, 0.55, -0.85], edge: [0, 0.85, 0.55], pos: [0, 2.1, -1.1], ease: 'io' },
    { t: 0.55, dir: [0, -0.5, 0.87], edge: [0, -0.87, -0.5], pos: [0, -1.1, 1.5], ease: 'in' },
    { t: 0.6, dir: [0, -0.62, 0.78], edge: [0, -0.78, -0.62], pos: [0, -1.35, 1.55], ease: 'out' },
    { t: 0.76, dir: [0, -0.58, 0.8], edge: [0, -0.8, -0.58], pos: [0, -1.25, 1.5], ease: 'io' },
    { t: 0.86, dir: [0, 0.2, 0.95], edge: [0, -0.95, 0.2], pos: [0, -0.4, 0.6], ease: 'io' },
    { t: 1, rest: true },
  ],
  body: [
    { t: 0 },
    { t: 0.26, adv: 0.15, hop: 0.25, pitch: -8 },
    { t: 0.45, adv: 0.8, hop: 0.9, pitch: -12 },
    { t: 0.55, adv: 1, hop: 0, pitch: 14, ease: 'in' },
    { t: 0.76, adv: 1, pitch: 10 },
    { t: 1, ease: 'io' },
  ],
};

/** Булава: заносится за спину, прыжок и тяжёлый удар сверху — земля вздрагивает. */
const SMASH: Clip = {
  hit: 0.6,
  weight: 1,
  trail: [0.46, 0.66],
  trailColor: 0xfff1d0,
  impact: 'crush',
  keys: [
    { t: 0, rest: true },
    { t: 0.22, dir: [0.25, -0.35, -0.9], edge: [0, 1, -0.3], pos: [0.3, 0.3, -1.3], ease: 'out' },
    { t: 0.36, dir: [0.3, -0.5, -0.8], edge: [0, 1, -0.5], pos: [0.35, 0.1, -1.5], ease: 'io' },
    { t: 0.5, dir: [0, 1, -0.15], edge: [0, 0.15, 1], pos: [0, 2.4, -0.4], ease: 'io' },
    { t: 0.6, dir: [0, -0.72, 0.7], edge: [0, -0.7, -0.72], pos: [0, -1.5, 1.4], ease: 'in' },
    { t: 0.66, dir: [0, -0.45, 0.9], edge: [0, -0.9, -0.45], pos: [0, -0.9, 1.3], ease: 'out' },
    { t: 0.8, dir: [0, -0.6, 0.8], edge: [0, -0.8, -0.6], pos: [0, -1.2, 1.3], ease: 'io' },
    { t: 1, rest: true },
  ],
  body: [
    { t: 0 },
    { t: 0.22, adv: -0.1, pitch: -6, hop: 0 },
    { t: 0.36, adv: 0.1, pitch: -10, hop: -0.15 },
    { t: 0.5, adv: 0.75, hop: 2.1, pitch: -16, ease: 'out' },
    { t: 0.6, adv: 1, hop: 0, pitch: 18, ease: 'in' },
    { t: 0.8, adv: 1, pitch: 8 },
    { t: 1, ease: 'io' },
  ],
};

/** Молот: раскручивается над головой и бьёт сбоку с полного оборота. */
const WHIRL: Clip = {
  hit: 0.6,
  weight: 0.85,
  trail: [0.14, 0.7],
  trailColor: 0xfff1d0,
  impact: 'crush',
  keys: [
    { t: 0, rest: true },
    { t: 0.12, dir: [1, 0.2, 0], edge: [0, 0, 1], pos: [0.6, 1.2, -0.2], ease: 'out' },
    { t: 0.22, dir: [0, 0.2, -1], edge: [1, 0, 0], pos: [0, 1.5, -0.6], ease: 'lin' },
    { t: 0.31, dir: [-1, 0.2, 0], edge: [0, 0, -1], pos: [-0.6, 1.5, -0.2], ease: 'lin' },
    { t: 0.39, dir: [0, 0.2, 1], edge: [-1, 0, 0], pos: [0, 1.4, 0.4], ease: 'lin' },
    { t: 0.46, dir: [1, 0.15, 0], edge: [0, 0, 1], pos: [0.9, 1.0, 0], ease: 'lin' },
    { t: 0.53, dir: [0.2, 0.1, -1], edge: [1, 0, 0.2], pos: [1.1, 0.4, -0.7], ease: 'lin' },
    { t: 0.6, dir: [-0.25, -0.25, 0.95], edge: [-0.95, 0, -0.25], pos: [-0.6, -0.9, 1.3], ease: 'in' },
    { t: 0.68, dir: [-0.9, -0.2, 0.4], edge: [-0.4, 0, -0.9], pos: [-1.5, -0.9, 0.9], ease: 'out' },
    { t: 0.82, dir: [-0.95, -0.1, 0.3], edge: [-0.3, 0, -0.95], pos: [-1.5, -0.7, 0.8], ease: 'io' },
    { t: 1, rest: true },
  ],
  body: [
    { t: 0 },
    { t: 0.12, adv: 0.05, yaw: 6 },
    { t: 0.46, adv: 0.7, yaw: 16, hop: 0.2 },
    { t: 0.53, adv: 0.9, yaw: 28 },
    { t: 0.6, adv: 1, yaw: -14, pitch: 6, ease: 'in' },
    { t: 0.7, adv: 1, yaw: -30, ease: 'out' },
    { t: 0.82, adv: 0.95, yaw: -24 },
    { t: 1, ease: 'io' },
  ],
};

/** Кинжал: резкий рывок и короткий укол. */
const STAB: Clip = {
  hit: 0.46,
  weight: 0.25,
  trail: [0.36, 0.56],
  trailColor: STEEL,
  impact: 'pierce',
  keys: [
    { t: 0, rest: true },
    { t: 0.16, dir: [0.1, 0.5, 0.85], edge: [0, 0.85, -0.5], pos: [0.2, 0.6, -0.5], ease: 'out' },
    { t: 0.34, dir: [0, -0.05, 1], edge: [0, 1, 0.05], pos: [0.15, -0.2, -1.5], ease: 'io' },
    { t: 0.46, dir: [0, -0.2, 0.98], edge: [0, 0.98, 0.2], pos: [0, -0.9, 2.0], ease: 'in' },
    { t: 0.6, dir: [0, -0.15, 0.99], edge: [0, 0.99, 0.15], pos: [0, -0.7, 0.9], ease: 'out' },
    { t: 1, rest: true },
  ],
  body: [
    { t: 0 },
    { t: 0.16, adv: 0.1, pitch: 4 },
    { t: 0.34, adv: 0.85, pitch: 8, ease: 'in' },
    { t: 0.46, adv: 1, pitch: 12, ease: 'out' },
    { t: 0.66, adv: 1, pitch: 8 },
    { t: 1, ease: 'io' },
  ],
};

/** Повторный укол кинжала в серии: не отходя, отдёрнуть и ткнуть ещё раз. */
const STAB_COMBO: Clip = {
  hit: 0.34,
  weight: 0.25,
  trail: [0.22, 0.46],
  trailColor: STEEL,
  impact: 'pierce',
  keys: [
    { t: 0, dir: [0, -0.15, 0.99], edge: [0, 0.99, 0.15], pos: [0, -0.7, 0.9] },
    { t: 0.2, dir: [0.1, 0.05, 1], edge: [0, 1, -0.05], pos: [0.35, -0.1, -1.2], ease: 'out' },
    { t: 0.34, dir: [-0.05, -0.22, 0.97], edge: [0, 0.97, 0.22], pos: [-0.2, -0.9, 2.0], ease: 'in' },
    { t: 0.5, dir: [0, -0.15, 0.99], edge: [0, 0.99, 0.15], pos: [0, -0.7, 0.9], ease: 'out' },
    { t: 1, rest: true },
  ],
  body: [
    { t: 0, adv: 1, pitch: 8 },
    { t: 0.2, adv: 0.92, pitch: 5 },
    { t: 0.34, adv: 1, pitch: 12, ease: 'in' },
    { t: 0.6, adv: 1, pitch: 8 },
    { t: 1, ease: 'io' },
  ],
};

/** Копьё: оттягивается далеко назад и длинный прямой выпад. */
const THRUST: Clip = {
  hit: 0.55,
  weight: 0.55,
  trail: [0.44, 0.64],
  trailColor: STEEL,
  impact: 'pierce',
  keys: [
    { t: 0, rest: true },
    { t: 0.22, dir: [0, 0.1, 1], edge: [0, 1, -0.1], pos: [0.1, 0.2, -1.6], ease: 'out' },
    { t: 0.44, dir: [0, 0.02, 1], edge: [0, 1, 0], pos: [0.1, 0, -3.0], ease: 'io' },
    { t: 0.55, dir: [0, -0.16, 0.99], edge: [0, 0.99, 0.16], pos: [0, -0.8, 2.6], ease: 'in' },
    { t: 0.74, dir: [0, -0.14, 0.99], edge: [0, 0.99, 0.14], pos: [0, -0.7, 2.3], ease: 'io' },
    { t: 1, rest: true },
  ],
  body: [
    { t: 0 },
    { t: 0.22, adv: -0.1, pitch: -3 },
    { t: 0.44, adv: 0.2, pitch: -5 },
    { t: 0.55, adv: 1, pitch: 10, ease: 'in' },
    { t: 0.74, adv: 1, pitch: 7 },
    { t: 1, ease: 'io' },
  ],
};

/** Нож: обратный хват, быстрый росчерк снизу вверх. */
const FLICK: Clip = {
  hit: 0.45,
  weight: 0.2,
  trail: [0.34, 0.6],
  trailColor: STEEL,
  impact: 'cut',
  keys: [
    { t: 0, rest: true },
    { t: 0.2, dir: [0.35, -0.85, 0.3], edge: [0, 0.3, 0.95], pos: [0.4, -0.6, -0.3], ease: 'out' },
    { t: 0.34, dir: [0.3, -0.8, 0.5], edge: [0, 0.5, 0.85], pos: [0.4, -1.1, 0.3], ease: 'io' },
    { t: 0.45, dir: [-0.15, 0.3, 0.94], edge: [0, 0.94, -0.3], pos: [-0.2, -0.5, 1.9], ease: 'in' },
    { t: 0.56, dir: [-0.45, 0.88, 0.15], edge: [0, 0.15, -0.98], pos: [-0.5, 0.9, 1.3], ease: 'out' },
    { t: 0.72, dir: [-0.4, 0.9, 0.1], edge: [0, 0.1, -0.99], pos: [-0.5, 1.0, 1.1], ease: 'io' },
    { t: 1, rest: true },
  ],
  body: [
    { t: 0 },
    { t: 0.2, adv: 0.2, pitch: 6 },
    { t: 0.34, adv: 0.9, pitch: 10, ease: 'in' },
    { t: 0.45, adv: 1, pitch: -4, hop: 0.2 },
    { t: 0.7, adv: 1, pitch: -6 },
    { t: 1, ease: 'io' },
  ],
};

/** Кулак: оружия нет — бьёт всем телом. */
const PUNCH: Clip = {
  hit: 0.45,
  weight: 0.35,
  trail: [0, 0],
  trailColor: 0xffffff,
  impact: 'punch',
  keys: [{ t: 0, rest: true }, { t: 1, rest: true }],
  body: [
    { t: 0 },
    { t: 0.24, adv: -0.18, pitch: -8, hop: 0.15 },
    { t: 0.36, adv: 0.5, pitch: 0, hop: 0.3 },
    { t: 0.45, adv: 1.12, pitch: 14, ease: 'in' },
    { t: 0.56, adv: 0.95, pitch: 6, ease: 'out' },
    { t: 0.72, adv: 1, pitch: 4 },
    { t: 1, ease: 'io' },
  ],
};

export const CLIPS: Record<WeaponStyle, Clip> = {
  slash: SLASH, chop: CHOP, smash: SMASH, whirl: WHIRL, stab: STAB, stabCombo: STAB_COMBO, thrust: THRUST, flick: FLICK, punch: PUNCH,
};

const STYLE_BY_ITEM: Record<string, WeaponStyle> = {
  rustySword: 'slash', rustyAxe: 'chop', rustyClub: 'smash', rustyHammer: 'whirl', rustyDagger: 'stab', rustySpear: 'thrust', rustyKnife: 'flick',
};
const STYLE_BY_PATTERN: Record<string, WeaponStyle> = { cleave: 'slash', split: 'chop', crush: 'smash', precise: 'stab', pierce: 'thrust', carry: 'punch' };

/** Клип по предмету; незнакомое оружие — по схеме удара; пустая рука — кулак. */
export function weaponStyleOf(itemId?: string | null, pattern?: string): WeaponStyle {
  if (!itemId) return 'punch';
  return STYLE_BY_ITEM[itemId] ?? STYLE_BY_PATTERN[pattern ?? ''] ?? 'slash';
}

const ease = (kind: Ease | undefined, u: number) => {
  switch (kind) {
    case 'in': return u * u * u;
    case 'out': return 1 - (1 - u) ** 3;
    case 'lin': return u;
    default: return u * u * (3 - 2 * u);
  }
};

const vx = new Vector3(), vy = new Vector3(), vz = new Vector3();
const basis = new Matrix4();
/** Поворот, который ставит ось +Y модели вдоль dir, а +Z — как можно ближе к edge. */
export function aimQuat(dir: V3, edge: V3, out = new Quaternion()): Quaternion {
  vy.set(...dir).normalize();
  vz.set(...edge);
  vz.addScaledVector(vy, -vz.dot(vy));
  if (vz.lengthSq() < 1e-6) vz.set(0, 0, 1).addScaledVector(vy, -vy.z);
  vz.normalize();
  vx.crossVectors(vy, vz);
  return out.setFromRotationMatrix(basis.makeBasis(vx, vy, vz));
}

interface BakedKey { t: number; rest: boolean; q: Quaternion; p: Vector3; ease?: Ease }
const baked = new Map<Clip, BakedKey[]>();
function bake(clip: Clip): BakedKey[] {
  let keys = baked.get(clip);
  if (!keys) {
    keys = clip.keys.map((k) => ({
      t: k.t, rest: !!k.rest, ease: k.ease,
      q: k.rest ? new Quaternion() : aimQuat(k.dir ?? [0, 1, 0], k.edge ?? [0, 0, 1]),
      p: new Vector3(...(k.pos ?? [0, 0, 0])),
    }));
    baked.set(clip, keys);
  }
  return keys;
}

/** Поза оружия в момент u клипа; restQ/restP — текущая поза покоя (в неё клип приходит и из неё выходит). */
export function sampleWeapon(clip: Clip, u: number, restQ: Quaternion, restP: Vector3, outQ: Quaternion, outP: Vector3) {
  const keys = bake(clip);
  const t = Math.min(1, Math.max(0, u));
  let i = 0;
  while (i < keys.length - 2 && t > keys[i + 1].t) i++;
  const a = keys[i], b = keys[i + 1];
  const span = b.t - a.t;
  const k = ease(b.ease, span > 0 ? Math.min(1, (t - a.t) / span) : 1);
  outQ.copy(a.rest ? restQ : a.q).slerp(b.rest ? restQ : b.q, k);
  outP.copy(a.rest ? restP : a.p).lerp(b.rest ? restP : b.p, k);
}

export interface BodyPose { adv: number; hop: number; yaw: number; pitch: number }
export function sampleBody(clip: Clip, u: number, out: BodyPose): BodyPose {
  const keys = clip.body;
  const t = Math.min(1, Math.max(0, u));
  let i = 0;
  while (i < keys.length - 2 && t > keys[i + 1].t) i++;
  const a = keys[i], b = keys[i + 1];
  const span = b.t - a.t;
  const k = ease(b.ease, span > 0 ? Math.min(1, (t - a.t) / span) : 1);
  const mix = (x?: number, y?: number) => (x ?? 0) + ((y ?? 0) - (x ?? 0)) * k;
  out.adv = mix(a.adv, b.adv);
  out.hop = mix(a.hop, b.hop);
  out.yaw = mix(a.yaw, b.yaw);
  out.pitch = mix(a.pitch, b.pitch);
  return out;
}
