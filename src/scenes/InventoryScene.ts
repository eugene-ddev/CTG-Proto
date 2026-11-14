import Phaser from 'phaser';
import { isDragRelease } from '../ui/dragGuard';
import { BaseScene } from './BaseScene';
import { SCENE, type CharactersSceneData } from './keys';
import { getBlueprint, getItem } from '../data/catalog';
import { craftCost, disassembleItem, disassembleMany, disassemblyRefund, disassemblyRefundOf } from '../core/craft';
import { Modal } from '../ui/Modal';
import { SHARDS_PER_CUBE, convertShards } from '../core/arena';
import { itemDescription, itemRows } from '../data/labels';
import { fillItemInfo } from '../ui/itemInfo';
import { ScrollArea } from '../ui/ScrollArea';
import type { Item, ItemKind } from '../data/types';
import { addGemCell, cellInfo, gemInfo, upgradeInfo, upgradeWeapon, type UpgradeTarget } from '../core/upgrade';
import { openGemPicker } from '../ui/GemPicker';
import { withUpgrade } from '../ui/upgradeTip';
import { SHARD_ID, itemCount, moveInventory, sortInventory, type InventoryEntry, type PlayerState } from '../core/state';
import { enableSlotDrag } from '../ui/bagDrag';
import { itemOf, takeFromBag, unequip, type SlotRef } from '../core/character';
import { store } from '../game/store';
import { Button } from '../ui/Button';
import { createItemIcon } from '../ui/ItemIcon';
import { Card, dottedLine } from '../ui/Panel';
import { Pager } from '../ui/Pager';
import { Slot } from '../ui/Slot';
import { text } from '../ui/text';
import { COLOR } from '../ui/theme';

type Filter = 'all' | ItemKind;
const FILTERS: Array<[Filter, string]> = [
  ['all', 'Всё'],
  ['weapon', 'Оружие'],
  ['artifact', 'Артефакты'],
  ['gem', 'Камни'],
  ['potion', 'Зелья'],
  ['bag', 'Сумки'],
  ['resource', 'Ресурсы'],
];
const KIND_ORDER: ItemKind[] = ['resource', 'weapon', 'artifact', 'gem', 'potion', 'bag'];
const FILTER_KEY = 'inventory.filter';
const COLS = 9;
const ROWS = 4;
const PER_PAGE = COLS * ROWS;
const SLOT = 72;
const GAP = 10;
const PICKED = 0x6b8f3a;

/** Чертёж предмета (для разборки). */
const blueprintOf = (id: string) => {
  const bpId = getItem(id).blueprintId;
  return bpId ? getBlueprint(bpId) : undefined;
};

/** Запись для показа: лежит в инвентаре или надета на персонажа (where). */
interface ViewEntry extends InventoryEntry {
  /** slot — надето в ячейку снаряжения; bagCell — лежит в рюкзаке персонажа. */
  where?: { charUid: string; charName: string; slot?: SlotRef; bagCell?: number; slotName: string };
}

/** Всё, что есть у игрока: инвентарь + надетое на персонажей (руки, артефакты, рюкзак). */
function allEntries(s: PlayerState): ViewEntry[] {
  // только то, что лежит в инвентаре: надетое и содержимое рюкзаков видно в «Персонажах»
  return [...s.inventory];
}

/** Порядок «Сортировать»: по типу, затем по имени, полные стопки раньше. */
function byKindAndName(a: InventoryEntry, b: InventoryEntry) {
  const ia = getItem(a.itemId), ib = getItem(b.itemId);
  return KIND_ORDER.indexOf(ia.kind) - KIND_ORDER.indexOf(ib.kind) || ia.name.localeCompare(ib.name, 'ru') || b.count - a.count;
}

export class InventoryScene extends BaseScene {
  private filter: Filter = 'all';
  private page = 0;
  private selected: string | null = null;
  /** Режим выбора нескольких: клик отмечает предмет; Ctrl/Shift+клик включает режим сразу. */
  private multi = false;
  private picked = new Set<string>();
  private multiBtn!: Button;
  private grid!: Phaser.GameObjects.Container;
  private tabs = new Map<Filter, Phaser.GameObjects.Text>();
  private pager!: Pager;
  private details!: Card;
  private detailBody!: Phaser.GameObjects.Container;
  private empty!: Phaser.GameObjects.Text;

  constructor() {
    super(SCENE.inventory);
  }

  create() {
    this.tabs.clear();
    this.selected = null;
    this.multi = false;
    this.picked = new Set();
    this.setupScreen({ title: 'Инвентарь', subtitle: 'Предметы и кубы', tab: 'inventory' });

    const list = new Card(this, 40, 146, 860, 560, { title: 'Предметы', aside: 'Кубы' });
    this.bindCubes(list);
    let x = 0;
    for (const [f, label] of FILTERS) {
      const t = text(this, x, 0, label, { kind: 'display', size: 19, color: COLOR.inkQuiet }).setInteractive({ useHandCursor: true });
      t.on('pointerup', () => !isDragRelease(this) && this.setFilter(f));
      list.content.add(t);
      this.tabs.set(f, t);
      x += t.width + 44;
    }
    const gridW = COLS * SLOT + (COLS - 1) * GAP;
    this.grid = this.add.container((list.innerW - gridW) / 2 + SLOT / 2, 44 + SLOT / 2);
    list.content.add(this.grid);
    this.empty = text(this, list.innerW / 2, 200, '', { size: 16, color: COLOR.inkQuiet, align: 'center' }).setOrigin(0.5);
    // свой порядок сбрасывается в «по типу и имени»
    const sortLink = text(this, list.innerW, 2, 'СОРТИРОВАТЬ', { size: 13, color: COLOR.inkQuiet, letterSpacing: 1 }).setOrigin(1, 0).setInteractive({ useHandCursor: true });
    sortLink.on('pointerover', () => sortLink.setColor(COLOR.ink)).on('pointerout', () => sortLink.setColor(COLOR.inkQuiet));
    sortLink.on('pointerup', () => !isDragRelease(this) && store.update((st) => sortInventory(st, byKindAndName)));
    list.content.add(sortLink);
    list.content.add(this.empty);
    this.pager = new Pager(this, list.innerW / 2, 44 + ROWS * (SLOT + GAP) + 14, (p) => this.setPage(p));
    list.content.add(this.pager);
    // колесо над карточкой предмета — её прокрутка, а не листание сетки
    this.input.on('wheel', (p: Phaser.Input.Pointer, _o: unknown, _dx: number, dy: number) => p.x < 905 && this.pager.flip(dy > 0 ? 1 : -1));

    this.details = new Card(this, 916, 146, 324, 560, { title: 'Предмет' });
    this.detailBody = this.add.container(0, 0);
    this.details.content.add(this.detailBody);

    // осколки — дроп арены; перерабатываются в кубы
    const shardsText = text(this, 24, list.innerH - 22, '', { size: 14, color: COLOR.ink }).setOrigin(0, 0.5);
    list.content.add(shardsText);
    const conv = new Button(this, list.innerW - 95, list.innerH - 22, 'В кубы', { variant: 'beige', width: 190, height: 42, size: 17, onClick: () => store.update(convertShards) });
    list.content.add(conv);
    // выбор нескольких предметов — разобрать разом
    this.multiBtn = new Button(this, list.innerW - 95 - 215, list.innerH - 22, 'Выбрать несколько', {
      variant: 'beige', width: 220, height: 42, size: 16,
      onClick: () => this.setMulti(!this.multi),
    });
    list.content.add(this.multiBtn);
    this.input.keyboard?.on('keydown-ESC', () => this.multi && !this.children.list.some((c) => c instanceof Modal) && this.setMulti(false));
    this.watch((st) => {
      const sh = itemCount(st, SHARD_ID);
      shardsText.setText(`ОСКОЛКИ · ${sh}   (${SHARDS_PER_CUBE} = 1 куб)`);
      conv.setEnabled(sh >= SHARDS_PER_CUBE);
      conv.setCaption(sh >= SHARDS_PER_CUBE ? `В кубы · +${Math.floor(sh / SHARDS_PER_CUBE)}` : 'В кубы');
    });

    this.filter = (this.registry.get(FILTER_KEY) as Filter | undefined) ?? 'all';
    this.watch((s) => this.render(s));
  }

  private setFilter(f: Filter) {
    this.filter = f;
    this.page = 0;
    this.registry.set(FILTER_KEY, f);
    this.render(store.state);
  }

  private setPage(p: number) {
    this.page = p;
    this.render(store.state);
  }

  private visible(s: PlayerState) {
    // порядок — свой у игрока: меняется перетаскиванием, новые предметы — в конец, «Сортировать» — по типу и имени
    return allEntries(s).filter((e) => this.filter === 'all' || getItem(e.itemId).kind === this.filter);
  }

  private render(s: PlayerState) {
    for (const [f, t] of this.tabs) {
      const all = allEntries(s);
      const n = f === 'all' ? all.length : all.filter((e) => getItem(e.itemId).kind === f).length;
      t.setText(`${FILTERS.find(([k]) => k === f)![1]} ${n}`.toUpperCase());
      t.setColor(f === this.filter ? COLOR.ink : COLOR.inkQuiet).setFontStyle(f === this.filter ? 'bold' : '');
    }
    // раскладка вкладок после смены текста
    let x = 0;
    for (const t of this.tabs.values()) {
      t.setX(x);
      x += t.width + 30;
    }

    const entries = this.visible(s);
    const pages = Math.max(1, Math.ceil(entries.length / PER_PAGE));
    this.page = Math.min(this.page, pages - 1);
    this.pager.set(this.page, pages);
    if (this.selected && !allEntries(s).some((e) => e.uid === this.selected)) this.selected = null;
    for (const uid of [...this.picked]) if (!s.inventory.some((e) => e.uid === uid)) this.picked.delete(uid);
    this.multiBtn.setCaption(this.multi ? 'Готово' : 'Выбрать несколько');

    this.grid.removeAll(true);
    const pageEntries = entries.slice(this.page * PER_PAGE, (this.page + 1) * PER_PAGE);
    const cells: Slot[] = [];
    for (let i = 0; i < PER_PAGE; i++) {
      const e = pageEntries[i];
      const x = (i % COLS) * (SLOT + GAP);
      const y = Math.floor(i / COLS) * (SLOT + GAP);
      if (!e) {
        const empty = new Slot(this, x, y, { size: SLOT }).setAlpha(0.55);
        this.grid.add(empty);
        cells.push(empty);
        continue;
      }
      const item = itemOf(e);
      const slot = new Slot(this, x, y, {
        size: SLOT,
        caption: e.where ? `${e.where.bagCell !== undefined ? 'в рюкз.' : 'на'} ${e.where.charName}`.slice(0, 14) : undefined,
        tooltip: () =>
          withUpgrade(
            {
              title: item.name,
              rows: itemRows(item).map((r) => [r.label, r.value, r.color] as [string, string, string?]),
              note: e.where ? `${e.where.bagCell !== undefined ? 'Лежит у' : 'Надето:'} «${e.where.charName}», ${e.where.slotName.toLowerCase()}.` : itemDescription(item),
            },
            item,
          ),
        onClick: () => this.select(e.uid),
      });
      slot.setContent(createItemIcon(this, item, SLOT - (e.where ? 26 : 18)), e.count).setItemGems(item);
      if (e.where) slot.setAccent(0x6b8f3a);
      if (this.multi) {
        if (this.picked.has(e.uid)) {
          slot.setAccent(PICKED).setSelected(true);
          slot.add(text(this, SLOT / 2 - 6, -SLOT / 2 + 4, '✓', { kind: 'mono', size: 16, weight: 700, color: '#3f6a1c' }).setOrigin(1, 0));
        }
      } else slot.setSelected(e.uid === this.selected);
      this.grid.add(slot);
      cells.push(slot);
    }
    // перетаскивание: на другой предмет — поменять местами (то же зелье — в стопку), на пустую ячейку — в конец
    if (!this.multi) {
      enableSlotDrag(this, cells, cells.map((_, i) => (pageEntries[i] ? getItem(pageEntries[i].itemId) : null)), SLOT - 18, (from, to) => {
        const a = pageEntries[from];
        if (!a) return;
        store.update((st) => moveInventory(st, a.uid, pageEntries[to]?.uid ?? null, store.maxStack));
      });
    }

    this.empty.setText(
      entries.length ? '' : this.filter === 'all' ? 'Инвентарь пуст.\nПредметы собираются в «Чертежах».' : 'В этой вкладке пусто.',
    );
    this.empty.setVisible(!entries.length);
    this.renderDetails(s);
  }

  private confirmDisassembly(uid: string, name: string, refund: number) {
    const m = new Modal(this, { title: 'Разобрать?', width: 480, height: 260 });
    const w = m.card.innerW;
    m.card.content.add(text(this, w / 2, 30, `«${name}» разберётся на кубы.\nВернётся ${refund} куб. — половина стоимости.`, { size: 16, align: 'center' }).setOrigin(0.5, 0));
    m.card.content.add(new Button(this, w / 2 - 105, 130, 'Отмена', { variant: 'beige', width: 190, height: 48, size: 20, onClick: () => m.close() }));
    m.card.content.add(
      new Button(this, w / 2 + 105, 130, 'Разобрать', {
        width: 190,
        height: 48,
        size: 20,
        onClick: () => {
          store.update((s) => disassembleItem(s, uid, (id) => {
            const bpId = getItem(id).blueprintId;
            return bpId ? getBlueprint(bpId) : undefined;
          }));
          m.close();
        },
      }),
    );
  }

  private select(uid: string) {
    const ev = this.input.activePointer.event as MouseEvent | undefined;
    const mod = !!(ev && (ev.ctrlKey || ev.shiftKey || ev.metaKey));
    if (mod && !this.multi) {
      this.multi = true;
      this.picked = new Set(this.selected ? [this.selected] : []);
    }
    if (this.multi) {
      if (this.picked.has(uid)) this.picked.delete(uid);
      else this.picked.add(uid);
    } else this.selected = uid;
    this.render(store.state);
  }

  private setMulti(on: boolean) {
    this.multi = on;
    this.picked = new Set(on && this.selected ? [this.selected] : []);
    this.render(store.state);
  }

  /** Панель справа в режиме выбора: сколько выбрано, сколько вернётся, разобрать разом. */
  private renderPicked(s: PlayerState) {
    const w = this.details.innerW;
    const h = this.details.innerH;
    const picked = s.inventory.filter((e) => this.picked.has(e.uid));
    const pieces = picked.reduce((n, e) => n + e.count, 0);
    const refund = disassemblyRefundOf(s, this.picked, blueprintOf);
    const noBp = picked.filter((e) => !blueprintOf(e.itemId));
    this.detailBody.add(text(this, 0, 0, 'ВЫБРАНО', { size: 12, color: COLOR.inkQuiet, letterSpacing: 1 }));
    this.detailBody.add(text(this, 0, 18, picked.length ? `${picked.length} предм. · ${pieces} шт.` : 'Ничего', { kind: 'display', size: 22 }));
    let y = 56;
    const byName = new Map<string, number>();
    for (const e of picked) byName.set(getItem(e.itemId).name, (byName.get(getItem(e.itemId).name) ?? 0) + e.count);
    const lines = [...byName];
    for (const [name, n] of lines.slice(0, 12)) {
      this.detailBody.add(text(this, 0, y, name, { size: 13, wrap: w - 50 }));
      this.detailBody.add(text(this, w, y, `×${n}`, { kind: 'mono', size: 13 }).setOrigin(1, 0));
      this.detailBody.add(dottedLine(this, 0, y + 18, w, 0x9a7a58));
      y += 22;
    }
    if (lines.length > 12) this.detailBody.add(text(this, 0, y, `и ещё ${lines.length - 12}…`, { size: 13, color: COLOR.inkQuiet }));
    if (!picked.length) {
      this.detailBody.add(text(this, 0, y, 'Клик по предмету — отметить.\nCtrl/Shift+клик — то же из обычного режима.\nСтопки разбираются целиком.', { size: 13, color: COLOR.inkQuiet, wrap: w }));
    }
    const visible = this.visible(s).slice(this.page * PER_PAGE, (this.page + 1) * PER_PAGE);
    const allOnPage = visible.length > 0 && visible.every((e) => this.picked.has(e.uid));
    this.detailBody.add(
      new Button(this, w / 2, h - 126, allOnPage ? 'Снять выбор' : 'Выбрать всё на странице', {
        variant: 'beige', width: w, height: 40, size: 16,
        onClick: () => {
          for (const e of visible) (allOnPage ? this.picked.delete(e.uid) : this.picked.add(e.uid));
          this.render(store.state);
        },
      }),
    );
    if (noBp.length) this.detailBody.add(text(this, w / 2, h - 92, `Без чертежа не разберутся: ${noBp.length}`, { size: 12, color: COLOR.lose }).setOrigin(0.5));
    this.detailBody.add(text(this, w / 2, h - 60, picked.length ? `Вернётся ${refund} куб.` : '', { size: 12, color: COLOR.inkQuiet }).setOrigin(0.5));
    this.detailBody.add(
      new Button(this, w / 2, h - 26, 'Разобрать выбранное', {
        variant: 'beige', width: w, height: 44, size: 18,
        onClick: () => this.confirmMany(picked.length, pieces, refund),
      }).setEnabled(refund > 0),
    );
  }

  private confirmMany(n: number, pieces: number, refund: number) {
    const m = new Modal(this, { title: 'Разобрать выбранное?', width: 480, height: 260 });
    const w = m.card.innerW;
    m.card.content.add(text(this, w / 2, 30, `${n} предм. (${pieces} шт.) разберутся на кубы.
Вернётся ${refund} куб. — половина стоимости.`, { size: 16, align: 'center' }).setOrigin(0.5, 0));
    m.card.content.add(new Button(this, w / 2 - 105, 130, 'Отмена', { variant: 'beige', width: 190, height: 48, size: 20, onClick: () => m.close() }));
    m.card.content.add(
      new Button(this, w / 2 + 105, 130, 'Разобрать', {
        width: 190, height: 48, size: 20,
        onClick: () => {
          const ids = [...this.picked];
          this.picked.clear();
          store.update((s) => disassembleMany(s, ids, blueprintOf));
          m.close();
        },
      }),
    );
  }

  private renderDetails(s: PlayerState) {
    this.detailBody.removeAll(true);
    if (this.multi) return this.renderPicked(s);
    const w = this.details.innerW;
    const entry = allEntries(s).find((e) => e.uid === this.selected);
    if (!entry) {
      this.detailBody.add(text(this, w / 2, 160, 'Выбери предмет\nв сетке слева.\n\nПеретащи — поменять местами.', { size: 16, color: COLOR.inkQuiet, align: 'center' }).setOrigin(0.5));
      return;
    }
    const item: Item = itemOf(entry);
    const up = item.kind === 'weapon' && !entry.where ? upgradeInfo(s, { kind: 'inv', uid: entry.uid }) : null;
    const cell = up ? cellInfo(s, { kind: 'inv', uid: entry.uid }) : null;
    // внизу — кнопки действий, выше — карточка с прокруткой
    // камни — и у надетого оружия, и у лежащего в рюкзаке бойца: там, где оно сейчас
    const where = entry.where;
    const gemTarget: UpgradeTarget = !where ? { kind: 'inv', uid: entry.uid }
      : where.bagCell !== undefined ? { kind: 'bag', charUid: where.charUid, cell: where.bagCell }
        : { kind: 'equip', charUid: where.charUid, slot: typeof where.slot === 'number' ? where.slot : -1 };
    const gemsInfo = item.kind === 'weapon' ? gemInfo(s, gemTarget) : null;
    // ячейки камней — прямо в карточке; клик по ячейке открывает выбор камня
    const gems = gemsInfo ? { info: gemsInfo, onCell: (k: number) => void openGemPicker(this, gemTarget, k) } : null;
    const reserve = entry.where ? 146 : up ? 104 : 80;
    const area = new ScrollArea(this, 0, 0, w - 14, this.details.innerH - reserve); // справа — зазор и полоса прокрутки
    this.detailBody.add(area);
    fillItemInfo(this, area, item, { count: entry.count, up, cell, gems });
    const h = this.details.innerH;
    if (entry.where) {
      const where = entry.where;
      const inBag = where.bagCell !== undefined;
      this.detailBody.add(text(this, w / 2, h - 118, `${inBag ? 'Лежит у' : 'Надето:'} «${where.charName}»\n${where.slotName}`, { size: 13, color: COLOR.ink, align: 'center' }).setOrigin(0.5));
      this.detailBody.add(
        new Button(this, w / 2, h - 74, inBag ? 'Вынуть в инвентарь' : 'Снять', {
          variant: 'beige', width: w, height: 40, size: 18,
          onClick: () => store.update((st) => (inBag ? takeFromBag(st, where.charUid, where.bagCell!) : unequip(st, where.charUid, where.slot!))),
        }),
      );
      this.detailBody.add(
        new Button(this, w / 2, h - 26, 'К персонажу', {
          width: w, height: 40, size: 18,
          onClick: () => this.go(SCENE.characters, { charUid: where.charUid } satisfies CharactersSceneData),
        }),
      );
      return;
    }
    const refund = item.blueprintId ? disassemblyRefund(craftCost(getBlueprint(item.blueprintId))) : 0;
    if (up) {
      // оружие: «Прокачать» и «Разобрать» рядом, цена — на кнопках
      const bw = (w - 10) / 2;
      this.detailBody.add(
        new Button(this, bw / 2, h - 26, up.reason === 'max' ? 'Максимум' : `Прокачать · ${up.cost}`, {
          width: bw, height: 44, size: 16,
          onClick: () => store.update((st) => upgradeWeapon(st, { kind: 'inv', uid: entry.uid })),
        }).setEnabled(up.ok),
      );
      this.detailBody.add(
        new Button(this, w - bw / 2, h - 26, `Разобрать · +${refund}`, {
          variant: 'beige', width: bw, height: 44, size: 16,
          onClick: () => this.confirmDisassembly(entry.uid, item.name, refund),
        }).setEnabled(!!item.blueprintId),
      );
      // ячейка камня — за ювелирный набор (этап 8), до MAX_GEM_CELLS
      if (cell) {
        this.detailBody.add(
          new Button(this, w / 2, h - 76, cell.reason === 'max' ? `Ячеек ${cell.cells}/${cell.max} — максимум` : `Ячейка камня · 1 набор · ${cell.cells}/${cell.max}`, {
            variant: 'beige', width: w, height: 40, size: 15,
            onClick: () => store.update((st) => addGemCell(st, { kind: 'inv', uid: entry.uid })),
          }).setEnabled(cell.ok),
        );
      }

      return;
    }
    this.detailBody.add(
      new Button(this, w / 2, h - 26, 'Разобрать', {
        variant: 'beige',
        width: w,
        height: 44,
        size: 18,
        onClick: () => this.confirmDisassembly(entry.uid, item.name, refund),
      }).setEnabled(!!item.blueprintId),
    );
    this.detailBody.add(
      text(this, w / 2, h - 60, `Вернётся ${refund} куб.${entry.count > 1 ? ' за 1 шт.' : ''}`, { size: 12, color: COLOR.inkQuiet }).setOrigin(0.5),
    );
  }
}
