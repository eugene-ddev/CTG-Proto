// Превью модели: 3D (three.js), если есть WebGL, иначе прежняя 2D-изометрия. API у обоих одинаковый.
import type Phaser from 'phaser';
import { webglAvailable } from '../render3d/Battle3DLayer';
import { VoxelView, type VoxelViewOpts } from './VoxelView';
import { VoxelView3D } from './VoxelView3D';

export type ModelView = VoxelView | VoxelView3D;

let gl: boolean | undefined;

export function modelView(scene: Phaser.Scene, x: number, y: number, opts: VoxelViewOpts): ModelView {
  gl ??= webglAvailable();
  return gl ? new VoxelView3D(scene, x, y, opts) : new VoxelView(scene, x, y, opts);
}
