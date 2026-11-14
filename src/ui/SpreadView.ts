import Phaser from 'phaser';
import { spreadCells } from '../core/spread';
import type { BlockGeometry, WeaponPattern, WeaponPerk } from '../data/types';
import { VoxelView } from './VoxelView';

/** Цвета схемы удара: цель и кубы, куда уходит остаток. */
export const SPREAD_TARGET = 0xc0281e;
export const SPREAD_HIT = 0xf2b312;
/** Неполный остаток (делится поровну между кубами) — оранжевый. */
export const SPREAD_PART = 0xe07a2a;

/**
 * Схема удара на кубах: куб 3 × 3 × 3 (вглубь длиннее, если схема достаёт дальше), удар — в центральный куб передней грани;
 * перёд — +Z, без стрелки (решение Евгения).
 * Красный — цель, жёлтые — остаток целиком, оранжевые — его доля (делится поровну), остальные — контуром. Центр в (x, y); w × h — рамка.
 * Обёрнута в контейнер с прозрачным прямоугольником — чтобы у неё были честные границы (прокрутка, подсказки).
 */
export function createSpreadView(scene: Phaser.Scene, x: number, y: number, w: number, h: number, pattern: WeaponPattern, perk: WeaponPerk = {}) {
  const cells = spreadCells(pattern, perk);
  // куб 3 × 3 × 3, цель — центральный куб передней грани; вглубь — дальше, только если схема достаёт глубже (копьё)
  const depth = Math.max(2, ...cells.map((c) => -c.d[2]));
  const blocks: BlockGeometry[] = [];
  const index = new Map<string, number>();
  for (let z = 0; z >= -depth; z--)
    for (let yy = -1; yy <= 1; yy++)
      for (let xx = -1; xx <= 1; xx++) {
        index.set(`${xx},${yy},${z}`, blocks.length);
        blocks.push({ shape: 'cube', pos: [xx, yy, z], rot: [0, 0, 0] });
      }
  const target = index.get('0,0,0')!;
  // куб → цвет: жёлтый — получает остаток целиком (цепочка, «каждому целиком»), оранжевый — долю (поровну)
  const hit = new Map<number, number>();
  for (const c of cells) {
    const i = index.get(c.d.join(','));
    if (i !== undefined) hit.set(i, c.kind === 'share' ? SPREAD_PART : SPREAD_HIT);
  }
  const root = scene.add.container(x, y);
  root.add(scene.add.rectangle(0, 0, w, h, 0x000000, 0));
  root.add(
    new VoxelView(scene, 0, 0, {
      blocks,
      width: w,
      height: h,
      maxBlockPx: 20,
      yaw: -90, // передней гранью к зрителю
      colorOf: (i) => (i === target ? SPREAD_TARGET : hit.get(i)),
      lookOf: (i) => (i === target || hit.has(i) ? 'solid' : 'faint'),
    }),
  );
  root.setSize(w, h);
  return root;
}
