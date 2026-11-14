import Phaser from 'phaser';
import { panel } from './Panel';
import { text } from './text';
import { COLOR } from './theme';

export interface TextFieldOpts {
  width: number;
  height?: number;
  value?: string;
  maxLength?: number;
  placeholder?: string;
  onChange?: (value: string) => void;
  onSubmit?: (value: string) => void;
  /** Фокус снят (Enter, ESC, клик мимо). */
  onBlur?: (value: string) => void;
}

/** Сцены с открытым полем ввода: ESC и горячие клавиши сцены не должны срабатывать. */
export const isTyping = (scene: Phaser.Scene) => scene.data?.get('typing') === true;

/**
 * Однострочное поле ввода на Phaser (без DOM): клик — фокус, печать с клавиатуры,
 * Backspace, Enter / ESC / клик мимо — снять фокус. Кириллица — через event.key.
 * Позиция (x, y) — левый верхний угол.
 */
export class TextField extends Phaser.GameObjects.Container {
  private value: string;
  private focused = false;
  private readonly label: Phaser.GameObjects.Text;
  private readonly caret: Phaser.GameObjects.Rectangle;
  private readonly frame: Phaser.GameObjects.Graphics;
  private blink?: Phaser.Time.TimerEvent;

  constructor(scene: Phaser.Scene, x: number, y: number, private opts: TextFieldOpts) {
    super(scene, x, y);
    const h = opts.height ?? 40;
    this.value = opts.value ?? '';
    this.add(panel(scene, 0, 0, opts.width, h, 'insetLight'));
    this.label = text(scene, 12, h / 2, '', { size: 18, color: COLOR.ink }).setOrigin(0, 0.5);
    this.caret = scene.add.rectangle(0, h / 2, 2, h - 16, 0x4a2a12).setOrigin(0, 0.5).setVisible(false);
    this.frame = scene.add.graphics();
    const hit = scene.add.zone(0, 0, opts.width, h).setOrigin(0).setInteractive({ useHandCursor: true });
    this.add([this.label, this.caret, this.frame, hit]);
    this.setSize(opts.width, h);

    hit.on('pointerdown', (_p: Phaser.Input.Pointer, _x: number, _y: number, ev: Phaser.Types.Input.EventData) => {
      ev.stopPropagation();
      this.focus();
    });
    const onKey = (e: KeyboardEvent) => this.key(e);
    const onDown = () => this.blur();
    scene.input.keyboard?.on('keydown', onKey);
    scene.input.on('pointerdown', onDown);
    this.once(Phaser.GameObjects.Events.DESTROY, () => {
      scene.input.keyboard?.off('keydown', onKey);
      scene.input.off('pointerdown', onDown);
      this.blink?.remove();
      if (this.focused) scene.data.set('typing', false);
    });
    this.render();
    scene.add.existing(this);
  }

  get text() {
    return this.value;
  }

  setValue(v: string) {
    this.value = v.slice(0, this.opts.maxLength ?? 64);
    this.render();
    return this;
  }

  focus() {
    if (this.focused) return;
    this.focused = true;
    this.scene.data.set('typing', true);
    this.blink = this.scene.time.addEvent({ delay: 500, loop: true, callback: () => this.caret.setVisible(this.focused && !this.caret.visible) });
    this.render();
  }

  blur() {
    if (!this.focused) return;
    this.focused = false;
    // ESC, который снял фокус, не должен тут же закрыть экран. Сцену берём заранее:
    // onBlur может перерисовать экран и удалить само поле до того, как сработает таймер.
    const scene = this.scene;
    scene.time.delayedCall(0, () => {
      if (scene.sys.isActive()) scene.data.set('typing', false);
    });
    this.blink?.remove();
    this.render();
    this.opts.onBlur?.(this.value);
  }

  private key(e: KeyboardEvent) {
    if (!this.focused) return;
    if (e.key === 'Enter') {
      this.opts.onSubmit?.(this.value);
      return this.blur();
    }
    if (e.key === 'Escape') return this.blur();
    if (e.key === 'Backspace') this.value = this.value.slice(0, -1);
    else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && this.value.length < (this.opts.maxLength ?? 64)) this.value += e.key;
    else return;
    e.preventDefault();
    this.opts.onChange?.(this.value);
    this.render();
  }

  private render() {
    const empty = !this.value;
    this.label.setText(empty && !this.focused ? this.opts.placeholder ?? '' : this.value).setColor(empty ? COLOR.inkQuiet : COLOR.ink);
    this.caret.setX(12 + (empty ? 0 : this.label.width) + 1).setVisible(this.focused);
    this.frame.clear();
    if (this.focused) this.frame.lineStyle(2, COLOR.highlight, 1).strokeRoundedRect(1, 1, this.opts.width - 2, (this.opts.height ?? 40) - 2, 6);
  }
}
