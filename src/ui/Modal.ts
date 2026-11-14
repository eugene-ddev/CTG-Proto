import Phaser from 'phaser';
import { Card } from './Panel';
import { TEX } from './textures';
import { DEPTH, GAME_W, GAME_H } from './theme';
import { Tooltip } from './Tooltip';
import { isDragRelease } from './dragGuard';

export interface ModalOpts {
  title: string;
  width?: number;
  height?: number;
  onClose?: () => void;
  /** false — закрыть можно только кнопками внутри: без крестика, клика мимо и ESC. */
  closable?: boolean;
}

/** Модальное окно: затемнение, перехватывающее клики, и карточка по центру. ESC закрывает. */
export class Modal extends Phaser.GameObjects.Container {
  readonly card: Card;

  constructor(scene: Phaser.Scene, private readonly opts: ModalOpts) {
    super(scene, 0, 0);
    Tooltip.for(scene).hide(); // всплывашка под курсором не должна висеть поверх окна
    const w = opts.width ?? 520;
    const h = opts.height ?? 360;
    const dim = scene.add.rectangle(0, 0, GAME_W, GAME_H, 0x000000, 0.6).setOrigin(0).setInteractive();
    // клик мимо окна закрывает его: нажатие и отпускание — оба на затемнении (не конец жеста)
    let downOnDim = false;
    dim.on('pointerdown', () => (downOnDim = true));
    dim.on('pointerout', () => (downOnDim = false));
    const closable = opts.closable !== false;
    dim.on('pointerup', () => {
      if (closable && downOnDim && !isDragRelease(scene)) this.close();
      downOnDim = false;
    });
    this.card = new Card(scene, (GAME_W - w) / 2, (GAME_H - h) / 2, w, h, { title: opts.title });
    // само окно глотает клики, чтобы клик по пустому месту окна не считался кликом мимо
    this.card.addAt(scene.add.zone(0, 0, w, h).setOrigin(0).setInteractive(), 0);
    if (closable) {
      const close = scene.add
        .image(w - 30, 30, TEX.cross)
        .setScale(1.4)
        .setInteractive({ useHandCursor: true })
        .on('pointerup', () => this.close());
      this.card.add(close);
    }
    this.add([dim, this.card]);
    this.setDepth(DEPTH.modal);

    const esc = closable ? scene.input.keyboard?.addKey(Phaser.Input.Keyboard.KeyCodes.ESC) : undefined;
    // снимать только свой обработчик: клавиша общая на сцену, у другого окна может быть свой
    const onEsc = () => this.close();
    esc?.once('down', onEsc);
    this.once(Phaser.GameObjects.Events.DESTROY, () => esc?.off('down', onEsc));

    this.setAlpha(0);
    scene.tweens.add({ targets: this, alpha: 1, duration: 120 });
    scene.add.existing(this);
  }

  close() {
    if (!this.active) return;
    this.opts.onClose?.();
    this.destroy();
  }
}
