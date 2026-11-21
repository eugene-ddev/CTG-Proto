import { fighterInputOf, fightSetup } from '../core/fight';
import { ratingDeltas } from '../core/rating';
import { SERIES_LENGTH, lossRule, retriesLeft, seriesRetries } from '../core/arena';
import { CUBE_ID } from '../core/state';
import Phaser from 'phaser';
import { BaseScene } from './BaseScene';
import { SCENE, type BattleSceneData, type OpponentSceneData } from './keys';
import { ARENA, getBlueprint, getItem, hasItem } from '../data/catalog';
import type { CharacterBlueprint, EquipmentItem, Stat } from '../data/types';
import { STAT_SHORT, itemDescription, itemRows } from '../data/labels';
import { isDisabled } from '../core/battle';
import { Slot } from '../ui/Slot';
import { attachTooltip } from '../ui/Tooltip';
import { withUpgrade } from '../ui/upgradeTip';
import { createItemIcon } from '../ui/ItemIcon';
import { hintIcon } from '../ui/HintIcon';
import { weaponRow } from '../ui/WeaponRow';
import { THRESHOLDS, createFighter, critOf, digPreview, dodgeOf, hasAliveCube, normalizeTarget, perkOf, slotDamageValue, type Fighter } from '../core/battle';
import { armorAbsorb, bagSlots, itemOf, rucksackItemId } from '../core/character';
import { type Opponent } from '../core/opponent';
import { randomSeed } from '../core/rng';
import type { CharacterState } from '../core/state';
import { store } from '../game/store';
import { Button } from '../ui/Button';
import { Card, dottedLine } from '../ui/Panel';
import { text } from '../ui/text';
import { TEX } from '../ui/textures';
import { COLOR, GAME_W, STAT_COLOR } from '../ui/theme';
import { modelView, type ModelView } from '../ui/modelView';
import { Modal } from '../ui/Modal';
import { openRucksack } from '../ui/RucksackModal';
import { FACE_LEFT, FACE_RIGHT } from '../render/anim';
import { skinColorOf, skinPatternOf } from '../data/skins';

/** Плашки приоритета атаки. */
// шесть плашек приоритета — на всю ширину экрана (40…1240)
const CHIP_W = 190;
const CHIP_H = 52;
const CHIP_STEP = 202;
const CHIP_X0 = 40;
const CHIP_Y = 580;
const TITLE_Y = 54;
const FOOTER_Y = 656;
const ICON_BUTTON_W = 60;
const ICON_BUTTON_H = 54;

const pct = (v: number) => `${(v * 100).toFixed(1).replace('.0', '')}%`;

/** Вход для боя из персонажа игрока. */
export const playerFighterInput = fighterInputOf;

/**
 * «Новый противник»: кто против нас (бот той же категории) и в каком порядке бить его блоки.
 * Порядок сохраняется у персонажа.
 */
export class OpponentScene extends BaseScene {
  private charUid = '';
  private starting = false;
  private oppSeed = 0;
  private except?: string;
  private opp!: Opponent;
  private targetRows!: Phaser.GameObjects.Container;
  /** Модель противника — подсветка статы и предпросмотр раскопки. */
  private enemyView?: ModelView;
  private enemyF?: Fighter;
  /** Стата, кубы которой подсвечены (наведение/перетаскивание плашки). */
  private highlight: Stat | null = null;
  /** Весь путь раскопки — порядок, в котором будут разбиты кубы противника, и его полоса над моделью. */
  private preview: number[] = [];
  private pathGfx?: Phaser.GameObjects.Graphics;

  constructor() {
    super(SCENE.opponent);
  }

  init(data: OpponentSceneData) {
    // идёт серия — только её боец
    this.charUid = store.state.arenaRun?.charUid ?? data?.charUid ?? store.state.lastArenaCharacterId ?? '';
    this.oppSeed = data?.oppSeed ?? randomSeed();
    this.except = data?.except;
  }

  create() {
    const c = store.state.characters.find((x) => x.uid === this.charUid);
    // серия с игроками без выбранного соперника — к списку соперников
    if (c && store.state.arenaRun?.mode === 'players' && !store.state.arenaRun.opp) return void this.scene.start(SCENE.rivals);
    // противника выбирает сервер: пока ответа нет — экран ожидания, затем сцена открывается заново
    if (c && !store.state.arenaRun?.opp) {
      this.setupScreen({ title: 'Новый противник', titleY: TITLE_Y, kicker: 'Арена', back: null });
      const note = text(this, GAME_W / 2, 340, 'Подбор противника…', { size: 20, color: COLOR.light }).setOrigin(0.5);
      void store.request('startRun', this.charUid).then((ok) => {
        if (!this.scene.isActive()) return;
        if (ok && store.state.arenaRun?.opp) return this.scene.restart({ charUid: this.charUid } satisfies OpponentSceneData);
        note.setText('Не удалось начать серию — нет связи с сервером или серия идёт другим бойцом.');
        new Button(this, GAME_W / 2, 420, 'В меню', { width: 240, height: 52, onClick: () => this.go(SCENE.menu) });
      });
      return;
    }
    const run = store.state.arenaRun;
    const pvp = run?.opp?.player;
    const rating = pvp && ratingDeltas(pvp.myRating, pvp.rating);
    // экран подготовки к бою — без табов главного меню: выход — кнопкой слева внизу
    this.setupScreen({
      title: 'Новый противник',
      titleY: TITLE_Y,
      kicker: pvp ? `Бой с игроком · бой ${run?.fight ?? 1} из ${SERIES_LENGTH} · без дополнительных попыток` : `Арена · бой ${run?.fight ?? 1} из ${SERIES_LENGTH} · попыток ${retriesLeft(run)}/${seriesRetries()}`,
      subtitle: [
        pvp && rating && `рейтинг ${pvp.myRating} · победа +${rating.win} · поражение ${rating.lose}`,
        run?.wins && `побед: ${run.wins}`,
      ].filter(Boolean).join(' · '),
      back: c && run ? null : SCENE.menu,
    });
    if (!c || !run) {
      this.add.existing(this.stubNote(640, 360, 'Бойца нет', 'Выбери бойца вкладкой «Арена».'));
      return;
    }
    // выход с арены — кнопка со стрелкой; после побед спросит подтверждение (лут остаётся у бойца)
    const exit = new Button(this, 70, FOOTER_Y, '', { variant: 'beige', width: ICON_BUTTON_W, height: ICON_BUTTON_H, onClick: () => this.leaveRun() });
    exit.addAt(this.add.image(-1, -2, TEX.arrowBackBrown).setScale(1.1), exit.getIndex(exit.hit));
    attachTooltip(exit.hit, () => ({ title: run.wins ? 'Забрать лут и выйти' : 'Выйти с арены', note: run.wins ? 'Серия закончится без награды; лут в рюкзаке остаётся у бойца.' : 'Серия закончится, боец вернётся в лобби.' }));
    const bp = getBlueprint(c.blueprintId) as CharacterBlueprint;
    // противник — из состояния (бот по зерну сервера или снимок бойца другого игрока)
    this.opp = fightSetup(store.state)!.opp;
    this.oppSeed = this.opp.seed;
    const enemy = createFighter('enemy', this.opp);
    const me = createFighter('player', playerFighterInput(c));

    // свой боец слева, противник справа — лицом друг к другу
    this.fighterCard(40, 'Твой боец', me, bp.name, c.equipment.map((e) => (e && hasItem(e.itemId) ? (itemOf(e) as EquipmentItem).itemLevel : null)));
    const ec = this.fighterCard(650, pvp ? `Игрок ${pvp.name}` : 'Противник', enemy, this.opp.pattern, this.opp.weaponLevels);
    this.enemyView = ec.view;
    this.enemyF = enemy;
    this.highlight = null;
    this.preview = [];
    const disabled = THRESHOLDS.stats.filter((s) => isDisabled(enemy, s));
    if (disabled.length) ec.card.setAside(`${enemy.aliveBlocks} куб. · откл.: ${disabled.map((s) => STAT_SHORT[s]).join(', ')}`);
    // полоса пути — над моделью; модель можно вращать, поэтому перерисовка каждый кадр
    this.pathGfx = this.add.graphics().setDepth(5);
    const follow = () => this.drawPath();
    this.events.on(Phaser.Scenes.Events.UPDATE, follow);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.events.off(Phaser.Scenes.Events.UPDATE, follow));

    // приоритет атаки: горизонтальные плашки, порядок меняется перетаскиванием
    const priority = text(this, CHIP_X0, 530, 'ПРИОРИТЕТ АТАКИ', { kind: 'display', size: 23, color: COLOR.title }).setOrigin(0, 0.5);
    hintIcon(this, priority.x + priority.width + 18, priority.y, () => ({
      title: 'Приоритет атаки',
      note: 'Перетащи плашки, чтобы задать порядок. Боец атакует спереди в сторону кубов самой левой доступной статы. Наведи на плашку, чтобы подсветить её кубы. Белая линия покажет порядок разбития.',
    }), 0x8a6a48).setScale(1.4);
    this.targetRows = this.add.container(0, 0);
    this.renderTarget(c, enemy);

    // рюкзак — кнопка с иконкой сумки и заполненностью
    const bagBtn = new Button(this, 140, FOOTER_Y, '', {
      variant: 'beige',
      width: ICON_BUTTON_W,
      height: ICON_BUTTON_H,
      onClick: () => {
        const m = openRucksack(this, c.uid, { note: lossRule(run.mode) === 'drop' ? 'Между боями: выпить зелье, сменить оружие. При поражении оружие и содержимое рюкзака пропадают.' : 'Между боями: выпить зелье, сменить оружие.' });
        m.once(Phaser.GameObjects.Events.DESTROY, () => this.sys.isActive() && this.scene.restart({ charUid: c.uid, oppSeed: this.oppSeed, except: this.except } satisfies OpponentSceneData));
      },
    });
    const bagItemId = rucksackItemId(c);
    const bagIcon = createItemIcon(this, getItem(bagItemId), 38) as Phaser.GameObjects.Components.Transform & Phaser.GameObjects.GameObject;
    bagIcon.setPosition(0, -3);
    bagBtn.addAt(bagIcon, bagBtn.getIndex(bagBtn.hit));
    const bagCells = bagSlots(c);
    if (bagCells.length) bagBtn.addAt(text(this, 24, 20, `${bagCells.filter(Boolean).length}/${bagCells.length}`, { kind: 'mono', size: 10, weight: 700, color: COLOR.ink }).setOrigin(1, 1), bagBtn.getIndex(bagBtn.hit));
    attachTooltip(bagBtn.hit, () => ({ title: 'Рюкзак и зелья', note: 'Выпить зелье, сменить оружие, улучшить зелья и рюкзак.' }));
    const rewards = new Button(this, GAME_W - CHIP_X0 - ICON_BUTTON_W / 2, FOOTER_Y, '', {
      variant: 'beige', width: ICON_BUTTON_W, height: ICON_BUTTON_H, onClick: () => this.showSeriesRewards(),
    });
    const chest = this.add.graphics({ y: -2 });
    chest.fillStyle(0x4a2a12).fillRoundedRect(-15, -12, 30, 24, 4);
    chest.fillStyle(0xb57633).fillRoundedRect(-12, -9, 24, 18, 2);
    chest.lineStyle(2, 0x4a2a12).lineBetween(-13, -1, 13, -1);
    chest.fillStyle(0xf2b312).fillRoundedRect(-4, -4, 8, 8, 2);
    rewards.addAt(chest, rewards.getIndex(rewards.hit));
    attachTooltip(rewards.hit, () => ({ title: 'Награды за серию' }));
    new Button(this, GAME_W / 2, FOOTER_Y, 'В бой', {
      width: 280,
      height: 60,
      size: 32,
      onClick: () => {
        // зерно боя выдаёт сервер; сцена боя берёт противника и зерно из состояния
        if (this.starting) return;
        this.starting = true;
        void store.request('startFight').then((ok) => {
          this.starting = false;
          if (!this.scene.isActive()) return;
          if (ok) this.go(SCENE.battle, { charUid: c.uid } satisfies BattleSceneData);
          else this.cameras.main.shake(120, 0.003);
        });
      },
    });
  }

  private showSeriesRewards() {
    const { cubes, drops } = ARENA.reward;
    const available = drops.filter((d) => hasItem(d.itemId) && d.weight > 0);
    const totalWeight = available.reduce((sum, d) => sum + d.weight, 0);
    const modal = new Modal(this, { title: 'Награды за серию', width: 520, height: 145 + available.length * 36 });
    const { content, innerW: w } = modal.card;
    const heading = available.length
      ? `За ${SERIES_LENGTH} победы — ${cubes} кубов и один предмет из списка.`
      : `За ${SERIES_LENGTH} победы — ${cubes} кубов.`;
    const cubeIcon = new Slot(this, 16, 16, { size: 32 });
    cubeIcon.setContent(createItemIcon(this, getItem(CUBE_ID), 24));
    content.add([cubeIcon, text(this, 44, 7, heading, { size: 16 })]);
    available.forEach((drop, i) => {
      const it = getItem(drop.itemId);
      const [min, max] = drop.count;
      const y = 49 + 36 * i;
      const icon = new Slot(this, 16, y + 15, { size: 30 });
      icon.setContent(createItemIcon(this, it, 22));
      content.add([
        icon,
        text(this, 44, y + 5, it.name, { size: 16 }),
        text(this, w - 68, y + 5, min === max ? `×${min}` : `×${min}–${max}`, { size: 15 }).setOrigin(1, 0),
        text(this, w, y + 5, pct(drop.weight / totalWeight), { size: 15, color: COLOR.inkQuiet }).setOrigin(1, 0),
      ]);
    });
  }

  /** Выйти из серии: осколки — в кошелёк, лут остаётся в рюкзаке. */
  private leaveRun() {
    const run = store.state.arenaRun;
    if (!run?.wins) {
      store.act('endRun');
      return this.go(SCENE.menu);
    }
    const m = new Modal(this, { title: 'Завершить серию?', width: 520, height: 290 });
    const w = m.card.innerW;
    m.card.content.add(
      text(this, w / 2, 6, `Лут в рюкзаке остаётся у бойца. Награда за серию — только за все ${SERIES_LENGTH} победы.\nПри выходе все кубы и заряды зелий восстановятся.`, { size: 15, align: 'center', wrap: w }).setOrigin(0.5, 0),
    );
    m.card.content.add(new Button(this, w / 2 - 115, 130, 'Остаться', { variant: 'beige', width: 210, height: 48, size: 20, onClick: () => m.close() }));
    m.card.content.add(
      new Button(this, w / 2 + 115, 130, 'Забрать и выйти', {
        width: 210,
        height: 48,
        size: 18,
        onClick: () => {
          store.act('endRun');
          this.go(SCENE.menu);
        },
      }),
    );
  }

  /** Подсветить кубы статы на модели противника (остальные полупрозрачны — видно и внутренние); null — снять. */
  private setHighlight(stat: Stat | null) {
    if (stat === this.highlight) return;
    this.highlight = stat;
    this.refreshLook();
  }

  private refreshLook() {
    const f = this.enemyF;
    const v = this.enemyView;
    if (!f || !v) return;
    const stat = this.highlight;
    v.setLookOf((i) => (!f.blocks[i].alive || (stat && f.blocks[i].stat !== stat) ? 'broken' : 'solid'));
    v.setOutlineOf((i) => (stat && f.blocks[i].alive && f.blocks[i].stat === stat ? COLOR.highlight : undefined));
  }

  private updatePreview(order: readonly Stat[], enemy: Fighter) {
    this.preview = digPreview(order, enemy, enemy.blocks.length);
  }

  /** Белая линия проходит через кубы в порядке, заданном фокусом атаки. */
  private drawPath() {
    const g = this.pathGfx;
    const v = this.enemyView;
    if (!g || !v?.active) return;
    g.clear();
    if (!this.highlight || !this.preview.length) return;
    const points = this.preview.map((i) => v.blockWorldPos(i));
    for (let j = 1; j < points.length; j++) {
      const a = points[j - 1], b = points[j];
      g.lineStyle(4, 0x140a02, 0.4).lineBetween(a.x, a.y, b.x, b.y);
      g.lineStyle(1.5, 0xffffff, 0.95).lineBetween(a.x, a.y, b.x, b.y);
    }
    const first = points[0];
    g.fillStyle(0x140a02, 0.8).fillCircle(first.x, first.y, 5);
    g.fillStyle(0xffffff, 1).fillCircle(first.x, first.y, 3.5);
  }

  /** Карточка бойца: слева модель (без оружия), под ней ячейки снаряжения, справа оружие с уроном и боевые статы. Возвращает модель. */
  private fighterCard(x: number, title: string, f: Fighter, sub: string, levels: Array<number | null>): { view: ModelView; card: Card; x0: number; w: number } {
    const card = new Card(this, x, 132, 590, 372, { title, aside: `${f.aliveBlocks} куб.` });
    const c = card.content;
    const w = card.innerW;
    const bp = getBlueprint(f.blueprintId);
    const mw = 262;
    // под моделью — ячейки снаряжения: наведи, чтобы посмотреть предмет
    const SLOT = 44;
    const modelH = card.innerH - SLOT - 30;
    const view = modelView(this, mw / 2, modelH / 2 - 4, {
      blocks: bp.blocks, width: mw - 24, height: modelH - 10, maxBlockPx: 26, interactive: true, showFront: true,
      colorOf: (i) => skinColorOf(f.blueprintId, f.skinId, i) ?? STAT_COLOR[f.blocks[i].stat],
      pattern: skinPatternOf(f.blueprintId, f.skinId),
      lookOf: (i) => (f.blocks[i].alive ? 'solid' : 'broken'),
      yaw: f.side === 'enemy' ? FACE_LEFT : FACE_RIGHT,
      // без оружия на модели: на превью важны кубы и путь раскопки, оружие — в ячейках под моделью
    });
    c.add(view);
    const gap = Math.min(8, (mw - 12 - f.slots.length * SLOT) / Math.max(1, f.slots.length - 1));
    const rowW = f.slots.length * SLOT + (f.slots.length - 1) * gap;
    f.slots.forEach((sl, i) => {
      const item = sl.item;
      const label = sl.type === 'Hand' ? (sl.isLeftHand ? 'Л' : 'П') : 'А';
      const cell = new Slot(this, (mw - rowW) / 2 + SLOT / 2 + i * (SLOT + gap), card.innerH - SLOT / 2 - 4, {
        size: SLOT,
        label,
        tooltip: () =>
          item
            ? withUpgrade({ title: item.name, rows: itemRows(item).map((r) => [r.label, r.value, r.color] as [string, string, string?]), note: itemDescription(item) }, item)
            : { title: sl.type === 'Hand' ? 'Пустая рука' : 'Пустой слот артефакта', note: sl.type === 'Hand' ? 'Кулаком бьёт, только если оружия нет ни в одной руке.' : undefined },
      });
      if (item) cell.setContent(createItemIcon(this, item, SLOT - 14)).setItemGems(item);
      c.add(cell);
    });
    const x0 = mw + 16;
    const iw = w - x0;
    c.add(text(this, x0, 0, f.name, { kind: 'display', size: 22 }));
    const subText = text(this, x0, 28, sub, { size: 13, color: COLOR.inkQuiet, wrap: iw });
    c.add(subText);
    let y = Math.max(52, 28 + subText.height + 6);
    c.add(dottedLine(this, x0, y, w));
    y += 8;
    f.slots.forEach((s, i) => {
      if (s.type !== 'Hand' && !s.item) return;
      const dmg = slotDamageValue(f, s);
      const label = s.type === 'Hand' ? (s.isLeftHand ? 'Л' : 'П') : 'А';
      // пустая рука бьёт кулаком, только если оружия нет ни в одной руке (0.0.54) — иначе «пусто»
      const a = s.ability;
      const hit = !!a && a.type !== 'ApplyEffect';
      const made = weaponRow(this, x0, y, iw, {
        label,
        name: s.item ? s.item.name : a ? 'Кулак' : 'пусто',
        level: s.item ? levels[i] : null,
        empty: !a,
        ...(a ? { cooldown: a.cooldown } : {}),
        // число ударов — с учётом свойства уровня (кинжал ур. 2–3 бьёт трижды)
        ...(hit ? { damage: dmg, hits: perkOf(s.item).hits ?? a.hits } : a ? { cost: `${a.manaCost} маны` } : {}),
      });
      c.add(made.row);
      y += made.height;
    });
    y += 4;
    c.add(dottedLine(this, x0, y, w));
    y += 8;
    const critOff = !hasAliveCube(f, 'Strength') ? 'Нет живых кубов Силы.' : critOf(f) === 0 ? (f.cubeTotals.Luck === 0 ? 'Нет кубов Удачи.' : 'Удача отключена: разбито больше половины её кубов.') : '';
    const dodgeOff = !hasAliveCube(f, 'Dexterity') ? 'Нет живых кубов Ловкости.' : dodgeOf(f) === 0 ? 'Ловкость отключена: разбито больше половины её кубов.' : '';
    const rows: Array<[string, string, string?, { title: string; note: string }?]> = [
      ...(f.side === 'player' && f.aliveBlocks < f.blocks.length
        ? ([['Разбито', `${f.blocks.length - f.aliveBlocks}`, COLOR.lose, { title: 'Разбитые кубы', note: 'Между боями кубы можно восстановить встроенными зельями.' }]] as Array<[string, string, string?, { title: string; note: string }?]>)
        : []),
      critOff ? ['Крит', '0%', COLOR.lose, { title: 'Крита нет', note: `${critOff} Крит работает, пока есть хотя бы один живой куб Силы и не отключена Удача.` }] : ['Крит', pct(critOf(f))],
      dodgeOff ? ['Уворот', '0%', COLOR.lose, { title: 'Уворота нет', note: `${dodgeOff} Уворот работает, пока есть хотя бы один живой куб Ловкости.` }] : ['Уворот', pct(dodgeOf(f))],
      ['Выносливость', `${Math.round(f.maxStamina)}`],
      ['Мана', `${Math.round(f.maxMana)}`],
      ['Броня режет', pct(armorAbsorb(f.stats.Armor))],
    ];
    for (const [k, v, color, hint] of rows) {
      c.add(text(this, x0, y, k, { size: 13 }));
      const valueText = text(this, w, y, v, { kind: 'mono', size: 13, ...(color ? { color } : {}) }).setOrigin(1, 0);
      c.add(valueText);
      if (hint) c.add(hintIcon(this, w - valueText.width - 12, y + 8, () => hint));
      y += 19;
    }
    return { view, card, x0, w };
  }

  /** Плашки стат в ряд: номер, цвет, название, сколько таких кубов у противника. Перетаскиванием меняется порядок. */
  private renderTarget(c: CharacterState, enemy: Fighter) {
    this.targetRows.removeAll(true);
    const saved = normalizeTarget(c.target);
    const present = (s: Stat) => enemy.cubeTotals[s] > 0;
    const available = saved.filter(present);
    const order = [...available, ...saved.filter((s) => !present(s))];
    const lastAvailable = available.length - 1;
    const slotX = (k: number) => CHIP_X0 + CHIP_W / 2 + k * CHIP_STEP;
    const chips = new Map<Stat, { box: Phaser.GameObjects.Container; num: Phaser.GameObjects.Text }>();
    let dragging = false;
    const layout = (except?: Stat) => {
      order.forEach((s, k) => {
        const ch = chips.get(s)!;
        ch.num.setText(String(k + 1));
        if (s === except) return;
        this.tweens.killTweensOf(ch.box);
        this.tweens.add({ targets: ch.box, x: slotX(k), duration: 140, ease: 'Cubic.easeOut' });
      });
      this.updatePreview(order, enemy);
    };
    order.forEach((s, k) => {
      const n = enemy.cubeTotals[s];
      const box = this.add.container(slotX(k), CHIP_Y);
      const g = this.add.graphics();
      const draw = (hot: boolean) => {
        g.clear();
        g.fillStyle(COLOR.slotDark, 1).fillRoundedRect(-CHIP_W / 2, -CHIP_H / 2, CHIP_W, CHIP_H, 5);
        g.lineStyle(2, hot ? COLOR.highlight : COLOR.slotDarkBorder, 1).strokeRoundedRect(-CHIP_W / 2, -CHIP_H / 2, CHIP_W, CHIP_H, 5);
        g.fillStyle(STAT_COLOR[s], 1).fillRect(-CHIP_W / 2 + 22, -10, 20, 20);
      };
      draw(false);
      const num = text(this, -CHIP_W / 2 + 7, -CHIP_H / 2 + 3, String(k + 1), { kind: 'mono', size: 11, color: COLOR.light });
      const short = text(this, -CHIP_W / 2 + 50, -7, STAT_SHORT[s], { kind: 'display', size: 22, color: '#ffffff' }).setOrigin(0, 0.5);
      const cnt = text(this, -CHIP_W / 2 + 50, 12, n ? `${n} куб.` : 'нет', { size: 11, color: n ? COLOR.light : COLOR.lightQuiet }).setOrigin(0, 0.5);
      box.add([g, num, short, cnt]);
      this.targetRows.add(box);
      chips.set(s, { box, num });
      if (!n) return;
      const grip = text(this, CHIP_W / 2 - 12, 8, '⋮⋮', { size: 14, color: COLOR.lightQuiet }).setOrigin(0.5);
      box.add(grip);
      box.setSize(CHIP_W, CHIP_H).setInteractive({ draggable: true, useHandCursor: true });
      // наведение — подсветка кубов этой статы у противника
      box.on('pointerover', () => this.setHighlight(s));
      box.on('pointerout', () => !dragging && this.setHighlight(null));

      box.on('dragstart', () => {
        dragging = true;
        this.setHighlight(s);
        this.targetRows.bringToTop(box);
        this.tweens.killTweensOf(box);
        box.setScale(1.06);
        draw(true);
        this.input.setDefaultCursor('grabbing');
      });
      box.on('drag', (_p: Phaser.Input.Pointer, dragX: number) => {
        box.x = Phaser.Math.Clamp(dragX, slotX(0), slotX(lastAvailable));
        const k2 = Math.round((box.x - slotX(0)) / CHIP_STEP);
        const cur = order.indexOf(s);
        if (k2 !== cur) {
          order.splice(cur, 1);
          order.splice(k2, 0, s);
          layout(s);
        }
      });
      box.on('dragend', () => {
        dragging = false;
        box.setScale(1);
        draw(false);
        this.input.setDefaultCursor('default');
        this.tweens.add({ targets: box, x: slotX(order.indexOf(s)), duration: 120, ease: 'Cubic.easeOut' });
        layout(s);
        this.setHighlight(null);
        // Позиции отсутствующих статов пригодятся в бою с другим противником.
        let i = 0;
        store.act('setTarget', c.uid, saved.map((stat) => present(stat) ? order[i++] : stat));
      });
    });
    this.updatePreview(order, enemy);
  }
}
