import Phaser from 'phaser';
import { text, type TextOpts } from './text';

const BAR_W = 4;
/** Зазор между содержимым и полосой прокрутки. */
const BAR_GAP = 8;

/** Скрытое за краем области не должно ловить клики (кнопки внутри контейнеров — тоже). */
function setInputEnabled(o: Phaser.GameObjects.GameObject, on: boolean) {
  if (o.input) o.input.enabled = on;
  if (o instanceof Phaser.GameObjects.Container) for (const c of o.list) setInputEnabled(c, on);
}
const WHEEL_K = 0.5;

/**
 * Область с вертикальной прокруткой колесом мыши (и перетаскиванием ползунка справа).
 * Масок нет (в Phaser 4 это фильтры): всё, что не помещается в окно целиком, просто скрыто,
 * поэтому содержимое собирается из невысоких кусков — строк; длинный текст — addLines (по строке на объект).
 * Левый верхний угол в (x, y), окно w × h. Дети — в `content`; после наполнения — layout().
 */
export class ScrollArea extends Phaser.GameObjects.Container {
  readonly content: Phaser.GameObjects.Container;
  private offset = 0;
  private contentH = 0;
  private readonly bar: Phaser.GameObjects.Graphics;
  private readonly knob: Phaser.GameObjects.Zone;
  private dragY0: number | null = null;

  constructor(scene: Phaser.Scene, x: number, y: number, readonly w: number, readonly h: number) {
    super(scene, x, y);
    this.content = scene.add.container(0, 0);
    this.bar = scene.add.graphics();
    this.knob = scene.add.zone(w + BAR_GAP + BAR_W / 2, 0, 14, 10).setOrigin(0.5, 0).setInteractive({ useHandCursor: true, draggable: true });
    this.add([this.content, this.bar, this.knob]);
    const onWheel = (p: Phaser.Input.Pointer, _o: unknown, _dx: number, dy: number) => {
      if (this.active && this.visible && this.hitsPointer(p)) this.scrollBy(dy * WHEEL_K);
    };
    scene.input.on('wheel', onWheel);
    this.once(Phaser.GameObjects.Events.DESTROY, () => scene.input.off('wheel', onWheel));
    this.knob.on('dragstart', () => (this.dragY0 = this.offset));
    this.knob.on('drag', (_p: Phaser.Input.Pointer, _x: number, dragY: number) => {
      if (this.dragY0 === null) return;
      const track = this.h - this.knobH();
      if (track > 0) this.scrollTo((dragY / track) * this.maxOffset());
    });
    this.knob.on('dragend', () => (this.dragY0 = null));
    scene.add.existing(this);
  }

  /** Курсор над окном области (мировые координаты). */
  hitsPointer(p: Phaser.Input.Pointer): boolean {
    const m = this.getWorldTransformMatrix();
    const x = p.x - m.tx;
    const y = p.y - m.ty;
    return x >= 0 && x <= this.w + BAR_GAP + BAR_W + 6 && y >= 0 && y <= this.h;
  }

  /** Строки длинного текста — отдельными объектами, чтобы скрывались по одной. Возвращает высоту. */
  addLines(x: number, y: number, value: string, opts: TextOpts & { wrap: number; lineGap?: number }): number {
    const probe = text(this.scene, 0, 0, value, opts);
    const lines = probe.getWrappedText(value);
    const lineH = Math.ceil(probe.height / Math.max(1, lines.length)) + (opts.lineGap ?? 0);
    probe.destroy();
    lines.forEach((ln, k) => this.content.add(text(this.scene, x, y + k * lineH, ln, { ...opts, wrap: undefined })));
    return lines.length * lineH;
  }

  /** Пересчитать высоту содержимого и видимость; contentH — если известна (иначе по детям). */
  layout(contentH?: number) {
    this.contentH = contentH ?? this.measure();
    this.scrollTo(this.offset);
    return this;
  }

  scrollBy(d: number) {
    this.scrollTo(this.offset + d);
  }

  scrollTo(v: number) {
    this.offset = Phaser.Math.Clamp(v, 0, this.maxOffset());
    this.content.y = -this.offset;
    this.cull();
    this.drawBar();
  }

  private maxOffset() {
    return Math.max(0, this.contentH - this.h);
  }

  private measure() {
    let bottom = 0;
    for (const c of this.content.list) {
      const r = this.localRect(c as Phaser.GameObjects.GameObject);
      if (r) bottom = Math.max(bottom, r.bottom);
    }
    return bottom;
  }

  /** Вертикальные границы ребёнка в координатах содержимого (без прокрутки). */
  private localRect(c: Phaser.GameObjects.GameObject): { top: number; bottom: number } | null {
    const any = c as unknown as { getBounds?: () => Phaser.Geom.Rectangle };
    if (!any.getBounds) return null;
    const b = any.getBounds();
    const top = b.y - this.getWorldTransformMatrix().ty + this.offset;
    return { top, bottom: top + b.height };
  }

  private cull() {
    for (const c of this.content.list) {
      const r = this.localRect(c as Phaser.GameObjects.GameObject);
      if (!r) continue;
      const v = r.top >= this.offset - 1 && r.bottom <= this.offset + this.h + 1;
      (c as unknown as Phaser.GameObjects.Components.Visible).setVisible(v);
      setInputEnabled(c as Phaser.GameObjects.GameObject, v);
    }
  }

  private knobH() {
    return this.contentH > this.h ? Math.max(24, (this.h * this.h) / this.contentH) : this.h;
  }

  private drawBar() {
    const g = this.bar.clear();
    const over = this.contentH > this.h;
    this.knob.setVisible(over);
    if (!over) return;
    const kh = this.knobH();
    const ky = (this.offset / this.maxOffset()) * (this.h - kh);
    g.fillStyle(0x4a2a12, 0.15).fillRoundedRect(this.w + BAR_GAP, 0, BAR_W, this.h, 2);
    g.fillStyle(0x4a2a12, 0.6).fillRoundedRect(this.w + BAR_GAP, ky, BAR_W, kh, 2);
    this.knob.setPosition(this.w + BAR_GAP + BAR_W / 2, ky).setSize(14, kh);
    if (this.knob.input) this.knob.input.hitArea.setTo(0, 0, 14, kh);
  }
}
