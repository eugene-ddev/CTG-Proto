import Phaser from 'phaser';
import { turns } from '../data/labels';
import { text } from './text';
import { COLOR } from './theme';

export interface WeaponRowOpts {
  /** Плашка слота: «Л», «П», «А». */
  label: string;
  name: string;
  level?: number | null;
  /** Урон за удар, уже со скалированием; нет — предмет без удара. */
  damage?: number;
  hits?: number;
  /** Кулдаун в своих ходах. */
  cooldown?: number;
  /** Вместо урона у предмета без удара: «3 маны». */
  cost?: string;
  /** Мелкая строка под уроном: «~120/ход · 2 вын.» */
  details?: string;
  /** Красная строка внизу: «не хватит выносливости». */
  warn?: string;
  /** Пустая рука: бледная плашка и одна строка. */
  empty?: boolean;
}

const BADGE_W = 22;
const DAMAGE_COLOR = '#c0281e';

/**
 * Строка оружия или артефакта в слоте: плашка руки слева; название и уровень; под ними урон и кулдаун.
 * Левый верхний угол в (x, y), ширина w. Возвращает контейнер и занятую высоту (с отступом до следующей строки).
 */
export function weaponRow(scene: Phaser.Scene, x: number, y: number, w: number, o: WeaponRowOpts): { row: Phaser.GameObjects.Container; height: number } {
  const row = scene.add.container(x, y);
  const badge = scene.add.graphics();
  badge.fillStyle(0x4a2a12, o.empty ? 0.35 : 0.92).fillRoundedRect(0, 1, BADGE_W, o.empty ? 18 : 34, 4);
  row.add(badge);
  row.add(text(scene, BADGE_W / 2, o.empty ? 10 : 18, o.label, { size: 12, weight: 700, color: '#ffffff' }).setOrigin(0.5));
  const tx = BADGE_W + 8;
  row.add(text(scene, tx, 0, o.name, { size: 14, weight: 700, color: o.empty ? COLOR.inkQuiet : COLOR.ink }));
  if (o.empty) return { row, height: 24 };
  if (o.level) row.add(text(scene, w, 1, `ур. ${o.level}`, { kind: 'mono', size: 12, color: COLOR.inkQuiet }).setOrigin(1, 0));
  if (o.damage !== undefined) {
    const caption = text(scene, tx, 20, 'урон', { size: 12, color: COLOR.inkQuiet });
    const value = `${Math.round(o.damage * 10) / 10}${(o.hits ?? 1) > 1 ? ` ×${o.hits}` : ''}`;
    row.add([caption, text(scene, tx + caption.width + 6, 19, value, { kind: 'mono', size: 13, weight: 700, color: DAMAGE_COLOR })]);
  } else if (o.cost) {
    row.add(text(scene, tx, 20, o.cost, { size: 12, color: COLOR.inkQuiet }));
  }
  if (o.cooldown !== undefined) row.add(text(scene, w, 20, `кулдаун ${turns(Math.max(1, o.cooldown))}`, { size: 12, color: COLOR.inkQuiet }).setOrigin(1, 0));
  let height = 38;
  for (const [line, color] of [[o.details, COLOR.inkQuiet], [o.warn, COLOR.lose]] as Array<[string | undefined, string]>) {
    if (!line) continue;
    row.add(text(scene, tx, height, line, { size: 12, color }));
    height += 16;
  }
  return { row, height: height + 4 };
}
