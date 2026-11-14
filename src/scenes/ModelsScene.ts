import Phaser from 'phaser';
import { BaseScene } from './BaseScene';
import { SCENE } from './keys';
import { isUnlocked } from '../core/craft';
import { BLUEPRINT_KIND_LABEL, ROTATION_BLUEPRINTS, blueprintCost, getItem, itemModel } from '../data/catalog';
import type { BlockGeometry, Blueprint, BlueprintKind } from '../data/types';
import { STAT_LABEL } from '../data/labels';
import { weaponLevelName } from '../data/weaponLooks';
import { store } from '../game/store';
import { Button } from '../ui/Button';
import { Card, dottedLine } from '../ui/Panel';
import { TEX } from '../ui/textures';
import { text } from '../ui/text';
import { COLOR, STAT_COLOR } from '../ui/theme';
import { VoxelView } from '../ui/VoxelView';

const LEVELS = [1, 2, 3];

/** Собранный боец игрока по этому чертежу — его кубы показывают настоящую раскраску по статам. */
const ownerOf = (bp: Blueprint) => (bp.kind === 'character' ? store.state.characters.find((c) => c.blueprintId === bp.id) : undefined);

/**
 * Просмотр моделей чертежей в ротации: оружие — по уровням (обычное, улучшенное, сияющее),
 * зелья — по вариантам, персонаж — в цветах собранного бойца.
 */
export class ModelsScene extends BaseScene {
  private current!: Blueprint;
  private view?: VoxelView;
  private viewCard!: Card;
  private info!: Phaser.GameObjects.Text;
  private hoverInfo!: Phaser.GameObjects.Text;
  private yawText!: Phaser.GameObjects.Text;
  private rows = new Map<string, Phaser.GameObjects.Text>();
  private list!: Card;
  private listRows!: Phaser.GameObjects.Container;
  private kindChips = new Map<BlueprintKind, Phaser.GameObjects.Text>();
  /** false — бесцветный чертёж; true — цвета предмета или кубы собранного бойца. */
  private statColors = true;
  private level = 1;
  private variant = 0;
  private blocks: BlockGeometry[] = [];
  private chips!: Phaser.GameObjects.Container;
  private slotsVisible = true;
  private colorBtn!: Button;
  private slotBtn!: Button;

  constructor() {
    super(SCENE.models);
  }

  create() {
    this.setupScreen({ title: 'Модели', subtitle: 'Все кубы и призмы одного размера · поворот ← → или Q / E · наведи на блок' });
    this.rows.clear();
    this.view = undefined;

    // тип чертежа (2 ряда по 3) и список чертежей этого типа
    this.list = new Card(this, 40, 150, 300, 540, { title: 'Чертежи' });
    this.kindChips.clear();
    const kinds = (Object.keys(BLUEPRINT_KIND_LABEL) as BlueprintKind[]).filter((kind) => ROTATION_BLUEPRINTS().some((b) => b.kind === kind));
    kinds.forEach((kind, i) => {
      const perRow = kinds.length <= 4 ? kinds.length : 3;
      const t = text(this, (i % perRow) * (this.list.innerW / perRow), Math.floor(i / perRow) * 24, BLUEPRINT_KIND_LABEL[kind], { kind: 'display', size: 15, color: COLOR.inkQuiet })
        .setInteractive({ useHandCursor: true })
        .on('pointerup', () => this.showKind(kind));
      this.list.content.add(t);
      this.kindChips.set(kind, t);
    });
    this.listRows = this.add.container(0, 60);
    this.list.content.add(this.listRows);

    // сама модель
    this.viewCard = new Card(this, 360, 150, 560, 540, { title: ' ' });
    const arrowY = this.viewCard.innerH - 22;
    const left = this.add.image(this.viewCard.innerW / 2 - 70, arrowY, TEX.arrowLeft).setScale(2).setInteractive({ useHandCursor: true });
    const right = this.add.image(this.viewCard.innerW / 2 + 70, arrowY, TEX.arrowRight).setScale(2).setInteractive({ useHandCursor: true });
    left.on('pointerup', () => this.rotate(-1));
    right.on('pointerup', () => this.rotate(1));
    this.yawText = text(this, this.viewCard.innerW / 2, arrowY, '0°', { kind: 'mono', size: 14, color: COLOR.inkQuiet }).setOrigin(0.5);
    this.chips = this.add.container(0, 0);
    this.viewCard.content.add([left, right, this.yawText, this.chips]);

    // информация и переключатели
    const side = new Card(this, 940, 150, 300, 540, { title: 'Инфо' });
    this.info = text(this, 0, 0, '', { size: 15, wrap: side.innerW });
    this.info.setLineSpacing(4);
    side.content.add(this.info);
    this.colorBtn = new Button(this, side.innerW / 2, 222, '', { variant: 'beige', width: side.innerW, height: 44, size: 18, onClick: () => this.toggleColors() });
    this.slotBtn = new Button(this, side.innerW / 2, 274, '', { variant: 'beige', width: side.innerW, height: 44, size: 18, onClick: () => this.toggleSlots() });
    side.content.add([this.colorBtn, this.slotBtn, dottedLine(this, 0, 308, side.innerW)]);
    this.hoverInfo = text(this, 0, 320, '', { kind: 'mono', size: 12, color: COLOR.inkQuiet, wrap: side.innerW });
    this.hoverInfo.setLineSpacing(3);
    side.content.add(this.hoverInfo);

    this.input.keyboard?.on('keydown-LEFT', () => this.rotate(-1));
    this.input.keyboard?.on('keydown-Q', () => this.rotate(-1));
    this.input.keyboard?.on('keydown-RIGHT', () => this.rotate(1));
    this.input.keyboard?.on('keydown-E', () => this.rotate(1));

    this.showKind(kinds[0]);
  }

  private showKind(kind: BlueprintKind) {
    for (const [k, t] of this.kindChips) t.setColor(k === kind ? COLOR.ink : COLOR.inkQuiet).setFontStyle(k === kind ? 'bold' : '');
    this.listRows.removeAll(true);
    this.rows.clear();
    const items = ROTATION_BLUEPRINTS().filter((b) => b.kind === kind);
    items.forEach((bp, i) => {
      const y = i * 24;
      const row = text(this, 0, y, bp.name, { size: 15, wrap: this.list.innerW - 30 }).setInteractive({ useHandCursor: true });
      row.on('pointerup', () => this.select(bp));
      row.on('pointerover', () => row !== this.rows.get(this.current?.id) && row.setColor(COLOR.inkQuiet));
      row.on('pointerout', () => row !== this.rows.get(this.current?.id) && row.setColor(COLOR.ink));
      this.listRows.add(row);
      const locked = !isUnlocked(store.state, bp.id);
      this.listRows.add(text(this, this.list.innerW, y + 1, locked ? `закрыт · ${blueprintCost(bp)}` : String(blueprintCost(bp)), { kind: 'mono', size: 12, color: COLOR.inkQuiet }).setOrigin(1, 0));
      this.rows.set(bp.id, row);
    });
    this.select(items[0]);
  }

  private select(bp: Blueprint) {
    for (const r of this.rows.values()) r.setColor(COLOR.ink).setFontStyle('');
    this.current = bp;
    this.rows.get(bp.id)?.setColor(COLOR.ink).setFontStyle('bold');
    this.level = 1;
    this.variant = 0;
    this.show(0);
  }

  /** Блоки показанной модели: у оружия — модель выбранного уровня. */
  private modelBlocks(): BlockGeometry[] {
    const bp = this.current;
    return bp.kind === 'weapon' ? itemModel(bp.itemId, this.level)?.blocks ?? bp.blocks : bp.blocks;
  }

  /** Цвет блока при включённых цветах: кубы бойца, жидкость зелья; остальное — цвета самой модели. */
  private colorOf(): ((i: number) => number | undefined) | undefined {
    const bp = this.current;
    const owner = ownerOf(bp);
    if (owner) return (i) => STAT_COLOR[owner.blockStats[i]];
    if (bp.kind !== 'potion' && bp.kind !== 'gem') return undefined;
    const item = getItem(bp.variants[this.variant].itemId);
    const tint = 'tint' in item ? parseInt(item.tint.slice(1), 16) : undefined;
    return (i) => (this.blocks[i]?.tinted ? tint : undefined);
  }

  /** Цвета есть у предметов и у персонажа с собранным бойцом; иначе модель бесцветная. */
  private colored() {
    return this.statColors && (this.current.kind !== 'character' || !!ownerOf(this.current));
  }

  private show(yaw: number) {
    const bp = this.current;
    const isChar = bp.kind === 'character';
    this.view?.destroy();
    this.blocks = this.modelBlocks();
    const colored = this.colored();
    this.view = new VoxelView(this, this.viewCard.innerW / 2, (this.viewCard.innerH - 50) / 2 + 10, {
      blocks: this.blocks,
      width: this.viewCard.innerW - 20,
      height: this.viewCard.innerH - 90,
      slots: isChar ? bp.slots.filter((s) => s.type === 'Hand') : undefined,
      colorOf: colored ? this.colorOf() : undefined,
      neutral: !colored,
      interactive: true,
      maxBlockPx: 46,
      yaw,
    });
    this.view.setSlotsVisible(this.slotsVisible);
    this.view.on('blockover', (i: number) => this.showBlock(i));
    this.view.on('blockout', () => this.hoverInfo.setText('Наведи на блок —\nздесь его данные.'));
    this.viewCard.content.add(this.view);
    this.yawText.setText(`${yaw}°`);
    this.hoverInfo.setText('Наведи на блок —\nздесь его данные.');
    this.drawChips();

    const cubes = this.blocks.filter((b) => b.shape === 'cube').length;
    const lines = [
      bp.kind === 'weapon' ? weaponLevelName(bp.name, this.level) : bp.name,
      `Тип: ${BLUEPRINT_KIND_LABEL[bp.kind].toLowerCase()}`,
      `Чертёж: ${isUnlocked(store.state, bp.id) ? 'открыт' : 'закрыт'}`,
      `Блоков: ${this.blocks.length} (кубов ${cubes}, призм ${this.blocks.length - cubes})`,
      `Крафт: ${blueprintCost(bp)} куб.`,
    ];
    if (bp.kind === 'weapon') lines.push(`По уровням: ${LEVELS.map((l) => itemModel(bp.itemId, l)?.blocks.length ?? bp.blocks.length).join(' / ')}`);
    if (isChar) {
      lines.push(`Категория: ${bp.category}`);
      lines.push(`Слоты рук: ${bp.slots.filter((s) => s.type === 'Hand').length}`);
    }
    this.info.setText(lines.join('\n'));
    this.colorBtn.setCaption(this.colorCaption()).setEnabled(!isChar || !!ownerOf(bp));
    this.slotBtn.setCaption(this.slotsVisible ? 'Слоты: показаны' : 'Слоты: скрыты').setEnabled(isChar);
  }

  /** Переключатель над моделью: уровни оружия или варианты зелья. */
  private drawChips() {
    const bp = this.current;
    this.chips.removeAll(true);
    const labels = bp.kind === 'weapon' ? LEVELS.map((l) => `УР. ${l}`) : bp.kind === 'potion' || bp.kind === 'gem' ? bp.variants.map((v) => v.label.toUpperCase()) : [];
    if (labels.length < 2) return;
    const active = bp.kind === 'weapon' ? this.level - 1 : this.variant;
    const made = labels.map((label, i) => {
      const on = i === active;
      const chip = text(this, 0, 0, label, { kind: 'display', size: 15, color: on ? COLOR.ink : COLOR.inkQuiet }).setFontStyle(on ? 'bold' : '').setInteractive({ useHandCursor: true });
      chip.on('pointerup', () => {
        if (bp.kind === 'weapon') this.level = i + 1;
        else this.variant = i;
        this.show((Math.round((this.view?.currentYaw ?? 0) / 90) * 90) % 360);
      });
      return chip;
    });
    const gap = 18;
    const total = made.reduce((sum, chip) => sum + chip.width, 0) + gap * (made.length - 1);
    let x = (this.viewCard.innerW - total) / 2;
    for (const chip of made) {
      chip.setX(x);
      x += chip.width + gap;
    }
    this.chips.add(made);
    this.viewCard.content.bringToTop(this.chips);
  }

  private showBlock(i: number) {
    const block = this.blocks[i];
    const lines = [`БЛОК #${i}`, `форма  ${block.shape === 'cube' ? 'куб' : 'призма'}`, `поз    ${block.pos.join(', ')}`, `пов    ${block.rot.join(', ')}`];
    const owner = ownerOf(this.current);
    if (owner && this.colored()) lines.push(`стата  ${STAT_LABEL[owner.blockStats[i]]}`);
    this.hoverInfo.setText(lines.join('\n'));
  }

  private rotate(step: number) {
    if (!this.view) return;
    this.view.rotateBy(step);
    const yaw = (((Math.round(this.view.currentYaw / 90) + step) * 90) % 360 + 360) % 360;
    this.yawText.setText(`${yaw}°`);
  }

  private toggleColors() {
    this.statColors = !this.statColors;
    const colored = this.colored();
    this.view?.setColorOf(colored ? this.colorOf() : undefined).setNeutral(!colored);
    this.colorBtn.setCaption(this.colorCaption());
  }

  private colorCaption() {
    const owner = ownerOf(this.current);
    if (this.current.kind === 'character' && !owner) return 'Цвета: нет бойца';
    if (!this.statColors) return 'Цвета: чертёж';
    return owner ? `Цвета: ${owner.name}` : 'Цвета: предмет';
  }

  private toggleSlots() {
    this.slotsVisible = !this.slotsVisible;
    this.view?.setSlotsVisible(this.slotsVisible);
    this.slotBtn.setCaption(this.slotsVisible ? 'Слоты: показаны' : 'Слоты: скрыты');
  }
}
