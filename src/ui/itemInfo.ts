// Карточка предмета: иконка, имя, строки свойств, прокачка, описание — в ScrollArea.
// Общая для инвентаря и правой колонки персонажа; кнопки действий — у вызывающего, под областью.
import Phaser from 'phaser';
import type { CellInfo, GemInfo, UpgradeInfo } from '../core/upgrade';
import { COMBAT, getItem } from '../data/catalog';
import { perkOf } from '../core/battle';
import { createSpreadView } from './SpreadView';
import { PATTERN_LABEL, effectDescription, itemDescription, itemRows, itemSummary, patternDescription, weaponPerkText } from '../data/labels';
import type { Item, ItemKind } from '../data/types';
import { createItemIcon } from './ItemIcon';
import { dottedLine } from './Panel';
import type { ScrollArea } from './ScrollArea';
import { Slot } from './Slot';
import { text } from './text';
import { COLOR } from './theme';

/** Высота строки «подпись — значение» и добавка между строками переносимого текста. */
const ROW_H = 32;
const LINE_GAP = 3;
/** Неактивные уровни прокачки — бледнее обычного «тихого» текста. */
const PALE = '#b39a7c';

export const KIND_LABEL: Record<ItemKind, string> = { weapon: 'Оружие', artifact: 'Артефакт', gem: 'Камень', potion: 'Зелье', bag: 'Сумка', resource: 'Ресурс' };

export interface ItemInfoRow {
  label: string;
  value: string;
  color?: string;
}

export interface ItemInfoOpts {
  count?: number;
  /** Прокачка оружия (камни) и ячейки камней — строки «есть / нужно» и что даст уровень. */
  up?: UpgradeInfo | null;
  cell?: CellInfo | null;
  /** Ячейки камней оружия; клик по ячейке — onCell (окно выбора камня). */
  gems?: { info: GemInfo; onCell: (cell: number) => void } | null;
  /** Строки сверху (например, урон у этого бойца). */
  extraRows?: ItemInfoRow[];
  /** Строка под описанием (предупреждение, где лежит). */
  note?: { text: string; color?: string };
}

/** Заполнить область карточкой предмета. */
export function fillItemInfo(scene: Phaser.Scene, area: ScrollArea, item: Item, o: ItemInfoOpts = {}) {
  const c = area.content;
  c.removeAll(true);
  const w = area.w;
  const iconSize = o.up ? 100 : 130;
  const icon = createItemIcon(scene, item, iconSize) as Phaser.GameObjects.Components.Transform & Phaser.GameObjects.GameObject;
  icon.setPosition(w / 2, iconSize / 2 + 4);
  c.add(icon);
  let y = iconSize + 14;
  const name = text(scene, 0, y, item.name, { kind: 'display', size: 22, wrap: w });
  c.add(name);
  y += name.height + 6;
  const kindLine = `${KIND_LABEL[item.kind]} · ${itemSummary(item)}${(o.count ?? 1) > 1 ? ` · ×${o.count}` : ''}`;
  y += area.addLines(0, y, kindLine, { size: 13, color: COLOR.inkQuiet, wrap: w, lineGap: LINE_GAP });
  y += 14;
  const rows: ItemInfoRow[] = [...(o.extraRows ?? []), ...itemRows(item).filter((r) => r.label !== 'Свойства' && !(item.kind === 'weapon' && r.label === 'Удар'))];
  const { up } = o;
  for (const r of rows) {
    // строка — один контейнер, чтобы скрывалась целиком
    const row = scene.add.container(0, y);
    const label = text(scene, 0, 0, r.label.toUpperCase(), { size: 12, color: COLOR.inkQuiet });
    row.add(label);
    const value = text(scene, w, -1, r.value, { kind: 'mono', size: 14, color: r.color ?? COLOR.ink }).setOrigin(1, 0);
    if (value.width <= w - label.width - 12) {
      row.add(value);
      row.add(dottedLine(scene, 0, ROW_H - 8, w, 0x9a7a58));
      c.add(row);
      y += ROW_H;
      continue;
    }
    // длинное значение (схема удара) — под подписью, с переносом
    value.destroy();
    c.add(row);
    y += 20;
    y += area.addLines(0, y, r.value, { size: 13, color: r.color ?? COLOR.ink, wrap: w, lineGap: LINE_GAP });
    c.add(dottedLine(scene, 0, y + 3, w, 0x9a7a58));
    y += ROW_H - 16;
  }
  if (item.kind === 'weapon') {
    // все уровни прокачки: взятые — тёмным и жирным, ещё не взятые — бледнее
    const { max } = COMBAT.weaponLevels;
    const pattern = item.pattern ?? 'carry';
    const cur = Math.min(up?.level ?? item.itemLevel, max);
    // сперва ячейки камней и что делают вставленные камни, потом прокачка
    if (o.gems) y = gemCells(scene, area, o.gems, w, y) - 4;
    y += 16;
    c.add(text(scene, 0, y, 'ПРОКАЧКА', { size: 12, color: COLOR.inkQuiet, letterSpacing: 1 }));
    y += 22;
    for (let lvl = 1; lvl <= max; lvl++) {
      const on = lvl <= cur; // взятые уровни (включая предыдущие) — тёмные
      const color = on ? COLOR.ink : PALE;
      c.add(text(scene, 0, y, `Уровень ${lvl}`, { size: 13, weight: 700, color }));
      y += 20;
      // схема удара этого уровня кубами; ещё не взятый — бледнее
      const perk = perkOf({ id: item.id, itemLevel: lvl });
      const view = createSpreadView(scene, w / 2, y + 42, w, 84, pattern, perk).setAlpha(on ? 1 : 0.45);
      c.add(view);
      y += 88;
      const desc = lvl === 1 ? `${PATTERN_LABEL[pattern]}: ${patternDescription(pattern)}` : weaponPerkText(item.id, pattern, lvl);
      y += area.addLines(0, y, desc.charAt(0).toUpperCase() + desc.slice(1), { size: 13, weight: on ? 700 : undefined, color, wrap: w, lineGap: LINE_GAP });
      y += 10;
    }
  }
  y += 12;
  y += area.addLines(0, y, itemDescription(item), { size: 13, color: COLOR.inkQuiet, wrap: w, lineGap: LINE_GAP });
  if (item.kind === 'bag') {
    y += 8;
    c.add(text(scene, 0, y, `ВМЕСТИМОСТЬ · ${item.capacity} ЯЧ.`, { size: 12, color: COLOR.inkQuiet, letterSpacing: 1 }));
    y += 18;
  }
  if (o.note) {
    y += 12;
    y += area.addLines(0, y, o.note.text, { size: 13, color: o.note.color ?? COLOR.ink, wrap: w, lineGap: LINE_GAP });
  }
  area.layout(y + 4);
}

const GEM_CELL = 46;
const GEM_GAP = 8;

/** Ячейки камней прямо в карточке; клик по ячейке — окно выбора камня (вызывающий). Возвращает новую y. */
function gemCells(scene: Phaser.Scene, area: ScrollArea, gems: NonNullable<ItemInfoOpts['gems']>, w: number, y0: number): number {
  const c = area.content;
  const { info } = gems;
  const locked = !!info.reason;
  let y = y0 + 16;
  c.add(text(scene, 0, y, `КАМНИ · ${info.gems.length} / ${info.cells}`, { size: 12, color: COLOR.inkQuiet, letterSpacing: 1 }));
  y += 22;
  if (info.cells === 0) {
    y += area.addLines(0, y, `Ячеек нет — их создаёт ювелирный набор (до ${COMBAT.gemCells.max}).`, { size: 13, color: PALE, wrap: w, lineGap: LINE_GAP });
    return y + 4;
  }
  for (let k = 0; k < info.cells; k++) {
    const gemId = info.gems[k];
    const gem = gemId ? getItem(gemId) : null;
    const slot = new Slot(scene, GEM_CELL / 2 + k * (GEM_CELL + GEM_GAP), y + GEM_CELL / 2, {
      size: GEM_CELL,
      tooltip: () => (gem
        ? { title: gem.name, note: `${itemDescription(gem)}${locked ? '' : '\n\nКлик — заменить или вынуть.'}` }
        : { title: 'Пустая ячейка', note: locked ? 'Боец на арене — камни не меняются.' : 'Клик — выбрать камень.' }),
      onClick: locked ? undefined : () => gems.onCell(k),
    });
    if (gem) slot.setContent(createItemIcon(scene, gem, GEM_CELL - 16));
    c.add(slot);
  }
  y += GEM_CELL + 8;
  // эффекты вставленных камней: название — жирным, под ним описание
  for (const gemId of info.gems) {
    const gem = getItem(gemId);
    if (gem.kind !== 'gem') continue;
    c.add(text(scene, 0, y, gem.name, { size: 13, weight: 700, color: COLOR.ink }));
    y += 19;
    for (const effect of gem.effects) y += area.addLines(0, y, effectDescription(effect), { size: 13, color: COLOR.ink, wrap: w, lineGap: LINE_GAP }) + 2;
    y += 6;
  }
  if (!info.gems.length) y += area.addLines(0, y, 'Камень добавляет удару эффект: горение, лёд или яд.', { size: 13, color: PALE, wrap: w, lineGap: LINE_GAP }) + 4;
  if (locked) y += area.addLines(0, y + 2, 'Боец на арене — камни не меняются до конца серии.', { size: 13, color: COLOR.lose, wrap: w, lineGap: LINE_GAP }) + 4;
  return y;
}
