import Phaser from 'phaser';

// Kenney UI pack: RPG extension (CC0) — тот же пак, что в Unity-клиенте.
const sprites = import.meta.glob('../assets/ui/*.png', { eager: true, query: '?url', import: 'default' }) as Record<
  string,
  string
>;

export const TEX = {
  panelBeige: 'panel_beige',
  panelLight: 'panel_beigeLight',
  panelBrown: 'panel_brown',
  insetBeige: 'panelInset_beige',
  insetLight: 'panelInset_beigeLight',
  insetBrown: 'panelInset_brown',
  btnBrown: 'buttonLong_brown',
  btnBrownPressed: 'buttonLong_brown_pressed',
  btnBeige: 'buttonLong_beige',
  btnBeigePressed: 'buttonLong_beige_pressed',
  btnSquare: 'buttonSquare_beige',
  btnSquarePressed: 'buttonSquare_beige_pressed',
  arrowLeft: 'arrowBeige_left',
  arrowBackBrown: 'arrowBrown_left',
  arrowRight: 'arrowBeige_right',
  cross: 'iconCross_brown',
} as const;

export function preloadUiTextures(scene: Phaser.Scene): void {
  for (const [path, url] of Object.entries(sprites)) {
    const key = path.split('/').pop()!.replace('.png', '');
    scene.load.image(key, url);
  }
}
