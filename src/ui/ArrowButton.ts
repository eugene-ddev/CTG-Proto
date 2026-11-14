import Phaser from 'phaser';
import { isDragRelease } from './dragGuard';
import { TEX } from './textures';

/** Коричневая стрелка из спрайта без подложки (листание бойцов в главном меню); вправо — отражённая. */
export class ArrowButton extends Phaser.GameObjects.Image {
  constructor(scene: Phaser.Scene, x: number, y: number, dir: -1 | 1, onClick: () => void, scale = 1.2) {
    super(scene, x, y, TEX.arrowBackBrown);
    this.setScale(scale).setFlipX(dir > 0).setInteractive({ useHandCursor: true });
    this.on('pointerover', () => this.setTint(0xffd9a0));
    this.on('pointerout', () => this.clearTint().setScale(scale));
    this.on('pointerdown', () => this.setScale(scale * 0.9));
    this.on('pointerup', () => {
      this.setScale(scale);
      if (!isDragRelease(scene)) onClick();
    });
    scene.add.existing(this);
  }
}
