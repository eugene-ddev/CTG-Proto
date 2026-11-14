import Phaser from 'phaser';
import { setDragging } from './dragGuard';
import type { Item } from '../data/types';
import { createItemIcon } from './ItemIcon';
import type { Slot } from './Slot';
import { Tooltip } from './Tooltip';
import { DEPTH } from './theme';

const DROP_OK = 0x6b8f3a;

/**
 * Перетаскивание предметов между ячейками (рюкзак): тянешь занятую ячейку, отпускаешь над другой.
 * slots — ячейки по порядку, items — что в них (null — пусто, не тянется), iconSize — размер иконки-призрака.
 * targets — куда можно бросить (по умолчанию те же ячейки); onDrop получает индекс в targets.
 * Клик по ячейке работает как раньше: жест начинается только после сдвига на несколько пикселей.
 */
export function enableSlotDrag(
  scene: Phaser.Scene,
  slots: Slot[],
  items: ReadonlyArray<Item | null>,
  iconSize: number,
  onDrop: (from: number, to: number) => void,
  targets: Slot[] = slots,
) {
  const same = targets === slots;
  scene.input.dragDistanceThreshold = Math.max(scene.input.dragDistanceThreshold, 6);
  const under = (p: Phaser.Input.Pointer) => targets.findIndex((s) => s.active && s.hit.getBounds().contains(p.x, p.y));

  slots.forEach((slot, from) => {
    let ghost: Phaser.GameObjects.Container | null = null;
    let target = -1;
    const mark = (k: number) => {
      if (k === target) return;
      if (target >= 0 && targets[target]?.active) targets[target].setAccent(null);
      target = k;
      if (k >= 0 && !(same && k === from)) targets[k].setAccent(DROP_OK);
    };
    const cleanup = () => {
      mark(-1);
      ghost?.destroy();
      ghost = null;
      if (slot.active) slot.setAlpha(1);
      scene.time.delayedCall(0, () => setDragging(scene, false));
    };

    const item = items[from];
    if (!item) return;
    slot.hit.on('dragstart', () => {
      const ic = createItemIcon(scene, item, iconSize);
      setDragging(scene, true);
      Tooltip.for(scene).hide();
      ghost = scene.add.container(0, 0, [ic]).setDepth(DEPTH.tooltip - 1).setAlpha(0.85);
      slot.setAlpha(0.45);
    });
    slot.hit.on('drag', (p: Phaser.Input.Pointer) => {
      if (!ghost) return;
      ghost.setPosition(p.x, p.y);
      mark(under(p));
    });
    slot.hit.on('dragend', (p: Phaser.Input.Pointer) => {
      if (!ghost) return;
      const to = under(p);
      cleanup();
      if (to >= 0 && !(same && to === from)) onDrop(from, to);
    });
    slot.once(Phaser.GameObjects.Events.DESTROY, () => ghost?.destroy());
    scene.input.setDraggable(slot.hit, true);
  });
}
