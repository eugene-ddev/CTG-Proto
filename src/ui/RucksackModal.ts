// Рюкзак бойца: между боями серии (и в лобби) — выпить зелье, сменить оружие или артефакт.
// Содержимое рюкзака под риском: при поражении на арене он пропадает вместе с оружием в руках.
import Phaser from 'phaser';
import { getBlueprint, getItem, hasItem } from '../data/catalog';
import { STAT_LABEL_GEN, itemRows } from '../data/labels';
import { withUpgrade } from './upgradeTip';
import { STATS, type CharacterBlueprint, type Item } from '../data/types';
import { potionEffect } from '../core/arena';
import { bagSlots, characterStats, itemOf, requirementGap } from '../core/character';
import { enableSlotDrag } from './bagDrag';
import { store } from '../game/store';
import { Button } from './Button';
import { crossButton } from './CrossButton';
import { createItemIcon } from './ItemIcon';
import { Modal } from './Modal';
import { dottedLine } from './Panel';
import { Slot } from './Slot';
import { text } from './text';
import { COLOR, STAT_COLOR } from './theme';

const CELL = 64;

type Pick = { kind: 'bag'; cell: number } | { kind: 'slot'; slot: number } | null;

export function openRucksack(scene: Phaser.Scene, charUid: string, opts: { title?: string; note?: string } = {}) {
  const opened = store.state.characters.find((x) => x.uid === charUid);
  // рюкзаки на 12 и 18 ячеек — в два ряда: окно выше
  const perRow = Math.floor((760 - 60 + 10) / (CELL + 10));
  const extraRows = Math.max(0, Math.ceil((opened ? bagSlots(opened).length : 0) / perRow) - 1);
  const m = new Modal(scene, { title: opts.title ?? 'Рюкзак', width: 760, height: 520 + extraRows * (CELL + 10) });
  const body = scene.add.container(0, 0);
  m.card.content.add(body);
  const w = m.card.innerW;
  let pick: Pick = null;

  const render = () => {
    body.removeAll(true);
    const c = store.state.characters.find((x) => x.uid === charUid);
    if (!c) return;
    const bp = getBlueprint(c.blueprintId) as CharacterBlueprint;
    const cells = bagSlots(c);
    const stats = characterStats(bp, c.blockStats);
    if (opts.note) body.add(text(scene, 0, -4, opts.note, { size: 13, color: COLOR.inkQuiet, wrap: w }));
    let y = opts.note ? 26 : 0;

    // надето: руки и артефакты
    body.add(text(scene, 0, y, 'НАДЕТО', { size: 12, color: COLOR.inkQuiet, letterSpacing: 1 }));
    y += 20;
    bp.slots.forEach((sl, k) => {
      if (sl.type !== 'Hand' && sl.type !== 'Artifact') return;
      const e = c.equipment[k];
      // пустые слоты артефактов пока скрыты
      if (sl.type === 'Artifact' && !e) return;
      const item = e && hasItem(e.itemId) ? itemOf(e) : null;
      const label = sl.type === 'Hand' ? (sl.isLeftHand ? 'Л' : 'П') : `А${k - 1}`;
      const s = new Slot(scene, CELL / 2 + k * (CELL + 10), y + CELL / 2, {
        size: CELL,
        label,
        tooltip: () => (item ? withUpgrade({ title: item.name, rows: itemRows(item).map((r) => [r.label, r.value, r.color] as [string, string, string?]) }, item) : null),
        onClick: () => {
          pick = item ? { kind: 'slot', slot: k } : null;
          render();
        },
      });
      if (item) s.setContent(createItemIcon(scene, item, CELL - 22)).setItemGems(item);
      if (pick?.kind === 'slot' && pick.slot === k) s.setSelected(true);
      body.add(s);
    });
    y += CELL + 18;

    // ячейки рюкзака
    body.add(text(scene, 0, y, cells.length ? `РЮКЗАК · ${cells.filter(Boolean).length}/${cells.length}` : 'РЮКЗАКА НЕТ', { size: 12, color: COLOR.inkQuiet, letterSpacing: 1 }));
    y += 20;
    if (!cells.length) {
      body.add(text(scene, 0, y + 4, 'Без рюкзака некуда класть лут и зелья.', { size: 14, color: COLOR.inkQuiet }));
      y += 40;
    }
    const bagCells: Slot[] = [];
    // на арене из рюкзака можно выбросить (крестик на ячейке) — освободить место под лут
    const canDiscard = store.state.arenaRun?.charUid === charUid;
    const crosses: Phaser.GameObjects.GameObject[] = [];
    cells.forEach((e, k) => {
      const item = e && hasItem(e.itemId) ? itemOf(e) : null;
      const heal = item?.kind === 'potion' ? potionEffect(c, item) : 0;
      const cx = CELL / 2 + (k % perRow) * (CELL + 10);
      const cy = y + CELL / 2 + Math.floor(k / perRow) * (CELL + 10);
      const s = new Slot(scene, cx, cy, {
        size: CELL,
        tooltip: () => {
          if (!item) return null;
          const tip = withUpgrade({ title: item.name, rows: itemRows(item).map((r) => [r.label, r.value, r.color] as [string, string, string?]) }, item);
          return item.kind === 'potion' ? { ...tip, note: heal ? `Клик — выпить: +${heal} куб.` : 'Нечего чинить — кубы этой статы целы.' } : tip;
        },
        onClick: () => {
          // зелье пьётся сразу по клику, если есть что чинить; остальное — выбирается
          if (item?.kind === 'potion' && heal > 0) {
            pick = null;
            if (!store.act('drinkPotion', charUid, { kind: 'bag', cell: k })) render();
            return;
          }
          pick = item ? { kind: 'bag', cell: k } : null;
          render();
        },
      });
      if (item) s.setContent(createItemIcon(scene, item, CELL - 22), e!.count).setItemGems(item);
      if (pick?.kind === 'bag' && pick.cell === k) s.setSelected(true);
      body.add(s);
      bagCells.push(s);
      if (item && canDiscard) {
        crosses.push(crossButton(scene, cx + CELL / 2 - 7, cy - CELL / 2 + 7, () => confirmDiscard(scene, `${item.name}${e!.count > 1 ? ` ×${e!.count}` : ''}`, () => {
          pick = null;
          store.act('discardFromBag', charUid, k);
        }), 'Выбросить', 8));
      }
    });
    body.add(crosses);
    // перетаскивание между ячейками рюкзака
    enableSlotDrag(scene, bagCells, cells.map((e) => (e && hasItem(e.itemId) ? getItem(e.itemId) : null)), CELL - 22, (from, to) => {
      pick = null;
      store.act('moveInBag', charUid, from, to);
    });
    if (cells.length) y += Math.ceil(cells.length / perRow) * (CELL + 10) + 4;

    body.add(dottedLine(scene, 0, y, w));
    y += 12;

    // действия с выбранным
    const act = (label: string, x: number, fn: () => boolean, enabled = true) => {
      const b = new Button(scene, x, y + 22, label, { width: 200, height: 42, size: 16, variant: 'beige', onClick: () => { if (fn()) pick = null; render(); } });
      if (!enabled) b.setEnabled(false);
      body.add(b);
    };
    if (pick?.kind === 'bag') {
      const e = cells[pick.cell];
      const item = e && getItem(e.itemId);
      const cell = pick.cell;
      if (item) {
        body.add(text(scene, 0, y, item.name, { kind: 'display', size: 20 }));
        y += 30;
        if (item.kind === 'potion') {
          // сюда попадает только зелье, которое сейчас не выпить (иначе клик выпил бы его сразу)
          body.add(text(scene, 0, y + 6, 'Нечего чинить — кубы этой статы целы.', { size: 13, color: COLOR.inkQuiet }));
        } else {
          const targets = bp.slots
            .map((sl, k) => ({ sl, k }))
            .filter(({ sl }) => (item.kind === 'weapon' && sl.type === 'Hand') || (item.kind === 'artifact' && sl.type === 'Artifact'));
          const gap = requirementGap(item as Item, stats);
          targets.forEach(({ sl, k }, i) => {
            const name = sl.type === 'Hand' ? (sl.isLeftHand ? 'В левую руку' : 'В правую руку') : `В слот А${k - 1}`;
            act(name, 100 + i * 214, () => store.act('equipFromBag', charUid, cell, k), gap <= 0);
          });
          if (gap > 0) body.add(text(scene, 0, y + 50, `Не хватает ${gap} ${STAT_LABEL_GEN[(item as Extract<Item, { scalingStat: unknown }>).scalingStat]}.`, { size: 13, color: '#c0281e' }));
        }
      }
    } else if (pick?.kind === 'slot') {
      const e = c.equipment[pick.slot];
      const slot = pick.slot;
      if (e) {
        body.add(text(scene, 0, y, getItem(e.itemId).name, { kind: 'display', size: 20 }));
        y += 30;
        const free = cells.some((x) => !x);
        act(free ? 'Убрать в рюкзак' : 'Рюкзак полон', 100, () => store.act('stowToBag', charUid, slot), free);
      }
    } else {
      body.add(text(scene, 0, y + 6, `Клик по зелью — выпить. Клик по оружию — взять в руку; перетащи — переложить в другую ячейку.\nВыбери надетое — убрать в рюкзак.${canDiscard ? ' Крестик — выбросить.' : ''}`, { size: 13, color: COLOR.inkQuiet }));
    }

    // разбитые кубы
    const yb = m.card.innerH - 70;
    body.add(dottedLine(scene, 0, yb, w));
    const total = c.blockStats.length;
    body.add(text(scene, 0, yb + 10, `КУБЫ · ${total - c.brokenBlocks.length}/${total}`, { size: 12, color: COLOR.inkQuiet, letterSpacing: 1 }));
    let x = 0;
    const brokenBy = STATS.map((st) => [st, c.brokenBlocks.filter((i) => c.blockStats[i] === st).length] as const).filter(([, n]) => n > 0);
    if (!brokenBy.length) body.add(text(scene, 0, yb + 32, 'Все кубы целы.', { size: 14 }));
    for (const [st, n] of brokenBy) {
      body.add(scene.add.rectangle(x + 8, yb + 42, 14, 14, STAT_COLOR[st]).setStrokeStyle(1, 0x000000, 0.4));
      const t = text(scene, x + 20, yb + 33, `−${n} ${STAT_LABEL_GEN[st]}`, { size: 14 });
      body.add(t);
      x += t.width + 40;
    }
    body.add(new Button(scene, w - 80, yb + 38, 'Готово', { width: 160, height: 44, size: 18, onClick: () => m.close() }));
  };

  render();
  const unsub = store.subscribe(() => m.active && render());
  m.once(Phaser.GameObjects.Events.DESTROY, unsub);
  return m;
}

/** Подтверждение: выброшенное из рюкзака пропадает насовсем. */
function confirmDiscard(scene: Phaser.Scene, name: string, onYes: () => void) {
  const m = new Modal(scene, { title: 'Выбросить?', width: 460, height: 240 });
  const w = m.card.innerW;
  m.card.content.add(text(scene, w / 2, 20, `«${name}» пропадёт насовсем.`, { size: 16, align: 'center', wrap: w }).setOrigin(0.5, 0));
  m.card.content.add(new Button(scene, w / 2 - 105, 110, 'Отмена', { variant: 'beige', width: 190, height: 46, size: 18, onClick: () => m.close() }));
  m.card.content.add(new Button(scene, w / 2 + 105, 110, 'Выбросить', { width: 190, height: 46, size: 18, onClick: () => { onYes(); m.close(); } }));
}
