import Phaser from 'phaser';
import { COLOR, GAME_W, GAME_H } from './theme';

/** Тёмный пол-сетка арены в перспективе, как фон экранов Unity-клиента. */
export function drawArenaBackground(scene: Phaser.Scene) {
  const g = scene.add.graphics().setDepth(-100);
  g.fillStyle(COLOR.bg, 1).fillRect(0, 0, GAME_W, GAME_H);

  const horizon = 70;
  const vpX = GAME_W / 2;
  const vpY = -900; // точка схода выше экрана — сетка «наклонена» к зрителю

  // продольные линии сходятся к точке схода
  g.lineStyle(1, COLOR.grid, 0.22);
  for (let bx = -3000; bx <= GAME_W + 3000; bx += 110) {
    const t = (horizon - GAME_H) / (vpY - GAME_H);
    g.lineBetween(bx, GAME_H, bx + (vpX - bx) * t, horizon);
  }
  // поперечные линии сгущаются к горизонту
  const rows = 16;
  for (let i = 0; i <= rows; i++) {
    const k = i / rows;
    const y = horizon + (GAME_H - horizon) * k * k;
    g.lineStyle(1, COLOR.grid, 0.08 + 0.16 * k);
    g.lineBetween(0, y, GAME_W, y);
  }

  // тёмная полоса сверху и виньетка
  g.fillGradientStyle(COLOR.bgTop, COLOR.bgTop, COLOR.bgTop, COLOR.bgTop, 1, 1, 0, 0);
  g.fillRect(0, 0, GAME_W, horizon + 90);
  g.fillGradientStyle(0x000000, 0x000000, 0x000000, 0x000000, 0, 0, 0.35, 0.35);
  g.fillRect(0, GAME_H - 160, GAME_W, 160);
  return g;
}
