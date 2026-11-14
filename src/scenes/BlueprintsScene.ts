import Phaser from 'phaser';
import { PARCHMENT_ID, cubeCount, itemCount } from '../core/state';
import { UNLOCK_COST, isUnlocked, unlockBlueprint } from '../core/craft';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';
import { isDragRelease } from '../ui/dragGuard';
import { BaseScene } from './BaseScene';
import { SCENE, type CraftSceneData } from './keys';
import { BLUEPRINT_KIND_LABEL, ROTATION_BLUEPRINTS, blueprintCost, blueprintsByKind, getItem } from '../data/catalog';
import { STAT_LABEL, blueprintSummary, itemRows } from '../data/labels';
import { STATS, type Blueprint, type BlueprintKind } from '../data/types';
import { Card, panel } from '../ui/Panel';
import { TEX } from '../ui/textures';
import { attachTooltip, type TooltipContent } from '../ui/Tooltip';
import { withUpgrade } from '../ui/upgradeTip';
import { text } from '../ui/text';
import { COLOR, GAME_W } from '../ui/theme';
import { VoxelView } from '../ui/VoxelView';
import { store } from '../game/store';
import { targetLabel } from '../core/craftTarget';

type Tab = BlueprintKind | 'all';
const TABS: Tab[] = ['all', ...(Object.keys(BLUEPRINT_KIND_LABEL) as BlueprintKind[])];
const TAB_KEY = 'blueprints.tab';
const PAGE_KEY = 'blueprints.page';
const COLS = 4;
const ROWS = 2;
const PER_PAGE = COLS * ROWS;
const TILE_W = 200;
const TILE_H = 186;
const GAP = 16;

const tabLabel = (t: Tab) => (t === 'all' ? 'Все' : BLUEPRINT_KIND_LABEL[t]);
/** Чертежи вкладки: сперва открытые, потом закрытые; внутри группы — прежний порядок. */
const tabItems = (t: Tab) => {
  const list = t === 'all' ? ROTATION_BLUEPRINTS() : blueprintsByKind(t);
  const open = list.filter((b) => isUnlocked(store.state, b.id));
  return [...open, ...list.filter((b) => !open.includes(b))];
};

/** Все чертежи игры по вкладкам: персонажи, оружие, камни, артефакты, сумки. */
export class BlueprintsScene extends BaseScene {
  private card!: Card;
  private grid!: Phaser.GameObjects.Container;
  private tabs = new Map<Tab, Phaser.GameObjects.Text>();
  private tab: Tab = 'all';
  private page = 0;
  private pager!: Phaser.GameObjects.Container;
  private pageText!: Phaser.GameObjects.Text;
  private tiles: Array<{ cost: number; costText: Phaser.GameObjects.Text }> = [];

  constructor() {
    super(SCENE.blueprints);
  }

  create() {
    // экземпляр сцены переиспользуется между заходами — сбрасываем ссылки на прошлые объекты
    this.tiles = [];
    this.tabs.clear();
    const target = this.craftTarget;
    const forWhom = target ? targetLabel(store.state, target) : null;
    if (target && !forWhom) this.setCraftTarget(null);
    this.setupScreen({ title: 'Чертежи', subtitle: forWhom ? undefined : 'Всё, что собирается из кубов', tab: 'blueprints' });
    if (forWhom) this.targetLine(forWhom);
    const w = 900;
    this.card = new Card(this, (GAME_W - w) / 2, 146, w, 560, { title: 'Список чертежей', aside: 'Кубы' });
    this.bindCubes(this.card);

    this.tabs.clear();
    let x = 0;
    for (const tab of TABS) {
      // вкладка без чертежей (камни — только из наград) не показывается
      if (!tabItems(tab).length) continue;
      const t = text(this, x, 0, `${tabLabel(tab)} ${tabItems(tab).length}`, { kind: 'display', size: 20, color: COLOR.inkQuiet }).setInteractive({
        useHandCursor: true,
      });
      t.on('pointerup', () => !isDragRelease(this) && this.showTab(tab, 0));
      this.card.content.add(t);
      this.tabs.set(tab, t);
      x += t.width + 26;
    }
    this.grid = this.add.container(0, 40);
    this.card.content.add(this.grid);

    // листалка страниц: стрелки, колесо мыши, ← →
    const py = 40 + ROWS * (TILE_H + GAP) + 10;
    const cx = this.card.innerW / 2;
    const prev = this.add.image(cx - 70, py, TEX.arrowLeft).setScale(1.6).setInteractive({ useHandCursor: true }).on('pointerup', () => !isDragRelease(this) && this.flip(-1));
    const next = this.add.image(cx + 70, py, TEX.arrowRight).setScale(1.6).setInteractive({ useHandCursor: true }).on('pointerup', () => !isDragRelease(this) && this.flip(1));
    this.pageText = text(this, cx, py, '', { kind: 'mono', size: 15, color: COLOR.inkQuiet }).setOrigin(0.5);
    this.pager = this.add.container(0, 0, [prev, next, this.pageText]);
    this.card.content.add(this.pager);
    this.input.on('wheel', (_p: unknown, _o: unknown, _dx: number, dy: number) => this.flip(dy > 0 ? 1 : -1));
    this.input.keyboard?.on('keydown-LEFT', () => this.flip(-1));
    this.input.keyboard?.on('keydown-RIGHT', () => this.flip(1));

    // при пересчёте кубов обновляем «нужно / есть» и доступность кнопок
    this.watch((s) => this.refreshTiles(cubeCount(s)));

    this.showTab((this.registry.get(TAB_KEY) as Tab | undefined) ?? 'all', (this.registry.get(PAGE_KEY) as number | undefined) ?? 0);
  }

  /** «Сборка для: Имя · Правая рука ×» — после крафта будет «Надеть». × — забыть ячейку. */
  private targetLine(label: string) {
    const t = text(this, GAME_W / 2 - 14, 98, `Сборка для: ${label}`, { size: 17, color: COLOR.light }).setOrigin(0.5, 0);
    const x = t.x + t.width / 2 + 18;
    const bg = this.add.circle(x, 109, 11, 0x8a2a1e).setStrokeStyle(2, 0x2b1a0a, 0.9).setInteractive({ useHandCursor: true });
    const cross = text(this, x, 108, '×', { kind: 'mono', size: 17, weight: 700, color: '#ffffff' }).setOrigin(0.5);
    attachTooltip(bg, () => ({ title: 'Сбросить: собирать без привязки к ячейке' }));
    bg.on('pointerup', () => {
      if (isDragRelease(this)) return;
      this.setCraftTarget(null);
      t.setText('Всё, что собирается из кубов').setX(GAME_W / 2);
      bg.destroy();
      cross.destroy();
    });
  }

  private pages(tab = this.tab) {
    return Math.max(1, Math.ceil(tabItems(tab).length / PER_PAGE));
  }

  private flip(dir: number) {
    const page = Phaser.Math.Clamp(this.page + dir, 0, this.pages() - 1);
    if (page !== this.page) this.showTab(this.tab, page);
  }

  private showTab(tab: Tab, page: number) {
    this.tab = tab;
    this.page = Phaser.Math.Clamp(page, 0, this.pages(tab) - 1);
    this.registry.set(TAB_KEY, tab);
    this.registry.set(PAGE_KEY, this.page);
    for (const [k, t] of this.tabs) t.setColor(k === tab ? COLOR.ink : COLOR.inkQuiet).setFontStyle(k === tab ? 'bold' : '');
    this.pager.setVisible(this.pages(tab) > 1);
    this.pageText.setText(`${this.page + 1} / ${this.pages(tab)}`);
    this.grid.removeAll(true);
    this.tiles = [];
    const left = (this.card.innerW - (COLS * TILE_W + (COLS - 1) * GAP)) / 2;
    tabItems(tab).slice(this.page * PER_PAGE, (this.page + 1) * PER_PAGE).forEach((bp, i) => {
      const x = left + (i % COLS) * (TILE_W + GAP);
      const y = Math.floor(i / COLS) * (TILE_H + GAP);
      this.grid.add(this.tile(bp, x, y));
    });
    this.refreshTiles(cubeCount(store.state));
  }

  /** «Нужно / есть»: стоимость красным, если кубов не хватает (зайти в чертёж можно всё равно). */
  private refreshTiles(cubes: number) {
    for (const t of this.tiles) t.costText.setColor(cubes >= t.cost ? COLOR.ink : COLOR.lose);
  }

  private tile(bp: Blueprint, x: number, y: number) {
    const c = this.add.container(x, y);
    const bg = panel(this, 0, 0, TILE_W, TILE_H, 'beige');
    // вся плитка — кнопка: клик открывает сборку по чертежу
    const hover = this.add.graphics().lineStyle(3, 0x4a2a12, 1).strokeRoundedRect(1, 1, TILE_W - 2, TILE_H - 2, 8).setVisible(false);
    const hit = this.add.zone(TILE_W / 2, TILE_H / 2, TILE_W, TILE_H).setInteractive({ useHandCursor: true });
    hit.on('pointerover', () => hover.setVisible(true)).on('pointerout', () => hover.setVisible(false));
    const locked = !isUnlocked(store.state, bp.id);
    hit.on('pointerup', () => {
      if (isDragRelease(this)) return;
      if (locked) this.confirmUnlock(bp);
      else this.go(SCENE.craft, { blueprintId: bp.id } satisfies CraftSceneData);
    });
    attachTooltip(hit, () => this.tooltip(bp));
    // стоимость — справа в строке с названием; модель занимает всё место над подписями; персонажи повёрнуты на 180°, как в «Персонажах»
    const nameY = TILE_H - 50;
    const view = new VoxelView(this, TILE_W / 2, (nameY - 6) / 2 + 4, { blocks: bp.blocks, width: TILE_W - 56, height: nameY - 40, maxBlockPx: 22, neutral: true, yaw: bp.kind === 'character' ? 180 : 0 });
    const cost = blueprintCost(bp);
    const costText = text(this, TILE_W - 12, nameY, `${cost} куб.`, { kind: 'mono', size: 14, weight: 700 }).setOrigin(1, 0);
    const name = text(this, 12, nameY, bp.name, { kind: 'display', size: 17, wrap: TILE_W - 24 - costText.width - 8 });
    const summary = text(this, 12, nameY + 23, blueprintSummary(bp), { size: 13, color: COLOR.inkQuiet, wrap: TILE_W - 24 });
    c.add([bg, view, name, summary, costText, hover, hit]);
    if (locked) {
      // закрытый чертёж: модель бледнее, вместо цены — «закрыт»; клик предлагает открыть за пергамент
      view.setAlpha(0.35);
      name.setColor(COLOR.inkQuiet);
      costText.setText('ЗАКРЫТ').setColor(COLOR.lose);
      return c;
    }
    this.tiles.push({ cost, costText });
    return c;
  }

  /** Закрытый чертёж: открыть за чистый пергамент (выпадает за серию арены). */
  private confirmUnlock(bp: Blueprint) {
    const have = itemCount(store.state, PARCHMENT_ID);
    const m = new Modal(this, { title: 'Чертёж закрыт', width: 480, height: 280 });
    const w = m.card.innerW;
    m.card.content.add(text(this, w / 2, 4, `«${bp.name}»`, { kind: 'display', size: 22 }).setOrigin(0.5, 0));
    m.card.content.add(text(this, w / 2, 42, `Открывается чистым пергаментом: нужно ${UNLOCK_COST}, есть ${have}.\nПергамент выпадает за пройденную серию арены.`, { size: 15, align: 'center', color: have >= UNLOCK_COST ? COLOR.ink : COLOR.lose, wrap: w }).setOrigin(0.5, 0));
    m.card.content.add(new Button(this, w / 2 - 110, 134, 'Отмена', { variant: 'beige', width: 200, height: 48, size: 20, onClick: () => m.close() }));
    m.card.content.add(
      new Button(this, w / 2 + 110, 134, `Открыть · ${UNLOCK_COST}`, {
        width: 200, height: 48, size: 20,
        onClick: () => {
          m.close();
          if (store.update((st) => unlockBlueprint(st, bp.id))) this.showTab(this.tab, this.page);
        },
      }).setEnabled(have >= UNLOCK_COST),
    );
  }

  private tooltip(bp: Blueprint): TooltipContent {
    const cost = blueprintCost(bp);
    if (!isUnlocked(store.state, bp.id)) return { title: bp.name, note: `Чертёж закрыт. Открывается чистым пергаментом (нужно ${UNLOCK_COST}) — он выпадает за серию арены.` };
    if (bp.kind === 'character') {
      const base = STATS.filter((s) => bp.baseStats[s] > 0).map((s) => `${STAT_LABEL[s]} ${bp.baseStats[s]}`);
      return {
        title: bp.name,
        rows: [
          ['Блоков', String(cost)],
          ['Категория', String(bp.category)],
          ['Слоты', `${bp.slots.filter((s) => s.type === 'Hand').length} руки, ${bp.slots.filter((s) => s.type === 'Artifact').length} артефакта`],
        ],
        note: `Базовые статы: ${base.join(', ')}. Статы блоков задаются при сборке персонажа.`,
      };
    }
    if ('variants' in bp) {
      const rows: Array<[string, string]> = [['Блоков', String(cost)], [bp.variantLabel, bp.variants.map((v) => v.label).join(', ')]];
      if (bp.restoreAmount) rows.push(['Чинит', `${bp.restoreAmount} куб. своей статы`]);
      return {
        title: bp.name,
        rows,
        note: `${bp.variantLabel} выбирается при сборке, каждый вариант — свой предмет.`,
      };
    }
    const item = getItem(bp.itemId);
    return withUpgrade({
      title: item.name,
      rows: [['Блоков', String(cost)], ...itemRows(item).map((r) => [r.label, r.value, r.color] as [string, string, string | undefined])],
      note: item.description,
    } as TooltipContent, item);
  }
}
