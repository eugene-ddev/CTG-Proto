import { BaseScene } from './BaseScene';
import { SCENE } from './keys';
import { itemOf } from '../core/character';
import { emptyCounts } from '../core/stats';
import { ROTATION_BLUEPRINTS, blueprintCost, getItem, weaponStrike } from '../data/catalog';
import { STAT_SHORT, disabledEffect, effectDescription, itemDescription, itemRows, statDisabledTitle } from '../data/labels';
import type { Blueprint, Item, Stat } from '../data/types';
import { ArrowButton } from '../ui/ArrowButton';
import { Button } from '../ui/Button';
import { crossButton } from '../ui/CrossButton';
import { hintIcon } from '../ui/HintIcon';
import { createItemIcon } from '../ui/ItemIcon';
import { Modal } from '../ui/Modal';
import { Pager } from '../ui/Pager';
import { Card, panel } from '../ui/Panel';
import { ResourceBar } from '../ui/ResourceBar';
import { BlockChip, Slot } from '../ui/Slot';
import { StatAllocator } from '../ui/StatAllocator';
import { text } from '../ui/text';
import { TextField } from '../ui/TextField';
import { COLOR } from '../ui/theme';
import type { TooltipContent } from '../ui/Tooltip';
import { withUpgrade } from '../ui/upgradeTip';
import { VoxelView } from '../ui/VoxelView';
import { weaponRow } from '../ui/WeaponRow';

const WEAPON_ID = 'rustySword';
const GEMS = ['fireGem', 'iceGem'];
const GEM_CELLS = 3;
const FOCUS: Stat[] = ['Armor', 'Strength', 'Dexterity'];
const FIGHTERS = ['Варан', 'Лобстер'];
const PAGES = 3;

const itemTip = (item: Item): TooltipContent =>
  withUpgrade({ title: item.name, rows: itemRows(item).map((r) => [r.label, r.value, r.color] as [string, string, string?]), note: itemDescription(item) } as TooltipContent, item);

/** Витрина компонентов интерфейса на данных каталога: кнопки, листание, ячейки предметов, камни, статы. */
export class UiKitScene extends BaseScene {
  constructor() {
    super(SCENE.uiKit);
  }

  create() {
    this.setupScreen({ title: 'UI-кит', subtitle: 'Компоненты интерфейса на данных каталога' });
    this.controls(new Card(this, 40, 150, 380, 530, { title: 'Кнопки и листание' }));
    this.items(new Card(this, 440, 150, 400, 530, { title: 'Предметы' }));
    this.stats(new Card(this, 860, 150, 380, 530, { title: 'Статы и ресурсы' }));
  }

  private label(card: Card, y: number, value: string) {
    card.content.add(text(this, 0, y, value, { size: 12, color: COLOR.inkQuiet, letterSpacing: 1 }));
  }

  private controls(card: Card) {
    const c = card.content;
    const w = card.innerW;
    const left = w / 4;
    const right = (w * 3) / 4;
    c.add(new Button(this, left, 24, 'В бой', { width: 156, height: 46, size: 26 }));
    c.add(new Button(this, right, 24, 'В лобби', { variant: 'beige', width: 156, height: 46, size: 22 }));
    c.add(new Button(this, left, 78, 'Недоступно', { width: 156, height: 46, size: 20 }).setEnabled(false));
    c.add(
      new Button(this, right, 78, 'Модалка', {
        variant: 'beige',
        width: 156,
        height: 46,
        size: 22,
        onClick: () => {
          const modal = new Modal(this, { title: 'Пауза', width: 460, height: 260 });
          modal.card.content.add(text(this, modal.card.innerW / 2, 50, 'Бой приостановлен', { size: 18 }).setOrigin(0.5));
          modal.card.content.add(new Button(this, modal.card.innerW / 2, 130, 'Продолжить', { width: 220, height: 54, onClick: () => modal.close() }));
        },
      }),
    );

    this.label(card, 112, 'ЛИСТАНИЕ И ЗНАЧКИ');
    let fighter = 0;
    const fighterName = text(this, 84, 142, FIGHTERS[fighter], { kind: 'display', size: 17 }).setOrigin(0.5);
    const flip = (dir: number) => {
      fighter = (fighter + dir + FIGHTERS.length) % FIGHTERS.length;
      fighterName.setText(FIGHTERS[fighter]);
    };
    c.add([new ArrowButton(this, 22, 142, -1, () => flip(-1), 0.8), fighterName, new ArrowButton(this, 146, 142, 1, () => flip(1), 0.8)]);
    c.add(crossButton(this, w - 70, 142, () => undefined, 'Снять или выбросить'));
    c.add(hintIcon(this, w - 30, 142, () => ({ title: 'Крита нет', note: 'Пояснение к значению, которое не помещается в строку.' })));

    const pager: Pager = new Pager(this, 84, 184, (page) => pager.set(page, PAGES));
    pager.set(0, PAGES);
    c.add(pager);
    c.add(new TextField(this, 176, 166, { width: w - 176, height: 36, value: FIGHTERS[0], maxLength: 16, placeholder: 'Имя бойца' }));

    this.label(card, 212, 'ЧЕРТЕЖИ: ОТКРЫТ И ЗАКРЫТ');
    const weapons = ROTATION_BLUEPRINTS().filter((bp) => bp.kind === 'weapon');
    const tileW = (w - 8) / 2;
    if (weapons[0]) c.add(this.blueprintTile(weapons[0], 0, 234, tileW, 150, false));
    if (weapons[1]) c.add(this.blueprintTile(weapons[1], tileW + 8, 234, tileW, 150, true));

    // заголовки финальных экранов поверх пергамента не читаются — показываем на тёмной плашке
    c.add(this.add.rectangle(w / 2, 412, w, 40, COLOR.bg).setStrokeStyle(1, 0x000000, 0.4));
    c.add(text(this, 12, 412, 'Победа', { kind: 'display', size: 22, color: COLOR.win }).setOrigin(0, 0.5));
    c.add(text(this, w / 2 + 6, 412, 'Поражение', { kind: 'display', size: 22, color: COLOR.lose }).setOrigin(0.5));
    c.add(text(this, w - 12, 412, 'Пауза', { kind: 'display', size: 22, color: COLOR.pause }).setOrigin(1, 0.5));
  }

  /** Плитка чертежа, как в «Чертежах»: закрытая — бледная модель и «ЗАКРЫТ» вместо цены. */
  private blueprintTile(bp: Blueprint, x: number, y: number, w: number, h: number, locked: boolean) {
    const tile = this.add.container(x, y);
    const nameY = h - 28;
    const view = new VoxelView(this, w / 2, (nameY - 4) / 2 + 2, { blocks: bp.blocks, width: w - 40, height: nameY - 16, maxBlockPx: 18, neutral: true });
    const cost = text(this, w - 10, nameY, locked ? 'ЗАКРЫТ' : `${blueprintCost(bp)} куб.`, { kind: 'mono', size: 12, weight: 700, color: locked ? COLOR.lose : COLOR.ink }).setOrigin(1, 0);
    const name = text(this, 10, nameY - 2, bp.name, { kind: 'display', size: 15, color: locked ? COLOR.inkQuiet : COLOR.ink });
    if (locked) view.setAlpha(0.35);
    tile.add([panel(this, 0, 0, w, h, 'beige'), view, name, cost]);
    return tile;
  }

  private items(card: Card) {
    const c = card.content;
    const w = card.innerW;
    const slotWith = (x: number, y: number, size: number, item: Item, count?: number) => {
      const slot = new Slot(this, x, y, { size, tooltip: () => itemTip(item) });
      slot.setContent(createItemIcon(this, item, size - 20), count).setItemGems(item);
      c.add(slot);
      return slot;
    };

    this.label(card, 0, 'ОРУЖИЕ: УРОВНИ, ЯЧЕЙКИ КАМНЕЙ, ПУСТОЙ СЛОТ');
    // уровень виден по модели; точки в углу — ячейки камней: пустые и с камнями
    slotWith(38, 58, 76, itemOf({ itemId: WEAPON_ID, level: 1 }));
    slotWith(38 + 84, 58, 76, itemOf({ itemId: WEAPON_ID, level: 2, cells: 1 }));
    slotWith(38 + 168, 58, 76, itemOf({ itemId: WEAPON_ID, level: 3, cells: GEM_CELLS, gems: GEMS }));
    c.add(new Slot(this, w - 38, 58, { size: 76, label: 'Рука', tooltip: () => ({ title: 'Пустой слот', note: 'Перетащи оружие из инвентаря или рюкзака.' }) }));

    this.label(card, 106, 'ЯЧЕЙКИ: СТОПКА, СУМКА, ВЫБРАНА, ЦЕЛЬ');
    const step = (w - 60) / 4;
    slotWith(30, 158, 60, getItem('restoreArmorVial'), 3);
    slotWith(30 + step, 158, 60, getItem('whetstone'), 12);
    slotWith(30 + step * 2, 158, 60, getItem('pouch'));
    slotWith(30 + step * 3, 158, 60, getItem('rustyDagger')).setSelected(true);
    c.add(new Slot(this, 30 + step * 4, 158, { size: 60, tooltip: () => ({ title: 'Цель перетаскивания', note: 'Зелёная рамка — сюда можно положить.' }) }).setAccent(0x3fa535));

    this.label(card, 198, `КАМНИ · ${GEMS.length} / ${GEM_CELLS}`);
    for (let cell = 0; cell < GEM_CELLS; cell++) {
      const gem = GEMS[cell] ? getItem(GEMS[cell]) : null;
      const slot = new Slot(this, 23 + cell * 54, 241, {
        size: 46,
        tooltip: () => (gem ? { title: gem.name, note: itemDescription(gem) } : { title: 'Пустая ячейка', note: 'Клик — выбрать камень.' }),
      });
      if (gem) slot.setContent(createItemIcon(this, gem, 30));
      c.add(slot);
    }
    // описание эффекта — у первого камня; остальные — в подсказках ячеек
    const firstGem = getItem(GEMS[0]);
    if (firstGem.kind === 'gem') {
      c.add(text(this, 172, 218, firstGem.name, { size: 12, weight: 700 }));
      c.add(text(this, 172, 234, firstGem.effects.map(effectDescription).join(' '), { size: 11, color: COLOR.inkQuiet, wrap: w - 172 }));
    }

    this.label(card, 284, 'СТРОКА ОРУЖИЯ В РУКЕ');
    const inHand = itemOf({ itemId: WEAPON_ID, level: 2 });
    if (inHand.kind === 'weapon') {
      const ability = inHand.ability;
      const strike = weaponStrike(inHand);
      const damage = ability.damage * strike.multiplier;
      c.add(weaponRow(this, 0, 304, w, { label: 'Л', name: inHand.name, level: inHand.itemLevel, damage, hits: strike.hits, cooldown: ability.cooldown, details: `~${Math.round((damage * strike.hits) / Math.max(1, ability.cooldown))}/ход · ${ability.staminaCost} вын.` }).row);
    }

    this.label(card, 366, 'ФОКУС АТАКИ');
    FOCUS.forEach((stat, i) => c.add(new BlockChip(this, 54 + i * ((w - 108) / 2), 405, STAT_SHORT[stat], i + 1, 104, 40)));
  }

  private stats(card: Card) {
    const c = card.content;
    const w = card.innerW;
    const bars: Array<[number, string, number]> = [
      [COLOR.hp, 'КБ', 100],
      [COLOR.stamina, 'ВН', 64],
      [COLOR.mana, 'МН', 30],
    ];
    bars.forEach(([color, name, value], i) => c.add(new ResourceBar(this, 0, i * 32, w, 26, color, name).set(value, 100)));

    // строка «метка — значение» с пояснением под значком «?»
    const row = (y: number, label: string, value: string, hint: TooltipContent) => {
      const valueText = text(this, w, y, value, { kind: 'mono', size: 13, color: COLOR.lose }).setOrigin(1, 0);
      c.add([text(this, 0, y, label, { size: 13 }), valueText, hintIcon(this, w - valueText.width - 12, y + 8, () => hint)]);
    };
    row(102, 'Крит', '0%', { title: 'Крита нет', note: 'Крит работает, пока есть хотя бы один живой куб Силы и не отключена Удача.' });
    row(122, 'Сила', 'отключена', { title: statDisabledTitle('Strength'), note: `Нет кубов Силы: ${disabledEffect('Strength')}.` });

    c.add(new StatAllocator(this, 0, 152, w, { total: 20, initial: { ...emptyCounts(), Armor: 6, Strength: 5, Dexterity: 3, Stamina: 4, Luck: 2 } }));

    c.add(text(this, 0, 372, 'Nozhik — заголовки', { kind: 'display', size: 20 }));
    c.add(text(this, 0, 398, 'Roboto Condensed — основной текст', { size: 15 }));
    c.add(text(this, 0, 418, 'JetBrains Mono — 0:47  3–7  33%', { kind: 'mono', size: 13 }));
  }
}
