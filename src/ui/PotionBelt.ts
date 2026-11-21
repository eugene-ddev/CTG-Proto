import Phaser from 'phaser';
import { potionEffect } from '../core/arena';
import { potionItemOf, type CharacterState } from '../core/state';
import { COMBAT } from '../data/catalog';
import { STAT_LABEL } from '../data/labels';
import { STATS, type Stat } from '../data/types';
import { store } from '../game/store';
import { createItemIcon } from './ItemIcon';
import { Slot } from './Slot';
import { text } from './text';
import { COLOR } from './theme';

export const potionBeltWidth = (size = 54, gap = 8) => 6 * size + 5 * gap;
export const potionBeltHeight = (size = 54) => size + 22;
export const POTION_BELT_WIDTH = potionBeltWidth();
export const POTION_BELT_HEIGHT = potionBeltHeight();

export interface PotionBeltOptions {
  size?: number;
  gap?: number;
  selected?: Stat | null;
  /** На экране персонажа клик выбирает зелье для правой колонки; без него — выпить. */
  onSelect?: (stat: Stat) => void;
}

/** Шесть встроенных зелий бойца с текущими зарядами. */
export function potionBelt(scene: Phaser.Scene, c: CharacterState, x: number, y: number, onChange?: () => void, opts: PotionBeltOptions = {}): Phaser.GameObjects.Container {
  const size = opts.size ?? 54;
  const gap = opts.gap ?? 8;
  const out = scene.add.container(x, y);
  STATS.forEach((stat, k) => {
    const cx = size / 2 + k * (size + gap);
    const p = c.potions[stat];
    const item = potionItemOf(c, stat);
    const heal = potionEffect(c, stat);
    const maxCharges = COMBAT.characterUpgrades.potionLevels[p.level - 1].charges;
    const slot = new Slot(scene, cx, size / 2, {
      size,
      tooltip: () => ({
        title: `${item.name} · ${STAT_LABEL[stat]}`,
        rows: [['Заряды', `${p.charges}/${maxCharges}`], ['За заряд', `${item.kind === 'potion' ? item.restoreAmount : 0} куб.`]],
        note: opts.onSelect ? 'Клик — сведения и прокачка справа.' : p.charges <= 0 ? 'Заряды кончились. Восстановятся при возвращении в лобби.' : heal > 0 ? `Клик — выпить: +${heal} куб.` : 'Нечего чинить — кубы этой статы целы.',
      }),
      onClick: () => {
        if (opts.onSelect) opts.onSelect(stat);
        else store.act('drinkPotion', c.uid, stat);
        onChange?.();
      },
    });
    slot.setContent(createItemIcon(scene, item, size - 14, { left: p.charges, max: maxCharges }));
    slot.setSelected(opts.selected === stat);
    out.add(slot);
    out.add(text(scene, cx, size + 5, `${p.charges}/${maxCharges}`, { kind: 'mono', size: 12, weight: 700, color: p.charges ? COLOR.ink : COLOR.lose }).setOrigin(0.5, 0));
  });
  return out;
}
