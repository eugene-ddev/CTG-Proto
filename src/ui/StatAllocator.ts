import Phaser from 'phaser';
import { isDragRelease } from './dragGuard';
import { STATS, type Stat } from '../data/types';
import { STAT_LABEL } from '../data/labels';
import { emptyCounts, totalCount, type StatCounts } from '../core/stats';
import { text } from './text';
import { COLOR, STAT_COLOR } from './theme';

export interface StatAllocatorOpts {
  /** Сколько кубов распределить — число блоков чертежа. */
  total: number;
  initial: StatCounts;
  /** Ниже этого значения ползунок не опускается (уже поставленные кубы статы). */
  minOf?: (s: Stat) => number;
  onChange?: (counts: StatCounts) => void;
  onBrush?: (s: Stat | null) => void;
}

const ROW_H = 32;

/**
 * Распределение кубов персонажа по 6 статам: ползунок, −/+ и число на строку.
 * Клик по названию выбирает цвет вручную (повторный клик — снова «авто»).
 * Левый верхний угол в (x, y), ширина w.
 */
export class StatAllocator extends Phaser.GameObjects.Container {
  private counts: StatCounts;
  /** Цвет, выбранный вручную; null — «авто», цвет берётся из ползунков. */
  private brush: Stat | null = null;
  private readonly rows = new Map<Stat, { bg: Phaser.GameObjects.Rectangle; fill: Phaser.GameObjects.Rectangle; knob: Phaser.GameObjects.Rectangle; value: Phaser.GameObjects.Text }>();
  private readonly header: Phaser.GameObjects.Text;
  private readonly trackX: number;
  private readonly trackW: number;

  constructor(scene: Phaser.Scene, x: number, y: number, w: number, private readonly opts: StatAllocatorOpts) {
    super(scene, x, y);
    this.counts = { ...emptyCounts(), ...opts.initial };
    this.header = text(scene, 0, 0, '', { size: 12, color: COLOR.inkQuiet, letterSpacing: 1 });
    this.add(this.header);

    this.trackX = 124;
    this.trackW = w - this.trackX - 64;
    STATS.forEach((s, i) => {
      const ry = 22 + i * ROW_H;
      const bg = scene.add.rectangle(-4, ry - 3, w + 8, ROW_H - 2, 0xffffff, 0).setOrigin(0).setStrokeStyle(2, 0x4a2a12, 0);
      const pick = scene.add.zone(-4, ry - 3, this.trackX - 22, ROW_H - 2).setOrigin(0).setInteractive({ useHandCursor: true });
      pick.on('pointerup', () => !isDragRelease(this.scene) && this.setBrush(this.brush === s ? null : s));
      const sw = scene.add.rectangle(0, ry + 5, 16, 16, STAT_COLOR[s]).setOrigin(0).setStrokeStyle(1, 0x000000, 0.35);
      const label = text(scene, 22, ry + 13, STAT_LABEL[s], { size: 13 }).setOrigin(0, 0.5);
      const minus = this.stepButton(this.trackX - 16, ry + 13, '−', () => this.set(s, this.counts[s] - 1));
      const track = scene.add.rectangle(this.trackX, ry + 9, this.trackW, 8, 0x000000, 0.12).setOrigin(0);
      const fill = scene.add.rectangle(this.trackX, ry + 9, 0, 8, STAT_COLOR[s], 1).setOrigin(0);
      const knob = scene.add.rectangle(this.trackX, ry + 13, 8, 18, 0x4a2a12, 1).setOrigin(0.5);
      const hit = scene.add.zone(this.trackX - 6, ry, this.trackW + 12, 26).setOrigin(0).setInteractive({ useHandCursor: true, draggable: true });
      const fromPointer = (p: Phaser.Input.Pointer) => {
        const local = this.getWorldTransformMatrix().applyInverse(p.x, p.y);
        const k = Phaser.Math.Clamp((local.x - this.trackX) / this.trackW, 0, 1);
        this.set(s, Math.round(k * opts.total));
      };
      hit.on('pointerdown', fromPointer);
      hit.on('drag', (p: Phaser.Input.Pointer) => fromPointer(p));
      const plus = this.stepButton(this.trackX + this.trackW + 16, ry + 13, '+', () => this.set(s, this.counts[s] + 1));
      const value = text(scene, w, ry + 13, '0', { kind: 'mono', size: 14, weight: 700 }).setOrigin(1, 0.5);
      this.add([bg, pick, sw, label, minus, track, fill, knob, hit, plus, value]);
      this.rows.set(s, { bg, fill, knob, value });
    });
    this.setSize(w, 22 + STATS.length * ROW_H);
    this.refresh();
    scene.add.existing(this);
  }

  get value(): StatCounts {
    return { ...this.counts };
  }

  get currentBrush(): Stat | null {
    return this.brush;
  }

  get remaining() {
    return this.opts.total - totalCount(this.counts);
  }

  setBrush(s: Stat | null) {
    this.brush = s;
    this.refresh();
    this.opts.onBrush?.(s);
  }

  /** Подставить значения снаружи (без onChange). */
  setCounts(c: StatCounts) {
    this.counts = { ...c };
    this.refresh();
    return this;
  }

  /** Поставить значение статы с учётом остатка бюджета и минимума. */
  set(s: Stat, v: number) {
    const min = this.opts.minOf?.(s) ?? 0;
    const max = this.counts[s] + this.remaining;
    const next = Phaser.Math.Clamp(Math.round(v), min, max);
    if (next === this.counts[s]) return;
    this.counts = { ...this.counts, [s]: next };
    this.refresh();
    this.opts.onChange?.(this.value);
  }

  refresh() {
    const left = this.remaining;
    this.header.setText(left > 0 ? `СТАТЫ · РАСПРЕДЕЛИ ЕЩЁ ${left}` : 'СТАТЫ · ВСЁ РАСПРЕДЕЛЕНО');
    this.header.setColor(left > 0 ? COLOR.lose : COLOR.inkQuiet);
    for (const s of STATS) {
      const r = this.rows.get(s)!;
      const k = this.opts.total ? this.counts[s] / this.opts.total : 0;
      r.fill.width = this.trackW * k;
      r.knob.x = this.trackX + this.trackW * k;
      r.value.setText(String(this.counts[s]));
      const on = s === this.brush;
      r.bg.setStrokeStyle(2, 0x4a2a12, on ? 1 : 0).setFillStyle(0xffffff, on ? 0.35 : 0);
    }
  }

  private stepButton(x: number, y: number, label: string, onClick: () => void) {
    const t = text(this.scene, x, y, label, { kind: 'mono', size: 16, weight: 700 }).setOrigin(0.5).setInteractive({ useHandCursor: true });
    t.on('pointerup', () => !isDragRelease(this.scene) && onClick());
    t.on('pointerover', () => t.setColor(COLOR.inkQuiet)).on('pointerout', () => t.setColor(COLOR.ink));
    return t;
  }
}
