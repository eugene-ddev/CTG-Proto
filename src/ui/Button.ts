import Phaser from 'phaser';
import { isDragRelease } from './dragGuard';
import { TEX } from './textures';
import { text } from './text';
import { COLOR } from './theme';

export interface ButtonOpts {
  /** brown — главная кнопка («В БОЙ»), beige — второстепенная («В ЛОББИ»). */
  variant?: 'brown' | 'beige';
  width?: number;
  height?: number;
  size?: number;
  onClick?: () => void;
}

/** Кнопка Kenney с нажатым состоянием. Центр в (x, y). */
export class Button extends Phaser.GameObjects.Container {
  private readonly normal: Phaser.GameObjects.NineSlice;
  private readonly pressed: Phaser.GameObjects.NineSlice;
  private readonly label: Phaser.GameObjects.Text;
  /** Зона нажатия — для подсказок поверх кнопки. */
  readonly hit: Phaser.GameObjects.Zone;
  private enabled = true;
  private onClick?: () => void;

  constructor(scene: Phaser.Scene, x: number, y: number, caption: string, opts: ButtonOpts = {}) {
    super(scene, x, y);
    const variant = opts.variant ?? 'brown';
    const w = opts.width ?? 220;
    const h = opts.height ?? 56;
    this.onClick = opts.onClick;

    const [k, kp] = variant === 'brown' ? [TEX.btnBrown, TEX.btnBrownPressed] : [TEX.btnBeige, TEX.btnBeigePressed];
    // нижние 4 px текстуры — «тень», в нажатом состоянии её нет
    this.normal = scene.add.nineslice(0, 0, k, undefined, w, h, 12, 12, 10, 14);
    this.pressed = scene.add.nineslice(0, 2, kp, undefined, w, h - 4, 12, 12, 10, 10).setVisible(false);
    this.label = text(scene, 0, -2, caption, { kind: 'display', size: opts.size ?? Math.round(h * 0.5), color: COLOR.ink }).setOrigin(0.5);
    this.hit = scene.add.zone(0, 0, w, h).setInteractive({ useHandCursor: true });
    this.add([this.normal, this.pressed, this.label, this.hit]);
    this.setSize(w, h);

    this.hit.on('pointerover', () => this.enabled && this.hover(true));
    this.hit.on('pointerout', () => {
      this.press(false);
      this.hover(false);
    });
    this.hit.on('pointerdown', () => this.enabled && this.press(true));
    this.hit.on('pointerup', () => {
      if (isDragRelease(this.scene)) return this.press(false);
      if (!this.enabled || !this.pressed.visible) return;
      this.press(false);
      this.onClick?.();
    });
    scene.add.existing(this);
  }

  setCaption(caption: string) {
    this.label.setText(caption.toUpperCase());
    return this;
  }

  /** Сменить вид (brown — активная, beige — обычная): переключатели режимов. */
  setVariant(variant: 'brown' | 'beige') {
    const [k, kp] = variant === 'brown' ? [TEX.btnBrown, TEX.btnBrownPressed] : [TEX.btnBeige, TEX.btnBeigePressed];
    this.normal.setTexture(k);
    this.pressed.setTexture(kp);
    return this;
  }

  setOnClick(fn: () => void) {
    this.onClick = fn;
    return this;
  }

  setEnabled(enabled: boolean) {
    this.enabled = enabled;
    this.setAlpha(enabled ? 1 : 0.45);
    if (this.hit.input) this.hit.input.cursor = enabled ? 'pointer' : 'default';
    return this;
  }

  private press(on: boolean) {
    this.normal.setVisible(!on);
    this.pressed.setVisible(on);
    this.label.setY(on ? 0 : -2);
  }

  private hover(on: boolean) {
    this.scene.tweens.add({ targets: this, scale: on ? 1.04 : 1, duration: 90 });
  }
}
