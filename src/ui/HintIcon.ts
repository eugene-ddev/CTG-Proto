import Phaser from 'phaser';
import { text } from './text';
import { attachTooltip, type TooltipContent } from './Tooltip';

/**
 * Значок «?» с подсказкой: пояснение к значению, которое не помещается в строку
 * (почему крит 0%, почему стата отключена). Центр в (x, y).
 */
export function hintIcon(scene: Phaser.Scene, x: number, y: number, content: () => TooltipContent, color = 0xb5302c): Phaser.GameObjects.Container {
  const box = scene.add.container(x, y);
  const circle = scene.add.graphics();
  circle.fillStyle(color, 1).fillCircle(0, 0, 7);
  const mark = text(scene, 0, 0, '?', { size: 11, weight: 700, color: '#ffffff' }).setOrigin(0.5);
  const hit = scene.add.zone(0, 0, 20, 20).setInteractive({ useHandCursor: true });
  attachTooltip(hit, content);
  box.add([circle, mark, hit]);
  box.setSize(16, 16);
  return box;
}
