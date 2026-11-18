// Телефон в браузере: полноэкранный режим, поворот, пересчёт размеров.
// Раскладка игры — фиксированные 1280×720, вписываются в экран (Scale.FIT); в портрете index.html просит повернуть телефон.
import type Phaser from 'phaser';

/** Основной ввод — палец (телефон, планшет). */
export const isTouchDevice = typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches;

/** Запущена с экрана «Домой» (PWA) — уже на весь экран, без панелей браузера. */
const isStandalone = () =>
  window.matchMedia('(display-mode: fullscreen)').matches ||
  window.matchMedia('(display-mode: standalone)').matches ||
  (navigator as Navigator & { standalone?: boolean }).standalone === true;

type OrientationLock = ScreenOrientation & { lock?: (o: 'landscape') => Promise<void> };

/** Полноэкранный режим доступен только по явной кнопке в шапке, не по касанию любого места. */
export function canUseFullscreen() {
  const root = document.documentElement;
  // В установленной PWA кнопка не нужна; в браузерном fullscreen она остаётся для выхода.
  const alreadyStandalone = isStandalone() && !document.fullscreenElement;
  return isTouchDevice && !alreadyStandalone && document.fullscreenEnabled && typeof root.requestFullscreen === 'function';
}

/** Войти / выйти по кнопке «Экран». После входа по возможности фиксируем горизонтальную ориентацию. */
export async function toggleFullscreen() {
  if (!canUseFullscreen()) return;
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else {
      await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
      await (screen.orientation as OrientationLock | undefined)?.lock?.('landscape');
    }
  } catch {
    // Отказ браузера или запрета ориентации — не ошибка игры.
  }
}

/** Поворот и появление/скрытие панелей браузера: размер окна меняется не сразу — пересчитать с запасом. */
function refreshOnViewportChange(game: Phaser.Game) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const refresh = () => {
    clearTimeout(timer);
    game.scale.refresh();
    timer = setTimeout(() => game.scale.refresh(), 300);
  };
  window.addEventListener('orientationchange', refresh);
  window.visualViewport?.addEventListener('resize', refresh);
  document.addEventListener('fullscreenchange', refresh);
}

export function setupMobile(game: Phaser.Game) {
  if (!isTouchDevice) return;
  refreshOnViewportChange(game);
}
