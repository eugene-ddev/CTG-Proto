import Phaser from 'phaser';
import { text } from './text';

/** Полоска «КБ (100/100)» с экрана паузы. Левый верхний угол в (x, y). */
export class ResourceBar extends Phaser.GameObjects.Container {
  private readonly fill: Phaser.GameObjects.Rectangle;
  private readonly label: Phaser.GameObjects.Text;

  constructor(
    scene: Phaser.Scene,
    x: number,
    y: number,
    private readonly barW: number,
    h: number,
    color: number,
    private readonly barName: string,
    /** Тонкая полоска: подпись моноширинным шрифтом с обводкой — крупный шрифт в неё не влезает. */
    compact = false,
  ) {
    super(scene, x, y);
    const back = scene.add.rectangle(0, 0, barW, h, color, 0.3).setOrigin(0);
    this.fill = scene.add.rectangle(0, 0, barW, h, color, 1).setOrigin(0);
    const edge = scene.add.rectangle(0, 0, barW, h).setOrigin(0).setStrokeStyle(1, 0x000000, 0.25);
    this.label = compact
      ? text(scene, 6, h / 2, '', { kind: 'mono', size: Math.max(9, Math.round(h * 0.8)), weight: 700, color: '#ffffff' }).setOrigin(0, 0.5).setStroke('#000000', 3)
      : text(scene, barW / 2, h / 2, '', { kind: 'display', size: Math.round(h * 0.6), color: '#ffffff' }).setOrigin(0.5);
    this.add([back, this.fill, edge, this.label]);
    scene.add.existing(this);
  }

  set(value: number, max: number) {
    const k = max > 0 ? Phaser.Math.Clamp(value / max, 0, 1) : 0;
    this.fill.width = this.barW * k;
    this.label.setText(`${this.barName} ${Math.round(value)}/${Math.round(max)}`);
    return this;
  }
}
