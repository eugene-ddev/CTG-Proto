// Полноэкранный режим и пересчёт размеров при повороте телефона.
// Раскладка игры — фиксированные 1280×720, вписываются в экран (Scale.FIT); в портрете index.html просит повернуть телефон.
import type Phaser from 'phaser';

/** Основной ввод — палец (телефон, планшет). */
export const isTouchDevice = typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches;

type OrientationLock = ScreenOrientation & { lock?: (o: 'landscape') => Promise<void> };

/** Полноэкранный режим доступен только по явной кнопке в шапке, не по касанию любого места. */
export function canUseFullscreen() {
  return document.fullscreenEnabled && typeof document.documentElement.requestFullscreen === 'function';
}

/** Войти / выйти по кнопке «На весь экран». На телефоне по возможности фиксируем горизонтальную ориентацию. */
export async function toggleFullscreen() {
  if (!canUseFullscreen()) return;
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else {
      await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
      if (isTouchDevice) await (screen.orientation as OrientationLock | undefined)?.lock?.('landscape');
    }
  } catch {
    // Отказ браузера или запрета ориентации — не ошибка игры.
  }
}

/** Поворот и появление/скрытие панелей браузера: размер окна меняется не сразу — пересчитать с запасом. */
export function setupViewport(game: Phaser.Game) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const refresh = () => {
    clearTimeout(timer);
    game.scale.refresh();
    timer = setTimeout(() => game.scale.refresh(), 300);
  };
  if (isTouchDevice) {
    window.addEventListener('orientationchange', refresh);
    window.visualViewport?.addEventListener('resize', refresh);
  }
  document.addEventListener('fullscreenchange', refresh);
}
