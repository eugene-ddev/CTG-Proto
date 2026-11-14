import Phaser from 'phaser';
import { isDragRelease } from './dragGuard';
import { TEX } from './textures';
import { text } from './text';
import { COLOR } from './theme';

export type PanelVariant = 'beige' | 'light' | 'brown' | 'insetBeige' | 'insetLight' | 'insetBrown';

const KEY: Record<PanelVariant, string> = {
  beige: TEX.panelBeige,
  light: TEX.panelLight,
  brown: TEX.panelBrown,
  insetBeige: TEX.insetBeige,
  insetLight: TEX.insetLight,
  insetBrown: TEX.insetBrown,
};

/** Цвет середины panel_beigeLight.png. */
const LIGHT_FILL = 0xece3ce;

/** Растягиваемая панель Kenney (9-slice), левый верхний угол в (x, y). */
export function panel(scene: Phaser.Scene, x: number, y: number, w: number, h: number, variant: PanelVariant = 'beige') {
  return scene.add.nineslice(x, y, KEY[variant], undefined, w, h, 12, 12, 12, 12).setOrigin(0, 0);
}

export interface CardOpts {
  title?: string;
  /** framed — коричневая рамка + светлый пергамент внутри (карточки «Билд оппонента»). */
  variant?: 'framed' | 'beige' | 'light';
  /** Подпись справа от заголовка, как «7 СЛОТОВ» или «КУБ · 48». */
  aside?: string;
  /** Кнопка «назад» слева от заголовка (стрелка и разделитель). */
  onBack?: () => void;
}

/**
 * Карточка-контейнер. Контент добавляется в `content` в локальных координатах:
 * (0, 0) — левый верхний угол области под заголовком.
 */
export class Card extends Phaser.GameObjects.Container {
  readonly content: Phaser.GameObjects.Container;
  readonly innerW: number;
  readonly innerH: number;
  private asideText?: Phaser.GameObjects.Text;

  constructor(scene: Phaser.Scene, x: number, y: number, w: number, h: number, opts: CardOpts = {}) {
    super(scene, x, y);
    const variant = opts.variant ?? 'framed';
    let pad = 18;
    if (variant === 'framed') {
      this.add(panel(scene, 0, 0, w, h, 'brown'));
      // подложка цвета светлой панели: на части видеокарт между двумя треугольниками середины 9-slice остаётся
      // волосяная щель по диагонали, и сквозь неё просвечивала коричневая рамка — тонкая линия в центре карточки.
      // Подложка меньше панели и смещена, чтобы её собственная диагональ не совпала с диагональю панели.
      this.add(scene.add.rectangle(30, 30, Math.max(1, w - 70), Math.max(1, h - 90), LIGHT_FILL).setOrigin(0));
      this.add(panel(scene, 8, 8, w - 16, h - 16, 'light'));
      pad = 26;
    } else {
      this.add(panel(scene, 0, 0, w, h, variant));
    }

    let top = pad;
    if (opts.title) {
      let tx = pad;
      if (opts.onBack) {
        const back = opts.onBack;
        // большая стрелка назад, за ней вертикальный разделитель, потом заголовок
        const arrow = scene.add.image(pad + 14, pad + 11, TEX.arrowBackBrown).setScale(1.25).setInteractive({ useHandCursor: true });
        arrow.on('pointerover', () => arrow.setTint(0xffd9a0)).on('pointerout', () => arrow.clearTint()).on('pointerup', () => !isDragRelease(scene) && back());
        const sep = scene.add.rectangle(pad + 36, pad + 11, 2, 24, 0x6b4a2a, 0.55);
        this.add([arrow, sep]);
        tx = pad + 48;
      }
      const t = text(scene, opts.aside ? tx : w / 2, pad - 4, opts.title, { kind: 'display', size: 24 });
      if (!opts.aside) t.setOrigin(0.5, 0);
      // со стрелкой назад — заголовок по центру стрелки по вертикали
      if (opts.onBack) t.setOrigin(0, 0.5).setY(pad + 11);
      this.add(t);
      if (opts.aside) {
        this.asideText = text(scene, w - pad, pad + 2, opts.aside.toUpperCase(), { size: 13, color: COLOR.inkQuiet, letterSpacing: 1 }).setOrigin(1, 0);
        this.add(this.asideText);
      }
      top += 34;
      this.add(dottedLine(scene, pad, top, w - pad));
      top += 12;
    }

    this.innerW = w - pad * 2;
    this.innerH = h - top - pad;
    this.content = scene.add.container(pad, top);
    this.add(this.content);
    scene.add.existing(this);
  }

  setAside(value: string) {
    this.asideText?.setText(value.toUpperCase());
    return this;
  }
}

/** Пунктирный разделитель, как на экране паузы. */
export function dottedLine(scene: Phaser.Scene, x1: number, y: number, x2: number, color = 0x6b4a2a) {
  const g = scene.add.graphics();
  g.fillStyle(color, 0.7);
  for (let x = x1; x < x2; x += 4) g.fillRect(x, y, 2, 1);
  return g;
}
