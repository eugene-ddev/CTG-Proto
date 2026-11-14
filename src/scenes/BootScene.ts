import Phaser from 'phaser';
import { preloadUiTextures } from '../ui/textures';
import { SCENE } from './keys';

export class BootScene extends Phaser.Scene {
  constructor() {
    super(SCENE.boot);
  }

  preload() {
    preloadUiTextures(this);
  }

  create() {
    this.scene.launch(SCENE.debug);
    this.scene.start(SCENE.login);
  }
}
