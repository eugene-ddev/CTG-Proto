import Phaser from 'phaser';
import { isDragRelease } from './dragGuard';
import { panel } from './Panel';
import { text } from './text';
import { COLOR } from './theme';
import { attachTooltip, type TooltipContent } from './Tooltip';
import { getItem, hasItem } from '../data/catalog';
import type { Item } from '../data/types';

export interface SlotOpts {
  size?: number;
  /** Подпись в слоте сверху: «РУКА», «АРТЕФАКТ». */
  label?: string;
  /** Подпись под иконкой: «РЖАВЫЙ МОЛОТ». */
  caption?: string;
  tooltip?: () => TooltipContent | null;
  onClick?: () => void;
}

/** Слот снаряжения/инвентаря. Центр в (x, y). Пустой слот показывает «+». */
export class Slot extends Phaser.GameObjects.Container {
  readonly size: number;
  private readonly frame: Phaser.GameObjects.Graphics;
  private readonly plus: Phaser.GameObjects.Text;
  /** Зона нажатия — для перетаскивания и проверки «под курсором». */
  readonly hit: Phaser.GameObjects.Zone;
  private readonly captionText?: Phaser.GameObjects.Text;
  private icon?: Phaser.GameObjects.GameObject;
  private countText?: Phaser.GameObjects.Text;
  private gemPips?: Phaser.GameObjects.Container;
  private hovered = false;
  private selected = false;
  /** Отпускание после перетаскивания — не клик. */
  suppressClick = false;
  private accent?: number;

  constructor(scene: Phaser.Scene, x: number, y: number, opts: SlotOpts = {}) {
    super(scene, x, y);
    const s = (this.size = opts.size ?? 72);
    const half = s / 2;
    this.add(panel(scene, -half, -half, s, s, 'beige'));
    if (opts.label) {
      this.add(text(scene, 0, -half + 6, opts.label.toUpperCase(), { size: 10, color: COLOR.inkQuiet, letterSpacing: 1 }).setOrigin(0.5, 0));
    }
    this.plus = text(scene, 0, opts.label ? 4 : 0, '+', { kind: 'display', size: Math.round(s * 0.55), color: COLOR.ink }).setOrigin(0.5);
    this.add(this.plus);
    if (opts.caption) {
      this.captionText = text(scene, 0, half - 6, opts.caption.toUpperCase(), { size: 9, color: COLOR.inkQuiet }).setOrigin(0.5, 1);
      this.add(this.captionText);
    }
    this.frame = scene.add.graphics();
    this.add(this.frame);
    this.hit = scene.add.zone(0, 0, s, s).setInteractive({ useHandCursor: !!opts.onClick });
    this.add(this.hit);

    this.hit.on('pointerover', () => this.highlight(true));
    this.hit.on('pointerout', () => this.highlight(false));
    if (opts.onClick) this.hit.on('pointerup', () => {
      if (isDragRelease(this.scene)) return;
      if (!this.suppressClick) opts.onClick!();
      this.suppressClick = false;
    });
    if (opts.tooltip) attachTooltip(this.hit, opts.tooltip);
    this.setSize(s, s);
    scene.add.existing(this);
  }

  /** Положить в слот объект-иконку (спрайт, превью модели). null — очистить. */
  setContent(icon: Phaser.GameObjects.GameObject | null, count?: number) {
    this.icon?.destroy();
    this.countText?.destroy();
    this.gemPips?.destroy();
    this.icon = undefined;
    this.countText = undefined;
    this.gemPips = undefined;
    this.plus.setVisible(!icon);
    if (icon) {
      this.addAt(icon, 1);
      this.icon = icon;
      if (count && count > 1) {
        const h = this.size / 2;
        this.countText = text(this.scene, -h + 6, h - 6, String(count), { kind: 'mono', size: 12, weight: 700 }).setOrigin(0, 1);
        this.add(this.countText);
      }
    }
    return this;
  }

  /**
   * Ячейки камней оружия — точками в правом нижнем углу: вставленный камень — его цветом, пустая ячейка — контуром.
   * Уровень цифрой не пишется: он виден по модели оружия.
   */
  setItemGems(item: Item | null | undefined) {
    this.gemPips?.destroy();
    this.gemPips = undefined;
    if (!item || item.kind !== 'weapon' || item.gemSlots <= 0) return this;
    const gems = item.gems ?? [];
    const small = this.size < 52;
    const r = small ? 3 : 4;
    const gap = small ? 2 : 3;
    const pad = 3;
    const n = item.gemSlots;
    const bw = n * 2 * r + (n - 1) * gap + pad * 2;
    const bh = 2 * r + pad * 2;
    const h = this.size / 2;
    const pips = this.scene.add.graphics();
    pips.fillStyle(0x4a2a12, 0.92).fillRoundedRect(-bw, -bh, bw, bh, 3);
    for (let k = 0; k < n; k++) {
      const cx = -bw + pad + r + k * (2 * r + gap);
      const gem = gems[k] && hasItem(gems[k]) ? getItem(gems[k]) : null;
      if (gem && gem.kind === 'gem') pips.fillStyle(parseInt(gem.tint.slice(1), 16), 1).fillCircle(cx, -bh / 2, r).lineStyle(1, 0xffffff, 0.7).strokeCircle(cx, -bh / 2, r);
      else pips.lineStyle(1, 0xffffff, 0.55).strokeCircle(cx, -bh / 2, r - 0.5);
    }
    this.gemPips = this.scene.add.container(h - 3, h - 3, [pips]);
    this.add(this.gemPips);
    return this;
  }

  /** Постоянная рамка выбранного слота (наведение рисуется поверх жёлтым). */
  setSelected(on: boolean) {
    this.selected = on;
    this.drawFrame();
    return this;
  }

  /** Подсветка цели при перетаскивании: зелёная — можно положить. null — убрать. */
  setAccent(color: number | null) {
    this.accent = color ?? undefined;
    this.drawFrame();
    return this;
  }

  private highlight(on: boolean) {
    this.hovered = on;
    this.drawFrame();
  }

  private drawFrame() {
    const h = this.size / 2;
    this.frame.clear();
    if (this.accent !== undefined) this.frame.lineStyle(3, this.accent, 1).strokeRoundedRect(-h + 1, -h + 1, this.size - 2, this.size - 2, 6);
    if (this.selected) this.frame.lineStyle(3, 0x4a2a12, 1).strokeRoundedRect(-h + 1, -h + 1, this.size - 2, this.size - 2, 6);
    if (this.hovered) this.frame.lineStyle(2, COLOR.highlight, 1).strokeRoundedRect(-h + 1, -h + 1, this.size - 2, this.size - 2, 6);
  }
}

/**
 * Тёмная плашка приоритета атаки блоков («БРН» с номером в углу).
 * Центр в (x, y).
 */
export class BlockChip extends Phaser.GameObjects.Container {
  constructor(scene: Phaser.Scene, x: number, y: number, label: string, index: number, w = 116, h = 52) {
    super(scene, x, y);
    const g = scene.add.graphics();
    g.fillStyle(COLOR.slotDark, 1).fillRoundedRect(-w / 2, -h / 2, w, h, 4);
    g.lineStyle(2, COLOR.slotDarkBorder, 1).strokeRoundedRect(-w / 2, -h / 2, w, h, 4);
    this.add(g);
    this.add(text(scene, -w / 2 + 7, -h / 2 + 4, String(index), { kind: 'mono', size: 11, color: COLOR.light }));
    this.add(text(scene, 0, 0, label, { kind: 'display', size: 26, color: '#ffffff' }).setOrigin(0.5));
    this.setSize(w, h);
    scene.add.existing(this);
  }
}
