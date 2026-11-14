import Phaser from 'phaser';
import { isDragRelease } from './dragGuard';
import { TEX } from './textures';
import { text } from './text';
import { COLOR } from './theme';

/** Листалка «◄ 1 / 2 ►». Центр в (x, y). Скрывается, если страница одна. */
export class Pager extends Phaser.GameObjects.Container {
  private readonly label: Phaser.GameObjects.Text;
  private page = 0;
  private total = 1;

  constructor(scene: Phaser.Scene, x: number, y: number, private readonly onChange: (page: number) => void) {
    super(scene, x, y);
    const prev = scene.add.image(-70, 0, TEX.arrowLeft).setScale(1.6).setInteractive({ useHandCursor: true }).on('pointerup', () => !isDragRelease(scene) && this.flip(-1));
    const next = scene.add.image(70, 0, TEX.arrowRight).setScale(1.6).setInteractive({ useHandCursor: true }).on('pointerup', () => !isDragRelease(scene) && this.flip(1));
    this.label = text(scene, 0, 0, '', { kind: 'mono', size: 15, color: COLOR.inkQuiet }).setOrigin(0.5);
    this.add([prev, next, this.label]);
    scene.add.existing(this);
  }

  set(page: number, total: number) {
    this.total = Math.max(1, total);
    this.page = Phaser.Math.Clamp(page, 0, this.total - 1);
    this.label.setText(`${this.page + 1} / ${this.total}`);
    this.setVisible(this.total > 1);
    return this;
  }

  get current() {
    return this.page;
  }

  flip(dir: number) {
    const next = Phaser.Math.Clamp(this.page + dir, 0, this.total - 1);
    if (next !== this.page) this.onChange(next);
  }
}
