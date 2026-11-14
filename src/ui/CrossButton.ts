import Phaser from 'phaser';
import { isDragRelease } from './dragGuard';
import { text } from './text';
import { attachTooltip } from './Tooltip';

/** Красный «×» в углу ячейки: одно действие по клику (снять, выбросить). Центр в (x, y). */
export function crossButton(scene: Phaser.Scene, x: number, y: number, onClick: () => void, hint: string, r = 9): Phaser.GameObjects.Container {
  const b = scene.add.container(x, y);
  const bg = scene.add.circle(0, 0, r, 0x8a2a1e, 1).setStrokeStyle(2, 0x2b1a0a, 0.9);
  const t = text(scene, 0, -1, '×', { kind: 'mono', size: r + 6, weight: 700, color: '#ffffff' }).setOrigin(0.5);
  b.add([bg, t]);
  bg.setInteractive({ useHandCursor: true })
    .on('pointerover', () => bg.setFillStyle(0xc0281e))
    .on('pointerout', () => bg.setFillStyle(0x8a2a1e))
    .on('pointerup', () => !isDragRelease(scene) && onClick());
  attachTooltip(bg, () => ({ title: hint }));
  return b;
}
