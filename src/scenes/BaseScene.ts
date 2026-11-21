import Phaser from 'phaser';
import { cubeCount } from '../core/state';
import type { CraftTarget } from '../core/craftTarget';
import { isDragRelease } from '../ui/dragGuard';
import { drawArenaBackground } from '../ui/Background';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';
import { isTyping } from '../ui/TextField';
import { attachTooltip } from '../ui/Tooltip';
import { text } from '../ui/text';
import { COLOR, GAME_W } from '../ui/theme';
import { canUseFullscreen, toggleFullscreen } from '../mobile';
import { SCENE, type SceneKey } from './keys';
import { store } from '../game/store';
import type { PlayerState } from '../core/state';
import { panel, type Card } from '../ui/Panel';
import { getBlueprint, getItem, hasItem } from '../data/catalog';
import { Pager } from '../ui/Pager';
import { VoxelView } from '../ui/VoxelView';
import { skinColorOf, skinPatternOf } from '../data/skins';
import { STAT_COLOR } from '../ui/theme';
import type { OpponentSceneData } from './keys';

export interface HeaderOpts {
  title: string;
  titleY?: number;
  /** Мелкая строка над заголовком, как «БОЙ 1 / 1». */
  kicker?: string;
  /** Подзаголовок под заголовком. */
  subtitle?: string;
  /** Куда ведёт кнопка «Назад» и ESC. null — кнопки нет. */
  back?: SceneKey | null;
  /** Активная вкладка верхнего меню. С ней вместо заголовка и «В меню» — табы на все разделы. */
  tab?: NavTab;
}

export type NavTab = 'menu' | 'inventory' | 'blueprints' | 'characters' | 'arena' | 'rating';

// первый экран и есть «Арена»: активный боец и «В бой»; экран противника подсвечивает его же
const NAV: Array<[NavTab, string]> = [
  ['menu', 'Арена'],
  ['inventory', 'Инвентарь'],
  ['blueprints', 'Чертежи'],
  ['characters', 'Персонажи'],
  ['rating', 'Рейтинг'],
];
const NAV_W = 168;
const NAV_GAP = 8;

const FADE_MS = 140;
const CRAFT_TARGET_KEY = 'craft.target';

/** Общая основа экранов: фон-сетка, шапка, переходы с затемнением. */
export abstract class BaseScene extends Phaser.Scene {
  private leaving = false;

  protected setupScreen(opts: HeaderOpts) {
    this.leaving = false;
    // контекст сборки живёт только в «Чертежах» и крафте — любой другой экран его сбрасывает
    if (this.scene.key !== SCENE.blueprints && this.scene.key !== SCENE.craft) this.setCraftTarget(null);
    drawArenaBackground(this);
    this.cameras.main.fadeIn(FADE_MS, 0, 0, 0);

    if (opts.tab) {
      this.navTabs(opts.tab);
      // заголовок — активная вкладка; строка под табами — кикер и подзаголовок
      const sub = [opts.kicker, opts.subtitle].filter(Boolean).join(' · ');
      if (sub) text(this, GAME_W / 2, 98, sub, { size: 17, color: COLOR.light }).setOrigin(0.5, 0);
    } else {
      if (opts.kicker) text(this, GAME_W / 2, 26, opts.kicker, { size: 18, color: COLOR.lightQuiet, letterSpacing: 1 }).setOrigin(0.5, 0);
      text(this, GAME_W / 2, opts.titleY ?? 46, opts.title, { kind: 'display', size: 52, color: COLOR.title }).setOrigin(0.5, 0);
      if (opts.subtitle) text(this, GAME_W / 2, 108, opts.subtitle, { size: 18, color: COLOR.light }).setOrigin(0.5, 0);
    }

    const back = opts.back === undefined ? (opts.tab ? null : SCENE.menu) : opts.back;
    if (back) {
      new Button(this, 96, 52, back === SCENE.menu ? 'В меню' : 'Назад', {
        variant: 'beige',
        width: 150,
        height: 46,
        onClick: () => this.go(back),
      });
      this.input.keyboard?.on('keydown-ESC', () => {
        // открытая модалка сама обработает ESC
        if (!this.children.list.some((c) => c instanceof Modal) && !isTyping(this)) this.go(back);
      });
    }
    if (canUseFullscreen()) {
      const icon = this.add.graphics().setPosition(GAME_W - 24, 46).setDepth(2);
      const draw = (color: number) => {
        icon.clear().lineStyle(3, color, 1);
        for (const [x1, y1, x2, y2] of [
          [-12, -5, -12, -12], [-12, -12, -5, -12],
          [5, -12, 12, -12], [12, -12, 12, -5],
          [-12, 5, -12, 12], [-12, 12, -5, 12],
          [12, 5, 12, 12], [5, 12, 12, 12],
        ]) icon.lineBetween(x1, y1, x2, y2);
      };
      draw(0xa9a7a2);
      const hit = this.add.zone(GAME_W - 24, 46, 44, 44).setInteractive({ useHandCursor: true }).setDepth(2);
      hit.on('pointerover', () => draw(COLOR.highlight));
      hit.on('pointerout', () => draw(0xa9a7a2));
      hit.on('pointerup', () => { if (!isDragRelease(this)) void toggleFullscreen(); });
      attachTooltip(hit, () => ({ title: document.fullscreenElement ? 'Выйти из полноэкранного режима' : 'На весь экран' }));
    }
  }

  /** Верхнее меню-табы: из любого раздела в любой. */
  private navTabs(active: NavTab) {
    const x0 = GAME_W / 2 - (NAV.length * NAV_W + (NAV.length - 1) * NAV_GAP) / 2 + NAV_W / 2;
    NAV.forEach(([tab, label], i) => {
      const on = tab === active || (tab === 'menu' && active === 'arena');
      const run = store.state.arenaRun;
      const caption = tab === 'menu' && run ? `Арена · бой ${run.fight}` : label;
      const b = new Button(this, x0 + i * (NAV_W + NAV_GAP), 46, caption, {
        variant: on ? 'brown' : 'beige',
        width: NAV_W,
        height: 50,
        size: caption.length > 10 ? 17 : 22,
        onClick: () => this.openTab(tab),
      });
      b.setDepth(1);
    });
  }

  /** Для какой ячейки бойца идёт сборка (пришли «+» → «К чертежам»). */
  protected get craftTarget(): CraftTarget | null {
    return (this.registry.get(CRAFT_TARGET_KEY) as CraftTarget | null | undefined) ?? null;
  }

  protected setCraftTarget(t: CraftTarget | null) {
    this.registry.set(CRAFT_TARGET_KEY, t);
  }

  /** Перейти в раздел. «Арена»: идущая серия (даже до первого боя) — продолжить, иначе — выбор бойца. */
  protected openTab(tab: NavTab) {
    if (tab === 'arena') {
      const run = store.state.arenaRun;
      if (run) return this.scene.key === SCENE.opponent ? undefined : this.go(SCENE.opponent, { charUid: run.charUid });
      return this.openArenaPicker();
    }
    const key = { menu: SCENE.menu, inventory: SCENE.inventory, blueprints: SCENE.blueprints, characters: SCENE.characters, rating: SCENE.leaderboard }[tab];
    // активная вкладка из вложенного экрана (крафт → «Чертежи») ведёт в корень раздела
    if (this.scene.key !== key) this.go(key);
  }

  /** Выбор бойца для арены: по умолчанию — последний выбранный. */
  protected openArenaPicker() {
    const chars = store.state.characters;
    if (!chars.length) {
      const modal = new Modal(this, { title: 'Арена', width: 560, height: 300 });
      const w = modal.card.innerW;
      modal.card.content.add(text(this, w / 2, 40, 'Бойцов пока нет.\nПерсонаж собирается в «Чертежах» — после сборки он сразу готов к бою.', { size: 17, align: 'center', wrap: w }).setOrigin(0.5, 0));
      modal.card.content.add(new Button(this, w / 2 - 120, 160, 'Закрыть', { variant: 'beige', width: 210, height: 52, onClick: () => modal.close() }));
      modal.card.content.add(new Button(this, w / 2 + 120, 160, 'К чертежам', { width: 210, height: 52, onClick: () => this.go(SCENE.blueprints) }));
      return;
    }
    let selected = chars.some((c) => c.uid === store.state.lastArenaCharacterId) ? store.state.lastArenaCharacterId! : chars[0].uid;
    const perPage = 4;
    const rows = Math.min(perPage, chars.length);
    const modal = new Modal(this, { title: 'Выбор бойца', width: 600, height: 170 + rows * 76 + (chars.length > perPage ? 30 : 0) });
    const body = modal.card.content;
    const w = modal.card.innerW;
    const list = this.add.container(0, 0);
    body.add(list);
    let page = Math.floor(chars.findIndex((c) => c.uid === selected) / perPage);
    const draw = () => {
      list.removeAll(true);
      chars.slice(page * perPage, (page + 1) * perPage).forEach((c, k) => {
        const bp = getBlueprint(c.blueprintId);
        const y = k * 76;
        const on = c.uid === selected;
        list.add(panel(this, 0, y, w, 68, on ? 'light' : 'beige'));
        if (on) list.add(this.add.graphics().lineStyle(3, 0x4a2a12, 1).strokeRoundedRect(1, y + 1, w - 2, 66, 8));
        list.add(new VoxelView(this, 44, y + 34, { blocks: bp.blocks, width: 70, height: 56, maxBlockPx: 9, colorOf: (i) => skinColorOf(c.blueprintId, c.skinId, i) ?? STAT_COLOR[c.blockStats[i]], pattern: skinPatternOf(c.blueprintId, c.skinId) }));
        list.add(text(this, 90, y + 10, c.name, { kind: 'display', size: 20 }));
        const hands = c.equipment.filter((e) => e && hasItem(e.itemId) && getItem(e.itemId).kind === 'weapon').map((e) => getItem(e!.itemId).name);
        list.add(text(this, 90, y + 40, `${bp.name} · ${hands.length ? hands.join(', ') : 'без оружия — кулаки'}`, { size: 13, color: COLOR.inkQuiet }));
        list.add(this.add.zone(0, y, w, 68).setOrigin(0).setInteractive({ useHandCursor: true }).on('pointerup', () => {
        if (isDragRelease(this)) return;
          selected = c.uid;
          draw();
        }));
      });
    };
    draw();
    const by = rows * 76 + 8;
    if (chars.length > perPage) {
      const pager = new Pager(this, w / 2, by + 6, (p) => {
        page = p;
        pager.set(p, Math.ceil(chars.length / perPage));
        draw();
      });
      pager.set(page, Math.ceil(chars.length / perPage));
      body.add(pager);
    }
    const yb = by + (chars.length > perPage ? 54 : 34);
    body.add(new Button(this, w / 2 - 130, yb, 'Отмена', { variant: 'beige', width: 230, height: 52, onClick: () => modal.close() }));
    body.add(
      new Button(this, w / 2 + 130, yb, 'К противнику', {
        width: 230,
        height: 52,
        onClick: () => {
          this.go(SCENE.opponent, { charUid: selected } satisfies OpponentSceneData);
        },
      }),
    );
  }

  /** Вызвать fn сейчас и при каждом изменении состояния; отписка — при выходе из сцены. */
  protected watch(fn: (s: PlayerState) => void) {
    fn(store.state);
    const unsub = store.subscribe(fn);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, unsub);
  }

  /** «КУБЫ · N» в правом верхнем углу карточки. */
  protected bindCubes(card: Card) {
    this.watch((s) => card.setAside(`Кубы · ${cubeCount(s)}`));
  }

  /** Переход на другую сцену с затемнением. */
  go(key: SceneKey, data?: object) {
    if (this.leaving) return;
    this.leaving = true;
    const cam = this.cameras.main;
    cam.resetFX(); // fade-in мог ещё идти — без сброса fadeOut будет проигнорирован
    cam.fadeOut(FADE_MS, 0, 0, 0);
    cam.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => this.scene.start(key, data));
  }

  /** Плашка-заглушка: что появится на этом экране и на каком этапе. */
  protected stubNote(x: number, y: number, stage: string, what: string, width = 420) {
    const t = text(this, x, y, `${stage}\n${what}`, { size: 15, color: COLOR.inkQuiet, align: 'center', wrap: width });
    return t.setOrigin(0.5);
  }
}
