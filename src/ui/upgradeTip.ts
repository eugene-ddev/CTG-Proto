import { COMBAT } from '../data/catalog';
import { PATTERN_LABEL, patternDescription, weaponPerkText } from '../data/labels';
import type { Item } from '../data/types';
import { perkOf } from '../core/battle';
import type { TooltipContent } from './Tooltip';

/**
 * Описание прокачки оружия — тултип под зажатым Alt: каждый уровень — подпись, схема удара кубами и что он даёт;
 * взятые уровни тёмные, ещё не взятые бледнее (как блок «Прокачка» в карточке предмета).
 */
export function upgradeTip(item: Item | null | undefined): TooltipContent | undefined {
  if (!item || item.kind !== 'weapon') return undefined;
  const { max } = COMBAT.weaponLevels;
  const pattern = item.pattern ?? 'carry';
  const cur = Math.min(item.itemLevel, max);
  const levels: NonNullable<TooltipContent['levels']> = [];
  for (let lvl = 1; lvl <= max; lvl++) {
    const desc = lvl === 1 ? `${PATTERN_LABEL[pattern]}: ${patternDescription(pattern)}` : weaponPerkText(item.id, pattern, lvl);
    levels.push({ label: `Уровень ${lvl}`, desc: desc.charAt(0).toUpperCase() + desc.slice(1), on: lvl <= cur, pattern, perk: perkOf({ id: item.id, itemLevel: lvl }) });
  }
  return { title: `${item.name} · прокачка`, levels };
}

/** Схема удара оружия для тултипа: перк текущего уровня и описание (база + что даёт уровень). */
export function strikeOf(item: Item): TooltipContent['strike'] | undefined {
  if (item.kind !== 'weapon') return undefined;
  const pattern = item.pattern ?? 'carry';
  const lvl = Math.min(item.itemLevel, COMBAT.weaponLevels.max);
  const base = `${patternDescription(pattern).charAt(0).toUpperCase()}${patternDescription(pattern).slice(1)}.`;
  return { pattern, perk: perkOf(item), desc: lvl >= 2 ? `${base} Ур. ${lvl}: ${weaponPerkText(item.id, pattern, lvl)}.` : base };
}

/**
 * Добавить к тултипу предмета Alt-вариант с прокачкой и схему удара кубами (только у оружия);
 * строка «Удар» текстом убирается — её заменяет схема.
 */
export function withUpgrade<T extends TooltipContent>(content: T, item: Item | null | undefined): T {
  const alt = upgradeTip(item);
  if (!alt || !item) return content;
  return { ...content, rows: content.rows?.filter(([label]) => label !== 'Удар'), strike: strikeOf(item), alt, altLabel: 'прокачка' };
}
