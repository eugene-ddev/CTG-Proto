// Слой 3D-боя в сцене Phaser: three.js рисует в свой canvas, кадр копируется в текстуру Phaser.
// Так 3D лежит под интерфейсом (полоски, слоты, числа урона) без наложения DOM-элементов.
import Phaser from 'phaser';
import { Arena3D } from './Arena3D';

let counter = 0;

export class Battle3DLayer {
  readonly arena: Arena3D;
  readonly image: Phaser.GameObjects.Image;
  private readonly key = `battle3d-${++counter}`;
  private readonly texture: Phaser.Textures.CanvasTexture;
  private readonly glCanvas = document.createElement('canvas');

  constructor(private readonly scene: Phaser.Scene, width: number, height: number) {
    this.arena = new Arena3D(this.glCanvas, width, height);
    this.texture = scene.textures.createCanvas(this.key, width, height)!;
    this.image = scene.add.image(0, 0, this.key).setOrigin(0);
    scene.events.on(Phaser.Scenes.Events.UPDATE, this.update, this);
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, this.destroy, this);
  }

  private update(_time: number, delta: number) {
    this.arena.update(delta);
    this.texture.context.drawImage(this.glCanvas, 0, 0);
    this.texture.refresh();
  }

  private destroy() {
    this.scene.events.off(Phaser.Scenes.Events.UPDATE, this.update, this);
    this.arena.dispose();
    this.scene.textures.remove(this.key);
  }
}

/** Работает ли WebGL — без него бой рисуется прежней 2D-изометрией. */
export function webglAvailable(): boolean {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') ?? c.getContext('webgl'));
  } catch {
    return false;
  }
}
