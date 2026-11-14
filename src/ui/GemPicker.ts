// Выбор камня для ячейки оружия: клик по ячейке в карточке предмета открывает это окно.
// Пустая ячейка — выбрать камень из инвентаря; занятая — заменить его или вынуть обратно в инвентарь.
import Phaser from 'phaser';
import { getItem } from '../data/catalog';
import { itemDescription } from '../data/labels';
import { gemInfo, type UpgradeTarget } from '../core/upgrade';
import { store } from '../game/store';
import { Button } from './Button';
import { createItemIcon } from './ItemIcon';
import { Modal } from './Modal';
import { Slot } from './Slot';
import { text } from './text';
import { COLOR } from './theme';

const CELL = 76;
const GAP = 14;

export function openGemPicker(scene: Phaser.Scene, target: UpgradeTarget, cell: number) {
  const info = gemInfo(store.state, target);
  if (!info || info.reason) return null;
  const current = info.gems[cell] ? getItem(info.gems[cell]) : null;
  const m = new Modal(scene, { title: current ? 'Заменить камень' : 'Вставить камень', width: 460, height: current ? 330 : 270 });
  const add = (o: Phaser.GameObjects.GameObject) => m.card.content.add(o);
  const w = m.card.innerW;
  const pick = (gemId: string | null) => {
    store.act('setGem', target, cell, gemId, !!current);
    m.close();
  };
  add(text(scene, w / 2, 0, current ? `Сейчас: ${current.name}` : 'Камень из инвентаря — в эту ячейку', { size: 14, color: COLOR.inkQuiet }).setOrigin(0.5, 0));
  const y = 34;
  if (!info.available.length) {
    add(text(scene, w / 2, y + CELL / 2, info.gems.length ? 'Других камней в инвентаре нет.\nОдинаковые в одно оружие не ставятся.' : 'Камней в инвентаре нет —\nсобери по чертежу «Камень».', { size: 15, color: COLOR.ink, align: 'center' }).setOrigin(0.5));
  } else {
    const total = info.available.length * CELL + (info.available.length - 1) * GAP;
    info.available.forEach((entry, k) => {
      const gem = getItem(entry.itemId);
      const slot = new Slot(scene, w / 2 - total / 2 + CELL / 2 + k * (CELL + GAP), y + CELL / 2, {
        size: CELL,
        caption: gem.name.replace(/^камень\s+/i, ''),
        tooltip: () => ({ title: gem.name, note: itemDescription(gem) }),
        onClick: () => pick(entry.itemId),
      });
      slot.setContent(createItemIcon(scene, gem, CELL - 28), entry.count);
      add(slot);
    });
  }
  if (current) add(new Button(scene, w / 2, y + CELL + 56, 'Вынуть в инвентарь', { variant: 'beige', width: 260, height: 44, size: 18, onClick: () => pick(null) }));
  return m;
}
