import type Phaser from 'phaser';

// Жест (поворот модели) заканчивается отпусканием над чем угодно — кнопка под пальцем
// не должна от этого срабатывать. VoxelView ставит флаг на время жеста и снимает его
// после того, как отработают обработчики этого отпускания.
const KEY = 'ui.dragging';

export function setDragging(scene: Phaser.Scene, on: boolean) {
  scene.data?.set(KEY, on);
}

/** true — это отпускание после жеста, а не клик. */
export const isDragRelease = (scene: Phaser.Scene | undefined | null) => !!scene?.data?.get(KEY);
