import Phaser from 'phaser';
import { cubeCount } from '../core/state';
import { isDragRelease } from '../ui/dragGuard';
import { BaseScene } from './BaseScene';
import { SCENE, type CharactersSceneData, type CraftSceneData } from './keys';
import { BLUEPRINT_KIND_LABEL, COMBAT, getBlueprint, getItem, hasBlueprint } from '../data/catalog';
import { STAT_LABEL, STAT_SHORT, variantDescription } from '../data/labels';
import { defaultSkinId, resolveSkin, skinColorOf, skinPatternOf, skinsFor, type CharacterSkin } from '../data/skins';
import { STATS, type Blueprint, type BlueprintVariant, type Stat } from '../data/types';
import { buildOrder, frontier, adjacency } from '../core/build';
import { layeredStats } from '../core/layout';
import { canAutoCraft, completeCraft, craftFailure, craftCost, type CraftResult } from '../core/craft';
import { countsAfterPaint, countsAfterRepaint, defaultCounts, nextStat, totalCount, usedCounts, type StatCounts } from '../core/stats';
import { store } from '../game/store';
import { applyCharacterEdit, cellCounts, editChanges, editCost, editDelta, editLocked, rebalanceCells, type Cells } from '../core/edit';
import type { CharacterState } from '../core/state';
import { applyTarget, targetFit, targetLabel } from '../core/craftTarget';
import { Button } from '../ui/Button';
import { createItemIcon } from '../ui/ItemIcon';
import { Modal } from '../ui/Modal';
import { Card, dottedLine, panel } from '../ui/Panel';
import { ResourceBar } from '../ui/ResourceBar';
import { StatAllocator } from '../ui/StatAllocator';
import { TEX } from '../ui/textures';
import { attachTooltip } from '../ui/Tooltip';
import { text } from '../ui/text';
import { COLOR, GAME_W, STAT_COLOR } from '../ui/theme';
import { GHOST_ACCENT, GHOST_BLOCK, VoxelView, type BlockLook } from '../ui/VoxelView';
import { modelView, type ModelView } from '../ui/modelView';

const VARIANT_KEY = (id: string) => `craft.variant.${id}`;
const AUTO_STEP_MS = 45;

/**
 * Крафт по чертежу. Сборка начинается с одного куба; доступны только блоки,
 * примыкающие к поставленным. Кубы списываются целиком, когда модель собрана.
 * Первая сборка — вручную, после неё у чертежа открывается «Автосборка».
 * У персонажа — панель распределения кубов по статам: поставленный куб берёт стату «кисти».
 */
export class CraftScene extends BaseScene {
  private blueprintId?: string;
  private bp?: Blueprint;
  private adj: number[][] = [];
  private placed = new Set<number>();
  private open = new Set<number>();
  private variant?: BlueprintVariant;
  private counts?: StatCounts;
  private assigned = new Map<number, Stat>();
  private allocator?: StatAllocator;
  private view?: ModelView;
  /** «Создать персонажа» — пока игрок поправляет статы собранной модели. */
  private createBtn?: Button;
  private progress!: ResourceBar;
  private costText!: Phaser.GameObjects.Text;
  private autoBtn!: Button;
  private resetBtn!: Button;
  private autoHint!: Phaser.GameObjects.Text;
  private variantText?: Phaser.GameObjects.Text;
  private chips: Array<{ v: BlueprintVariant; frame: Phaser.GameObjects.Rectangle }> = [];
  private busy = false;
  private done = false;
  /** Сколько штук собрать автосборкой за раз (ручная сборка — всегда одна). */
  private qty = 1;
  private qtyText?: Phaser.GameObjects.Text;
  private qtyMinus?: Button;
  private qtyPlus?: Button;
  private viewCard?: Card;
  private placeHint?: Phaser.GameObjects.Text;
  /** Палитра над моделью: «авто» (s = null) и 6 цветов. */
  private swatches: Array<{ s: Stat | null; frame: Phaser.GameObjects.Rectangle }> = [];

  // ── изменение готового персонажа (editCharUid) ──
  private editCharUid?: string;
  private editChar?: CharacterState;
  /** Исходные статы кубов персонажа. */
  private orig: Stat[] = [];
  /** Разбитые кубы — не меняются. */
  private locked = new Set<number>();
  /** Текущая модель в редакторе: стата куба или null — убран. */
  private cells: Cells = [];
  /** Скин применяется вместе с остальными изменениями по «Подтвердить». */
  private origSkinId?: string;
  private editSkinId?: string;
  private deltaText?: Phaser.GameObjects.Text;
  private confirmBtn?: Button;
  private skinTiles: Array<{ id: string; frame: Phaser.GameObjects.Rectangle; check: Phaser.GameObjects.Text }> = [];
  private previewSkin = false;
  private skinPage = 0;
  private skinGallery?: Phaser.GameObjects.Container;

  constructor() {
    super(SCENE.craft);
  }

  init(data: CraftSceneData) {
    this.blueprintId = data?.blueprintId;
    this.editCharUid = data?.editCharUid;
  }

  create() {
    this.placed = new Set();
    this.open = new Set();
    this.assigned = new Map();
    this.chips = [];
    this.busy = false;
    this.done = false;
    // количество для автосборки запоминается по чертежу — «Ещё раз» соберёт столько же
    this.qty = (this.registry.get(`craft.qty.${this.blueprintId}`) as number | undefined) ?? 1;
    this.view = undefined;
    this.createBtn = undefined;
    this.allocator = undefined;
    this.variantText = undefined;
    this.counts = undefined;
    this.swatches = [];
    this.skinTiles = [];
    this.previewSkin = false;
    this.skinPage = 0;
    this.skinGallery = undefined;
    this.editChar = undefined;
    if (this.editCharUid) return this.createEdit(this.editCharUid);
    this.bp = this.blueprintId && hasBlueprint(this.blueprintId) ? getBlueprint(this.blueprintId) : undefined;
    this.setupScreen({
      title: 'Сборка',
      subtitle: this.bp ? `Чертёж: ${this.bp.name}${this.forWhom(this.bp)}` : 'Чертёж не выбран',
      back: null,
      tab: 'blueprints',
    });
    // назад к списку чертежей: стрелка у заголовка карточки (buildView) и ESC
    this.input.keyboard?.on('keydown-ESC', () => {
      if (!this.busy && !this.children.list.some((o) => o instanceof Modal)) this.go(SCENE.blueprints);
    });
    if (!this.bp) return this.noBlueprint();
    this.adj = adjacency(this.bp.blocks);
    this.updateOpen();
    this.buildView(this.bp);
    this.buildPanel(this.bp);
    if (this.isChar()) this.buildBrushBar();
    this.watch(() => this.refresh());
  }

  private noBlueprint() {
    const w = 700;
    const card = new Card(this, (GAME_W - w) / 2, 200, w, 300, { title: 'Выбери чертёж', aside: 'Кубы' });
    this.bindCubes(card);
    card.content.add(text(this, card.innerW / 2, 50, 'Сборка идёт по чертежу: открой список и кликни по чертежу.', { size: 17 }).setOrigin(0.5));
    card.content.add(new Button(this, card.innerW / 2, 140, 'К чертежам', { width: 260, height: 56, onClick: () => this.go(SCENE.blueprints) }));
  }

  private isChar(): boolean {
    return this.bp?.kind === 'character';
  }

  /** Поставлен — обычный, доступен — силуэт, остальное — еле заметный контур конечной фигуры. */
  private lookOf = (i: number): BlockLook =>
    this.editChar ? (this.cells[i] && !this.locked.has(i) ? 'solid' : 'ghost') : this.placed.has(i) ? 'solid' : this.open.has(i) ? 'ghost' : 'faint';

  private updateOpen() {
    this.open = new Set(frontier(this.bp!.blocks, this.placed, this.adj));
  }

  private buildView(bp: Blueprint) {
    const card = new Card(this, 40, 146, 820, 560, { title: this.editChar?.name ?? bp.name, aside: 'Кубы', onBack: () => this.back() });
    this.viewCard = card;
    this.bindCubes(card);
    const skins = this.editChar ? skinsFor(bp.id) : [];
    const galleryH = skins.length ? 136 : 0;
    this.view = modelView(this, card.innerW / 2, (card.innerH - 40 - galleryH) / 2 + 20, {
      blocks: bp.blocks,
      width: card.innerW - 30,
      height: card.innerH - 70 - galleryH,
      interactive: true,
      maxBlockPx: 52,
      yaw: bp.kind === 'character' ? 180 : 0, // персонажи повёрнуты на 180°, как в «Персонажах» и «Чертежах»
      showFront: bp.kind === 'character', // откуда бьют: перёд закрывай бронёй, слабое прячь в глубину
      colorOf: (i) => {
        if (this.editChar) return this.previewSkin ? skinColorOf(this.editChar.blueprintId, this.editSkinId, i) ?? STAT_COLOR[this.cells[i] ?? this.orig[i]] : STAT_COLOR[this.cells[i] ?? this.orig[i]];
        if (this.isChar()) {
          const s = this.assigned.get(i);
          return s ? STAT_COLOR[s] : undefined;
        }
        return bp.blocks[i].tinted && this.variant ? parseInt(this.variant.tint.slice(1), 16) : undefined;
      },
      pattern: this.editChar && this.previewSkin ? skinPatternOf(this.editChar.blueprintId, this.editSkinId) : undefined,
      lookOf: this.lookOf,
      // у персонажа пустые места подсвечены цветом статы, которой встанет следующий куб
      ghostColor: (i) => {
        // изменение: разбитый куб — цвет своей статы; пустое место — цвет кисти или исходный
        if (this.editChar) return this.previewSkin ? skinColorOf(this.editChar.blueprintId, this.editSkinId, i) ?? STAT_COLOR[this.orig[i]] : STAT_COLOR[this.locked.has(i) ? this.orig[i] : this.allocator?.currentBrush ?? this.orig[i]];
        if (!this.isChar() || !this.counts || !this.allocator) return GHOST_ACCENT;
        const s = this.allocator.currentBrush ?? nextStat(this.counts, this.assigned, STATS[0]);
        return s ? STAT_COLOR[s] : GHOST_BLOCK;
      },
    });
    this.view.on('blockclick', (i: number) => (this.editChar ? this.editClick(i) : this.place(i)));
    card.content.add(this.view);
    if (skins.length) {
      const boxX = card.innerW - 218;
      const box = this.add.rectangle(boxX, 16, 16, 16, 0xd8c6a0).setStrokeStyle(2, 0x4a2a12, 1);
      const check = text(this, boxX, 15, '✓', { kind: 'mono', size: 18, weight: 700, color: COLOR.ink }).setOrigin(0.5).setVisible(false);
      const label = text(this, boxX + 16, 16, 'Предпросмотр скина', { size: 12, color: COLOR.ink }).setOrigin(0, 0.5);
      const hit = this.add.zone(boxX + 100, 16, 220, 30).setInteractive({ useHandCursor: true });
      hit.on('pointerup', () => {
        if (isDragRelease(this)) return;
        this.previewSkin = !this.previewSkin;
        check.setVisible(this.previewSkin);
        this.view?.redraw();
      });
      attachTooltip(hit, () => ({ title: 'Предпросмотр скина', note: 'Показать выбранный скин вместо цветов статов в редакторе.' }));
      card.content.add([box, check, label, hit]);
      this.buildSkinGallery(card, bp, skins);
    }

    const y = card.innerH - 18;
    const arrowY = Math.max(150, (card.innerH - galleryH - 40) / 2) + 20;
    const left = this.add.image(40, arrowY, TEX.arrowLeft).setScale(1.8).setInteractive({ useHandCursor: true });
    const right = this.add.image(card.innerW - 40, arrowY, TEX.arrowRight).setScale(1.8).setInteractive({ useHandCursor: true });
    left.on('pointerup', () => !isDragRelease(this) && this.view?.rotateBy(-1));
    right.on('pointerup', () => !isDragRelease(this) && this.view?.rotateBy(1));
    card.content.add([left, right]);
    if (!this.editChar) {
      this.placeHint = text(this, 0, y - 8, 'Клик по силуэту — поставить куб', { size: 13, color: COLOR.inkQuiet }).setOrigin(0, 0.5);
      card.content.add(this.placeHint);
      card.content.add(text(this, 0, y + 9, 'Кубы спишутся, когда модель собрана целиком', { size: 11, color: COLOR.inkQuiet }).setOrigin(0, 0.5));
    }
    this.input.keyboard?.on('keydown-LEFT', () => this.view?.rotateBy(-1));
    this.input.keyboard?.on('keydown-Q', () => this.view?.rotateBy(-1));
    this.input.keyboard?.on('keydown-RIGHT', () => this.view?.rotateBy(1));
    this.input.keyboard?.on('keydown-E', () => this.view?.rotateBy(1));
  }

  /** Галерея скинов уже собранного бойца: по три превью на страницу, закрытые — чёрно-белые. */
  private buildSkinGallery(card: Card, bp: Blueprint, skins: CharacterSkin[]) {
    this.skinGallery?.destroy(true);
    const c = this.add.container(0, 0);
    card.content.add(c);
    this.skinGallery = c;
    this.skinTiles = [];
    const perPage = 3;
    const pages = Math.max(1, Math.ceil(skins.length / perPage));
    this.skinPage = Phaser.Math.Clamp(this.skinPage, 0, pages - 1);
    const shown = skins.slice(this.skinPage * perPage, this.skinPage * perPage + perPage);
    const tileW = 176;
    const tileH = 104;
    const gap = 12;
    const y = card.innerH - 125;
    const total = shown.length * tileW + (shown.length - 1) * gap;
    const x0 = (card.innerW - total) / 2;
    c.add(text(this, x0, y - 18, 'СКИНЫ', { size: 11, color: COLOR.inkQuiet, letterSpacing: 1 }));
    const gray = (color: number) => {
      const r = (color >> 16) & 0xff, g = (color >> 8) & 0xff, b = color & 0xff;
      const v = Math.round((r * 0.3 + g * 0.59 + b * 0.11) * 0.55);
      return (v << 16) | (v << 8) | v;
    };
    shown.forEach((skin, i) => {
      const x = x0 + i * (tileW + gap);
      const locked = !!skin.locked;
      c.add(panel(this, x, y, tileW, tileH, locked ? 'brown' : 'beige'));
      const colorOf = (block: number) => locked ? gray(skin.colors[block]) : skin.colors[block];
      const preview = modelView(this, x + tileW / 2, y + 40, {
        blocks: bp.blocks,
        width: tileW - 24,
        height: 66,
        maxBlockPx: 11,
        yaw: 180,
        colorOf,
        ghostColor: colorOf,
        pattern: skin.pattern,
        lookOf: this.lookOf,
      });
      c.add(preview);
      c.add(text(this, x + tileW / 2, y + 91, skin.name, { size: 15, weight: locked ? 700 : 400, color: locked ? COLOR.light : COLOR.ink }).setOrigin(0.5, 0.5));
      const frame = this.add.rectangle(x + tileW / 2, y + tileH / 2, tileW, tileH, 0, 0).setStrokeStyle(3, 0x4a2a12, 0);
      const check = text(this, x + tileW - 18, y + 12, '✓', { kind: 'mono', size: 20, weight: 700, color: COLOR.ink }).setOrigin(0.5).setVisible(false);
      c.add([frame, check]);
      if (locked) c.add(text(this, x + 12, y + 12, 'ЗАКРЫТ', { size: 11, weight: 700, color: COLOR.light, letterSpacing: 1 }).setOrigin(0, 0.5));
      const hit = this.add.zone(x + tileW / 2, y + tileH / 2, tileW, tileH).setInteractive({ useHandCursor: !locked });
      attachTooltip(hit, () => ({ title: skin.name, note: locked ? 'Скин закрыт.' : 'Клик — выбрать этот скин.' }));
      if (!locked) hit.on('pointerup', () => {
        if (isDragRelease(this) || !this.editChar) return;
        this.editSkinId = skin.id;
        this.editChanged();
      });
      c.add(hit);
      this.skinTiles.push({ id: skin.id, frame, check });
    });
    if (pages > 1) {
      const arrowY = y + tileH / 2;
      const left = this.add.image(40, arrowY, TEX.arrowLeft).setScale(1.5).setInteractive({ useHandCursor: true });
      const right = this.add.image(card.innerW - 40, arrowY, TEX.arrowRight).setScale(1.5).setInteractive({ useHandCursor: true });
      left.on('pointerup', () => {
        if (isDragRelease(this) || this.skinPage <= 0) return;
        this.skinPage--;
        this.buildSkinGallery(card, bp, skins);
      });
      right.on('pointerup', () => {
        if (isDragRelease(this) || this.skinPage >= pages - 1) return;
        this.skinPage++;
        this.buildSkinGallery(card, bp, skins);
      });
      c.add([left, right]);
      c.add(text(this, card.innerW / 2, card.innerH - 4, `${this.skinPage + 1} / ${pages}`, { kind: 'mono', size: 12, color: COLOR.inkQuiet }).setOrigin(0.5));
    }
    if (this.costText?.active) this.refreshEdit();
  }

  private buildPanel(bp: Blueprint) {
    const panel = new Card(this, 876, 146, 364, 560, { title: 'Сборка' });
    const w = panel.innerW;
    const c = panel.content;
    c.add(text(this, 0, 0, BLUEPRINT_KIND_LABEL[bp.kind].toUpperCase(), { size: 12, color: COLOR.inkQuiet, letterSpacing: 1 }));
    this.costText = text(this, 0, 20, '', { kind: 'mono', size: 15, weight: 700 });
    c.add(this.costText);
    this.progress = new ResourceBar(this, 0, 48, w, 24, 0x9a6a3a, 'СОБРАНО');
    c.add(this.progress);

    let y = 86;
    if (bp.kind === 'character') {
      c.add(dottedLine(this, 0, y, w));
      this.counts = defaultCounts(bp);
      this.allocator = new StatAllocator(this, 0, y + 8, w, {
        total: bp.blocks.length,
        initial: this.counts,
        minOf: (s) => usedCounts(this.assigned)[s],
        onChange: (v) => {
          this.counts = v;
          this.refresh();
          this.view?.redraw(); // цвет подсветки пустых мест зависит от квот
        },
        onBrush: () => this.onBrushChanged(),
      });
      c.add(this.allocator);
      y += 8 + 22 + 6 * 32 + 4;
    } else if ('variants' in bp) {
      c.add(dottedLine(this, 0, y, w));
      c.add(text(this, 0, y + 10, bp.variantLabel.toUpperCase(), { size: 12, color: COLOR.inkQuiet, letterSpacing: 1 }));
      const saved = this.registry.get(VARIANT_KEY(bp.id)) as string | undefined;
      this.variant = bp.variants.find((v) => v.key === saved) ?? bp.variants[0];
      const cols = 3;
      const cw = (w - 16) / cols;
      bp.variants.forEach((v, i) => {
        const cx = (i % cols) * (cw + 8);
        const cy = y + 32 + Math.floor(i / cols) * 38;
        const frame = this.add.rectangle(cx, cy, cw, 32, 0x000000, 0).setOrigin(0).setStrokeStyle(2, 0x4a2a12, 0);
        const sw = this.add.rectangle(cx + 5, cy + 8, 16, 16, parseInt(v.tint.slice(1), 16)).setOrigin(0).setStrokeStyle(1, 0x000000, 0.4);
        const label = text(this, cx + 28, cy + 16, v.label, { size: v.label.length > 9 ? 11 : 13 }).setOrigin(0, 0.5);
        const hit = this.add.zone(cx, cy, cw, 32).setOrigin(0).setInteractive({ useHandCursor: true }).on('pointerup', () => !isDragRelease(this) && this.chooseVariant(v));
        c.add([frame, sw, label, hit]);
        this.chips.push({ v, frame });
      });
      y += 32 + Math.ceil(bp.variants.length / cols) * 38;
      // что делает выбранный вариант
      this.variantText = text(this, 0, y + 2, '', { size: 12, color: COLOR.ink, wrap: w });
      this.variantText.setLineSpacing(2);
      c.add(this.variantText);
      y += 88;
    }

    c.add(dottedLine(this, 0, y, w));
    // количество для автосборки: − N +
    this.qtyMinus = new Button(this, 20, y + 34, '-', { variant: 'beige', width: 40, height: 48, size: 26, onClick: () => this.setQty(this.qty - 1) });
    this.qtyText = text(this, 64, y + 32, '1', { kind: 'mono', size: 20, weight: 700 }).setOrigin(0.5);
    this.qtyPlus = new Button(this, 108, y + 34, '+', { variant: 'beige', width: 40, height: 48, size: 26, onClick: () => this.setQty(this.qty + 1) });
    c.add([this.qtyMinus, this.qtyText, this.qtyPlus]);
    this.autoBtn = new Button(this, 136 + (w - 136) / 2, y + 34, 'Автосборка', { width: w - 136, height: 48, size: 20, onClick: () => this.autoAssemble() });
    this.autoHint = text(this, w / 2, y + 64, '', { size: 12, color: COLOR.inkQuiet, align: 'center', wrap: w }).setOrigin(0.5, 0);
    this.resetBtn = new Button(this, w / 2, y + 110, 'Сбросить', { variant: 'beige', width: w, height: 40, size: 18, onClick: () => this.resetPlacement() });
    c.add([this.autoBtn, this.autoHint, this.resetBtn]);
    if (this.variant) this.chooseVariant(this.variant);
  }

  private chooseVariant(v?: BlueprintVariant) {
    if (!v || this.busy) return;
    this.variant = v;
    if (this.bp) this.registry.set(VARIANT_KEY(this.bp.id), v.key);
    for (const ch of this.chips) ch.frame.setStrokeStyle(2, 0x4a2a12, ch.v === v ? 1 : 0).setFillStyle(0xffffff, ch.v === v ? 0.35 : 0);
    this.variantText?.setText(`${getItem(v.itemId).name}. ${variantDescription(v)}`);
    this.view?.redraw();
  }

  private enough(n = 1) {
    return !!this.bp && cubeCount(store.state) >= craftCost(this.bp) * n;
  }

  /** Сколько штук хватает кубов собрать автосборкой. */
  private maxQty() {
    return this.bp ? Math.max(1, Math.floor(cubeCount(store.state) / craftCost(this.bp))) : 1;
  }

  private setQty(n: number) {
    if (this.busy || this.done) return;
    this.qty = Phaser.Math.Clamp(n, 1, this.maxQty());
    if (this.bp) this.registry.set(`craft.qty.${this.bp.id}`, this.qty);
    this.refresh();
  }

  /** Сколько кубов ещё не распределено по статам (только персонаж). */
  private unallocated() {
    return this.isChar() && this.counts ? this.bp!.blocks.length - totalCount(this.counts) : 0;
  }

  private refresh() {
    if (!this.bp) return;
    const cost = craftCost(this.bp);
    const have = cubeCount(store.state);
    this.costText.setText(`Стоимость ${cost} куб. · есть ${have}`).setColor(have >= cost ? COLOR.ink : COLOR.lose);
    this.progress.set(this.placed.size, cost);
    const unlocked = canAutoCraft(store.state, this.bp.id);
    const left = this.unallocated();
    this.qty = Phaser.Math.Clamp(this.qty, 1, this.maxQty());
    this.qtyText?.setText(String(this.qty));
    this.qtyMinus?.setEnabled(unlocked && this.qty > 1 && !this.busy && !this.done);
    this.qtyPlus?.setEnabled(unlocked && this.qty < this.maxQty() && !this.busy && !this.done);
    this.autoBtn.setCaption(this.qty > 1 ? `Автосборка ×${this.qty}` : 'Автосборка');
    this.autoBtn.setEnabled(unlocked && this.enough(this.qty) && left === 0 && !this.busy && !this.done);
    this.resetBtn.setEnabled(this.placed.size > 0 && !this.busy && !this.done);
    this.autoHint.setText(
      !this.enough()
        ? `Не хватает ${cost - have} куб.`
        : this.qty > 1
          ? `${this.qty} шт. за ${cost * this.qty} куб. — собирается как одна`
        : !unlocked
          ? 'Откроется после первой ручной сборки'
          : left > 0
            ? `Распредели ещё ${left} куб. по статам`
            : 'Чертёж уже собирался вручную',
    );
  }

  private place(i: number) {
    if (this.busy || this.done) return;
    if (this.placed.has(i)) return this.repaint(i);
    if (!this.open.has(i)) return;
    if (!this.enough()) return this.cameras.main.shake(120, 0.003);
    if (this.isChar()) {
      const brush = this.allocator!.currentBrush;
      if (brush) {
        // цвет выбран вручную — куб этим цветом, ползунки подстраиваются
        const next = countsAfterPaint(this.counts!, this.assigned, brush, this.bp!.blocks.length);
        if (!next) return this.cameras.main.shake(120, 0.003);
        this.setCounts(next);
        this.assigned.set(i, brush);
      } else {
        const s = nextStat(this.counts!, this.assigned, STATS[0]);
        if (!s) {
          this.autoHint.setText(`Распредели ещё ${this.unallocated()} куб. по статам`).setColor(COLOR.lose);
          this.time.delayedCall(1200, () => this.autoHint.setColor(COLOR.inkQuiet));
          return this.cameras.main.shake(120, 0.003);
        }
        this.assigned.set(i, s);
      }
      this.allocator!.refresh();
    }
    this.placed.add(i);
    this.updateOpen();
    this.view?.setLookOf(this.lookOf);
    this.refresh();
    if (this.placed.size === this.bp!.blocks.length) this.finish(true);
  }

  /** Цвет выбран вручную: клик по поставленному кубу перекрашивает его, квота переходит к новой стате. */
  private repaint(i: number) {
    const brush = this.allocator?.currentBrush;
    const old = this.assigned.get(i);
    if (!this.isChar() || !brush || !old || old === brush) return;
    this.setCounts(countsAfterRepaint(this.counts!, old, brush));
    this.assigned.set(i, brush);
    this.allocator!.refresh();
    this.view?.redraw();
  }

  private setCounts(c: StatCounts) {
    this.counts = c;
    this.allocator?.setCounts(c);
    this.refresh();
  }

  /** Над моделью: палитра — «авто» (цвет из ползунков) или цвет вручную. */
  private buildBrushBar() {
    const c = this.viewCard!.content;
    c.add(text(this, 0, 16, 'ЦВЕТ КУБА', { size: 12, color: COLOR.inkQuiet, letterSpacing: 1 }).setOrigin(0, 0.5));
    const autoFrame = this.add.rectangle(130, 16, 84, 34, 0xffffff, 0).setStrokeStyle(3, 0x4a2a12, 0);
    const autoBg = this.add.rectangle(130, 16, 76, 26, 0xd8c6a0).setStrokeStyle(1, 0x000000, 0.3).setInteractive({ useHandCursor: true });
    const edit = !!this.editChar;
    const autoLabel = text(this, 130, 16, edit ? 'УБРАТЬ' : 'АВТО', { kind: 'display', size: edit ? 13 : 16 }).setOrigin(0.5);
    autoBg.on('pointerup', () => !isDragRelease(this) && this.allocator?.setBrush(null));
    attachTooltip(autoBg, () =>
      edit
        ? { title: 'Убрать / вернуть', note: 'Клик по кубу — убрать его, по пустому месту — вернуть исходный куб.' }
        : { title: 'Авто', note: 'Цвет берётся из ползунков: каждый куб — стата, у которой ещё остались кубы.' },
    );
    c.add([autoFrame, autoBg, autoLabel]);
    this.swatches.push({ s: null, frame: autoFrame });
    STATS.forEach((st, k) => {
      const x = 200 + k * 48;
      const frame = this.add.rectangle(x, 16, 46, 32, 0xffffff, 0).setStrokeStyle(3, 0x4a2a12, 0);
      const sw = this.add.rectangle(x, 16, 40, 26, STAT_COLOR[st]).setStrokeStyle(1, 0x000000, 0.4).setInteractive({ useHandCursor: true });
      const label = text(this, x, 16, STAT_SHORT[st], { kind: 'mono', size: 11, weight: 700, color: '#ffffff' }).setOrigin(0.5).setStroke('#2b1a0a', 2);
      sw.on('pointerup', () => !isDragRelease(this) && this.allocator?.setBrush(this.allocator.currentBrush === st ? null : st));
      attachTooltip(sw, () => ({
        title: STAT_LABEL[st],
        note: edit ? 'Клик по кубу — перекрасить в этот цвет, по пустому месту — поставить этим цветом.' : 'Кубы ставятся этим цветом, ползунки подстраиваются сами. Клик по поставленному кубу — перекрасить.',
      }));
      c.add([frame, sw, label]);
      this.swatches.push({ s: st, frame });
    });
    this.onBrushChanged();
  }

  private onBrushChanged() {
    const brush = this.allocator?.currentBrush ?? null;
    for (const w of this.swatches) w.frame.setStrokeStyle(3, 0x4a2a12, w.s === brush ? 1 : 0);
    this.placeHint?.setText(
      this.editChar
        ? brush
          ? `${STAT_LABEL[brush]}: клик по кубу — перекрасить, по пустому месту — поставить`
          : 'Клик по кубу — убрать, по пустому месту — вернуть исходный'
        : brush
          ? `${STAT_LABEL[brush]}: клик по силуэту — поставить, по кубу — перекрасить в этот цвет`
          : 'Клик по силуэту — поставить куб (цвет из ползунков)',
    );
    this.view?.redraw();
  }

  private resetPlacement() {
    this.createBtn?.destroy();
    this.createBtn = undefined;
    this.placed.clear();
    this.assigned.clear();
    this.updateOpen();
    this.allocator?.refresh();
    this.view?.setLookOf(this.lookOf);
    this.refresh();
  }

  /** Достроить оставшееся от собранной части наружу с анимацией, затем завершить без ручного флага. */
  private autoAssemble() {
    if (!this.bp || this.busy || !canAutoCraft(store.state, this.bp.id) || !this.enough(this.qty) || this.unallocated() > 0) return;
    this.busy = true;
    this.refresh();
    const order = buildOrder(this.bp.blocks, this.placed);
    // модель уже собрана (игрок поправлял статы) — достраивать нечего
    if (!order.length) {
      this.busy = false;
      return this.finish(false);
    }
    // статы оставшихся кубов — слоями спереди назад (combat.json → layout.autoBuild): броня закрывает перёд
    let plan: Map<number, Stat> | null = null;
    if (this.isChar()) {
      const used = usedCounts(this.assigned);
      const left = Object.fromEntries(STATS.map((s) => [s, Math.max(0, this.counts![s] - used[s])])) as Record<Stat, number>;
      plan = layeredStats(this.bp.blocks, left, COMBAT.layout.autoBuild, (i) => !this.placed.has(i));
    }
    order.forEach((i, k) => {
      this.time.delayedCall(k * AUTO_STEP_MS, () => {
        if (this.isChar()) this.assigned.set(i, plan?.get(i) ?? nextStat(this.counts!, this.assigned, this.allocator!.currentBrush ?? STATS[0])!);
        this.placed.add(i);
        this.updateOpen();
        this.view?.setLookOf(this.lookOf);
        this.allocator?.refresh();
        this.progress.set(this.placed.size, this.bp!.blocks.length);
        if (k === order.length - 1) {
          this.busy = false;
          this.finish(false);
        }
      });
    });
  }

  /**
   * Персонаж собран целиком: создать сейчас или сначала поправить расположение стат. «Поправить» оставляет
   * модель на экране — выбери цвет в палитре и кликай по кубам; кубы спишутся только при создании.
   */
  private askCreate(manual: boolean) {
    const create = () => this.finish(manual, true);
    const adjust = () => {
      if (this.createBtn || this.done) return;
      this.createBtn = new Button(this, 450, 618, 'Создать персонажа', { width: 320, height: 52, size: 22, onClick: create });
      this.placeHint?.setText('Выбери цвет в палитре и кликни по кубу — перекрасить. Готово — «Создать персонажа».');
    };
    let made = false;
    const m = new Modal(this, { title: 'Персонаж собран', width: 560, height: 280, onClose: () => !made && adjust() });
    const w = m.card.innerW;
    m.card.content.add(text(this, w / 2, 8, 'Создать персонажа сейчас или сначала поправить, где какие статы?\nКубы спишутся только при создании.', { size: 16, align: 'center', wrap: w }).setOrigin(0.5, 0));
    m.card.content.add(new Button(this, w / 2 - 130, 130, 'Поправить статы', { variant: 'beige', width: 240, height: 52, size: 19, onClick: () => m.close() }));
    m.card.content.add(
      new Button(this, w / 2 + 130, 130, 'Создать персонажа', {
        width: 240, height: 52, size: 19,
        onClick: () => {
          made = true;
          m.close();
          create();
        },
      }),
    );
  }

  private finish(manual: boolean, confirmed = false) {
    if (this.isChar() && !this.editChar && !confirmed) return this.askCreate(manual);
    this.createBtn?.destroy();
    this.createBtn = undefined;
    const bp = this.bp!;
    const blockStats = this.isChar() ? bp.blocks.map((_, i) => this.assigned.get(i)!) : undefined;
    const opts = { manual, variantKey: this.variant?.key, maxStack: store.maxStack, blockStats };
    // автосборка собирает qty штук: модель одна, результат — qty предметов (персонажей)
    const count = manual ? 1 : this.qty;
    let r = completeCraft(store.state, bp, opts);
    for (let k = 1; r && k < count; k++) {
      const more = completeCraft(r.state, bp, opts);
      if (!more) break;
      r = { state: more.state, result: r.result };
    }
    if (!r) {
      // раньше сборка молча сбрасывалась — теперь говорим почему, кубы не тратятся
      const why = craftFailure(store.state, bp, opts) ?? 'Неизвестная ошибка.';
      console.error('[craft] не удалось завершить', bp.id, why);
      const modal = new Modal(this, { title: 'Не собралось', width: 480, height: 240 });
      const w = modal.card.innerW;
      modal.card.content.add(text(this, w / 2, 30, `${why}\nКубы не потрачены.`, { size: 16, align: 'center', wrap: w }).setOrigin(0.5, 0));
      modal.card.content.add(new Button(this, w / 2, 130, 'Понятно', { width: 180, height: 48, size: 20, onClick: () => modal.close() }));
      this.resetPlacement();
      return;
    }
    this.done = true;
    store.act('craft', { blueprintId: bp.id, manual, variantKey: this.variant?.key, blockStats, count });
    this.cameras.main.flash(180, 255, 236, 180);
    const result = r.result;
    this.time.delayedCall(250, () => this.showResult(result, manual, blockStats, count));
  }

  // ───────────── изменение готового персонажа ─────────────

  private back() {
    if (this.editChar) return this.go(SCENE.characters, { charUid: this.editChar.uid } satisfies CharactersSceneData);
    this.go(SCENE.blueprints);
  }

  private createEdit(charUid: string) {
    const c = store.state.characters.find((x) => x.uid === charUid);
    if (!c || !hasBlueprint(c.blueprintId) || editLocked(store.state, charUid)) return this.go(SCENE.characters, (c ? { charUid } : {}) satisfies CharactersSceneData);
    const bp = getBlueprint(c.blueprintId);
    this.bp = bp;
    this.blueprintId = bp.id;
    this.editChar = c;
    this.orig = [...c.blockStats];
    this.locked = new Set(c.brokenBlocks);
    this.cells = [...c.blockStats];
    this.origSkinId = c.skinId ?? defaultSkinId(c.blueprintId);
    this.editSkinId = this.origSkinId;
    this.setupScreen({ title: 'Изменить персонажа', subtitle: `${c.name} · ${bp.name}`, back: null, tab: 'characters' });
    this.input.keyboard?.on('keydown-ESC', () => {
      if (!this.children.list.some((o) => o instanceof Modal)) this.back();
    });
    this.buildView(bp);
    this.buildEditPanel(bp);
    this.buildBrushBar();
    this.watch(() => this.refreshEdit());
  }

  private buildEditPanel(bp: Blueprint) {
    const panel = new Card(this, 876, 146, 364, 560, { title: 'Изменение' });
    const w = panel.innerW;
    const c = panel.content;
    c.add(text(this, 0, 0, `ПЕРСОНАЖ · ${bp.blocks.length} КУБ.`, { size: 12, color: COLOR.inkQuiet, letterSpacing: 1 }));
    this.costText = text(this, 0, 20, '', { kind: 'mono', size: 15, weight: 700 });
    c.add(this.costText);
    let y = 50;
    c.add(dottedLine(this, 0, y, w));
    this.allocator = new StatAllocator(this, 0, y + 8, w, {
      total: bp.blocks.length,
      initial: cellCounts(this.cells),
      // ниже разбитых кубов статы ползунок не опускается
      minOf: (s) => [...this.locked].filter((i) => this.orig[i] === s).length,
      onChange: (v) => {
        this.cells = rebalanceCells(bp.blocks, this.orig, this.cells, this.locked, v, COMBAT.layout.autoBuild);
        this.editChanged();
      },
      onBrush: () => this.onBrushChanged(),
    });
    c.add(this.allocator);
    y += 8 + 22 + 6 * 32 + 6;
    c.add(dottedLine(this, 0, y, w));
    this.deltaText = text(this, 0, y + 8, '', { size: 13, wrap: w });
    this.deltaText.setLineSpacing(3);
    c.add(this.deltaText);
    this.autoHint = text(this, 0, y + 46, '', { size: 12, color: COLOR.inkQuiet, wrap: w });
    c.add(this.autoHint);
    const by = panel.innerH - 72;
    this.confirmBtn = new Button(this, w / 2, by, 'Подтвердить', { width: w, height: 52, size: 20, onClick: () => this.confirmEdit() });
    this.resetBtn = new Button(this, w / 4 - 4, by + 54, 'Сбросить', { variant: 'beige', width: w / 2 - 8, height: 40, size: 18, onClick: () => this.resetEdit() });
    const cancel = new Button(this, (3 * w) / 4 + 4, by + 54, 'Отмена', { variant: 'beige', width: w / 2 - 8, height: 40, size: 18, onClick: () => this.back() });
    c.add([this.confirmBtn, this.resetBtn, cancel]);
  }

  /** Клик по модели: кисть — перекрасить / поставить этим цветом; «убрать» — убрать куб / вернуть исходный. */
  private editClick(i: number) {
    if (this.locked.has(i)) {
      this.autoHint.setText('Разбитый куб не меняется — сначала почини его.').setColor(COLOR.lose);
      this.time.delayedCall(1400, () => this.refreshEdit());
      return this.cameras.main.shake(120, 0.003);
    }
    const brush = this.allocator?.currentBrush ?? null;
    const cur = this.cells[i];
    if (brush) {
      if (cur === brush) return;
      this.cells[i] = brush;
    } else {
      this.cells[i] = cur ? null : this.orig[i];
    }
    this.editChanged();
  }

  private editChanged() {
    this.allocator?.setCounts(cellCounts(this.cells));
    this.view?.setLookOf(this.lookOf);
    this.view?.redraw();
    this.refreshEdit();
  }

  private resetEdit() {
    this.cells = [...this.orig];
    this.editSkinId = this.origSkinId;
    this.editChanged();
  }

  private refreshEdit() {
    if (!this.editChar || !this.costText) return;
    const holes = this.cells.filter((x) => !x).length;
    const changed = editChanges(this.orig, this.cells);
    const cost = editCost(this.orig, this.cells);
    const have = cubeCount(store.state);
    this.costText.setText(`Цена ${cost} куб. · есть ${have}`).setColor(have >= cost ? COLOR.ink : COLOR.lose);
    const delta = editDelta(this.orig, this.cells);
    const skinChanged = this.editSkinId !== this.origSkinId;
    const changes: string[] = [];
    if (changed || holes) changes.push(`Изменено кубов: ${changed}${delta.length ? `\n${delta.map(([s, d]) => `${STAT_SHORT[s]} ${d > 0 ? '+' : '−'}${Math.abs(d)}`).join(' · ')}` : ''}`);
    if (skinChanged) {
      const before = resolveSkin(this.editChar.blueprintId, this.origSkinId)?.name ?? 'Оригинал';
      const after = resolveSkin(this.editChar.blueprintId, this.editSkinId)?.name ?? 'Оригинал';
      changes.push(`Скин: ${before} → ${after}`);
    }
    this.deltaText?.setText(changes.length ? changes.join('\n') : 'Без изменений');
    this.autoHint
      .setText(
        holes
          ? `Пустых мест: ${holes} — поставь кубы (клик по месту или ползунок вверх).`
          : have < cost
            ? `Не хватает ${cost - have} куб.`
            : changed || skinChanged
              ? 'Подтверди, чтобы сохранить изменения.'
              : 'Перекрась кубы кистью или подвинь ползунки: ползунок вниз убирает кубы, вверх — ставит в пустые места.',
      )
      .setColor(holes || have < cost ? COLOR.lose : COLOR.inkQuiet);
    this.confirmBtn?.setCaption(cost ? `Подтвердить · ${cost} куб.` : 'Подтвердить');
    this.confirmBtn?.setEnabled(!holes && (changed > 0 || skinChanged) && have >= cost);
    this.resetBtn.setEnabled(changed > 0 || holes > 0 || skinChanged);
    const current = store.state.characters.find((c) => c.uid === this.editChar!.uid) ?? this.editChar;
    const currentSkin = this.editSkinId ?? current.skinId ?? defaultSkinId(current.blueprintId);
    for (const skin of this.skinTiles) {
      const selected = currentSkin === skin.id;
      skin.frame.setStrokeStyle(3, selected ? 0x4a2a12 : 0x6b5438, selected ? 1 : 0.35);
      skin.check.setVisible(selected);
    }
  }

  private confirmEdit() {
    const c = this.editChar;
    if (!c) return;
    const cubesChanged = editChanges(this.orig, this.cells) > 0;
    const skinChanged = !!this.editSkinId && this.editSkinId !== this.origSkinId;
    if (!cubesChanged && !skinChanged) return;
    if (cubesChanged) {
      const next = applyCharacterEdit(store.state, c.uid, this.cells);
      if (!next) return this.cameras.main.shake(120, 0.003);
      store.act('editCharacter', c.uid, [...this.cells]);
    }
    if (skinChanged) store.act('setSkin', c.uid, this.editSkinId!);
    this.cameras.main.flash(180, 255, 236, 180);
    this.time.delayedCall(200, () => this.go(SCENE.characters, { charUid: c.uid } satisfies CharactersSceneData));
  }

  /** « · для Варан 1 · Левая рука», если чертёж подходит под ячейку, из которой пришли. */
  private forWhom(bp: Blueprint): string {
    const t = this.craftTarget;
    if (!t || bp.kind === 'character') return '';
    const itemId = 'variants' in bp ? bp.variants[0]?.itemId : bp.itemId;
    if (!itemId || !targetFit(store.state, t, getItem(itemId))) return '';
    return ` · для ${targetLabel(store.state, t)}`;
  }

  private showResult(result: CraftResult, manual: boolean, blockStats?: Stat[], count = 1) {
    const bp = this.bp!;
    // закрыть итог крестиком — сразу новая сборка этого чертежа (вариант и количество можно сменить)
    const modal = new Modal(this, { title: 'Готово', width: 560, height: 390, onClose: () => this.scene.restart({ blueprintId: bp.id } satisfies CraftSceneData) });
    const c = modal.card.content;
    const w = modal.card.innerW;
    let name: string;
    if (result.kind === 'item') {
      const item = getItem(result.itemId);
      name = item.name;
      const icon = createItemIcon(this, item, 120) as Phaser.GameObjects.Components.Transform & Phaser.GameObjects.GameObject;
      icon.setPosition(w / 2, 70);
      c.add(icon);
    } else {
      name = store.state.characters.find((x) => x.uid === result.charUid)?.name ?? bp.name;
      c.add(new VoxelView(this, w / 2, 70, { blocks: bp.blocks, width: 220, height: 120, yaw: 180, colorOf: (i) => (blockStats ? STAT_COLOR[blockStats[i]] : undefined) }));
    }
    const where = result.kind === 'item' ? 'в инвентаре' : 'боец в окне «Персонажи»: там снаряжение и имя';
    c.add(text(this, w / 2, 150, count > 1 ? `${name} ×${count}` : name, { kind: 'display', size: 24 }).setOrigin(0.5, 0));
    c.add(text(this, w / 2, 184, `Готово, ${where}.`, { size: 15, align: 'center', wrap: w }).setOrigin(0.5, 0));
    if (manual) c.add(text(this, w / 2, 210, 'Для этого чертежа открыта «Автосборка».', { size: 13, color: COLOR.inkQuiet }).setOrigin(0.5, 0));
    const again = new Button(this, w / 2 - 170, 270, 'Ещё раз', {
      variant: 'beige', width: 160, height: 48, size: 20,
      onClick: () => this.scene.restart({ blueprintId: bp.id } satisfies CraftSceneData),
    });
    const toList = new Button(this, w / 2, 270, 'Чертежи', { variant: 'beige', width: 160, height: 48, size: 20, onClick: () => this.go(SCENE.blueprints) });
    // снаряжение надевается / кладётся в рюкзак в «Персонажах»; камни пока только лежат в инвентаре
    const toInventory = result.kind === 'item' && getItem(result.itemId).kind === 'gem';
    const toChars = (charUid?: string) => this.go(SCENE.characters, (charUid ? { charUid } : {}) satisfies CharactersSceneData);
    // пришли из ячейки бойца — вместо «Персонажи» сразу «Надеть» / «В рюкзак»
    const target = this.craftTarget;
    const fit = target && result.kind === 'item' ? targetFit(store.state, target, getItem(result.itemId)) : null;
    let toResult: Button;
    if (target && fit === 'ok' && result.kind === 'item') {
      const label = 'bagCell' in target ? 'В рюкзак' : 'Надеть';
      toResult = new Button(this, w / 2 + 170, 270, label, {
        width: 160, height: 48, size: 20,
        onClick: () => {
          const next = applyTarget(store.state, target, result.itemId);
          if (next) store.act('craftToTarget', target, result.itemId);
          this.setCraftTarget(null);
          toChars(target.charUid);
        },
      });
      c.add(text(this, w / 2, 230, `${label}: ${targetLabel(store.state, target)}`, { size: 13, color: COLOR.inkQuiet }).setOrigin(0.5, 0));
    } else {
      if (target && fit) c.add(text(this, w / 2, 230, `${fit} (${targetLabel(store.state, target)}).`, { size: 13, color: COLOR.lose }).setOrigin(0.5, 0));
      toResult = new Button(this, w / 2 + 170, 270, toInventory ? 'Инвентарь' : 'Персонажи', {
        width: 160, height: 48, size: 20,
        onClick: () => (toInventory ? this.go(SCENE.inventory) : toChars(result.kind === 'character' ? result.charUid : target?.charUid)),
      });
    }
    c.add([again, toList, toResult]);
  }
}
