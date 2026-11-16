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

/** Сенсорный экран без мыши (телефон, планшет). */
const coarsePointer = () => typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;

/** Сцены с открытым полем ввода: ESC и горячие клавиши сцены не должны срабатывать. */
export const isTyping = (scene: Phaser.Scene) => scene.data?.get('typing') === true;

/**
 * Однострочное поле ввода: рисуется на Phaser, а текст набирается в скрытом настоящем <input> поверх поля —
 * только так в телефоне открывается экранная клавиатура, и работают автозамена, свайп-набор и Android
 * (у него в keydown часто key = 'Unidentified'). Клик — фокус, Enter / ESC / клик мимо — снять фокус.
 * Позиция (x, y) — левый верхний угол.
 */
export class TextField extends Phaser.GameObjects.Container {
  private value: string;
  private focused = false;
  private readonly label: Phaser.GameObjects.Text;
  private readonly caret: Phaser.GameObjects.Rectangle;
  private readonly frame: Phaser.GameObjects.Graphics;
  private blink?: Phaser.Time.TimerEvent;
  /** Перефокус настоящего поля: его blur — не потеря фокуса. */
  private refocusing = false;
  private readonly domInput: HTMLInputElement | null;

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

    this.domInput = typeof document === 'undefined' ? null : this.createInput();
    // фокус настоящему полю — прямо в обработчике нажатия, иначе мобильный браузер не откроет клавиатуру.
    // iOS открывает её только из touchend/click: на касании фокус — по отпусканию, мышью — сразу.
    hit.on('pointerdown', (p: Phaser.Input.Pointer, _x: number, _y: number, ev: Phaser.Types.Input.EventData) => {
      ev.stopPropagation();
      this.markFocused();
      if (!p.wasTouch) this.focusInput(true);
    });
    hit.on('pointerup', (p: Phaser.Input.Pointer) => {
      if (p.wasTouch && this.focused) this.focusInput(true);
    });
    const onDown = () => this.blur();
    scene.input.on('pointerdown', onDown);
    this.once(Phaser.GameObjects.Events.DESTROY, () => {
      scene.input.off('pointerdown', onDown);
      this.blink?.remove();
      if (this.focused) scene.data.set('typing', false);
      this.focused = false;
      this.domInput?.remove();
    });
    this.render();
    scene.add.existing(this);
  }

  get text() {
    return this.value;
  }

  setValue(v: string) {
    this.value = v.slice(0, this.opts.maxLength ?? 64);
    if (this.domInput) this.domInput.value = this.value;
    this.render();
    return this;
  }

  /**
   * Фокус из кода (не по нажатию): на телефоне только рисуем фокус — фокус настоящему полю вне жеста
   * клавиатуру не открывает, а iOS после такого фокуса не открывает её и по следующему тапу.
   */
  focus() {
    this.markFocused();
    if (!coarsePointer()) this.focusInput(false);
  }

  private markFocused() {
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
    this.domInput?.blur();
    this.render();
    this.opts.onBlur?.(this.value);
  }

  private createInput(): HTMLInputElement {
    const el = document.createElement('input');
    el.type = 'text';
    el.maxLength = this.opts.maxLength ?? 64;
    el.value = this.value;
    el.autocomplete = 'off';
    el.spellcheck = false;
    el.setAttribute('autocapitalize', 'off');
    el.setAttribute('enterkeyhint', 'done');
    el.setAttribute('aria-label', this.opts.placeholder ?? '');
    // невидимое, клики не перехватывает; 16px — иначе iOS увеличивает страницу при фокусе
    Object.assign(el.style, {
      position: 'fixed',
      left: '0px',
      top: '0px',
      width: '1px',
      height: '1px',
      opacity: '0',
      border: '0',
      padding: '0',
      fontSize: '16px',
      pointerEvents: 'none',
      zIndex: '-1',
    });
    el.addEventListener('input', () => {
      const v = el.value.slice(0, this.opts.maxLength ?? 64);
      if (v !== el.value) el.value = v;
      if (v === this.value) return;
      this.value = v;
      this.opts.onChange?.(this.value);
      this.render();
    });
    // клавиши поля не доходят до сцены (горячие клавиши, захваченные Phaser клавиши вроде ESC в окне)
    el.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') {
        e.preventDefault();
        this.opts.onSubmit?.(this.value);
        this.blur();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        this.blur();
      }
    });
    el.addEventListener('keyup', (e) => e.stopPropagation());
    // клавиатура закрыта системой (iOS «Готово», переход в другое окно)
    el.addEventListener('blur', () => {
      if (!this.refocusing && this.focused && document.activeElement !== el) this.blur();
    });
    document.body.appendChild(el);
    return el;
  }

  /**
   * Настоящее поле — под нарисованным (страница прокручивается к нему, когда открывается клавиатура).
   * force — вызов из жеста: если поле уже в фокусе (поставлен без клавиатуры), фокус ставится заново,
   * иначе iOS клавиатуру не покажет.
   */
  private focusInput(force: boolean) {
    const el = this.domInput;
    if (!el || !this.scene) return;
    const canvas = this.scene.game.canvas;
    const rect = canvas.getBoundingClientRect();
    const k = rect.width / this.scene.scale.gameSize.width;
    const m = this.getWorldTransformMatrix();
    el.style.left = `${Math.round(rect.left + m.tx * k)}px`;
    el.style.top = `${Math.round(rect.top + m.ty * k)}px`;
    el.style.width = `${Math.max(1, Math.round(this.width * k))}px`;
    el.style.height = `${Math.max(1, Math.round(this.height * k))}px`;
    if (el.value !== this.value) el.value = this.value;
    if (document.activeElement === el && force) {
      this.refocusing = true;
      el.blur();
      this.refocusing = false;
    }
    if (document.activeElement !== el) el.focus({ preventScroll: true });
    // курсор — в конец
    const end = el.value.length;
    try {
      el.setSelectionRange(end, end);
    } catch {
      /* не все типы полей поддерживают выделение */
    }
  }

  private render() {
    const empty = !this.value;
    this.label.setText(empty && !this.focused ? this.opts.placeholder ?? '' : this.value).setColor(empty ? COLOR.inkQuiet : COLOR.ink);
    this.caret.setX(12 + (empty ? 0 : this.label.width) + 1).setVisible(this.focused);
    this.frame.clear();
    if (this.focused) this.frame.lineStyle(2, COLOR.highlight, 1).strokeRoundedRect(1, 1, this.opts.width - 2, (this.opts.height ?? 40) - 2, 6);
  }
}
