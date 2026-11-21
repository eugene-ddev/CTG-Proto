import Phaser from 'phaser';
import { getBlueprint, itemModel } from '../data/catalog';
import type { BlockGeometry, Item, PotionItem, ResourceItem } from '../data/types';
import { STAT_COLOR } from './theme';
import { shade } from '../render/iso';
import { VoxelView } from './VoxelView';

export interface PotionCharges {
  left: number;
  max: number;
}

/**
 * Иконка предмета: изометрическая модель его чертежа. Запасной вариант для зелья
 * без чертежа — нарисованный флакон цвета статы.
 */
export function createItemIcon(scene: Phaser.Scene, item: Item, size: number, charges?: PotionCharges): Phaser.GameObjects.GameObject {
  if (item.kind === 'resource') return resourceIcon(scene, item, size);
  if (!item.blueprintId) return item.kind === 'potion' ? potionIcon(scene, item, size) : scene.add.graphics();
  const bp = getBlueprint(item.blueprintId);
  // перекрашиваемые блоки (жидкость зелья, камень) — цвет этого варианта
  const tint = item.kind === 'potion' || item.kind === 'gem' ? parseInt(item.tint.slice(1), 16) : undefined;
  // у оружия модель улучшается с уровнем (data/weaponLooks.ts)
  const model = item.kind === 'weapon' ? itemModel(item.id, item.itemLevel)?.blocks ?? bp.blocks : bp.blocks;
  const blocks = item.kind === 'potion' && charges ? potionBlocks(model, charges) : model;
  return new VoxelView(scene, 0, 0, {
    blocks,
    width: size,
    height: size,
    maxBlockPx: size / 4,
    colorOf: tint === undefined ? undefined : (i) => (blocks[i].tinted ? tint : undefined),
  });
}

/** Оставить геометрию флакона из чертежа и заменить опустевшие кубы прозрачными. */
function potionBlocks(blocks: BlockGeometry[], { left, max }: PotionCharges): BlockGeometry[] {
  if (left >= max) return blocks;
  const bottom = blocks.filter((b) => b.tinted).sort((a, b) => a.pos[1] - b.pos[1])[0];
  if (!bottom) return blocks;
  const glass = blocks.map((b) => b.tinted && !(left > 1 && b.pos[1] === bottom.pos[1])
    ? { ...b, tinted: false, color: '#edf6f8', opacity: b === bottom && left === 1 ? 0.3 : 0.7 }
    : b);
  if (left === 1) {
    const [x, y, z] = bottom.pos;
    glass.push({ ...bottom, pos: [x, y - 0.1, z], scale: 0.8 });
  }
  return glass;
}

function potionIcon(scene: Phaser.Scene, item: PotionItem, size: number) {
  const g = scene.add.graphics();
  const color = STAT_COLOR[item.restoreStat];
  const big = item.restoreAmount > 1;
  const r = size * (big ? 0.3 : 0.22); // радиус колбы
  const cy = size * 0.12;
  const neckW = r * 0.62;
  const neckH = r * 0.75;
  // колба
  g.fillStyle(shade(color, 0.7), 1).fillCircle(0, cy, r);
  g.fillStyle(color, 1).fillCircle(0, cy + r * 0.12, r * 0.86);
  g.fillStyle(0xffffff, 0.35).fillCircle(-r * 0.35, cy - r * 0.25, r * 0.22);
  // горлышко и пробка
  g.fillStyle(0xd9d4c8, 1).fillRect(-neckW / 2, cy - r - neckH + 2, neckW, neckH);
  g.fillStyle(0x8a5a2b, 1).fillRect(-neckW / 2 - 2, cy - r - neckH - r * 0.28, neckW + 4, r * 0.34);
  g.lineStyle(1.5, 0x2b1a0a, 0.7).strokeCircle(0, cy, r);
  return g;
}

/** Значки ресурсов: изометрический куб, осколки, брусок точила, свиток пергамента. */
function resourceIcon(scene: Phaser.Scene, item: ResourceItem, size: number) {
  const g = scene.add.graphics();
  const c = parseInt(item.tint.slice(1), 16);
  const ink = 0x2b1a0a;
  const isoCube = (cx: number, cy: number, r: number, col: number) => {
    const h = r * 0.58;
    const top = [cx, cy - r, cx + r * 0.87, cy - r + h, cx, cy - r + 2 * h, cx - r * 0.87, cy - r + h];
    const left = [cx - r * 0.87, cy - r + h, cx, cy - r + 2 * h, cx, cy + r, cx - r * 0.87, cy + r - h];
    const right = [cx + r * 0.87, cy - r + h, cx, cy - r + 2 * h, cx, cy + r, cx + r * 0.87, cy + r - h];
    const pts = (a: number[]) => [0, 2, 4, 6].map((i) => new Phaser.Math.Vector2(a[i], a[i + 1]));
    g.fillStyle(shade(col, 1.15), 1).fillPoints(pts(top), true);
    g.fillStyle(shade(col, 0.85), 1).fillPoints(pts(left), true);
    g.fillStyle(shade(col, 0.65), 1).fillPoints(pts(right), true);
    g.lineStyle(1.5, ink, 0.6);
    for (const f of [top, left, right]) g.strokePoints(pts(f), true);
  };
  switch (item.icon) {
    case 'cube':
      isoCube(0, 2, size * 0.3, c);
      break;
    case 'shard': {
      const r = size * 0.13;
      const shard = (x: number, y: number, k: number, rot: number) => {
        const p = [0, -1.2, 0.9, 0.3, -0.2, 1, -0.9, 0].map((v) => v * r * k);
        const pts = [0, 2, 4, 6].map((i) => {
          const cs = Math.cos(rot), sn = Math.sin(rot);
          return new Phaser.Math.Vector2(x + p[i] * cs - p[i + 1] * sn, y + p[i] * sn + p[i + 1] * cs);
        });
        g.fillStyle(shade(c, 0.8 + k * 0.2), 1).fillPoints(pts, true);
        g.lineStyle(1.2, ink, 0.6).strokePoints(pts, true);
      };
      shard(-size * 0.12, size * 0.06, 1.2, 0.3);
      shard(size * 0.14, size * 0.1, 0.9, -0.6);
      shard(size * 0.02, -size * 0.14, 0.8, 1.2);
      break;
    }
    case 'whetstone': {
      const w = size * 0.62, h = size * 0.22;
      g.fillStyle(shade(c, 0.7), 1).fillRoundedRect(-w / 2, -h / 2 + h * 0.35, w, h, 4);
      g.fillStyle(c, 1).fillRoundedRect(-w / 2, -h / 2, w, h, 4);
      g.fillStyle(0xffffff, 0.25).fillRect(-w / 2 + 6, -h / 2 + 3, w - 12, 3);
      g.lineStyle(1.5, ink, 0.6).strokeRoundedRect(-w / 2, -h / 2, w, h * 1.35, 4);
      break;
    }
    case 'jeweler': {
      // ювелирный набор: шкатулка с крышкой и камнем
      const w = size * 0.56, h = size * 0.3;
      g.fillStyle(shade(c, 0.7), 1).fillRoundedRect(-w / 2, -h / 2 + h * 0.4, w, h, 4);
      g.fillStyle(c, 1).fillRoundedRect(-w / 2, -h / 2, w, h * 0.55, 4);
      g.lineStyle(1.5, ink, 0.6).strokeRoundedRect(-w / 2, -h / 2, w, h * 1.4, 4);
      const r = size * 0.1;
      g.fillStyle(0x1e74d0, 1).fillPoints([new Phaser.Math.Vector2(0, -h / 2 - r * 1.6), new Phaser.Math.Vector2(r, -h / 2 - r * 0.6), new Phaser.Math.Vector2(0, -h / 2 + r * 0.4), new Phaser.Math.Vector2(-r, -h / 2 - r * 0.6)], true);
      g.lineStyle(1.2, ink, 0.7).strokePoints([new Phaser.Math.Vector2(0, -h / 2 - r * 1.6), new Phaser.Math.Vector2(r, -h / 2 - r * 0.6), new Phaser.Math.Vector2(0, -h / 2 + r * 0.4), new Phaser.Math.Vector2(-r, -h / 2 - r * 0.6)], true);
      break;
    }
    case 'alchemist': {
      const w = size * 0.56, h = size * 0.3;
      g.fillStyle(shade(c, 0.65), 1).fillRoundedRect(-w / 2, 0, w, h, 4);
      g.lineStyle(1.5, ink, 0.6).strokeRoundedRect(-w / 2, 0, w, h, 4);
      for (const x of [-size * 0.13, size * 0.13]) {
        g.fillStyle(0xd9d4c8, 1).fillRect(x - 3, -size * 0.28, 6, size * 0.16);
        g.fillStyle(x < 0 ? 0x8e5aa8 : 0x3f9b72, 1).fillCircle(x, -size * 0.08, size * 0.11);
        g.lineStyle(1.2, ink, 0.7).strokeCircle(x, -size * 0.08, size * 0.11);
      }
      break;
    }
    case 'leatherworker': {
      const w = size * 0.58, h = size * 0.42;
      g.fillStyle(c, 1).fillRoundedRect(-w / 2, -h / 2, w, h, 5);
      g.fillStyle(shade(c, 0.65), 1).fillRect(-w / 2, -2, w, 5);
      g.lineStyle(1.5, ink, 0.65).strokeRoundedRect(-w / 2, -h / 2, w, h, 5);
      g.lineStyle(2, 0xd4a640, 1).strokeCircle(0, -h / 2, size * 0.1);
      g.lineBetween(-w / 2 + 5, h / 2 - 5, w / 2 - 5, h / 2 - 5);
      break;
    }
    case 'parchment': {
      const w = size * 0.46, h = size * 0.56;
      g.fillStyle(c, 1).fillRect(-w / 2, -h / 2, w, h);
      g.fillStyle(shade(c, 0.8), 1).fillRoundedRect(-w / 2 - 4, -h / 2 - 5, w + 8, 9, 4).fillRoundedRect(-w / 2 - 4, h / 2 - 4, w + 8, 9, 4);
      g.lineStyle(1, shade(c, 0.6), 0.8);
      for (let k = 0; k < 3; k++) g.lineBetween(-w / 2 + 6, -h / 4 + k * (h / 5), w / 2 - 6, -h / 4 + k * (h / 5));
      g.lineStyle(1.5, ink, 0.55).strokeRect(-w / 2, -h / 2, w, h);
      break;
    }
  }
  return g;
}
