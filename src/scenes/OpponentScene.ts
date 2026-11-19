import { fighterInputOf, fightSetup } from '../core/fight';
import { ratingDeltas } from '../core/rating';
import { lossRule } from '../core/arena';
import Phaser from 'phaser';
import { BaseScene } from './BaseScene';
import { SCENE, type BattleSceneData, type OpponentSceneData } from './keys';
import { getBlueprint, hasItem } from '../data/catalog';
import type { CharacterBlueprint, EquipmentItem, Stat } from '../data/types';
import { STAT_LABEL, STAT_SHORT, disabledEffect, itemDescription, itemRows } from '../data/labels';
import { isDisabled } from '../core/battle';
import { Slot } from '../ui/Slot';
import { attachTooltip } from '../ui/Tooltip';
import { withUpgrade } from '../ui/upgradeTip';
import { createItemIcon } from '../ui/ItemIcon';
import { hintIcon } from '../ui/HintIcon';
import { weaponRow } from '../ui/WeaponRow';
import { THRESHOLDS, createFighter, critOf, cubesToDisable, digPreview, dodgeOf, hasAliveCube, normalizeTarget, perkOf, slotDamageValue, type Fighter } from '../core/battle';
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
import { SERIES_LENGTH, seriesRetries, retriesLeft } from '../core/arena';
import { ARENA, getItem as itemById } from '../data/catalog';
import { FACE_LEFT, FACE_RIGHT } from '../render/anim';
import { skinColorOf, skinPatternOf, skinsFor } from '../data/skins';

/** Плашки приоритета атаки. */
// шесть плашек приоритета — на всю ширину экрана (40…1240)
const CHIP_W = 190;
const CHIP_H = 52;
const CHIP_STEP = 202;
const CHIP_X0 = 40;
const CHIP_Y = 580;

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
  /** Ползунок раскопки: сколько кубов пути уже «разбито» в предпросмотре (0 — бой не начат). */
  private digStep = 0;
  private digUi?: { set: (k: number, n: number) => void };
  /** Показать исходные статные цвета вместо скинов; локальная настройка экрана. */
  private originalModels = false;

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
    this.originalModels = this.registry.get('opponent.originalModels') === true;
    const c = store.state.characters.find((x) => x.uid === this.charUid);
    // серия с игроками без выбранного соперника — к списку соперников
    if (c && store.state.arenaRun?.mode === 'players' && !store.state.arenaRun.opp) return void this.scene.start(SCENE.rivals);
    // противника выбирает сервер: пока ответа нет — экран ожидания, затем сцена открывается заново
    if (c && !store.state.arenaRun?.opp) {
      this.setupScreen({ title: 'Новый противник', kicker: 'Арена', back: null });
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
    // экран подготовки к бою — без табов главного меню: выход — кнопкой слева внизу
    this.setupScreen({
      title: 'Новый противник',
      kicker: pvp ? `Бой с игроком · бой ${run?.fight ?? 1} из ${SERIES_LENGTH} · без повторов` : `Арена · бой ${run?.fight ?? 1} из ${SERIES_LENGTH} · повторов ${retriesLeft(run)}/${seriesRetries()}`,
      subtitle: `${pvp ? `рейтинг ${pvp.myRating} · победа +${ratingDeltas(pvp.myRating, pvp.rating).win} · поражение ${ratingDeltas(pvp.myRating, pvp.rating).lose} · ` : ''}${run?.wins ? `побед: ${run.wins} · ` : ''}за серию: ${ARENA.reward.cubes} куб. + ${[...new Set(ARENA.reward.drops.map((d) => `${itemById(d.itemId).kind === 'gem' ? 'камень стихии' : itemById(d.itemId).name.toLowerCase()} ${d.count[0] === d.count[1] ? d.count[0] : `${d.count[0]}–${d.count[1]}`}`))].join(' или ')}`,
      back: c && run ? null : SCENE.menu,
    });
    if (!c || !run) {
      this.add.existing(this.stubNote(640, 360, 'Бойца нет', 'Выбери бойца вкладкой «Арена».'));
      return;
    }
    // выход с арены — кнопка со стрелкой; после побед спросит подтверждение (лут остаётся у бойца)
    const exit = new Button(this, 70, 676, '', { variant: 'beige', width: 60, height: 54, onClick: () => this.leaveRun() });
    exit.addAt(this.add.image(-1, -2, TEX.arrowBackBrown).setScale(1.1), exit.getIndex(exit.hit));
    attachTooltip(exit.hit, () => ({ title: run.wins ? 'Забрать лут и выйти' : 'Выйти с арены', note: run.wins ? 'Серия закончится без награды; лут в рюкзаке остаётся у бойца.' : 'Серия закончится, боец вернётся в лобби.' }));
    const bp = getBlueprint(c.blueprintId) as CharacterBlueprint;
    // противник — из состояния (бот по зерну сервера или снимок бойца другого игрока)
    this.opp = fightSetup(store.state)!.opp;
    this.oppSeed = this.opp.seed;
    const enemy = createFighter('enemy', this.opp);
    const me = createFighter('player', playerFighterInput(c));
    if (skinsFor(me.blueprintId).length || skinsFor(enemy.blueprintId).length) {
      const toggle = new Button(this, GAME_W / 2, 116, this.originalModels ? 'Вид: оригинал' : 'Вид: скин', {
        variant: 'beige', width: 200, height: 30, size: 14,
        onClick: () => {
          this.registry.set('opponent.originalModels', !this.originalModels);
          this.scene.restart({ charUid: this.charUid, oppSeed: this.oppSeed, except: this.except } satisfies OpponentSceneData);
        },
      });
      attachTooltip(toggle.hit, () => ({ title: 'Отображение моделей', note: 'Оригинал — цвета статов для оценки сборки. Скин — вид, который будет использоваться в бою.' }));
    }

    // свой боец слева, противник справа — лицом друг к другу
    this.fighterCard(40, 'Твой боец', me, bp.name, c.equipment.map((e) => (e && hasItem(e.itemId) ? (itemOf(e) as EquipmentItem).itemLevel : null)));
    const ec = this.fighterCard(650, pvp ? `Игрок ${pvp.name}` : 'Противник', enemy, this.opp.pattern, this.opp.weaponLevels);
    this.enemyView = ec.view;
    this.enemyF = enemy;
    this.highlight = null;
    this.digStep = 0;
    // путь от прошлого противника: сцена переиспользуется — сбрасываем, ползунок всегда начинает с 0
    this.preview = [];
    this.digSlider(ec.card, enemy.aliveBlocks);
    // полоса пути — над моделью; модель можно вращать, поэтому перерисовка каждый кадр
    this.pathGfx = this.add.graphics().setDepth(5);
    const follow = () => this.drawPath();
    this.events.on(Phaser.Scenes.Events.UPDATE, follow);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.events.off(Phaser.Scenes.Events.UPDATE, follow));

    // приоритет атаки: горизонтальные плашки, порядок меняется перетаскиванием
    text(this, 40, 520, 'ПРИОРИТЕТ АТАКИ', { kind: 'display', size: 20, color: COLOR.title });
    text(this, 232, 524, `перетащи плашки · фокус атаки — спереди к самой левой стате · белая линия — порядок разбития кубов · наведи — её кубы`, { size: 13, color: COLOR.lightQuiet });
    this.targetRows = this.add.container(0, 0);
    this.renderTarget(c, enemy);
    this.thresholdLine(enemy);

    // рюкзак — кнопка с иконкой сумки и заполненностью
    const bagBtn = new Button(this, 140, 676, '', {
      variant: 'beige',
      width: 60,
      height: 54,
      onClick: () => {
        const m = openRucksack(this, c.uid, { note: lossRule(run.mode) === 'drop' ? 'Между боями: выпить зелье, сменить оружие. При поражении оружие и содержимое рюкзака пропадают.' : 'Между боями: выпить зелье, сменить оружие.' });
        m.once(Phaser.GameObjects.Events.DESTROY, () => this.sys.isActive() && this.scene.restart({ charUid: c.uid, oppSeed: this.oppSeed, except: this.except } satisfies OpponentSceneData));
      },
    });
    const bagItemId = rucksackItemId(c);
    const bagIcon = createItemIcon(this, itemById(bagItemId), 38) as Phaser.GameObjects.Components.Transform & Phaser.GameObjects.Components.Alpha & Phaser.GameObjects.GameObject;
    bagIcon.setPosition(0, -3);
    bagBtn.addAt(bagIcon, bagBtn.getIndex(bagBtn.hit));
    const bagCells = bagSlots(c);
    if (bagCells.length) bagBtn.addAt(text(this, 24, 20, `${bagCells.filter(Boolean).length}/${bagCells.length}`, { kind: 'mono', size: 10, weight: 700, color: COLOR.ink }).setOrigin(1, 1), bagBtn.getIndex(bagBtn.hit));
    attachTooltip(bagBtn.hit, () => ({ title: 'Рюкзак и зелья', note: 'Выпить зелье, сменить оружие, улучшить зелья и рюкзак.' }));
    new Button(this, GAME_W / 2, 676, 'В бой', {
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
      text(this, w / 2, 6, `Лут в рюкзаке остаётся у бойца. Награда за серию — только за все ${SERIES_LENGTH} победы.\nВне арены разбитые кубы восстанавливаются со временем.`, { size: 15, align: 'center', wrap: w }).setOrigin(0.5, 0),
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

  /**
   * Вид модели противника: кубы, «разбитые» ползунком, и подсвеченная стата — полупрозрачные остальные;
   * следующий куб раскопки и кубы подсвеченной статы — золотой обводкой.
   */
  private refreshLook() {
    const f = this.enemyF;
    const v = this.enemyView;
    if (!f || !v) return;
    const dug = new Set(this.preview.slice(0, this.digStep));
    const stat = this.highlight;
    const next = this.digStep > 0 ? this.preview[this.digStep] : undefined;
    v.setLookOf((i) => (!f.blocks[i].alive || dug.has(i) || (stat && f.blocks[i].stat !== stat) ? 'broken' : 'solid'));
    v.setOutlineOf((i) => (i === next || (stat && !dug.has(i) && f.blocks[i].alive && f.blocks[i].stat === stat) ? COLOR.highlight : undefined));
  }

  /**
   * Ползунок «РАСКОПКА» внизу экрана: протянуть путь по кубам — следующий куб обведён на модели, пройденные
   * полупрозрачны; в заголовке карточки противника — сколько кубов осталось и какие статы к этому шагу отключатся
   * порогом. Перетаскивание, клик по дорожке, ◀ ▶ и стрелки клавиатуры.
   */
  private digSlider(card: Card, alive0: number) {
    const tx = 900, tw = 250, ty = 684; // справа от «В бой» (до x 780), левее метки DEBUG
    const value = text(this, tx + tw / 2, 650, '', { size: 13, color: COLOR.light, letterSpacing: 1 }).setOrigin(0.5, 0);
    const g = this.add.graphics();
    const draw = (k: number, n: number) => {
      g.clear();
      g.fillStyle(0xe6e2d8, 0.25).fillRoundedRect(tx, ty - 3, tw, 6, 3);
      const kx = tx + (n ? (tw * k) / n : 0);
      g.fillStyle(COLOR.highlight, 1).fillRoundedRect(tx, ty - 3, Math.max(0, kx - tx), 6, 3);
      g.fillStyle(0x140a02, 1).fillCircle(kx, ty, 9);
      g.fillStyle(COLOR.highlight, 1).fillCircle(kx, ty, 7);
    };
    const f = this.enemyF!;
    const set = (k: number, n: number) => {
      this.digStep = Phaser.Math.Clamp(Math.round(k), 0, n);
      draw(this.digStep, n);
      value.setText(`ФОКУС АТАКИ · ${this.digStep} / ${n}`);
      // какие статы противника отключатся к этому шагу (разбитые до боя + разбитые по пути)
      const broken = { ...f.cubeBroken };
      for (const i of this.preview.slice(0, this.digStep)) broken[f.blocks[i].stat]++;
      const off = THRESHOLDS.stats.filter((st) => isDisabled(f, st) || (f.cubeTotals[st] > 0 && broken[st] > THRESHOLDS.share * f.cubeTotals[st]));
      card.setAside(`${alive0 - this.digStep} куб.${off.length ? ` · откл.: ${off.map((st) => STAT_SHORT[st]).join(', ')}` : ''}`);
      this.refreshLook();
      this.drawPath();
    };
    this.digUi = { set };
    const n = () => this.preview.length;
    const fromPointer = (p: Phaser.Input.Pointer) => set(((p.x - tx) / tw) * n(), n());
    const hit = this.add.zone(tx - 12, ty - 14, tw + 24, 28).setOrigin(0).setInteractive({ useHandCursor: true, draggable: true });
    hit.on('pointerdown', fromPointer);
    hit.on('drag', fromPointer);
    attachTooltip(hit, () => ({
      title: 'Фокус атаки',
      note: 'Протяни — путь растёт куб за кубом: пройденные кубы полупрозрачны, следующий обведён золотым, в заголовке противника — сколько кубов осталось и что отключилось. На 100% — весь путь. Стрелки ← → — по одному кубу.',
    }));
    const stepBtn = (x: number, label: string, d: number) => {
      const b = text(this, x, ty, label, { size: 16, color: COLOR.light }).setOrigin(0.5).setInteractive({ useHandCursor: true });
      b.on('pointerup', () => set(this.digStep + d, n()));
      return b;
    };
    stepBtn(tx - 26, '◀', -1);
    stepBtn(tx + tw + 26, '▶', 1);
    const key = (d: number) => () => set(this.digStep + d, n());
    this.input.keyboard?.on('keydown-LEFT', key(-1));
    this.input.keyboard?.on('keydown-RIGHT', key(1));
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.input.keyboard?.off('keydown-LEFT');
      this.input.keyboard?.off('keydown-RIGHT');
    });
    set(0, n());
  }

  /** Предпросмотр раскопки при порядке order: весь путь — в каком порядке будут разбиты кубы противника. */
  private updatePreview(order: readonly Stat[]) {
    const f = this.enemyF;
    if (!f) return;
    // по умолчанию ползунок на 0 (0.0.66, решение Евгения); дотянутый до 100% остаётся там и после смены приоритета
    const full = this.preview.length > 0 && this.digStep >= this.preview.length;
    this.preview = digPreview(order, f, f.blocks.length);
    if (this.digUi) this.digUi.set(full ? this.preview.length : this.digStep, this.preview.length); // перерисует вид, путь и подписи
    else this.drawPath();
  }

  /**
   * Полоса пути растёт за ползунком: от первого куба через уже пройденные до следующего; на 100% — весь путь.
   * Белая тонкая с тёмной подложкой; кружки — начало пути и следующий куб.
   */
  private drawPath() {
    const g = this.pathGfx;
    const v = this.enemyView;
    if (!g || !v?.active) return;
    g.clear();
    const pts = this.preview.map((i) => v.blockWorldPos(i));
    const n = pts.length;
    const k = Math.min(this.digStep, n);
    if (!n || k === 0) return;
    const end = Math.min(k, n - 1); // до следующего куба; на 100% — до последнего
    for (let j = 0; j < end; j++) {
      const a = pts[j], b = pts[j + 1];
      g.lineStyle(4, 0x140a02, 0.4).lineBetween(a.x, a.y, b.x, b.y);
      g.lineStyle(1.5, 0xffffff, 0.95).lineBetween(a.x, a.y, b.x, b.y);
    }
    const dot = (p: { x: number; y: number }) => {
      g.fillStyle(0x140a02, 0.8).fillCircle(p.x, p.y, 5);
      g.fillStyle(0xffffff, 1).fillCircle(p.x, p.y, 3.5);
    };
    dot(pts[0]);
    if (k < n) dot(pts[k]);
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
      colorOf: (i) => this.originalModels ? STAT_COLOR[f.blocks[i].stat] : skinColorOf(f.blueprintId, f.skinId, i) ?? STAT_COLOR[f.blocks[i].stat],
      pattern: this.originalModels ? undefined : skinPatternOf(f.blueprintId, f.skinId),
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
        ? ([['Разбито', `${f.blocks.length - f.aliveBlocks}`, COLOR.lose, { title: 'Разбитые кубы', note: 'Пока боец на арене, разбитые кубы сами не чинятся — только зельями из рюкзака.' }]] as Array<[string, string, string?, { title: string; note: string }?]>)
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

  /**
   * Пороги противника под плашками: сколько кубов каждой статы разбить, чтобы она отключилась в бою.
   * Ближайшие (≤ 2) подсвечены; у каждой — тултип, что именно отключится.
   */
  private thresholdLine(enemy: Fighter) {
    const list = THRESHOLDS.stats
      .map((s) => [s, cubesToDisable(enemy, s)] as const)
      .filter((e): e is readonly [Stat, number] => e[1] !== null)
      .sort((a, b) => a[1] - b[1]);
    if (!list.length) return;
    const y = 616;
    const head = text(this, 40, y, 'ДО ОТКЛЮЧЕНИЯ У ПРОТИВНИКА', { kind: 'display', size: 15, color: COLOR.title });
    let x = 40 + head.width + 14;
    for (const [s, n] of list) {
      const label = n === 0 ? `${STAT_LABEL[s]}: уже отключена` : `${STAT_LABEL[s]}: ${n} куб.`;
      const t = text(this, x, y + 1, label, { size: 13, weight: n <= 2 ? 700 : 400, color: n <= 2 ? COLOR.light : COLOR.lightQuiet }).setInteractive();
      t.on('pointerover', () => this.setHighlight(s));
      t.on('pointerout', () => this.setHighlight(null));
      attachTooltip(t, () => ({
        title: STAT_LABEL[s],
        rows: [
          ['Кубов у противника', String(enemy.cubeTotals[s])],
          ['Отключится, если разбить', n === 0 ? 'уже' : `ещё ${n}`],
          ['Что потеряет', disabledEffect(s)],
        ],
        note: `Порог — больше ${Math.round(THRESHOLDS.share * 100)}% кубов статы.`,
      }));
      x += t.width + 18;
    }
  }

  /** Плашки стат в ряд: номер, цвет, название, сколько таких кубов у противника. Перетаскиванием меняется порядок. */
  private renderTarget(c: CharacterState, enemy: Fighter) {
    this.targetRows.removeAll(true);
    const order = [...normalizeTarget(c.target)];
    const count = (s: Stat) => enemy.blocks.filter((b) => b.stat === s).length;
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
      this.updatePreview(order); // предпросмотр — сразу, и во время перетаскивания
    };
    order.forEach((s, k) => {
      const n = count(s);
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
      const grip = text(this, CHIP_W / 2 - 12, 8, '⋮⋮', { size: 14, color: COLOR.lightQuiet }).setOrigin(0.5);
      box.add([g, num, short, cnt, grip]);
      box.setSize(CHIP_W, CHIP_H).setInteractive({ draggable: true, useHandCursor: true });
      this.targetRows.add(box);
      chips.set(s, { box, num });
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
        box.x = Phaser.Math.Clamp(dragX, slotX(0), slotX(order.length - 1));
        const k2 = Phaser.Math.Clamp(Math.round((box.x - slotX(0)) / CHIP_STEP), 0, order.length - 1);
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
        store.act('setTarget', c.uid, [...order]);
      });
    });
    this.updatePreview(order);
  }
}
