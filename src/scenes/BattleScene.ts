import Phaser from 'phaser';
import { BaseScene } from './BaseScene';
import { createRunBattle, resolveFight, type FightInputs } from '../core/fight';
import { RATING_START } from '../core/rating';
import { lossRule, type RivalInfo } from '../core/arena';
import { SCENE, type BattleSceneData, type CharactersSceneData, type OpponentSceneData } from './keys';
import { EFFECTS, getBlueprint, getItem, hasItem, itemModel, weaponStrike } from '../data/catalog';
import { FACE_LEFT, FACE_RIGHT, attackStyleOf, type AttackStyle } from '../render/anim';
import { PATTERN_LABEL, STAT_LABEL_GEN, STAT_SHORT, disabledEffect, effectParts, patternDescription, statDisabledTitle, turns, weaponPerkText } from '../data/labels';
import type { EffectId, Stat } from '../data/types';
import { THRESHOLDS, canUseArtifact, critOf, dodgeOf, patternOf, slotDamageValue, step, useArtifact, type BattleEvent, type BattleState, type Fighter, type Side } from '../core/battle';
import { SERIES_LENGTH, seriesRetries, retriesLeft, surrenderRun, type FightOutcome, type LootEntry, type SeriesReward } from '../core/arena';
import { CUBE_ID } from '../core/state';
import { bagSlots, itemOf } from '../core/character';
import { crossButton } from '../ui/CrossButton';
import { itemDescription, itemRows } from '../data/labels';
import { enableSlotDrag } from '../ui/bagDrag';
import { openRucksack } from '../ui/RucksackModal';
import { store } from '../game/store';
import { Button } from '../ui/Button';
import { createItemIcon } from '../ui/ItemIcon';
import { Modal } from '../ui/Modal';
import { ResourceBar } from '../ui/ResourceBar';
import { Slot } from '../ui/Slot';
import { Tooltip, attachTooltip, type TooltipContent } from '../ui/Tooltip';
import { withUpgrade } from '../ui/upgradeTip';
import { text } from '../ui/text';
import { COLOR, DEPTH, GAME_H, GAME_W, STAT_COLOR } from '../ui/theme';
import { VoxelView, type BlockLook } from '../ui/VoxelView';
import { Battle3DLayer, webglAvailable } from '../render3d/Battle3DLayer';
import type { AttackCtx, Fighter3D } from '../render3d/Fighter3D';
import { shade } from '../render/iso';

/** Пауза между ходами, мс (TurnDelay клиента — 0.35 с; в прототипе медленнее, чтобы успеть рассмотреть). */
const TURN_MS = [1500, 760];
/** Длительность клипа удара, мс (в клиенте 1 с; в прототипе медленнее). Урон — в момент попадания (~0.58 клипа). */
const ATTACK_MS = [1250, 640];
/** Рассыпание проигравшего и пауза перед окном итога (×1, ×2). */
const CRUMBLE_MS = [1500, 900];
const RESULT_PAUSE_MS = [700, 400];
/** Срабатывание артефакта, мс. */
const ARTIFACT_MS = [800, 420];
/** Уворот, мс (CharacterEvade — 0.83 с). */
const EVADE_MS = [760, 400];
/** Раскладка: слоты внизу по центру, лог слева снизу, полоски в шапке. */
const SLOT_Y = 666;
const SLOT_STEP = 60;
const SLOT_GAP = 40;
const BAR_W = 250;
const LOG = { x: 16, y: 600, w: 300, h: 108 };
/** Пауза после пропущенного хода, мс — чтобы было видно, что боец стоит. */
const SKIP_MS = [2000, 1000];
/** Сколько держится надпись «СТАТА ОТКЛЮЧЕНА», мс; следующий ход ждёт её. */
const DISABLE_MS = [1600, 1000];
/** Иконки состояния под барами. */
const ICON = { w: 42, h: 24, gap: 6, y: 140 };
/** Цвета иконок эффектов. */
const EFFECT_ICON: Record<EffectId, { label: string; color: number }> = {
  shield: { label: 'ЩИТ', color: 0x5f9fe8 },
  burn: { label: 'ГОР', color: 0xe8661a },
  poison: { label: 'ЯД', color: 0x3fae2c },
  freeze: { label: 'ЛЁД', color: 0x6cc4ec },
};

/** Иконка состояния: отключённая стата или эффект. */
interface StatusIcon {
  key: string;
  label: string;
  color: number;
  slash?: boolean;
  count?: number;
  tooltip: () => TooltipContent;
}

/** Ключ настройки рендера боя: '0' — прежняя 2D-изометрия, иначе 3D (three.js). */
const RENDER_KEY = 'ctg.battle3d';
/** Ячейка лута и награды в окне итога. */
const LOOT_CELL = 58;
const LOOT_GAP = 8;
function render3dEnabled(): boolean {
  try {
    return localStorage.getItem(RENDER_KEY) !== '0';
  } catch {
    return true;
  }
}

/** Модель бойца в бою: 2D-изометрия (VoxelView) или 3D (Fighter3D). */
interface FighterView {
  readonly x: number;
  playAttack(slot: number, style: AttackStyle, dur: number, onHit?: () => void, ctx?: AttackCtx): number;
  blockWorldPos(index: number): { x: number; y: number };
  playEvade(dur: number): unknown;
  playArtifact(slot: number, dur: number): unknown;
  playCrumble(dur?: number): number;
  flashBlock(index: number, color: number, ms?: number): unknown;
  setLookOf(fn: (index: number) => BlockLook): unknown;
  redraw(): unknown;
  /** Только 3D: удар пришёл в бойца / куб получил урон — эффекты рисует сама сцена. */
  struck?(block: number, outcome: 'hit' | 'evade' | 'shield', crit: boolean): void;
  damaged?(block: number, source: string, spread: boolean): void;
  /** Только 3D: эффект на кубе (или на бойце — block null) появился / прошёл. */
  setEffect?(block: number | null, effect: string, on: boolean): void;
}

interface SideView {
  fighter: Fighter;
  view: FighterView;
  hp: ResourceBar;
  st: ResourceBar;
  mp: ResourceBar;
  slots: Slot[];
  cds: Phaser.GameObjects.Text[];
  /** Ряд иконок состояния под барами (отключённые статы и эффекты), перестраивается при смене набора. */
  status: Phaser.GameObjects.Container;
  statusKey: string;
  /** Отключённые статы, уже показанные на экране (событие disable — в момент попадания). */
  shownDisabled: Stat[];
  /** Строка под именем: крит и уворот — отдельными текстами, чтобы красить отключённое. */
  critText: Phaser.GameObjects.Text;
  dodgeText: Phaser.GameObjects.Text;
  edge: number;
  right: boolean;
  /** Полоса целей (только у противника). */
  targets?: Phaser.GameObjects.Container;
  baseX: number;
  /** Какие кубы живы на момент последнего пересчёта граней. */
  aliveKey: string;
  /**
   * Какие кубы показаны живыми. Состояние боя считается сразу за весь ход, а на экране куб
   * пропадает только в момент попадания (событие break показывается в точке импакта клипа).
   */
  shownAlive: boolean[];
  name: Phaser.GameObjects.Text;
  /** Маркер «ходит» над моделью. */
  marker: Phaser.GameObjects.Container;
  /** Слот, которым боец действует в этом ходу (подсветка). */
  activeSlot: number | null;
}

/** Пошаговый бой: ходы идут сами (AutoUse), игрок может включать артефакты и ставить паузу. */
export class BattleScene extends BaseScene {
  private data_!: BattleSceneData;
  private b!: BattleState;
  private sides!: Record<Side, SideView>;
  private logText!: Phaser.GameObjects.Text;
  private turnText!: Phaser.GameObjects.Text;
  private lines: string[] = [];
  private timer?: Phaser.Time.TimerEvent;
  private paused = false;
  private speed = 0;
  private speedBtn!: Button;
  /** Игрок сдался в окне итога, не тратя повторы. */
  private surrenderedRun = false;
  private queuedArtifact: number | null = null;
  private ended = false;
  /** Когда закрыли паузу: тот же ESC не должен сразу открыть её снова. */
  private resumedAt = -1;
  /** Чей сейчас ход (последний ходивший; до первого хода — игрок). */
  private active: Side = 'player';
  private skipped = false;
  private surrendered = false;
  /** Итог боя для серии (считается один раз). undefined — ещё не подведён, null — вне серии. */
  private outcome?: FightOutcome | null;
  /** Рюкзак и снаряжение противника — его лут. */
  /** Лут побеждённого: забирается перетаскиванием в рюкзак, пока игрок на этом экране. */
  /** Лут побеждённого — в состоянии игрока (забирается действием lootTake). */
  private get loot(): LootEntry[] {
    return store.state.loot?.entries ?? [];
  }
  /** Сколько ходов сыграно и когда нажаты артефакты — ввод игрока, по которому сервер пересчитывает бой. */
  private mode: 'bots' | 'players' = 'bots';
  private rival?: RivalInfo;
  private steps = 0;
  private artifactUses: Array<{ after: number; slot: number }> = [];
  /** Последний удар был критом — его основной урон рисуется золотым. */
  private lastCrit = false;
  /** Удары, чья точка импакта ещё не наступила. */
  private pendingHits = 0;
  /** 3D-рендер боя (three.js); нет — бой рисуется 2D-изометрией. */
  private layer3d?: Battle3DLayer;

  constructor() {
    super(SCENE.battle);
  }

  init(data: BattleSceneData) {
    this.data_ = data;
  }

  create() {
    this.lines = [];
    this.paused = false;
    this.ended = false;
    this.queuedArtifact = null;
    this.active = 'player';
    this.skipped = false;
    this.surrendered = false;
    this.pendingHits = 0;
    this.resumedAt = -1;
    this.speed = (this.registry.get('battle.speed') as number | undefined) ?? 0;
    const c = store.state.characters.find((x) => x.uid === this.data_?.charUid);
    this.outcome = undefined;
    this.surrenderedRun = false;
    this.setupScreen({ title: 'Арена', kicker: `БОЙ ${store.state.arenaRun?.fight ?? 1} ИЗ ${SERIES_LENGTH}`, back: null });
    if (!c) {
      this.add.existing(this.stubNote(640, 360, 'Бойца нет', 'Выбери бойца кнопкой «Арена» в меню.'));
      new Button(this, 640, 460, 'В меню', { width: 220, height: 52, onClick: () => this.go(SCENE.menu) });
      return;
    }
    this.layer3d = undefined;
    if (render3dEnabled() && webglAvailable()) {
      this.layer3d = new Battle3DLayer(this, GAME_W, GAME_H);
      // 3D — над фоном экрана, но под заголовком и всем интерфейсом
      const firstText = this.children.list.findIndex((o) => o instanceof Phaser.GameObjects.Text);
      if (firstText >= 0) this.children.moveTo(this.layer3d.image, firstText);
    }
    // боец, противник и зерно боя — из состояния (их зафиксировал сервер): тот же бой он пересчитает сам
    const made = createRunBattle(store.state);
    if (!made) {
      this.add.existing(this.stubNote(640, 360, 'Бой не начат', 'Вернись к противнику и нажми «В бой».'));
      new Button(this, 640, 460, 'В меню', { width: 220, height: 52, onClick: () => this.go(SCENE.menu) });
      return;
    }
    this.b = made.battle;
    // вид серии и соперник-игрок — запоминаем до итога: после боя их в состоянии уже нет
    this.mode = store.state.arenaRun?.mode ?? 'bots';
    this.rival = store.state.arenaRun?.opp?.player;
    this.steps = 0;
    this.artifactUses = [];
    // ушли с экрана победы — незабранный лут пропадает
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => store.state.loot && store.act('lootClose'));

    this.turnText = text(this, GAME_W / 2, 106, 'ХОД 0', { kind: 'mono', size: 15, color: COLOR.light }).setOrigin(0.5, 0);
    this.sides = { player: this.buildSide(this.b.player), enemy: this.buildSide(this.b.enemy) };
    if (this.layer3d)
      for (const sv of Object.values(this.sides)) {
        // камера подбирается, когда на сцене оба бойца — подписи над моделями ставим после
        sv.baseX = sv.view.x;
        sv.marker.setX(sv.view.x);
      }
    // разделитель между слотами бойцов
    this.add.rectangle(GAME_W / 2, SLOT_Y, 2, 64, 0xe6e2d8, 0.35);

    // лог: компактный, слева снизу
    this.add.rectangle(LOG.x, LOG.y, LOG.w, LOG.h, 0x000000, 0.38).setOrigin(0).setStrokeStyle(1, 0xe6e2d8, 0.15);
    this.logText = text(this, LOG.x + 10, LOG.y + 7, '', { size: 11, color: COLOR.light, wrap: LOG.w - 20 });
    this.logText.setLineSpacing(1);

    // скорость боя — кнопкой справа внизу (над меткой DEBUG); то же переключается в меню паузы
    this.speedBtn = new Button(this, GAME_W - 16 - 78, GAME_H - 72, '', { variant: 'beige', width: 156, height: 44, size: 18, onClick: () => this.toggleSpeed() });
    this.speedBtn.setCaption(this.speedCaption());
    // остальные кнопки — в меню-бургере справа сверху
    const burger = new Button(this, GAME_W - 44, 44, '', { variant: 'beige', width: 56, height: 50, onClick: () => this.pause() });
    const lines = this.add.graphics();
    lines.fillStyle(0x4a2a12, 1);
    for (const dy of [-10, -2, 6]) lines.fillRoundedRect(-13, dy - 2, 26, 4, 2);
    burger.add(lines);
    this.input.keyboard?.on('keydown-ESC', () => !this.ended && !this.children.list.some((o) => o instanceof Modal) && this.pause());
    this.input.keyboard?.on('keydown-SPACE', () => this.tryArtifact(this.firstArtifact()));

    this.push(`${this.b.player.name} против ${this.b.enemy.name}. Первым ходит игрок.`);
    // вышел покалеченным: стата могла перейти порог ещё до боя
    for (const f of [this.b.player, this.b.enemy]) {
      // статы без кубов в сборке отключены с начала — одной строкой; разбитые до боя — отдельно
      const none = f.disabled.filter((s) => f.cubeTotals[s] === 0);
      if (none.length) this.push(`${this.who(f.side)}: нет кубов — ${none.map((s) => `${statDisabledTitle(s).toLowerCase()} (${disabledEffect(s)})`).join(', ')}.`, true);
      for (const s of f.disabled) if (f.cubeTotals[s] > 0) this.push(`${this.who(f.side)}: ${statDisabledTitle(s).toLowerCase()} ещё до боя — ${disabledEffect(s)}.`, true);
    }
    this.refresh();
    const go = text(this, GAME_W / 2, 330, 'В БОЙ!', { kind: 'display', size: 72, color: COLOR.title }).setOrigin(0.5).setDepth(DEPTH.ui);
    this.tweens.add({ targets: go, alpha: 0, scale: 1.4, delay: 500, duration: 400, onComplete: () => go.destroy() });
    this.schedule(1000);
  }

  // ───────────── построение ─────────────

  private buildSide(f: Fighter): SideView {
    const right = f.side === 'enemy';
    // шапка бойца: имя и полоски у верхнего края; справа отступ под бургер
    const edge = right ? GAME_W - 96 : 28;
    const ox = right ? 1 : 0;
    const barX = right ? edge - BAR_W : edge;
    const name = text(this, edge, 16, f.name, { kind: 'display', size: 24, color: COLOR.light }).setOrigin(ox, 0);
    const critText = text(this, edge, 44, '', { size: 11, color: COLOR.lightQuiet }).setOrigin(ox, 0);
    const dodgeText = text(this, edge, 44, '', { size: 11, color: COLOR.lightQuiet }).setOrigin(ox, 0);
    const hp = new ResourceBar(this, barX, 62, BAR_W, 14, COLOR.hp, 'КБ', true);
    const st = new ResourceBar(this, barX, 79, BAR_W, 11, COLOR.stamina, 'ВН', true);
    const mp = new ResourceBar(this, barX, 93, BAR_W, 11, COLOR.mana, 'МН', true);
    // полоса целей под барами: статы бойца в порядке атаки соперника, ширина — по числу кубов (куда целит соперник)
    const targets = this.add.container(barX, 110);
    const status = this.add.container(0, ICON.y);
    const cx = right ? 950 : 330;
    const bp = getBlueprint(f.blueprintId);
    const blocks = bp.blocks;
    const shownAlive = f.blocks.map((b) => b.alive);
    const view: FighterView = this.layer3d
      ? this.layer3d.arena.addFighter({
        side: f.side,
        blocks,
        slots: bp.kind === 'character' ? bp.slots : [],
        equipped: f.slots.map((s) => itemModel(s.item?.id, s.item?.itemLevel)),
        colorOf: (i) => STAT_COLOR[f.blocks[i].stat],
        alive: (i) => shownAlive[i],
        slotEffects: f.slots.map((s) => s.ability?.effects),
      })
      : new VoxelView(this, cx, 372, {
      blocks,
      width: 520,
      height: 300,
      // оружие и артефакты на модели — по слотам чертежа, как в клиенте
      slots: bp.kind === 'character' ? bp.slots : undefined,
      slotMarkers: false,
      reserve: 1,
      equipped: f.slots.map((s) => itemModel(s.item?.id, s.item?.itemLevel)),
      idle: true,
      maxBlockPx: 40,
      // перёд модели (+Z) на экране: 180° — вправо-вниз, 270° — влево-вниз → бойцы смотрят друг на друга
      yaw: right ? FACE_LEFT : FACE_RIGHT,
      interactive: true,
      colorOf: (i) => STAT_COLOR[f.blocks[i].stat],
      lookOf: (i) => (shownAlive[i] ? 'solid' : 'broken'),
    });
    // слоты рук и артефактов
    const slots: Slot[] = [];
    const cds: Phaser.GameObjects.Text[] = [];
    // пустые слоты артефактов пока скрыты; места считаются только по видимым
    const shown = f.slots.map((s) => s.type === 'Hand' || !!s.item);
    const n = shown.filter(Boolean).length;
    f.slots.forEach((s, slotIndex) => {
      const place = shown.slice(0, slotIndex).filter(Boolean).length;
      // слоты обоих бойцов рядом внизу по центру, через черту; руки — с краю
      const sx = right ? GAME_W / 2 + SLOT_GAP + (n - 1 - place) * SLOT_STEP : GAME_W / 2 - SLOT_GAP - (n - 1 - place) * SLOT_STEP;
      const label = s.type === 'Hand' ? (s.isLeftHand ? 'Л' : 'П') : 'А';
      const slot = new Slot(this, sx, SLOT_Y, {
        size: 52,
        label,
        tooltip: () => this.slotTooltip(f, slotIndex),
        onClick: f.side === 'player' && s.type === 'Artifact' ? () => this.tryArtifact(slotIndex) : undefined,
      });
      if (s.item) slot.setContent(createItemIcon(this, s.item, 34)).setItemGems(s.item);
      else if (s.type === 'Hand') slot.setContent(text(this, 0, 4, '✊', { size: 22 }).setOrigin(0.5));
      const cd = text(this, sx, SLOT_Y, '', { kind: 'display', size: 24, color: '#ffffff' }).setOrigin(0.5).setStroke('#000000', 4);
      if (!shown[slotIndex]) {
        slot.setVisible(false);
        cd.setVisible(false);
      }
      slots.push(slot);
      cds.push(cd);
    });
    // маркер «ходит»: золотой треугольник с подписью над моделью
    const marker = this.add.container(cx, 168).setDepth(DEPTH.ui);
    const arrow = this.add.graphics();
    arrow.fillStyle(COLOR.highlight, 1).fillTriangle(-17, -10, 17, -10, 0, 12);
    arrow.lineStyle(2, 0x2b1a0a, 0.8).strokeTriangle(-17, -10, 17, -10, 0, 12);
    marker.add(arrow);
    marker.add(text(this, 0, -32, 'ХОДИТ', { kind: 'display', size: 28, color: COLOR.title }).setOrigin(0.5).setStroke('#140a02', 4));
    this.tweens.add({ targets: marker, y: 176, duration: 450, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    marker.setVisible(false);
    return { fighter: f, view, hp, st, mp, slots, cds, status, statusKey: '', shownDisabled: [...f.disabled], critText, dodgeText, edge, right, baseX: view.x, aliveKey: f.blocks.map((b) => (b.alive ? 1 : 0)).join(''), shownAlive, name, marker, activeSlot: null, targets };
  }

  private slotTooltip(f: Fighter, k: number) {
    const s = f.slots[k];
    const a = s.ability;
    if (!a) return { title: 'Пустой слот артефакта' };
    const rows: Array<[string, string]> = [];
    if (a.type !== 'ApplyEffect') {
      // число ударов — с учётом свойства уровня (кинжал ур. 2–3 бьёт трижды)
      const hits = s.item ? weaponStrike(s.item).hits : a.hits ?? 1;
      rows.push(['Урон', `${Math.round(slotDamageValue(f, s) * 10) / 10}${hits > 1 ? ` × ${hits}` : ''}${s.item ? ` · ур. ${s.item.itemLevel}` : ''}`]);
      rows.push(['Удар', `${PATTERN_LABEL[patternOf(s)]}: ${patternDescription(patternOf(s))}`]);
      if (s.item && s.item.itemLevel >= 2) rows.push([`Ур. ${Math.min(3, s.item.itemLevel)}`, weaponPerkText(s.item.id, patternOf(s), Math.min(3, s.item.itemLevel))]);
    }
    rows.push(['Кулдаун', `${Math.max(1, a.cooldown)}`]);
    if (a.staminaCost) rows.push(['Выносливость', String(a.staminaCost)]);
    if (a.manaCost) rows.push(['Мана', String(a.manaCost)]);
    for (const e of a.effects) rows.push([EFFECTS[e].name, effectParts(e).join('; ') || '—']);
    const note = s.type === 'Artifact' && f.side === 'player' ? 'Клик или пробел — активировать (ход не тратит).' : s.item ? undefined : s.ability ? 'Оружия нет — удар кулаком.' : 'Пустая рука не бьёт: кулак — только без оружия в руках.';
    return withUpgrade({ title: s.item?.name ?? (s.ability ? 'Кулак' : 'Пустая рука'), rows, note }, s.item);
  }

  // ───────────── цикл ─────────────

  private schedule(ms = TURN_MS[this.speed]) {
    this.timer?.remove();
    this.timer = this.time.delayedCall(ms, () => this.tick());
  }

  private tick() {
    if (this.paused || this.ended) return;
    const actor = this.b.next;
    this.skipped = false;
    const events = step(this.b);
    this.steps++;
    let delay = this.play(events);
    // стата отключилась — следующий ход ждёт, пока надпись провисит
    if (events.some((e) => e.t === 'disable')) delay += DISABLE_MS[this.speed];
    // артефакт, нажатый перед своим ходом, срабатывает сразу после него — чтобы щит закрыл ход противника
    if (actor === 'player' && this.queuedArtifact !== null) {
      const k = this.queuedArtifact;
      this.queuedArtifact = null;
      const before = this.b.log.length;
      this.artifactUses.push({ after: this.steps, slot: k });
      if (useArtifact(this.b, 'player', k)) {
        const evs = this.b.log.slice(before);
        // показать после удара этого хода
        this.time.delayedCall(delay, () => {
          this.play(evs);
          this.refresh();
        });
        delay += 60;
      }
    }
    if (delay === 0) this.refresh();
    else this.refreshIndicator();
    if (this.b.over) {
      this.ended = true; // дальше ходов нет; итог — когда долетит последний удар
      this.time.delayedCall(delay, () => {
        this.ended = false;
        this.refresh();
        this.finish();
      });
      return;
    }
    this.schedule(Math.max(delay + 250, this.skipped ? SKIP_MS[this.speed] : TURN_MS[this.speed]));
  }

  private firstArtifact(): number {
    return this.b?.player.slots.findIndex((s) => s.type === 'Artifact' && s.ability) ?? -1;
  }

  private tryArtifact(k: number) {
    if (k < 0 || this.ended || !this.b) return;
    if (!canUseArtifact(this.b, 'player', k)) {
      this.push('Артефакт не готов: кулдаун или не хватает маны.', true);
      this.cameras.main.shake(100, 0.002);
      return;
    }
    if (this.b.next === 'player') {
      this.queuedArtifact = k;
      this.push(`Артефакт сработает после твоего хода.`);
    } else {
      const before = this.b.log.length;
      this.artifactUses.push({ after: this.steps, slot: k });
      useArtifact(this.b, 'player', k);
      this.play(this.b.log.slice(before));
    }
    this.refresh();
  }

  // ───────────── отрисовка событий ─────────────

  /**
   * Показать события хода. Удар проигрывается анимацией оружия, а урон и всё, что после, появляется
   * в момент попадания. Возвращает задержку до последнего попадания, мс.
   */
  private play(events: BattleEvent[]): number {
    const i = events.findIndex((e) => e.t === 'attack');
    if (i < 0) {
      this.present(events);
      return 0;
    }
    this.present(events.slice(0, i));
    const atk = events[i] as Extract<BattleEvent, { t: 'attack' }>;
    const sv = this.sides[atk.side];
    this.highlightSlot(atk.side, atk.slot);
    const j = events.findIndex((e, k) => k > i && e.t === 'attack');
    const now = j < 0 ? events.slice(i) : events.slice(i, j);
    const later = j < 0 ? [] : events.slice(j);
    const item = sv.fighter.slots[atk.slot]?.item;
    let rest = 0;
    this.pendingHits++;
    const slot = sv.fighter.slots[atk.slot];
    const ctx: AttackCtx = {
      itemId: item?.id,
      pattern: slot ? patternOf(slot) : undefined,
      target: this.layer3d ? (this.sides[atk.side === 'player' ? 'enemy' : 'player'].view as Fighter3D) : undefined,
      block: atk.block,
      outcome: atk.outcome,
      crit: atk.crit,
      effects: slot?.ability?.effects,
    };
    const hitMs = sv.view.playAttack(atk.slot, attackStyleOf(item?.id), ATTACK_MS[this.speed], () => {
      this.pendingHits--;
      if (!this.sys.isActive()) return;
      this.present(now);
      // следующий удар (вторая рука) начинается в момент попадания первого; до refresh — чтобы его кубы не погасли раньше
      if (later.length) this.play(later);
      this.refresh();
    }, ctx);
    if (later.length) rest = this.estimate(later);
    return hitMs + rest;
  }

  /** Сколько займут удары в событиях (для паузы до следующего хода). */
  private estimate(events: BattleEvent[]): number {
    return events.filter((e) => e.t === 'attack').length * ATTACK_MS[this.speed] * 0.62;
  }

  private present(events: BattleEvent[]) {
    for (const e of events) {
      switch (e.t) {
        case 'turn':
          this.active = e.side;
          this.sides.player.activeSlot = null;
          this.sides.enemy.activeSlot = null;
          this.turnText.setText(`ХОД ${e.turn} · ${e.side === 'player' ? this.b.player.name : this.b.enemy.name}`);
          this.refreshIndicator();
          break;
        case 'attack': {
          const atk = this.sides[e.side];
          const def = this.sides[e.side === 'player' ? 'enemy' : 'player'];
          void atk;
          this.lastCrit = e.outcome === 'hit' && e.crit;
          const where = def.view.blockWorldPos(e.block);
          if (e.outcome === 'evade') {
            def.view.playEvade(EVADE_MS[this.speed]);
            this.float(where.x, where.y, 'УВОРОТ', '#e6e2d8');
          }
          else if (e.outcome === 'shield') this.float(where.x, where.y, 'ЩИТ', '#7fb8ff');
          else if (e.crit) this.float(where.x, where.y - 20, 'КРИТ!', COLOR.title);
          if (def.view.struck) def.view.struck(e.block, e.outcome, e.crit);
          else if (e.outcome === 'hit') this.splash(where.x, where.y, e.crit);
          else if (e.outcome === 'shield') this.splash(where.x, where.y, false, 0x7fb8ff);
          this.push(this.describeAttack(e));
          break;
        }
        case 'damage': {
          const sv = this.sides[e.side];
          const p = sv.view.blockWorldPos(e.block);
          const crit = this.lastCrit && e.source === 'attack' && !e.spread;
          const color = e.source === 'burn' ? '#ff8a1f' : e.source === 'poison' ? '#7dff4f' : crit ? '#ffd21f' : e.spread ? '#ff7d6b' : '#ffffff';
          this.damageNumber(p.x, p.y, e.damage, color, e.spread, e.side);
          if (sv.view.damaged) sv.view.damaged(e.block, e.source, e.spread);
          else {
            sv.view.flashBlock(e.block, e.source === 'burn' ? 0xff8a2a : e.source === 'poison' ? 0x8af06a : 0xffffff);
            // осколки цвета куба: от удара — больше, от перетекшего урона и эффектов — меньше
            this.burst(p.x, p.y, STAT_COLOR[sv.fighter.blocks[e.block].stat], e.source === 'attack' && !e.spread ? 9 : 4, e.spread ? 0.6 : 1);
          }
          if (e.source !== 'attack' && !e.spread) this.push(`${this.who(e.side)}: ${EFFECTS[e.source].name.toLowerCase()} −${Math.round(e.damage)} блоку.`);
          break;
        }
        case 'break': {
          const sv = this.sides[e.side];
          if (!this.layer3d) {
            this.cameras.main.shake(80, 0.002);
            const p = sv.view.blockWorldPos(e.block);
            this.burst(p.x, p.y, STAT_COLOR[e.stat], 16, 1.5); // куб разлетелся
          }
          sv.shownAlive[e.block] = false;
          sv.view.setLookOf((i) => (sv.shownAlive[i] ? 'solid' : 'broken'));
          this.push(`${this.who(e.side)} теряет куб ${STAT_LABEL_GEN[e.stat]} (−1).`);
          break;
        }
        case 'stun': {
          const sv = this.sides[e.side];
          this.float(sv.baseX, 300, 'ОГЛУШЁН', COLOR.title, 30);
          if (this.layer3d) this.layer3d.arena.shake(0.5);
          else this.cameras.main.shake(160, 0.004);
          this.push(`${this.who(e.side)} оглушён — пропустит следующий ход.`);
          break;
        }
        case 'disable': {
          const sv = this.sides[e.side];
          if (!sv.shownDisabled.includes(e.stat)) sv.shownDisabled.push(e.stat);
          this.announce(e.side, e.stat);
          this.push(`${this.who(e.side)}: ${statDisabledTitle(e.stat).toLowerCase()} — ${disabledEffect(e.stat)}.`);
          break;
        }
        case 'effect':
          this.sides[e.side].view.setEffect?.(e.block, e.effect, true);
          if (!e.refreshed) this.push(`${this.who(e.side)}: ${EFFECTS[e.effect].name.toLowerCase()}${e.block === null ? '' : ' на блоке'}.`);
          break;
        case 'expire':
          this.sides[e.side].view.setEffect?.(e.block, e.effect, false);
          if (e.effect === 'shield') this.push(`${this.who(e.side)}: щит погас.`);
          break;
        case 'artifact':
          this.highlightSlot(e.side, e.slot);
          this.sides[e.side].view.playArtifact(e.slot, ARTIFACT_MS[this.speed]);
          this.push(`${this.who(e.side)} активирует «${e.item}».`);
          break;
        case 'skip': {
          this.skipped = true;
          const sv = this.sides[e.side];
          this.float(sv.baseX, 330, 'ПРОПУСК ХОДА', COLOR.lightQuiet, 22);
          const why = { blocked: 'под щитом — не атакует', stamina: 'не хватает выносливости', cooldown: 'всё в откате', nothing: 'нечем бить', stunned: 'оглушён' }[e.reason];
          this.push(`${this.who(e.side)} пропускает ход: ${why}.`, true);
          break;
        }
        case 'end':
          break;
      }
    }
  }

  /** Подсветить слот, которым боец действует в этом ходу. */
  private highlightSlot(side: Side, k: number) {
    const sv = this.sides[side];
    sv.activeSlot = k;
    this.refreshIndicator();
    const slot = sv.slots[k];
    if (!slot) return;
    this.tweens.killTweensOf(slot);
    slot.setScale(1);
    this.tweens.add({ targets: slot, scale: 1.15, duration: 120, yoyo: true });
  }

  private describeAttack(e: Extract<BattleEvent, { t: 'attack' }>): string {
    const who = this.who(e.side);
    if (e.outcome === 'evade') return `${who} — ${e.weapon}: промах, уворот.`;
    if (e.outcome === 'shield') return `${who} — ${e.weapon}: удар в щит.`;
    const armor = e.absorbed > 0.05 ? `, броня −${Math.round(e.absorbed)}` : '';
    return `${who} — ${e.weapon}: ${Math.round(e.damage * 10) / 10} урона${e.crit ? ' (крит ×2)' : ''}${armor}.`;
  }

  private who(side: Side) {
    return side === 'player' ? this.b.player.name : this.b.enemy.name;
  }

  /** Разлёт кубиков-осколков цвета куба: летят вверх-в стороны и падают, вращаясь. */
  private burst(x: number, y: number, color: number, count: number, power = 1) {
    for (let i = 0; i < count; i++) {
      const size = Phaser.Math.Between(4, 8) * (power > 1 ? 1.2 : 1);
      const k = Phaser.Math.FloatBetween(0.7, 1.25);
      const c = shade(color, k);
      const r = this.add.rectangle(x, y, size, size, c).setStrokeStyle(1, shade(color, 0.55), 0.9).setDepth(DEPTH.ui - 1);
      r.setAngle(Phaser.Math.Between(0, 90));
      const ang = Phaser.Math.FloatBetween(-Math.PI * 0.95, -Math.PI * 0.05); // вверх и в стороны
      const v = Phaser.Math.FloatBetween(90, 230) * power;
      const vx = Math.cos(ang) * v, vy = Math.sin(ang) * v;
      const g = 620;
      const life = Phaser.Math.Between(520, 820);
      const spin = Phaser.Math.Between(-540, 540);
      this.tweens.addCounter({
        from: 0,
        to: life / 1000,
        duration: life,
        onUpdate: (tw) => {
          const t = tw.getValue() ?? 0;
          r.setPosition(x + vx * t, y + vy * t + (g * t * t) / 2);
          r.setAngle(r.angle + spin / 60);
          r.setAlpha(Math.min(1, 2.2 * (1 - (t * 1000) / life)));
        },
        onComplete: () => r.destroy(),
      });
    }
  }

  /** Сплэш в месте удара: вспышка, кольцо и лучи. */
  private splash(x: number, y: number, crit: boolean, color = 0xffffff) {
    const g = this.add.graphics().setDepth(DEPTH.ui - 1);
    const rays = Array.from({ length: crit ? 10 : 7 }, (_, i) => (i / (crit ? 10 : 7)) * Math.PI * 2 + Phaser.Math.FloatBetween(-0.2, 0.2));
    const maxR = crit ? 78 : 56;
    this.tweens.addCounter({
      from: 0,
      to: 1,
      duration: crit ? 520 : 420,
      ease: 'Cubic.easeOut',
      onUpdate: (tw) => {
        const u = tw.getValue() ?? 0;
        const a = 1 - u;
        g.clear();
        g.fillStyle(color, 0.9 * a).fillCircle(x, y, 8 + 22 * u * (1 - u) * 4 * (crit ? 1.3 : 1));
        g.fillStyle(crit ? COLOR.highlight : 0xfff3c4, 0.5 * a).fillCircle(x, y, 4 + 30 * u);
        g.lineStyle(crit ? 5 : 4, crit ? COLOR.highlight : color, a).strokeCircle(x, y, maxR * u);
        g.lineStyle(crit ? 4 : 3, color, a);
        for (const t of rays) {
          const r0 = maxR * (0.25 + 0.6 * u), r1 = maxR * (0.45 + 0.75 * u);
          g.lineBetween(x + Math.cos(t) * r0, y + Math.sin(t) * r0 * 0.75, x + Math.cos(t) * r1, y + Math.sin(t) * r1 * 0.75);
        }
      },
      onComplete: () => g.destroy(),
    });
  }

  /**
   * Число урона летит по параболе «с физикой»: подпрыгивает от места попадания в сторону от атакующего
   * и падает. Чем больше урон — тем крупнее число и тем оно «тяжелее»: ниже прыжок, медленнее в сторону.
   */
  private damageNumber(x: number, y: number, dmg: number, color: string, spread: boolean, side: Side) {
    const v = Math.round(dmg * 10) / 10;
    const heavy = Phaser.Math.Clamp(dmg / 400, 0, 1); // 0 — лёгкое, 1 — тяжёлое (400+ урона; прочность куба — 100)
    const size = spread ? 18 : Math.round(24 + 26 * heavy);
    const t = text(this, x, y, `−${v}`, { kind: 'display', size, color })
      .setOrigin(0.5)
      .setStroke('#140a02', spread ? 4 : 6)
      .setShadow(0, 3, '#000000', 4, true, true)
      .setDepth(DEPTH.ui);
    // в сторону от атакующего: урон по противнику летит вправо, по игроку — влево
    const away = side === 'enemy' ? 1 : -1;
    const vx = away * Phaser.Math.FloatBetween(90, 170) * (1 - 0.6 * heavy) * (spread ? 1.2 : 1) + Phaser.Math.FloatBetween(-20, 20);
    const vy = -Phaser.Math.FloatBetween(400, 470) * (1 - 0.25 * heavy) * (spread ? 0.8 : 1);
    const g = 800 + 200 * heavy; // тяжёлое падает быстрее
    const life = 1050;
    t.setScale(0.4);
    this.tweens.add({ targets: t, scale: 1, duration: 140, ease: 'Back.easeOut' });
    // парабола без отскоков; лёгкое число крутится сильнее, тяжёлое почти не крутится
    const spin = away * Phaser.Math.FloatBetween(30, 90) * (1 - heavy);
    this.tweens.addCounter({
      from: 0,
      to: life / 1000,
      duration: life,
      onUpdate: (tw) => {
        const s = tw.getValue() ?? 0;
        t.setPosition(x + vx * s, y + vy * s + (g * s * s) / 2);
        t.setAngle(spin * s);
        t.setAlpha(Math.min(1, (1 - (s * 1000) / life) * 3));
      },
      onComplete: () => t.destroy(),
    });
  }

  /** Крупная надпись над моделью: стата отключена порогом. */
  private announce(side: Side, stat: Stat) {
    const sv = this.sides[side];
    const hex = `#${STAT_COLOR[stat].toString(16).padStart(6, '0')}`;
    const box = this.add.container(sv.baseX, 246).setDepth(DEPTH.ui + 1);
    const title = text(this, 0, 0, statDisabledTitle(stat).toUpperCase(), { kind: 'display', size: 34, color: hex }).setOrigin(0.5).setStroke('#000000', 6);
    const sub = text(this, 0, 32, disabledEffect(stat), { size: 16, color: COLOR.light }).setOrigin(0.5).setStroke('#000000', 4);
    box.add([title, sub]).setScale(0.6).setAlpha(0);
    const total = DISABLE_MS[this.speed];
    this.tweens.add({ targets: box, scale: 1, alpha: 1, duration: 180, ease: 'Back.easeOut' });
    this.tweens.add({ targets: box, alpha: 0, y: 226, delay: total - 320, duration: 320, ease: 'Cubic.easeIn', onComplete: () => box.destroy() });
    this.cameras.main.shake(140, 0.003);
  }

  /** Строка под именем: «крит X% · уворот Y%», отключённое — цветом поражения. */
  private drawCritDodge(sv: SideView) {
    const f = sv.fighter;
    const offLuck = sv.shownDisabled.includes('Luck') || critOf(f) === 0;
    const offDex = sv.shownDisabled.includes('Dexterity') || dodgeOf(f) === 0;
    sv.critText.setText(`крит ${offLuck ? 0 : (critOf(f) * 100).toFixed(1)}%`).setColor(offLuck ? COLOR.lose : COLOR.lightQuiet);
    sv.dodgeText.setText(`уворот ${offDex ? 0 : (dodgeOf(f) * 100).toFixed(1)}%`).setColor(offDex ? COLOR.lose : COLOR.lightQuiet);
    const gap = 10;
    if (sv.right) sv.critText.setX(sv.edge - sv.dodgeText.width - gap);
    else sv.dodgeText.setX(sv.edge + sv.critText.width + gap);
  }

  /** Иконки под барами: отключённые статы, затем эффекты. Перестраиваются только при смене набора. */
  private drawStatus(sv: SideView) {
    const f = sv.fighter;
    const icons: StatusIcon[] = sv.shownDisabled.map((s) => ({
      key: `off-${s}`,
      label: STAT_SHORT[s],
      color: STAT_COLOR[s],
      slash: true,
      tooltip: () => ({
        title: statDisabledTitle(s),
        rows: [
          ['Потеряно', disabledEffect(s), COLOR.lose],
          ['Кубы', `разбито ${f.cubeBroken[s]} из ${f.cubeTotals[s]}`],
          ['Порог', `больше ${Math.round(THRESHOLDS.share * 100)}% кубов`],
        ],
        note: 'До конца боя.',
      }),
    }));
    for (const id of ['shield', 'burn', 'poison', 'freeze'] as EffectId[]) {
      const list = f.effects.filter((e) => e.id === id);
      if (!list.length) continue;
      icons.push({
        key: `fx-${id}-${list.length}`,
        label: EFFECT_ICON[id].label,
        color: EFFECT_ICON[id].color,
        count: list.length > 1 ? list.length : undefined,
        tooltip: () => ({
          title: EFFECTS[id].name,
          rows: [
            ...(id === 'shield' ? [] : ([['Блоков', String(f.effects.filter((e) => e.id === id).length)]] as Array<[string, string]>)),
            ['Осталось', turns(Math.max(0, ...f.effects.filter((e) => e.id === id).map((e) => e.remaining)))],
          ],
          note: id === 'shield' ? 'Физический урон не проходит, но владелец не атакует, пока стоит купол.' : `${effectParts(id).join('; ')}.`,
        }),
      });
    }
    if (f.stunned) icons.push({ key: 'stun', label: 'ОГЛ', color: 0xc9a227, tooltip: () => ({ title: 'Оглушён', note: 'Пропустит свой следующий ход (булава ур. 2–3).' }) });
    const key = icons.map((i) => i.key).join('|');
    if (key === sv.statusKey) return;
    sv.statusKey = key;
    Tooltip.for(this).hide();
    sv.status.removeAll(true);
    icons.forEach((ic, k) => {
      const step = ICON.w + ICON.gap;
      const x = sv.right ? sv.edge - ICON.w - k * step : sv.edge + k * step;
      const g = this.add.graphics();
      g.fillStyle(0x16171a, 0.9).fillRoundedRect(x, 0, ICON.w, ICON.h, 4);
      g.fillStyle(ic.color, 1).fillRoundedRect(x + 2, 2, ICON.w - 4, ICON.h - 4, 3);
      const label = text(this, x + ICON.w / 2, ICON.h / 2, ic.label, { kind: 'mono', size: 11, weight: 700, color: '#ffffff' }).setOrigin(0.5).setStroke('#000000', 3);
      const parts: Phaser.GameObjects.GameObject[] = [g, label];
      if (ic.slash) {
        // перечёркнуто: тёмная подложка + светлая черта, видна на любом цвете статы
        g.lineStyle(5, 0x000000, 0.85).lineBetween(x + 4, ICON.h - 3, x + ICON.w - 4, 3);
        g.lineStyle(2, 0xffffff, 1).lineBetween(x + 4, ICON.h - 3, x + ICON.w - 4, 3);
      }
      if (ic.count) parts.push(text(this, x + ICON.w - 2, ICON.h + 1, `×${ic.count}`, { kind: 'mono', size: 10, weight: 700, color: COLOR.light }).setOrigin(1, 0.5).setStroke('#000000', 3));
      const hit = this.add.rectangle(x, 0, ICON.w, ICON.h, 0x000000, 0).setOrigin(0).setInteractive();
      attachTooltip(hit, ic.tooltip);
      parts.push(hit);
      sv.status.add(parts);
    });
  }

  private float(x: number, y: number, s: string, color: string, size = 20) {
    const t = text(this, x, y, s, { kind: 'display', size, color }).setOrigin(0.5).setStroke('#000000', 4).setDepth(DEPTH.ui);
    this.tweens.add({ targets: t, y: y - 46, alpha: 0, duration: 900, ease: 'Cubic.easeOut', onComplete: () => t.destroy() });
  }

  private push(line: string, quiet = false) {
    this.lines.push(quiet ? `· ${line}` : line);
    if (this.lines.length > 6) this.lines.splice(0, this.lines.length - 6);
    this.logText?.setText(this.lines.join('\n'));
  }

  private refresh() {
    for (const side of ['player', 'enemy'] as Side[]) {
      const sv = this.sides[side];
      const f = sv.fighter;
      // полоска КБ — по показанным кубам: уменьшается в момент попадания, а не раньше
      sv.hp.set(sv.shownAlive.filter(Boolean).length, f.blocks.length);
      sv.st.set(f.stamina, f.maxStamina);
      sv.mp.set(f.mana, f.maxMana);
      // разбитые кубы перестают закрывать грани соседей — пересчитать видимость, иначе останутся дыры
      const alive = f.blocks.map((b) => (b.alive ? 1 : 0)).join('');
      if (alive !== sv.aliveKey && this.pendingHits === 0) {
        // догнать состояние, когда все удары хода уже показаны (страховка — обычно кубы гасит событие break)
        sv.aliveKey = alive;
        f.blocks.forEach((b, i) => (sv.shownAlive[i] = b.alive));
        sv.view.setLookOf((i) => (sv.shownAlive[i] ? 'solid' : 'broken'));
      } else sv.view.redraw();
      f.slots.forEach((s, k) => sv.cds[k].setText(s.ability && s.cooldown > 0 ? String(s.cooldown) : ''));
      this.drawCritDodge(sv);
      this.drawStatus(sv);
      if (sv.targets) this.drawTargets(sv, side === 'enemy' ? this.b.player.target : this.b.enemy.target);
    }
    this.refreshIndicator();
  }

  /**
   * Полоса целей бойца: по сегменту на каждую его стату в порядке атаки соперника, ширина — доля кубов,
   * заливка — живые кубы (по показанному на экране состоянию). Стрелка — над статой, которую бьют сейчас.
   */
  private drawTargets(sv: SideView, order: readonly Stat[]) {
    const box = sv.targets!;
    box.removeAll(true);
    const f = sv.fighter;
    const total = f.blocks.length;
    const H = 18;
    const gap = 3;
    const segs = order
      .map((st) => {
        const idx = f.blocks.filter((b) => b.stat === st).map((b) => b.index);
        return { st, n: idx.length, alive: idx.filter((i) => sv.shownAlive[i]).length };
      })
      .filter((x) => x.n > 0);
    const current = segs.find((x) => x.alive > 0)?.st;
    const usable = BAR_W - gap * (segs.length - 1);
    const g = this.add.graphics();
    box.add(g);
    let x = 0;
    for (const sg of segs) {
      const w = (usable * sg.n) / total;
      const c = STAT_COLOR[sg.st];
      g.fillStyle(c, 0.22).fillRect(x, 0, w, H);
      g.fillStyle(c, 1).fillRect(x, 0, (w * sg.alive) / sg.n, H);
      const on = sg.st === current;
      g.lineStyle(on ? 2 : 1, on ? COLOR.highlight : 0x000000, on ? 1 : 0.35).strokeRect(x, 0, w, H);
      if (w > 34) box.add(text(this, x + w / 2, H / 2, w > 70 ? `${STAT_SHORT[sg.st]} ${sg.alive}/${sg.n}` : `${sg.alive}`, { kind: 'mono', size: 10, weight: 700, color: '#ffffff' }).setOrigin(0.5).setStroke('#000000', 3));
      if (on) g.fillStyle(COLOR.highlight, 1).fillTriangle(x + w / 2 - 6, H + 9, x + w / 2 + 6, H + 9, x + w / 2, H + 2);
      x += w + gap;
    }
  }

  /** Чей ход, подсветка слота этого хода и готовность артефактов. */
  private refreshIndicator() {
    for (const side of ['player', 'enemy'] as Side[]) {
      const sv = this.sides[side];
      const f = sv.fighter;
      const isActive = this.active === side && !this.b.over;
      sv.name.setColor(isActive ? COLOR.title : COLOR.lightQuiet);
      sv.marker.setVisible(isActive);
      f.slots.forEach((s, k) => {
        let accent: number | null = null;
        if (side === 'player' && s.type === 'Artifact' && s.ability) {
          accent = this.queuedArtifact === k ? COLOR.highlight : canUseArtifact(this.b, 'player', k) ? 0x3f9a3a : null;
        }
        if (sv.activeSlot === k) accent = COLOR.highlight; // способность этого хода
        sv.slots[k].setAccent(accent);
      });
    }
  }

  // ───────────── пауза и конец ─────────────

  private speedCaption() {
    return `Скорость ×${this.speed + 1}`;
  }

  /** Скорость боя ×1 / ×2: действует со следующего хода, запоминается на следующие бои. */
  private toggleSpeed() {
    this.speed = 1 - this.speed;
    this.registry.set('battle.speed', this.speed);
    this.speedBtn.setCaption(this.speedCaption());
  }

  /** Меню боя (бургер / ESC): пауза, скорость, сдаться, выйти. */
  private pause() {
    if (this.time.now - this.resumedAt < 150) return; // тот же ESC, что закрыл окно
    if (this.children.list.some((o) => o instanceof Modal)) return; // уже открыто окно
    // бой окончен (итог закрыли крестиком или он ещё не показан) — бургер открывает итог
    if (this.ended) return this.showResult();
    this.paused = true;
    const m = new Modal(this, { title: 'Пауза', width: 440, height: 426, onClose: () => this.resume() });
    const w = m.card.innerW;
    const add = (o: Phaser.GameObjects.GameObject) => m.card.content.add(o);
    add(text(this, w / 2, 0, `Ход ${this.b.turn} · seed ${this.b.seed}`, { kind: 'mono', size: 13, color: COLOR.inkQuiet }).setOrigin(0.5, 0));
    add(new Button(this, w / 2, 56, 'Продолжить', { width: w, height: 52, onClick: () => m.close() }));
    const sp = new Button(this, w / 2, 116, this.speedCaption(), { variant: 'beige', width: w, height: 46, size: 20 });
    sp.setOnClick(() => {
      this.toggleSpeed();
      sp.setCaption(this.speedCaption());
    });
    add(sp);
    add(
      new Button(this, w / 2, 172, 'Сдаться', {
        variant: 'beige',
        width: w,
        height: 46,
        size: 20,
        onClick: () => {
          m.destroy();
          this.b.over = { winner: 'enemy', reason: 'death' };
          this.push('Ты сдался.');
          this.finish(true);
        },
      }),
    );
    add(
      new Button(this, w / 2, 228, 'Выйти с арены', {
        variant: 'beige',
        width: w,
        height: 46,
        size: 20,
        onClick: () => {
          m.destroy();
          this.paused = false; // подтверждение само поставит паузу и снимет её по «Остаться»
          this.confirmLeave();
        },
      }),
    );
    const renderCaption = () => `Бой: ${render3dEnabled() ? '3D' : '2D'}${render3dEnabled() === !!this.layer3d ? '' : ' · со следующего боя'}`;
    const rb = new Button(this, w / 2, 284, renderCaption(), { variant: 'beige', width: w, height: 46, size: 20 });
    rb.setOnClick(() => {
      try {
        localStorage.setItem(RENDER_KEY, render3dEnabled() ? '0' : '1');
      } catch {
        return;
      }
      rb.setCaption(renderCaption());
    });
    add(rb);
    add(text(this, w / 2, 322, 'ESC — меню · пробел — артефакт', { size: 12, color: COLOR.inkQuiet }).setOrigin(0.5, 0));
  }

  /** Выход с арены посреди боя — засчитывается поражением (в прототипе ни на что не влияет). */
  private confirmLeave() {
    if (this.ended) return this.go(SCENE.menu);
    const wasPaused = this.paused;
    this.paused = true;
    const m = new Modal(this, {
      title: 'Выйти с арены?',
      width: 480,
      height: 260,
      onClose: () => {
        if (!wasPaused) this.resume();
      },
    });
    const w = m.card.innerW;
    const inSeries = !!store.state.arenaRun;
    m.card.content.add(text(this, w / 2, 10, inSeries && lossRule(this.mode) === 'drop' ? 'Серия закончится поражением —\nоружие в руках и рюкзак пропадут.' : inSeries ? 'Серия закончится поражением.' : 'Бой будет засчитан поражением.', { size: 16, align: 'center' }).setOrigin(0.5, 0));
    m.card.content.add(new Button(this, w / 2 - 105, 110, 'Остаться', { variant: 'beige', width: 190, height: 48, size: 20, onClick: () => m.close() }));
    m.card.content.add(
      new Button(this, w / 2 + 105, 110, 'Выйти', {
        width: 190,
        height: 48,
        size: 20,
        onClick: () => {
          // выход посреди боя — поражение со всеми последствиями серии
          if (!this.b.over) this.b.over = { winner: 'enemy', reason: 'death' };
          this.settle();
          // выход с арены — конец серии, повторы не тратятся
          if (this.outcome?.retry) store.act('surrenderRun');
          this.go(SCENE.menu);
        },
      }),
    );
  }

  private resume() {
    if (!this.paused) return;
    this.paused = false;
    this.resumedAt = this.time.now;
    if (!this.ended) this.schedule(250);
  }

  private finish(surrender = false) {
    if (this.ended) return;
    this.ended = true;
    this.timer?.remove();
    this.surrendered = surrender;
    this.settle();
    // проигравший рассыпается; окно итога — когда он осыплется, с паузой
    const loser = this.b.over?.winner === 'player' ? 'enemy' : 'player';
    const crumble = this.sides[loser].view.playCrumble(CRUMBLE_MS[this.speed]);
    this.time.delayedCall(crumble + RESULT_PAUSE_MS[this.speed], () => this.sys.isActive() && this.showResult());
  }

  /** Подвести итог боя в серии: поломки бойца, осколки, лут или потери. Один раз. */
  private settle() {
    if (this.outcome !== undefined || !this.b?.over) return;
    // на сервер уходит не итог, а ввод игрока: артефакты и ход, на котором он сдался или вышел;
    // бой пересчитывается тем же кодом — здесь (для окна результата) и на сервере
    const natural = this.b.log.some((ev) => ev.t === 'end');
    const inputs: FightInputs = { artifacts: this.artifactUses, ...(natural ? {} : { stopAfter: this.steps }) };
    const out = resolveFight(store.state, inputs);
    if (out) store.act('finishFight', inputs);
    this.outcome = out;
  }

  /** Окно итога боя; можно закрыть и открыть снова бургером. */
  private showResult() {
    if (!this.b?.over || this.children.list.some((o) => o instanceof Modal)) return;
    const win = this.b.over.winner === 'player';
    const out = this.outcome ?? null;
    const looting = win && !!out;
    // итог закрывается только кнопками
    const m = new Modal(this, { title: win ? 'Победа' : 'Поражение', width: looting ? 780 : 640, height: looting ? (out?.reward ? 690 : 600) : 420, closable: false });
    const body = this.add.container(0, 0);
    m.card.content.add(body);
    const render = () => {
      body.removeAll(true);
      this.resultBody(m, body, render);
    };
    render();
    if (looting || out?.retry) {
      const unsub = store.subscribe(() => m.active && render());
      m.once(Phaser.GameObjects.Events.DESTROY, unsub);
    }
  }

  private resultBody(m: Modal, body: Phaser.GameObjects.Container, rerender: () => void) {
    const win = this.b.over!.winner === 'player';
    const reason = this.surrendered ? 'сдача' : this.b.over!.reason === 'turns' ? `лимит ${this.b.turn} ходов — по живым кубам` : 'все кубы разбиты';
    const out = this.outcome ?? null;
    const w = m.card.innerW;
    const add = (o: Phaser.GameObjects.GameObject) => body.add(o);
    const p = this.b.player;
    add(text(this, w / 2, 0, win ? 'ПОБЕДА' : 'ПОРАЖЕНИЕ', { kind: 'display', size: 44, color: win ? COLOR.win : COLOR.lose }).setOrigin(0.5, 0));
    const pend = this.rival ? store.state.pvpPending : null;
    const ratingNote = this.rival && pend ? ` · рейтинг ${pend.delta > 0 ? '+' : ''}${pend.delta} → ${store.state.rating ?? RATING_START}` : '';
    add(text(this, w / 2, 56, `${reason} · ходов: ${this.b.turn} · кубы бойца: ${p.aliveBlocks}/${p.blocks.length}${ratingNote}`, { size: 14, align: 'center' }).setOrigin(0.5, 0));
    let y = 92;
    if (win && out) {
      if (out.reward) y = this.rewardSection(body, w, y, out.reward);
      y = this.lootSection(body, w, y, rerender);
      if (out.reward) {
        add(text(this, 0, y, 'Серия окончена — разбитые кубы начнут восстанавливаться. Лут забери в рюкзак до выхода.', { size: 13, color: COLOR.inkQuiet, wrap: w }));
      } else {
        const left = SERIES_LENGTH - (store.state.arenaRun?.wins ?? 0);
        add(text(this, 0, y, `До награды серии ${left === 1 ? 'остался 1 бой' : `осталось ${left} боя`}. На арене разбитые кубы не чинятся — только зелья из рюкзака.`, { size: 13, color: COLOR.inkQuiet, wrap: w }));
      }
    } else {
      const lines: Array<[string, string]> = [];
      if (!win && out?.retry) {
        const left = retriesLeft(store.state.arenaRun);
        lines.push(['Повтор', `Бой можно переиграть: тот же противник, боец вернётся как до боя, ничего не пропадёт. Осталось повторов: ${left} из ${seriesRetries()}.`]);
        lines.push(['Сдаться', lossRule(this.mode) === 'keep' ? 'Серия закончится поражением; оружие и рюкзак останутся у бойца.' : 'Серия закончится поражением: оружие в руках и рюкзак с содержимым пропадут.']);
      } else if (!win && out) {
        const names = out.lost.map((id) => (hasItem(id) ? getItem(id).name : id));
        const keep = lossRule(this.mode) === 'keep';
        lines.push(['Потеряно', names.length ? names.join(', ') : keep ? 'ничего — в серии с ботами при поражении всё остаётся у бойца' : 'ничего — оружия и рюкзака не было']);
        if (this.mode === 'players') lines.push(['', `Серия с игроками закончена: повторов в ней нет.${this.rival ? ` ${this.rival.name} получит награду за отбитое нападение.` : ''}`]);
        else if (!this.surrenderedRun) lines.push(['', `Повторы серии кончились (${seriesRetries()} из ${seriesRetries()}).`]);
      } else lines.push(['', 'Бой вне серии — итог не сохраняется.']);
      for (const [k, v] of lines) {
        add(text(this, 0, y, k, { size: 14, weight: 700 }));
        const t = text(this, 110, y, v, { size: 14, wrap: w - 110 });
        add(t);
        y += Math.max(24, t.height + 8);
      }
    }
    const by = m.card.innerH - 34;
    if (win && out?.reward) {
      // серия закрыта: забрать лут, выпить/переложить из рюкзака и в меню
      if (this.loot.length) add(text(this, w / 2, by - 44, 'Незабранный лут пропадёт.', { size: 12, color: COLOR.lose }).setOrigin(0.5, 0));
      add(
        new Button(this, w / 2 - 105, by, 'Рюкзак', {
          variant: 'beige', width: 190, height: 50, size: 20,
          onClick: () => openRucksack(this, this.data_.charUid),
        }),
      );
      add(new Button(this, w / 2 + 105, by, 'В меню', { width: 190, height: 50, size: 20, onClick: () => this.go(SCENE.menu) }));
    } else if (win && out) {
      const left = this.loot.length;
      const warn = left ? ' Незабранный лут пропадёт.' : '';
      add(
        new Button(this, w / 2 - 205, by, 'Забрать и выйти', {
          variant: 'beige', width: 190, height: 50, size: 17,
          onClick: () => {
            store.act('endRun');
            this.go(SCENE.menu);
          },
        }),
      );
      add(
        new Button(this, w / 2, by, 'Рюкзак', {
          variant: 'beige', width: 190, height: 50, size: 20,
          onClick: () => openRucksack(this, this.data_.charUid, { note: 'Между боями: выпить зелье, сменить оружие.' }),
        }),
      );
      add(
        new Button(this, w / 2 + 205, by, this.mode === 'players' ? 'Следующий соперник' : 'Следующий бой', {
          width: 190, height: 50, size: 18,
          onClick: () => this.go(SCENE.opponent, { charUid: this.data_.charUid } satisfies OpponentSceneData),
        }),
      );
      if (warn) add(text(this, w / 2, by - 44, warn.trim(), { size: 12, color: COLOR.lose }).setOrigin(0.5, 0));
    } else if (!win && out?.retry) {
      add(
        new Button(this, w / 2 - 105, by, 'Сдаться', {
          variant: 'beige', width: 190, height: 50, size: 20,
          onClick: () => {
            const res = surrenderRun(store.state);
            if (!res || !store.act('surrenderRun')) return;
            this.outcome = res;
            this.surrenderedRun = true;
            rerender();
          },
        }),
      );
      add(
        new Button(this, w / 2 + 105, by, 'Повторить бой', {
          width: 190, height: 50, size: 20,
          onClick: () => this.go(SCENE.opponent, { charUid: this.data_.charUid } satisfies OpponentSceneData),
        }),
      );
    } else {
      add(new Button(this, w / 2 - 105, by, out ? 'В лобби' : 'В меню', { variant: 'beige', width: 190, height: 50, size: 20, onClick: () => this.go(SCENE.menu) }));
      add(
        new Button(this, w / 2 + 105, by, 'Персонаж', {
          width: 190, height: 50, size: 20,
          onClick: () => this.go(SCENE.characters, { charUid: this.data_.charUid } satisfies CharactersSceneData),
        }),
      );
    }
  }

  /**
   * Лут: ячейки врага (оружие, артефакты, рюкзак, осколки) и свой рюкзак.
   * Перетащить в ячейку рюкзака — положить туда; клик — в первую подходящую. Возвращает y под секцией.
   */
  /** Награда серии — ячейками по центру под заголовком, как лут; она уже в инвентаре, ячейки только показывают. */
  private rewardSection(body: Phaser.GameObjects.Container, w: number, y0: number, reward: SeriesReward): number {
    const entries = [{ itemId: CUBE_ID, count: reward.cubes }, ...reward.items].filter((e) => hasItem(e.itemId) && e.count > 0);
    body.add(text(this, w / 2, y0, 'СЕРИЯ ПРОЙДЕНА · НАГРАДА УЖЕ В ИНВЕНТАРЕ', { size: 12, weight: 700, color: COLOR.win, letterSpacing: 1 }).setOrigin(0.5, 0));
    const top = y0 + 20;
    const left = (w - (entries.length * LOOT_CELL + (entries.length - 1) * LOOT_GAP)) / 2;
    entries.forEach((e, k) => {
      const it = getItem(e.itemId);
      const slot = new Slot(this, left + LOOT_CELL / 2 + k * (LOOT_CELL + LOOT_GAP), top + LOOT_CELL / 2, {
        size: LOOT_CELL,
        tooltip: () => ({ title: `${it.name} ×${e.count}`, note: `${itemDescription(it)}\n\nНаграда за серию — уже в инвентаре.` }),
      });
      slot.setContent(createItemIcon(this, it, LOOT_CELL - 18), e.count);
      body.add(slot);
    });
    return top + LOOT_CELL + 12;
  }

  private lootSection(body: Phaser.GameObjects.Container, w: number, y0: number, rerender: () => void): number {
    const CELL = LOOT_CELL;
    const GAP = LOOT_GAP;
    const perRow = Math.floor((w + GAP) / (CELL + GAP));
    const c = store.state.characters.find((x) => x.uid === this.data_.charUid);
    const bag = c ? bagSlots(c) : [];
    const tooltipOf = (e: { itemId: string; level?: number }) => {
      const it = itemOf(e);
      return withUpgrade({ title: it.name, rows: itemRows(it).map((r) => [r.label, r.value, r.color] as [string, string, string?]), note: itemDescription(it) } as TooltipContent, it);
    };
    const take = (k: number, cell?: number) => {
      const e = this.loot[k];
      if (!e) return;
      if (!store.act('lootTake', k, cell)) return this.cameras.main.shake(100, 0.002);
      rerender();
    };

    let y = y0;
    body.add(text(this, 0, y, `ЛУТ ВРАГА${this.loot.length ? ' · перетащи в рюкзак, клик — в первую свободную ячейку' : ''}`, { size: 12, color: COLOR.inkQuiet, letterSpacing: 1 }));
    y += 20;
    const lootCells: Slot[] = [];
    if (!this.loot.length) {
      body.add(text(this, 0, y + 4, 'Всё забрано.', { size: 14 }));
      y += 34;
    } else {
      this.loot.forEach((e, k) => {
        const it = itemOf(e);
        const slot = new Slot(this, CELL / 2 + (k % perRow) * (CELL + GAP), y + CELL / 2 + Math.floor(k / perRow) * (CELL + GAP), {
          size: CELL,
          tooltip: () => tooltipOf(e),
          onClick: () => take(k),
        });
        slot.setContent(createItemIcon(this, it, CELL - 18), e.count).setItemGems(it);
        body.add(slot);
        lootCells.push(slot);
      });
      y += Math.ceil(this.loot.length / perRow) * (CELL + GAP) + 6;
    }

    body.add(text(this, 0, y, bag.length ? `ТВОЙ РЮКЗАК · ${bag.filter(Boolean).length}/${bag.length}` : 'РЮКЗАКА НЕТ — ЛУТ НЕКУДА ПОЛОЖИТЬ', { size: 12, color: bag.length ? COLOR.inkQuiet : COLOR.lose, letterSpacing: 1 }));
    y += 20;
    // выбросить из рюкзака — вещь ложится к луту врага: пока не ушёл с экрана, её можно забрать обратно
    const drop = (k: number) => {
      if (!store.act('lootDrop', k)) return;
      rerender();
    };
    const bagCells: Slot[] = [];
    bag.forEach((e, k) => {
      const x = CELL / 2 + (k % perRow) * (CELL + GAP);
      const cy = y + CELL / 2 + Math.floor(k / perRow) * (CELL + GAP);
      const slot = new Slot(this, x, cy, { size: CELL, tooltip: () => (e ? { ...tooltipOf(e), note: `${tooltipOf(e).note ?? ''}\n× или перетащить к луту врага — выбросить.`.trim() } : null) });
      if (e) slot.setContent(createItemIcon(this, itemOf(e), CELL - 18), e.count).setItemGems(itemOf(e));
      body.add(slot);
      bagCells.push(slot);
      if (e) body.add(crossButton(this, x + CELL / 2 - 7, cy - CELL / 2 + 7, () => drop(k), 'Выбросить (ляжет к луту врага)', 8));
    });
    if (bag.length) y += Math.ceil(bag.length / perRow) * (CELL + GAP) + 6;
    // из лута — в выбранную ячейку рюкзака; внутри рюкзака — переложить; из рюкзака к луту — выбросить
    enableSlotDrag(this, lootCells, this.loot.map((e) => itemOf(e)), CELL - 18, (from, to) => take(from, to), bagCells);
    enableSlotDrag(this, bagCells, bag.map((e) => (e ? itemOf(e) : null)), CELL - 18, (from, to) => {
      if (to < bagCells.length) {
        if (to !== from) store.act('moveInBag', this.data_.charUid, from, to);
      } else drop(from);
    }, [...bagCells, ...lootCells]);
    return y;
  }
}
