import Phaser from 'phaser';
import { PRESET_MISS_LABEL, PRESET_SLOTS, applyPreset, matchesPreset, presetsOf, type PresetReport } from '../core/preset';
import { ScrollArea } from '../ui/ScrollArea';
import { fillItemInfo } from '../ui/itemInfo';
import { itemOf as resolveItem } from '../core/character';
import { cubeCount } from '../core/state';
import { enableSlotDrag } from '../ui/bagDrag';
import { isDragRelease } from '../ui/dragGuard';
import type { CraftTarget } from '../core/craftTarget';
import { BaseScene } from './BaseScene';
import { SCENE, type CharactersSceneData, type CraftSceneData } from './keys';
import { editLocked } from '../core/edit';
import { getBlueprint, getItem, hasItem } from '../data/catalog';
import { NAME_MAX, bagAccepts, bagSlots, characterRefund, characterStats, requirementGap, slotAccepts, slotDamage, slotLabel, moveEquipped, moveInBag, validName, type CharacterStats, type SlotRef } from '../core/character';
import type { CharacterState, PlayerState } from '../core/state';
import type { BlueprintKind, CharacterBlueprint, Item, Stat } from '../data/types';
import { STATS } from '../data/types';
import { STAT_LABEL, STAT_LABEL_GEN, itemRows } from '../data/labels';
import { store } from '../game/store';
import { cellInfo, gemInfo, upgradeInfo, type UpgradeTarget } from '../core/upgrade';
import { openGemPicker } from '../ui/GemPicker';
import { hintIcon } from '../ui/HintIcon';
import { weaponRow } from '../ui/WeaponRow';
import { staminaRegenFor } from '../core/battle';
import { Button } from '../ui/Button';
import { createItemIcon } from '../ui/ItemIcon';
import { Modal } from '../ui/Modal';
import { openRucksack } from '../ui/RucksackModal';
import { LOBBY_REGEN_MS, activeCharacter, fullRegenIn, equipFromBag, inRun, nextRegenIn, potionSources, repairCost, stowToBagCell } from '../core/arena';

/** Слоты артефактов пока скрыты в интерфейсе: артефакты не проработаны (боты — без маны). */
export const HIDE_ARTIFACT_SLOTS = true;
/** Ячеек рюкзака в ряду на экране персонажа. */
const BAG_PER_ROW = 6;

/** «45 С», «3 МИН 05 С», «1 Ч 02 МИН». */
const duration = (ms: number) => {
  const t = Math.ceil(ms / 1000);
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), sec = t % 60;
  if (h) return `${h} Ч ${String(m).padStart(2, '0')} МИН`;
  if (m) return `${m} МИН ${String(sec).padStart(2, '0')} С`;
  return `${sec} С`;
};
import { Card, dottedLine, panel } from '../ui/Panel';
import { Pager } from '../ui/Pager';
import { Slot } from '../ui/Slot';
import { TextField } from '../ui/TextField';
import { text } from '../ui/text';
import { COLOR, STAT_COLOR } from '../ui/theme';
import { Tooltip, attachTooltip, type TooltipContent } from '../ui/Tooltip';
import { withUpgrade } from '../ui/upgradeTip';
import { VoxelView } from '../ui/VoxelView';
import { modelView, type ModelView } from '../ui/modelView';

const SELECTED_KEY = 'characters.selected';
/** Поворот модели на экране персонажа, градусы (как стрелка «вправо» в сборке — rotateBy(1)). */
const MODEL_YAW = 180;

/** Выбор в правой колонке. */
type Sel = { kind: 'slot'; ref: SlotRef } | { kind: 'bag'; cell: number } | { kind: 'preset'; slot: number };
const sameSel = (a: Sel | null, b: Sel) => !!a && JSON.stringify(a) === JSON.stringify(b);
const LIST_PAGE = 4;

/** Что нужно правой панели: чертёж, статы и предмет в ячейке. */
interface Gear {
  /** Чей это экип (для прокачки надетого оружия). */
  charUid?: string;
  bp: CharacterBlueprint;
  stats: CharacterStats;
  itemAt(slot: SlotRef): Item | null;
}

const fmt1 = (v: number) => (Math.round(v * 10) / 10).toFixed(1).replace('.0', '');
const pct = (v: number) => `${(v * 100).toFixed(1).replace('.0', '')}%`;

/**
 * Одно окно: слева персонажи, справа карточка выбранного — снаряжение, имя, статы.
 * Персонаж появляется сразу после крафта по чертежу, отдельной «сборки» нет.
 */
export class CharactersScene extends BaseScene {
  private list!: Card;
  private right!: Card;
  private listRows!: Phaser.GameObjects.Container;
  private body!: Phaser.GameObjects.Container;
  /** uid выбранного персонажа; null — персонажей нет. */
  private selected: string | null = null;
  private listPage = 0;
  private hint?: Phaser.GameObjects.Text;
  /** Что показано в правой колонке: предмет в ячейке, пресет; null — сведения о бойце. */
  private sel: Sel | null = null;
  /** Ячейка пресета, к которой относится кнопка «Применить / Сохранить». */
  private presetSel = 0;

  /** Персонаж, которого открыть сразу (кнопка «Персонажи» после крафта). */
  private pendingChar?: string;

  constructor() {
    super(SCENE.characters);
  }

  init(data: CharactersSceneData) {
    this.pendingChar = data?.charUid;
  }

  create() {
    this.listPage = 0;
    this.sel = null;
    this.setupScreen({ title: 'Персонажи', subtitle: 'Снаряжение и имя', tab: 'characters' });

    this.list = new Card(this, 40, 146, 360, 560, { title: 'Мои бойцы' });
    this.listRows = this.add.container(0, 0);
    this.list.content.add(this.listRows);
    this.right = new Card(this, 416, 146, 824, 560, { title: 'Персонаж' });
    this.body = this.add.container(0, 0);
    this.right.content.add(this.body);

    // по умолчанию — активный боец (закреплён вверху списка); после сборки — свежесобранный
    const want = this.pendingChar ?? activeCharacter(store.state)?.uid;
    this.pendingChar = undefined;
    this.selected = want && store.state.characters.some((c) => c.uid === want) ? want : store.state.characters[0]?.uid ?? null;
    if (this.selected) this.registry.set(SELECTED_KEY, this.selected);
    const c0 = store.state.characters.find((c) => c.uid === this.selected);
    if (c0) this.presetSel = this.matchingPreset(c0);
    // выбранный не активный — на странице списка, где он виден
    const idx = this.listOrder(store.state).rest.findIndex((c) => c.uid === this.selected);
    if (idx >= 0) this.listPage = Math.floor(idx / (LIST_PAGE - 1));
    this.watch((s) => this.render(s));
  }

  private select(uid: string) {
    if (uid !== this.selected) {
      this.sel = null;
      const c = store.state.characters.find((x) => x.uid === uid);
      this.presetSel = c ? this.matchingPreset(c) : 0;
    }
    this.selected = uid;
    this.registry.set(SELECTED_KEY, uid);
    this.render(store.state);
  }

  private render(s: PlayerState) {
    // выбранный мог быть разобран
    if (!this.selected || !s.characters.some((c) => c.uid === this.selected)) this.selected = s.characters[0]?.uid ?? null;
    this.renderList(s);
    this.renderRight(s);
  }

  // ───────────── список слева ─────────────

  private renderList(s: PlayerState) {
    this.listRows.removeAll(true);
    const w = this.list.innerW;
    this.listRows.add(
      new Button(this, w / 2, 22, '+ Новый персонаж', {
        variant: 'beige',
        width: w,
        height: 44,
        size: 18,
        onClick: () => {
          this.registry.set('blueprints.tab', 'character');
          this.registry.set('blueprints.page', 0);
          this.go(SCENE.blueprints);
        },
      }),
    );
    this.listRows.add(text(this, w / 2, 50, 'Персонаж собирается по чертежу', { size: 12, color: COLOR.inkQuiet }).setOrigin(0.5, 0));
    let y = 76;
    this.listRows.add(text(this, 0, y, `ПЕРСОНАЖИ · ${s.characters.length}`, { size: 12, color: COLOR.inkQuiet, letterSpacing: 1 }));
    y += 22;
    if (!s.characters.length) {
      this.listRows.add(text(this, 0, y, 'Пока никого. Собери первого в «Чертежах».', { size: 14, color: COLOR.inkQuiet, wrap: w }));
      return;
    }
    // активный боец закреплён вверху (зелёная галочка), остальные — постранично под ним
    const { active, rest } = this.listOrder(s);
    const per = LIST_PAGE - (active ? 1 : 0);
    const pages = Math.max(1, Math.ceil(rest.length / per));
    this.listPage = Math.min(this.listPage, pages - 1);
    const shown = [...(active ? [active] : []), ...rest.slice(this.listPage * per, (this.listPage + 1) * per)];
    for (const c of shown) {
      const bp = getBlueprint(c.blueprintId) as CharacterBlueprint;
      const selected = this.selected === c.uid;
      const row = this.add.container(0, y);
      row.add(panel(this, 0, 0, w, 66, selected ? 'light' : 'beige'));
      if (selected) row.add(this.add.graphics().lineStyle(3, 0x4a2a12, 1).strokeRoundedRect(1, 1, w - 2, 64, 8));
      // превью целиком; разбитые кубы — значок ремонта (в лобби чинятся сами, в серии арены — нет)
      row.add(new VoxelView(this, 40, 33, { blocks: bp.blocks, width: 64, height: 52, maxBlockPx: 8, yaw: MODEL_YAW, colorOf: (i) => STAT_COLOR[c.blockStats[i]] }));
      if (c.brokenBlocks.length) {
        const repairing = !inRun(s, c.uid);
        const badge = this.add.container(66, 12);
        badge.add(this.add.circle(0, 0, 11, repairing ? 0x3f7a2a : 0x8a2a1e, 1).setStrokeStyle(2, 0x2b1a0a, 0.9));
        badge.add(text(this, 0, 1, '🔧', { size: 12 }).setOrigin(0.5));
        if (repairing) this.tweens.add({ targets: badge, angle: { from: -12, to: 12 }, duration: 500, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
        row.add(badge);
      }
      if (c === active) {
        const check = this.add.container(w - 22, 33);
        check.add(this.add.circle(0, 0, 13, 0x3fa535, 1).setStrokeStyle(2, 0x1f4a12, 0.9));
        check.add(text(this, 0, 0, '✓', { kind: 'mono', size: 17, weight: 700, color: '#ffffff' }).setOrigin(0.5));
        row.add(check);
      }
      row.add(text(this, 82, 10, c.name, { kind: 'display', size: 19 }));
      const gear = c.equipment.filter(Boolean).length + (c.rucksack ? 1 : 0);
      row.add(text(this, 82, 38, `${bp.name} · ${c.blockStats.length - c.brokenBlocks.length}/${c.blockStats.length} куб. · снаряжение ${gear}`, { size: 12, color: COLOR.inkQuiet }));
      const hit = this.add.zone(0, 0, w, 66).setOrigin(0).setInteractive({ useHandCursor: true }).on('pointerup', () => !isDragRelease(this) && this.select(c.uid));
      if (c === active) attachTooltip(hit, () => ({ title: `${c.name} · активный`, note: 'Этот боец идёт в бой с главного экрана.' }));
      row.add(hit);
      this.listRows.add(row);
      y += 74;
    }
    if (pages > 1) {
      const pager = new Pager(this, w / 2, this.list.innerH - 14, (p) => {
        this.listPage = p;
        this.renderList(store.state);
      });
      pager.set(this.listPage, pages);
      this.listRows.add(pager);
    }
  }

  /** Активный боец (закреплён вверху) и остальные по порядку. */
  private listOrder(s: PlayerState): { active: CharacterState | null; rest: CharacterState[] } {
    const active = activeCharacter(s);
    return { active, rest: s.characters.filter((c) => c !== active) };
  }

  // ───────────── правая панель ─────────────

  private renderRight(s: PlayerState) {
    Tooltip.for(this).hide(); // объект под курсором пересоздаётся — старая подсказка устарела
    this.body.removeAll(true);
    this.hint = undefined;
    const c = s.characters.find((x) => x.uid === this.selected);
    if (!c) return this.renderEmpty();
    this.renderCharacter(c);
  }

  private renderEmpty() {
    const w = this.right.innerW;
    const h = this.right.innerH;
    this.body.add(text(this, w / 2, h / 2 - 50, 'Персонажей пока нет.\nПерсонаж собирается по чертежу — статы кубов задаются там же.\nПосле сборки он сразу появится здесь: останется надеть снаряжение и дать имя.', { size: 16, color: COLOR.inkQuiet, align: 'center', wrap: 560 }).setOrigin(0.5));
    this.body.add(
      new Button(this, w / 2, h / 2 + 50, 'К чертежам', {
        width: 240,
        height: 52,
        onClick: () => {
          this.registry.set('blueprints.tab', 'character');
          this.registry.set('blueprints.page', 0);
          this.go(SCENE.blueprints);
        },
      }),
    );
  }

  /** Карточка готового персонажа: снаряжение меняется сразу, статы — нет. */
  private renderCharacter(c: CharacterState) {
    const bp = getBlueprint(c.blueprintId) as CharacterBlueprint;
    const stats = characterStats(bp, c.blockStats, c.brokenBlocks);
    const itemOf = (it: { itemId: string; level?: number } | null) => (it && hasItem(it.itemId) ? resolveItem(it) : null);
    const gear: Gear = { charUid: c.uid, bp, stats, itemAt: (slot) => itemOf(slot === 'rucksack' ? c.rucksack : c.equipment[slot] ?? null) };
    // выбранная ячейка опустела (сняли, выпили) — снова сведения о бойце
    if (this.sel && !this.selItem(c, gear) && this.sel.kind !== 'preset') this.sel = null;
    // клик по пустому месту карточки — сбросить выбор (зона под всем остальным)
    const bg = this.add.zone(0, 0, this.right.innerW, this.right.innerH).setOrigin(0).setInteractive();
    bg.on('pointerup', () => {
      if (isDragRelease(this) || !this.sel) return;
      this.sel = null;
      this.render(store.state);
    });
    this.body.add(bg);
    const head = text(this, 0, 0, '', { size: 12, color: COLOR.inkQuiet, letterSpacing: 1 });
    // боец в серии: разбитые кубы сами не чинятся — красным сразу за шапкой
    const noRegen = text(this, 0, 0, '', { size: 12, color: COLOR.lose, letterSpacing: 1 });
    this.body.add([head, noRegen]);
    // шапка: в серии арены — номер боя; разбитые кубы — когда починится следующий и когда все
    const headText = () => {
      const st = store.state;
      const cur = st.characters.find((x) => x.uid === c.uid) ?? c;
      const parts = [`${bp.name.toUpperCase()} · КАТЕГОРИЯ ${bp.category}`];
      const arena = st.arenaRun?.charUid === c.uid;
      if (arena) parts.push(`НА АРЕНЕ · БОЙ ${st.arenaRun!.fight}`);
      if (cur.brokenBlocks.length) {
        const now = store.now();
        const t = nextRegenIn(st, cur, now);
        const all = fullRegenIn(st, cur, now);
        // на арене кубы сами не чинятся — только зельем
        const when = arena ? '' : `${t !== null ? ` · КУБ ЧЕРЕЗ ${duration(t)}` : ''}${all !== null && cur.brokenBlocks.length > 1 ? ` · ВСЕ ЧЕРЕЗ ${duration(all)}` : ''}`;
        parts.push(`РАЗБИТО ${cur.brokenBlocks.length}${when}`);
      }
      head.setText(parts.join(' · '));
      noRegen.setText(arena && cur.brokenBlocks.length ? ' · НЕ ЧИНЯТСЯ, ПОКА НА АРЕНЕ' : '').setX(head.width);
    };
    headText();
    const tick = this.time.addEvent({ delay: 1000, loop: true, callback: headText });
    head.once(Phaser.GameObjects.Events.DESTROY, () => tick.remove());
    const view = this.renderModelColumn(bp, c.blockStats, c.brokenBlocks, c.name, undefined, (v) => {
      if (validName(v) && validName(v) !== c.name) store.act('renameCharacter', c.uid, v);
    });
    // куб, который чинится в лобби сейчас: обводка и кольцо прогресса
    view.setFocusBlock(() => {
      const st = store.state;
      const cur = st.characters.find((x) => x.uid === c.uid);
      const t = cur ? nextRegenIn(st, cur, store.now()) : null;
      return cur && t !== null ? { index: cur.brokenBlocks[0], progress: 1 - t / LOBBY_REGEN_MS } : null;
    });
    // под именем: «Сделать активным» (если не активный), «Изменить персонажа», «Разобрать»
    let by = 332;
    if (activeCharacter(store.state)?.uid !== c.uid) {
      const run = store.state.arenaRun;
      const mk = new Button(this, 110, by, 'Сделать активным', {
        width: 220, height: 40, size: 17,
        onClick: () => store.act('setActiveCharacter', c.uid),
      }).setEnabled(!run);
      attachTooltip(mk.hit, () => ({ title: 'Сделать активным', note: run ? 'Идёт серия арены другим бойцом — сменить нельзя, пока она не кончится.' : 'Этот боец пойдёт в бой с главного экрана и встанет вверху списка.' }));
      this.body.add(mk);
      by += 50;
    }
    this.renderEditButton(c, view, by);
    this.renderRepairAll(c);
    this.renderGear(c, gear);
    this.renderInfo(c, gear);
    const refund = characterRefund(c);
    this.body.add(new Button(this, 110, by + 50, 'Разобрать', { variant: 'beige', width: 220, height: 40, size: 17, onClick: () => this.confirmCharacterDisassembly(c, refund) }));
  }

  /** Левая колонка: модель в цветах стат со слотами, имя, сведения о чертеже. */
  private renderModelColumn(bp: CharacterBlueprint, blockStats: readonly Stat[], broken: readonly number[], name: string, onChange?: (v: string) => void, onBlur?: (v: string) => void) {
    const view = modelView(this, 110, 124, {
      blocks: bp.blocks,
      width: 220,
      height: 196,
      maxBlockPx: 30,
      interactive: true,
      rotatable: false,
      yaw: MODEL_YAW, // повёрнут на 180° вправо (решение Евгения); стрелки «перёд» нет
      colorOf: (i) => STAT_COLOR[blockStats[i]],
      lookOf: broken.length ? (i) => (broken.includes(i) ? 'ghost' : 'solid') : undefined,
      // разбитый куб — силуэт цвета своей статы
      ghostColor: (i) => STAT_COLOR[blockStats[i]],
    });
    this.body.add(view);
    if (broken.length) this.body.add(text(this, 110, 226, 'Клик по разбитому кубу — починить зельем', { size: 11, color: COLOR.ink }).setOrigin(0.5, 0));
    this.body.add(text(this, 0, 252, 'ИМЯ', { size: 12, color: COLOR.inkQuiet, letterSpacing: 1 }));
    const field = new TextField(this, 0, 270, { width: 220, value: name, maxLength: NAME_MAX, placeholder: 'Имя бойца', onChange, onBlur });
    this.body.add(field);
    return view;
  }

  /** «Починить всё» за кубы — по цене флаконов; на арене нельзя (там чинят только зелья из рюкзака). */
  private renderRepairAll(c: CharacterState) {
    if (!c.brokenBlocks.length) return;
    const cost = repairCost(c);
    const arena = store.state.arenaRun?.charUid === c.uid;
    const btn = new Button(this, 165, 258, `Починить · ${cost} куб.`, {
      variant: 'beige', width: 112, height: 26, size: 11,
      onClick: () => store.act('repairAll', c.uid),
    });
    btn.setEnabled(!arena && cubeCount(store.state) >= cost);
    attachTooltip(btn.hit, () => ({
      title: 'Починить всё за кубы',
      rows: [['Разбито', String(c.brokenBlocks.length)], ['Цена', `${cost} куб.`], ['Есть', `${cubeCount(store.state)} куб.`]],
      note: arena ? 'На арене кубы чинятся только зельями из рюкзака.' : 'Цена — как собрать флаконы на починку: малый чинит 1 куб, большой — 3; берётся самый дешёвый набор.',
    }));
    this.body.add(btn);
  }

  /**
   * «Изменить персонажа» — вид сборки по чертежу с его кубами: перекрасить, убрать, поставить (руками или ползунками);
   * кубы списываются при подтверждении. Клик по разбитому кубу модели здесь — починка зельем.
   */
  private renderEditButton(c: CharacterState, view: ModelView, y: number) {
    const locked = editLocked(store.state, c.uid);
    const btn = new Button(this, 110, y, 'Изменить персонажа', {
      variant: 'beige', width: 220, height: 40, size: 17,
      onClick: () => this.go(SCENE.craft, { blueprintId: c.blueprintId, editCharUid: c.uid } satisfies CraftSceneData),
    });
    btn.setEnabled(!locked);
    attachTooltip(btn.hit, () => ({
      title: 'Изменить персонажа',
      note: locked
        ? 'Во время серии арены менять кубы нельзя.'
        : 'Откроется сборка по чертежу с кубами бойца: перекрась, убери или поставь кубы — руками или ползунками. Кубы спишутся при подтверждении: 1 за каждый изменённый.',
    }));
    this.body.add(btn);
    view.on('blockclick', (i: number) => {
      // разбитый куб — починить зельем его статы (или скрафтить зелье)
      if (store.state.characters.find((x) => x.uid === c.uid)?.brokenBlocks.includes(i)) this.openRepairPicker(c.uid, i);
    });
  }

  // ───────────── снаряжение ─────────────

  /** Предмет выбранной ячейки (или null). */
  private selItem(c: CharacterState, gear: Gear): Item | null {
    const sl = this.sel;
    if (!sl || sl.kind === 'preset') return null;
    if (sl.kind === 'slot') return gear.itemAt(sl.ref);
    const e = bagSlots(c)[sl.cell];
    return e ? resolveItem(e) : null;
  }

  /** Выбрать / снять выбор ячейки (повторный клик — снять). */
  private toggleSel(next: Sel) {
    this.sel = sameSel(this.sel, next) ? null : next;
    this.render(store.state);
  }

  /**
   * Ячейки персонажа: руки и рюкзак, артефакты, ячейки рюкзака (если надет), пресеты.
   * Клик по предмету — его сведения справа; по пустой ячейке — выбор из инвентаря.
   */
  private renderGear(c: CharacterState, gear: Gear) {
    const x0 = 248;
    const { bp } = gear;
    this.body.add(text(this, x0, 26, 'СНАРЯЖЕНИЕ', { size: 12, color: COLOR.inkQuiet, letterSpacing: 1 }));
    const hands = bp.slots.map((sl, i) => [sl, i] as const).filter(([sl]) => sl.type === 'Hand').map(([, i]) => i);
    const arts = bp.slots.map((sl, i) => [sl, i] as const).filter(([sl]) => sl.type === 'Artifact').map(([, i]) => i);
    const size = 72;
    // слоты рук и артефактов — для перетаскивания предмета из слота в слот
    const dragSlots: Slot[] = [];
    const dragRefs: number[] = [];
    const dragItems: Array<Item | null> = [];
    const placeRow = (refs: SlotRef[], y: number) =>
      refs.forEach((ref, k) => {
        const cx = x0 + size / 2 + k * (size + 12);
        const label = ref === 'rucksack' ? 'Рюкзак' : bp.slots[ref].type === 'Hand' ? (bp.slots[ref].isLeftHand ? 'Л. рука' : 'П. рука') : slotLabel(bp, ref).replace('Артефакт', 'Арт.');
        const item = gear.itemAt(ref);
        const slot = new Slot(this, cx, y, {
          size,
          label,
          tooltip: () => (item ? this.itemTooltip(item, gear.stats, 'Клик — сведения справа') : { title: slotLabel(bp, ref), note: `${this.slotHint(ref, bp)} Клик — выбрать из инвентаря.` }),
          onClick: () => {
            if (item) return this.toggleSel({ kind: 'slot', ref });
            // в серии арены снаряжение меняется только из рюкзака
            if (inRun(store.state, c.uid)) return openRucksack(this, c.uid, { note: 'Боец в серии арены: снаряжение меняется только между боями, из рюкзака.' });
            this.openSlotPicker(c, gear, ref);
          },
        });
        if (item) slot.setContent(createItemIcon(this, item, size - 24)).setItemGems(item);
        slot.setSelected(sameSel(this.sel, { kind: 'slot', ref }));
        this.body.add(slot);
        if (ref !== 'rucksack') {
          dragSlots.push(slot);
          dragRefs.push(ref);
          dragItems.push(item ?? null);
        }
        if (item) this.quickRemove(cx + size / 2 - 9, y - size / 2 + 9, c.uid, () => store.act('unequip', c.uid, ref), ref === 'rucksack' && c.bag.some(Boolean) ? 'Снять рюкзак (содержимое — в инвентарь)' : 'Снять в инвентарь');
      });
    placeRow([...hands, 'rucksack'], 50 + size / 2);
    // слоты артефактов пока скрыты (артефакты не проработаны); надетый раньше артефакт виден — чтобы его можно было снять
    const showArts = !HIDE_ARTIFACT_SLOTS || arts.some((ref) => gear.itemAt(ref));
    if (showArts) placeRow(arts, 50 + size + 12 + size / 2);

    // ячейки рюкзака — только когда он надет
    const cells = bagSlots(c);
    const yb = 50 + (showArts ? 2 : 1) * (size + 12) + 8;
    // ячейки рюкзака — рядами по BAG_PER_ROW (рюкзаки на 12 и 18 ячеек)
    const bagRows = Math.ceil(cells.length / BAG_PER_ROW);
    if (cells.length) {
      const used = cells.filter(Boolean).length;
      this.body.add(text(this, x0, yb, `РЮКЗАК · ${used} / ${cells.length}`, { size: 12, color: COLOR.inkQuiet, letterSpacing: 1 }));
      const cell = 40;
      const gap = Math.min(8, (264 - Math.min(cells.length, BAG_PER_ROW) * cell) / Math.max(1, Math.min(cells.length, BAG_PER_ROW) - 1));
      const cellX = (k: number) => x0 + cell / 2 + (k % BAG_PER_ROW) * (cell + gap);
      const cellY = (k: number) => yb + 22 + cell / 2 + Math.floor(k / BAG_PER_ROW) * (cell + 4);
      const bagCells: Slot[] = [];
      cells.forEach((e, k) => {
        const item = e ? resolveItem(e) : null;
        const slot = new Slot(this, cellX(k), cellY(k), {
          size: cell,
          tooltip: () => (item ? this.itemTooltip(item, gear.stats, 'Клик — сведения справа') : { title: 'Ячейка рюкзака', note: 'Сюда — зелья и запасное оружие на серию арены. Клик — выбрать из инвентаря.' }),
          onClick: () => {
            if (item) return this.toggleSel({ kind: 'bag', cell: k });
            if (inRun(store.state, c.uid)) return openRucksack(this, c.uid);
            this.openBagPicker(c, k);
          },
        });
        if (item) slot.setContent(createItemIcon(this, item, cell - 10), e!.count).setItemGems(item);
        slot.setSelected(sameSel(this.sel, { kind: 'bag', cell: k }));
        this.body.add(slot);
        bagCells.push(slot);
        if (item) this.quickRemove(cellX(k) + cell / 2 - 6, cellY(k) - cell / 2 + 6, c.uid, () => store.act('takeFromBag', c.uid, k), 'Вынуть в инвентарь', 7);
      });
      this.enableGearDrag(c, dragSlots, dragRefs, dragItems, bagCells, cells.map((e) => (e ? resolveItem(e) : null)));
    } else {
      this.enableGearDrag(c, dragSlots, dragRefs, dragItems, [], []);
      this.body.add(text(this, x0, yb, 'Наденешь рюкзак — появятся его ячейки\nдля зелий.', { size: 12, color: COLOR.inkQuiet }));
    }
    this.renderPresets(c, x0, cells.length ? yb + 34 + bagRows * 44 : yb + 46);
    this.hint = text(this, x0, this.right.innerH - 26, 'Клик по предмету — сведения справа,\nпо пустому месту — сведения о бойце.', { size: 12, color: COLOR.inkQuiet, wrap: 262 });
    this.body.add(this.hint);
  }

  /**
   * Перетаскивание снаряжения: из руки в руку, между слотами артефактов, из рюкзака в слот и обратно, внутри рюкзака.
   * В занятом месте предметы меняются местами, если подходят. В серии арены слоты не меняются — только порядок в рюкзаке.
   */
  private enableGearDrag(c: CharacterState, equipSlots: Slot[], equipRefs: number[], equipItems: Array<Item | null>, bagCells: Slot[], bagItems: Array<Item | null>) {
    const n = equipSlots.length;
    const run = inRun(store.state, c.uid);
    enableSlotDrag(this, [...equipSlots, ...bagCells], [...(run ? equipItems.map(() => null) : equipItems), ...bagItems], 40, (from, to) => {
      const move = (dry: boolean): boolean => {
        const st = store.state;
        if (from >= n && to >= n) return dry ? !!moveInBag(st, c.uid, from - n, to - n) : store.act('moveInBag', c.uid, from - n, to - n);
        if (run) return false;
        if (from < n && to < n) return dry ? !!moveEquipped(st, c.uid, equipRefs[from], equipRefs[to]) : store.act('moveEquipped', c.uid, equipRefs[from], equipRefs[to]);
        if (from >= n) return dry ? !!equipFromBag(st, c.uid, from - n, equipRefs[to]) : store.act('equipFromBag', c.uid, from - n, equipRefs[to]);
        return dry ? !!stowToBagCell(st, c.uid, equipRefs[from], to - n) : store.act('stowToBagCell', c.uid, equipRefs[from], to - n);
      };
      if (!move(true)) return;
      // выделение едет вместе с предметом из руки в руку; в остальных случаях — снимается
      const fromSel = from < n ? ({ kind: 'slot', ref: equipRefs[from] } as const) : ({ kind: 'bag', cell: from - n } as const);
      const toSel = to < n ? ({ kind: 'slot', ref: equipRefs[to] } as const) : ({ kind: 'bag', cell: to - n } as const);
      if (sameSel(this.sel, fromSel)) this.sel = toSel;
      else if (sameSel(this.sel, toSel)) this.sel = fromSel;
      move(false);
    });
  }

  /** Ячейка пресета, совпадающая с надетым (иначе первая). */
  private matchingPreset(c: CharacterState): number {
    const k = presetsOf(c).findIndex((_, i) => matchesPreset(c, i));
    return k >= 0 ? k : 0;
  }

  /**
   * Пресеты — PRESET_SLOTS ячеек. Клик — выбрать (содержимое справа); крестик — очистить.
   * Кнопка под ними: в заполненной ячейке — «Применить пресет», в пустой — «Сохранить».
   */
  private renderPresets(c: CharacterState, x0: number, y: number) {
    const list = presetsOf(c);
    const locked = inRun(store.state, c.uid);
    this.presetSel = Phaser.Math.Clamp(this.presetSel, 0, PRESET_SLOTS - 1);
    this.body.add(text(this, x0, y, 'ПРЕСЕТЫ', { size: 12, color: COLOR.inkQuiet, letterSpacing: 1 }));
    const cell = 44;
    const gap = (272 - PRESET_SLOTS * cell) / (PRESET_SLOTS - 1);
    list.forEach((p, k) => {
      const cx = x0 + cell / 2 + k * (cell + gap);
      const cy = y + 22 + cell / 2;
      const same = matchesPreset(c, k);
      const slot = new Slot(this, cx, cy, {
        size: cell,
        tooltip: () => ({ title: `Пресет ${k + 1}`, note: p ? `${same ? 'Надето как в пресете. ' : ''}Клик — что в нём (справа).` : 'Пусто. Выбери и нажми «Сохранить» — запомнится текущее снаряжение.' }),
        onClick: () => {
          this.presetSel = k;
          this.sel = { kind: 'preset', slot: k };
          this.render(store.state);
        },
      });
      const main = p ? [...p.equipment, p.rucksack].find((id): id is string => !!id && hasItem(id)) : undefined;
      if (main) slot.setContent(createItemIcon(this, getItem(main), cell - 14));
      slot.setSelected(this.presetSel === k);
      if (same) slot.setAccent(0x3f7a2a);
      this.body.add(slot);
      this.body.add(text(this, cx - cell / 2 + 4, cy - cell / 2 + 2, String(k + 1), { kind: 'mono', size: 10, weight: 700, color: COLOR.inkQuiet }));
      if (p) this.crossButton(cx + cell / 2 - 6, cy - cell / 2 + 6, 7, `Очистить пресет ${k + 1}`, () => store.act('clearPreset', c.uid, k));
    });
    const k = this.presetSel;
    const p = list[k];
    const same = matchesPreset(c, k);
    const by = y + 22 + cell + 26;
    if (p) {
      // обновить — записать в ячейку то, что надето сейчас (серая, если и так совпадает)
      const upd = new Button(this, x0 + 272 - 52, by, 'Обновить', {
        variant: 'beige', width: 104, height: 36, size: 15,
        onClick: () => store.act('savePreset', c.uid, k),
      }).setEnabled(!same);
      attachTooltip(upd.hit, () => ({ title: `Обновить пресет ${k + 1}`, note: same ? 'Пресет уже совпадает с надетым.' : 'Запомнить в этой ячейке то, что надето сейчас, и содержимое рюкзака.' }));
      this.body.add(upd);
    }
    const btn = p
      ? new Button(this, x0 + 80, by, `Применить ${k + 1}`, {
          variant: 'beige', width: 160, height: 36, size: 15,
          onClick: () => this.confirmPreset(c.uid, k),
        }).setEnabled(!same && !locked)
      : new Button(this, x0 + 136, by, `Сохранить в пресет ${k + 1}`, {
          variant: 'beige', width: 272, height: 36, size: 15,
          onClick: () => store.act('savePreset', c.uid, k),
        });
    // уже применён (надето как в пресете) или боец в серии — кнопка серая, причина в подсказке
    if (p && (locked || same)) attachTooltip(btn.hit, () => ({ title: 'Пресет', note: locked ? 'В серии арены снаряжение меняется только из рюкзака.' : 'Уже надето как в этом пресете.' }));
    this.body.add(btn);
  }

  /**
   * Перед применением пресета — окно: что останется надетым, что возьмётся из инвентаря, что соберётся (и за сколько
   * кубов), что уйдёт в инвентарь и чего не хватит. Отчёт считается тем же applyPreset на текущем состоянии, без записи.
   */
  private confirmPreset(charUid: string, slot: number) {
    const c = store.state.characters.find((x) => x.uid === charUid);
    const preview = c ? applyPreset(store.state, charUid, slot) : null;
    if (!c || !preview) return this.cameras.main.shake(120, 0.003);
    const r: PresetReport = preview.report;
    const name = (id: string) => (hasItem(id) ? getItem(id).name : id);
    const list = (xs: Array<{ itemId: string; count: number }>) => xs.map((x) => `${name(x.itemId)}${x.count > 1 ? ` ×${x.count}` : ''}`).join(', ');
    // что сейчас на бойце (руки, артефакты, рюкзак и его ячейки)
    const onChar = new Map<string, number>();
    const put = (id: string | undefined, n = 1) => id && onChar.set(id, (onChar.get(id) ?? 0) + n);
    for (const e of [...c.equipment, c.rucksack]) put(e?.itemId);
    for (const e of c.bag) put(e?.itemId, e?.count ?? 0);
    // «взято» в отчёте включает и то, что было надето: оно просто останется
    const keep: Array<{ itemId: string; count: number }> = [];
    const fromInv: Array<{ itemId: string; count: number }> = [];
    for (const t of r.taken) {
      const k = Math.min(t.count, onChar.get(t.itemId) ?? 0);
      if (k) keep.push({ itemId: t.itemId, count: k });
      if (t.count - k) fromInv.push({ itemId: t.itemId, count: t.count - k });
      onChar.set(t.itemId, (onChar.get(t.itemId) ?? 0) - k);
    }
    const toInv = [...onChar].filter(([, n]) => n > 0).map(([itemId, count]) => ({ itemId, count }));
    const cubes = r.built.reduce((n, b) => n + b.cubes, 0);
    const lines: Array<[string, string, string?]> = [];
    if (keep.length) lines.push(['Останется', list(keep)]);
    if (fromInv.length) lines.push(['Из инвентаря', list(fromInv)]);
    if (r.built.length) lines.push([`Соберётся`, `${list(r.built)} — ${cubes} куб.`]);
    if (toInv.length) lines.push(['В инвентарь', list(toInv)]);
    for (const m of r.missing) lines.push(['Без', `${name(m.itemId)}${m.count > 1 ? ` ×${m.count}` : ''} — ${PRESET_MISS_LABEL[m.reason]}`, COLOR.lose]);
    if (!lines.length) lines.push(['', 'Пресет пустой — всё снимется в инвентарь.']);

    const W = 600;
    // высота окна — по тексту: меряем строки заранее
    const probeW = W - 48 - 130;
    const contentH = lines.reduce((h, [, v]) => {
      const t = text(this, 0, 0, v, { size: 14, wrap: probeW });
      const hh = Math.max(26, t.height + 10);
      t.destroy();
      return h + hh;
    }, 0) + (cubes ? 26 : 0) + 64;
    const m = new Modal(this, { title: `Применить пресет ${slot + 1}?`, width: W, height: contentH + 120 });
    const w = m.card.innerW;
    let y = 0;
    for (const [k, v, color] of lines) {
      m.card.content.add(text(this, 0, y, k, { size: 14, weight: 700 }));
      const t = text(this, 130, y, v, { size: 14, wrap: w - 130, color: color ?? COLOR.ink });
      m.card.content.add(t);
      y += Math.max(26, t.height + 10);
    }
    if (cubes) {
      const have = cubeCount(store.state);
      m.card.content.add(text(this, 0, y + 4, `Кубов: ${have} → ${have - cubes}`, { size: 13, color: COLOR.inkQuiet }));
      y += 26;
    }
    const by = y + 34;
    m.card.content.add(new Button(this, w / 2 - 105, by, 'Отмена', { variant: 'beige', width: 190, height: 46, size: 19, onClick: () => m.close() }));
    m.card.content.add(
      new Button(this, w / 2 + 105, by, 'Применить', {
        width: 190, height: 46, size: 19,
        onClick: () => {
          m.close();
          store.act('applyPreset', charUid, slot);
        },
      }),
    );
  }

  /** Крестик в углу занятой ячейки: снять предмет одним кликом (в серии арены — нет, снаряжение меняется из рюкзака). */
  private quickRemove(x: number, y: number, charUid: string, fn: () => void, hint: string, r = 9) {
    if (inRun(store.state, charUid)) return;
    this.crossButton(x, y, r, hint, fn);
  }

  private crossButton(x: number, y: number, r: number, hint: string, fn: () => void) {
    const b = this.add.container(x, y);
    const bg = this.add.circle(0, 0, r, 0x8a2a1e, 1).setStrokeStyle(2, 0x2b1a0a, 0.9);
    const t = text(this, 0, -1, '×', { kind: 'mono', size: r + 6, weight: 700, color: '#ffffff' }).setOrigin(0.5);
    b.add([bg, t]);
    bg.setInteractive({ useHandCursor: true })
      .on('pointerover', () => bg.setFillStyle(0xc0281e))
      .on('pointerout', () => bg.setFillStyle(0x8a2a1e))
      .on('pointerup', () => !isDragRelease(this) && fn());
    attachTooltip(bg, () => ({ title: hint }));
    this.body.add(b);
  }

  /** Окно выбора для ячейки снаряжения: подходящие предметы из инвентаря + «Снять». */
  private openSlotPicker(c: CharacterState, gear: Gear, ref: SlotRef) {
    const { bp } = gear;
    const current = gear.itemAt(ref);
    const kindName = ref === 'rucksack' ? 'рюкзак' : bp.slots[ref].type === 'Hand' ? 'оружие' : 'артефакт';
    this.openPicker({
      title: ref === 'rucksack' ? 'Рюкзак' : `${slotLabel(bp, ref)} — ${kindName}`,
      current,
      accepts: (item) => slotAccepts(bp, ref, item),
      blocked: (item) => (requirementGap(item, gear.stats) > 0 ? this.gapText(item, gear.stats) : null),
      tooltip: (item) => this.itemTooltip(item, gear.stats, 'Клик — надеть'),
      onPick: (invUid) => store.act('equip', c.uid, ref, invUid),
      onClear: current ? () => store.act('unequip', c.uid, ref) : undefined,
      clearLabel: ref === 'rucksack' && c.bag.some(Boolean) ? 'Снять (содержимое — в инвентарь)' : 'Снять',
      emptyText: `В инвентаре нет: ${kindName}. Собери в «Чертежах».`,
      blueprintTab: ref === 'rucksack' ? 'bag' : bp.slots[ref].type === 'Hand' ? 'weapon' : 'artifact',
      target: { charUid: c.uid, slot: ref },
    });
  }

  private openBagPicker(c: CharacterState, cell: number) {
    const cur = bagSlots(c)[cell];
    const stats = characterStats(getBlueprint(c.blueprintId) as CharacterBlueprint, c.blockStats, c.brokenBlocks);
    this.openPicker({
      title: `Рюкзак · ячейка ${cell + 1}`,
      current: cur ? resolveItem(cur) : null,
      currentCount: cur?.count,
      accepts: bagAccepts,
      blocked: () => null,
      tooltip: (item) => this.itemTooltip(item, stats, 'Клик — положить (стопкой)'),
      onPick: (invUid) => store.act('putInBag', c.uid, cell, invUid),
      onClear: cur ? () => store.act('takeFromBag', c.uid, cell) : undefined,
      clearLabel: 'Вынуть в инвентарь',
      emptyText: 'В инвентаре нет зелий и снаряжения. Флаконы и оружие собираются в «Чертежах».',
      blueprintTab: 'potion',
      target: { charUid: c.uid, bagCell: cell },
    });
  }

  private openPicker(o: {
    title: string;
    current: Item | null;
    currentCount?: number;
    accepts: (item: Item) => boolean;
    blocked: (item: Item) => string | null;
    tooltip: (item: Item) => TooltipContent;
    onPick: (invUid: string) => void;
    onClear?: () => void;
    clearLabel: string;
    emptyText: string;
    /** Вкладка чертежей, куда ведёт «К чертежам», когда подходящих предметов нет. */
    blueprintTab: BlueprintKind;
    /** Ячейка, для которой крафтим: в итоге сборки будет «Надеть». */
    target: CraftTarget;
  }) {
    const W = 640;
    const H = 500;
    const m = new Modal(this, { title: o.title, width: W, height: H });
    const c = m.card.content;
    const w = m.card.innerW;
    let y = 0;
    if (o.current) {
      const cur = new Slot(this, 36, 36, { size: 72 });
      cur.setContent(createItemIcon(this, o.current, 52), o.currentCount).setItemGems(o.current);
      c.add(cur);
      c.add(text(this, 88, 14, 'СЕЙЧАС', { size: 11, color: COLOR.inkQuiet, letterSpacing: 1 }));
      c.add(text(this, 88, 30, o.current.name, { kind: 'display', size: 20 }));
      if (o.onClear) {
        const clear = o.onClear;
        c.add(new Button(this, w - 120, 36, o.clearLabel, { variant: 'beige', width: 240, height: 40, size: o.clearLabel.length > 14 ? 13 : 17, onClick: () => { m.close(); clear(); } }));
      }
      y = 86;
      c.add(dottedLine(this, 0, y, w));
      y += 12;
    }
    const entries = store.state.inventory
      .filter((e) => hasItem(e.itemId) && o.accepts(getItem(e.itemId)))
      .sort((a, b) => getItem(a.itemId).name.localeCompare(getItem(b.itemId).name, 'ru'));
    c.add(text(this, 0, y, `В ИНВЕНТАРЕ · ${entries.length}`, { size: 12, color: COLOR.inkQuiet, letterSpacing: 1 }));
    y += 22;
    // крафт подходящего — всегда внизу справа: сразу на нужной вкладке чертежей
    c.add(new Button(this, w - 100, m.card.innerH - 14, 'К чертежам', { variant: 'beige', width: 200, height: 40, size: 17, onClick: () => { m.close(); this.toBlueprints(o.blueprintTab, o.target); } }));
    if (!entries.length) {
      c.add(text(this, w / 2, y + 60, o.emptyText, { size: 15, color: COLOR.inkQuiet, align: 'center', wrap: w - 40 }).setOrigin(0.5));
      return;
    }
    const cols = 7;
    const cell = 72;
    const gap = (w - cols * cell) / (cols - 1);
    const rows = Math.max(1, Math.floor((m.card.innerH - y - 40) / (cell + 10)));
    const per = cols * rows;
    const grid = this.add.container(0, y);
    c.add(grid);
    const pages = Math.ceil(entries.length / per);
    const pager = new Pager(this, w / 2, m.card.innerH - 14, (p) => draw(p));
    c.add(pager);
    const draw = (page: number) => {
      grid.removeAll(true);
      pager.set(page, pages);
      entries.slice(page * per, (page + 1) * per).forEach((e, k) => {
        const item = resolveItem(e);
        const why = o.blocked(item);
        const slot = new Slot(this, cell / 2 + (k % cols) * (cell + gap), cell / 2 + Math.floor(k / cols) * (cell + 10), {
          size: cell,
          tooltip: () => o.tooltip(item),
          onClick: () => {
            if (why) return;
            m.close();
            o.onPick(e.uid);
          },
        });
        slot.setContent(createItemIcon(this, item, cell - 20), e.count).setItemGems(item);
        if (why) slot.setAlpha(0.4);
        grid.add(slot);
      });
    };
    draw(0);
  }

  /** Починка разбитого куба: зелья его статы из рюкзака и инвентаря. Клик по зелью — выпить и закрыть. */
  private openRepairPicker(charUid: string, block: number) {
    const c = store.state.characters.find((x) => x.uid === charUid);
    if (!c) return;
    const stat = c.blockStats[block];
    const sources = potionSources(store.state, c, stat);
    const cols = 5;
    const rows = Math.min(2, Math.ceil(sources.length / cols));
    // компактное окно: высота по числу рядов зелий
    const m = new Modal(this, { title: `Разбитый куб · ${STAT_LABEL[stat]}`, width: 500, height: 200 + Math.max(1, rows) * 92 });
    const body = m.card.content;
    const w = m.card.innerW;
    const broken = c.brokenBlocks.filter((i) => c.blockStats[i] === stat).length;
    body.add(this.add.rectangle(10, 12, 18, 18, STAT_COLOR[stat]).setStrokeStyle(1, 0x000000, 0.4));
    body.add(text(this, 28, 2, `Разбито кубов ${STAT_LABEL_GEN[stat]}: ${broken}. Клик по зелью — выпить${inRun(store.state, charUid) ? ' (в серии — только из рюкзака)' : ''}.`, { size: 13, color: COLOR.inkQuiet, wrap: w - 30 }));
    // к чертежам зелий — флаконы откроются уже с этой статой
    body.add(
      new Button(this, w - 100, m.card.innerH - 14, 'К чертежам', {
        variant: 'beige', width: 200, height: 40, size: 17,
        onClick: () => {
          m.close();
          this.registry.set('craft.variant.bp-potion-vial', stat);
          this.registry.set('craft.variant.bp-potion-flask', stat);
          this.toBlueprints('potion');
        },
      }),
    );
    if (!sources.length) {
      body.add(text(this, w / 2, 86, `Зелий ${STAT_LABEL_GEN[stat]} нет ни в рюкзаке, ни в инвентаре.`, { size: 15, color: COLOR.inkQuiet, align: 'center', wrap: w - 40 }).setOrigin(0.5));
      return;
    }
    const cell = 72;
    const gap = 12;
    sources.slice(0, cols * 2).forEach((src, k) => {
      const item = getItem(src.itemId) as Extract<Item, { kind: 'potion' }>;
      const slot = new Slot(this, cell / 2 + (k % cols) * (cell + gap), 50 + cell / 2 + Math.floor(k / cols) * (cell + 20), {
        size: cell,
        tooltip: () => ({ title: item.name, rows: [['Чинит', `до ${Math.min(item.restoreAmount, broken)} куб.`], ['Где', src.src.kind === 'bag' ? 'в рюкзаке' : 'в инвентаре']], note: 'Клик — выпить' }),
        onClick: () => {
          m.close();
          store.act('drinkPotion', charUid, src.src, block);
        },
      });
      slot.setContent(createItemIcon(this, item, cell - 26), src.count).setItemGems(item);
      body.add(slot);
    });
  }

  /** Открыть «Чертежи» на нужной вкладке. */
  private toBlueprints(tab: BlueprintKind, target: CraftTarget | null = null) {
    this.setCraftTarget(target);
    this.registry.set('blueprints.tab', tab);
    this.registry.set('blueprints.page', 0);
    this.go(SCENE.blueprints);
  }

  // ───────────── правая колонка ─────────────

  /** Правая колонка: сведения о бойце, о выбранном предмете (с действиями) или о пресете. */
  private renderInfo(c: CharacterState, gear: Gear) {
    const x0 = 548;
    const w = this.right.innerW - x0 - 14; // справа — зазор и полоса прокрутки
    const h = this.right.innerH - 26;
    const sel = this.sel;
    const item = this.selItem(c, gear);
    if (sel && sel.kind !== 'preset' && item) return this.renderItemInfo(c, gear, sel, item, x0, w, h);
    const area = new ScrollArea(this, x0, 26, w, h);
    this.body.add(area);
    if (sel?.kind === 'preset') this.fillPresetInfo(area, c, sel.slot);
    else this.fillCharacterInfo(area, gear);
  }

  /** Сведения о бойце: статы, бой, удары и артефакты. */
  private fillCharacterInfo(area: ScrollArea, gear: Gear) {
    const w = area.w;
    const st = gear.stats;
    const c = area.content;
    let y = 0;
    const head = (label: string) => {
      c.add(text(this, 0, y, label, { size: 12, color: COLOR.inkQuiet, letterSpacing: 1 }));
      y += 20;
    };
    const row = (label: string, value: string, color?: string, swatch?: number, hint?: { title: string; note: string }) => {
      const r = this.add.container(0, y);
      let lx = 0;
      if (swatch !== undefined) {
        r.add(this.add.rectangle(0, 8, 10, 10, swatch).setOrigin(0, 0.5).setStrokeStyle(1, 0x000000, 0.35));
        lx += 16;
      }
      r.add(text(this, lx, 0, label, { size: 13, color: COLOR.ink }));
      const valueText = text(this, w, 0, value, { kind: 'mono', size: 13, color: color ?? COLOR.ink }).setOrigin(1, 0);
      r.add(valueText);
      // пояснение к значению — значок «?» с подсказкой, а не длинный текст в строке
      if (hint) r.add(hintIcon(this, w - valueText.width - 12, 8, () => hint));
      c.add(r);
      y += 20;
    };
    const line = () => {
      y += 4;
      c.add(dottedLine(this, 0, y, w));
      y += 8;
    };
    head('СТАТЫ · КУБЫ · ОЧКИ');
    for (const s of STATS) {
      const lost = st.base[s] - st.current[s];
      row(STAT_LABEL[s], `${st.cubes[s]} · ${fmt1(st.current[s])}${lost > 0.01 ? ` (−${fmt1(lost)})` : ''}`, st.cubes[s] ? COLOR.ink : COLOR.inkQuiet, STAT_COLOR[s]);
    }
    line();
    head('В БОЮ');
    const noCrit = !st.cubes.Strength ? 'Нет живых кубов Силы.' : st.disabled.includes('Luck') ? 'Нет кубов Удачи.' : '';
    row('Крит', noCrit ? '0%' : pct(st.crit), noCrit ? COLOR.lose : undefined, undefined, noCrit ? { title: 'Крита нет', note: `${noCrit} Крит работает, пока у бойца есть хотя бы один живой куб Силы и кубы Удачи.` } : undefined);
    row('Уворот', st.cubes.Dexterity ? pct(st.dodge) : '0%', st.cubes.Dexterity ? undefined : COLOR.lose, undefined,
      st.cubes.Dexterity ? undefined : { title: 'Уворота нет', note: 'Нет живых кубов Ловкости. Уворот работает, пока у бойца есть хотя бы один живой куб Ловкости.' });
    const regen = staminaRegenFor(st.maxStamina);
    row('Выносливость', `${fmt1(st.maxStamina)} (${regen >= st.maxStamina ? 'вся за ход' : `+${fmt1(regen)}/ход`})`, st.maxStamina > 0 ? undefined : COLOR.lose);
    row('Мана', `${fmt1(st.maxMana)} (+2/ход)`);
    row('Броня режет', pct(st.armorAbsorb));
    line();
    head('УДАРЫ И АРТЕФАКТЫ');
    let any = false;
    gear.bp.slots.forEach((sl, i) => {
      const item = gear.itemAt(i);
      if (!item || (item.kind !== 'weapon' && item.kind !== 'artifact')) return;
      any = true;
      const a = item.ability;
      const hit = a.type !== 'ApplyEffect' && a.damage > 0;
      const dmg = hit ? slotDamage(item, st) : null;
      const details: string[] = [];
      if (dmg) details.push(`~${fmt1(dmg.perTurn)}/ход`);
      if (a.staminaCost) details.push(`${a.staminaCost} вын.`);
      if (a.manaCost && dmg) details.push(`${a.manaCost} маны`);
      const warn = a.manaCost > st.maxMana ? 'не хватит маны — нужен Интеллект' : a.staminaCost > st.maxStamina ? 'не хватит выносливости' : '';
      const made = weaponRow(this, 0, y, w, {
        label: sl.type === 'Hand' ? (sl.isLeftHand ? 'Л' : 'П') : 'А',
        name: item.name,
        level: item.itemLevel,
        cooldown: a.cooldown,
        ...(dmg ? { damage: dmg.damage, hits: dmg.hits } : { cost: `${a.manaCost} маны` }),
        ...(details.length ? { details: details.join(' · ') } : {}),
        ...(warn ? { warn } : {}),
      });
      c.add(made.row);
      y += made.height + 4;
    });
    if (!any) {
      c.add(text(this, 0, y, 'Руки пусты — бьёт кулаком (20).', { size: 13, color: COLOR.inkQuiet }));
      c.add(text(this, 0, y + 18, 'Оружие — клик по ячейке руки.', { size: 13, color: COLOR.inkQuiet }));
      y += 36;
    }
    // пояснение про обе руки — в самом низу, под строками оружия
    if (gear.bp.slots.filter((sl, i) => sl.type === 'Hand' && gear.itemAt(i)).length > 1) {
      y += area.addLines(0, y + 2, 'За ход бьют обе руки, если готовы и хватает выносливости.', { size: 12, color: COLOR.inkQuiet, wrap: w });
      y += 8;
    }
    area.layout(y);
  }

  /** Предмет из ячейки: карточка как в инвентаре и действия под ней. */
  private renderItemInfo(c: CharacterState, gear: Gear, sel: Sel, item: Item, x0: number, w: number, h: number) {
    const run = inRun(store.state, c.uid);
    const equipSlot = sel.kind === 'slot' && sel.ref !== 'rucksack' ? sel.ref : null;
    // оружие в руке или в ячейке рюкзака: прокачка, ячейки и камни — там, где оно лежит
    const target: UpgradeTarget | null = item.kind !== 'weapon' ? null
      : equipSlot !== null ? { kind: 'equip', charUid: c.uid, slot: equipSlot }
        : sel.kind === 'bag' ? { kind: 'bag', charUid: c.uid, cell: sel.cell } : null;
    const up = target ? upgradeInfo(store.state, target) : null;
    const cell = target ? cellInfo(store.state, target) : null;
    const extraRows: Array<{ label: string; value: string; color?: string }> = [];
    if (item.kind === 'weapon' && item.ability.damage > 0) extraRows.push({ label: 'У этого бойца', value: fmt1(slotDamage(item, gear.stats).damage), color: COLOR.lose });
    const gap = requirementGap(item, gear.stats) > 0 ? this.gapText(item, gear.stats) : '';
    const count = sel.kind === 'bag' ? bagSlots(c)[sel.cell]?.count : undefined;
    const gemsInfo = target ? gemInfo(store.state, target) : null;
    // ячейки камней — прямо в карточке; клик по ячейке открывает выбор камня
    const gems = target && gemsInfo ? { info: gemsInfo, onCell: (k: number) => void openGemPicker(this, target, k) } : null;
    const upRow = !!up && up.reason !== 'max';
    const rowsBelow = upRow ? 2 : 1;
    const reserve = rowsBelow * 46 + 6;
    const area = new ScrollArea(this, x0, 26, w, h - reserve);
    this.body.add(area);
    fillItemInfo(this, area, item, { count, up, cell, gems, extraRows, note: gap ? { text: gap, color: COLOR.lose } : undefined });
    const bw = (w - 8) / 2;
    const yb = 26 + h - 20;
    if (run) {
      // в серии арены снаряжение и рюкзак меняются только через окно рюкзака
      this.body.add(new Button(this, x0 + w / 2, yb, 'Рюкзак · сменить', { variant: 'beige', width: w, height: 40, size: 16, onClick: () => openRucksack(this, c.uid) }));
      return;
    }
    const yUp = yb - 46;
    if (upRow && target && up) {
      this.body.add(
        new Button(this, x0 + bw / 2, yUp, `Прокачать · ${up.cost}`, {
          width: bw, height: 40, size: 15,
          onClick: () => store.act('upgradeWeapon', target),
        }).setEnabled(up.ok),
      );
      this.body.add(
        new Button(this, x0 + w - bw / 2, yUp, cell && cell.reason !== 'max' ? `Ячейка · ${cell.cells}/${cell.max}` : 'Ячеек максимум', {
          variant: 'beige', width: bw, height: 40, size: 15,
          onClick: () => store.act('addGemCell', target),
        }).setEnabled(!!cell?.ok),
      );
    }
    const replace = () => (sel.kind === 'slot' ? this.openSlotPicker(c, gear, sel.ref) : sel.kind === 'bag' ? this.openBagPicker(c, sel.cell) : undefined);
    const remove = () => {
      this.sel = null;
      if (sel.kind === 'slot') store.act('unequip', c.uid, sel.ref);
      else if (sel.kind === 'bag') store.act('takeFromBag', c.uid, sel.cell);
    };
    this.body.add(new Button(this, x0 + bw / 2, yb, 'Заменить', { variant: 'beige', width: bw, height: 40, size: 16, onClick: replace }));
    this.body.add(new Button(this, x0 + w - bw / 2, yb, sel.kind === 'bag' ? 'Вынуть' : 'Снять', { variant: 'beige', width: bw, height: 40, size: 16, onClick: remove }));
  }

  /** Что лежит в пресете: руки, артефакты, рюкзак и его ячейки. */
  private fillPresetInfo(area: ScrollArea, c: CharacterState, slot: number) {
    const p = presetsOf(c)[slot];
    const bp = getBlueprint(c.blueprintId) as CharacterBlueprint;
    const w = area.w;
    const ct = area.content;
    let y = 0;
    ct.add(text(this, 0, y, `ПРЕСЕТ ${slot + 1}`, { kind: 'display', size: 20 }));
    y += 30;
    if (!p) {
      y += area.addLines(0, y, 'Пусто. Нажми «Сохранить в пресет» — запомнится всё, что надето сейчас, и содержимое рюкзака.', { size: 13, color: COLOR.inkQuiet, wrap: w });
      area.layout(y);
      return;
    }
    const line = (label: string, id: string | null, count?: number) => {
      const r = this.add.container(0, y);
      r.add(text(this, 0, 9, label.toUpperCase(), { size: 11, color: COLOR.inkQuiet }).setOrigin(0, 0.5));
      if (id && hasItem(id)) {
        const it = getItem(id);
        const icon = createItemIcon(this, it, 24) as Phaser.GameObjects.Components.Transform & Phaser.GameObjects.GameObject;
        icon.setPosition(96, 9);
        r.add(icon);
        r.add(text(this, 114, 9, `${it.name}${count && count > 1 ? ` ×${count}` : ''}`, { size: 13, wrap: w - 114 }).setOrigin(0, 0.5));
      } else {
        r.add(text(this, 114, 9, '—', { size: 13, color: COLOR.inkQuiet }).setOrigin(0, 0.5));
      }
      ct.add(r);
      y += Math.max(28, r.getBounds().height + 6);
    };
    bp.slots.forEach((sl, i) => line(sl.type === 'Hand' ? (sl.isLeftHand ? 'Л. рука' : 'П. рука') : slotLabel(bp, i).replace('Артефакт', 'Арт.'), p.equipment[i] ?? null));
    line('Рюкзак', p.rucksack);
    const bag = p.bag.map((b, k) => [b, k] as const).filter(([b]) => b);
    if (bag.length) {
      y += 4;
      ct.add(dottedLine(this, 0, y, w));
      y += 8;
      ct.add(text(this, 0, y, 'В РЮКЗАКЕ', { size: 12, color: COLOR.inkQuiet, letterSpacing: 1 }));
      y += 20;
      for (const [b, k] of bag) line(`Ячейка ${k + 1}`, b!.itemId, b!.count);
    }
    area.layout(y);
  }

  // ───────────── подсказки ─────────────

  private itemTooltip(item: Item, stats: CharacterStats, action?: string): TooltipContent {
    const rows = itemRows(item).map((r) => [r.label, r.value, r.color] as [string, string, string?]);
    if (item.kind === 'weapon' && item.ability.damage > 0) {
      const d = slotDamage(item, stats);
      rows.unshift(['У этого бойца', fmt1(d.damage), '#c0281e']);
    }
    const gap = requirementGap(item, stats);
    return withUpgrade({ title: item.name, rows, note: gap > 0 ? this.gapText(item, stats) : action }, item);
  }

  private gapText(item: Item, stats: CharacterStats): string {
    if (item.kind !== 'weapon' && item.kind !== 'artifact') return '';
    return `Нужно ${item.minStatRequired} ${STAT_LABEL_GEN[item.scalingStat]}, у бойца ${fmt1(stats.base[item.scalingStat])}.`;
  }

  private slotHint(ref: SlotRef, bp: CharacterBlueprint): string {
    if (ref === 'rucksack') return 'Сюда — рюкзак: лут и зелья на арене.';
    return bp.slots[ref].type === 'Hand' ? 'Сюда — оружие.' : 'Сюда — артефакт (тратит ману).';
  }

  // ───────────── подтверждения ─────────────

  private confirmCharacterDisassembly(c: CharacterState, refund: number) {
    this.confirm('Разобрать персонажа?', `«${c.name}» разберётся на кубы.\nВернётся ${refund} куб. — половина живых.\nСнаряжение уйдёт в инвентарь.`, () => {
      store.act('disassembleCharacter', c.uid);
    });
  }

  private confirm(title: string, body: string, ok: () => void) {
    const m = new Modal(this, { title, width: 480, height: 280 });
    const w = m.card.innerW;
    m.card.content.add(text(this, w / 2, 24, body, { size: 16, align: 'center' }).setOrigin(0.5, 0));
    m.card.content.add(new Button(this, w / 2 - 105, 150, 'Отмена', { variant: 'beige', width: 190, height: 48, size: 20, onClick: () => m.close() }));
    m.card.content.add(
      new Button(this, w / 2 + 105, 150, 'Разобрать', {
        width: 190,
        height: 48,
        size: 20,
        onClick: () => {
          m.close();
          ok();
        },
      }),
    );
  }
}

