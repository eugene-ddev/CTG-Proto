import Phaser from 'phaser';
import { loadFonts } from './ui/fonts';
import { store } from './game/store';
import { GAME_W, GAME_H } from './ui/theme';
import { BootScene } from './scenes/BootScene';
import { LoginScene } from './scenes/LoginScene';
import { MainMenuScene } from './scenes/MainMenuScene';
import { InventoryScene } from './scenes/InventoryScene';
import { BlueprintsScene } from './scenes/BlueprintsScene';
import { CraftScene } from './scenes/CraftScene';
import { CharactersScene } from './scenes/CharactersScene';
import { OpponentScene } from './scenes/OpponentScene';
import { RivalsScene } from './scenes/RivalsScene';
import { LeaderboardScene } from './scenes/LeaderboardScene';
import { BattleScene } from './scenes/BattleScene';
import { UiKitScene } from './scenes/UiKitScene';
import { DebugScene } from './scenes/DebugScene';
import { ModelsScene } from './scenes/ModelsScene';
import { setupMobile } from './mobile';

await loadFonts();

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'app',
  width: GAME_W,
  height: GAME_H,
  backgroundColor: '#2b2c30',
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
  scene: [BootScene, LoginScene, MainMenuScene, InventoryScene, BlueprintsScene, CraftScene, CharactersScene, OpponentScene, RivalsScene, LeaderboardScene, BattleScene, UiKitScene, ModelsScene, DebugScene], // Debug последней — рисуется поверх
});

setupMobile(game);

// доступ из консоли браузера для отладки
Object.assign(window, { __game: game, __store: store });

// любая ошибка видна прямо в игре — чтобы при «зависании» было что прислать
function showError(msg: string) {
  let box = document.getElementById('ctg-error');
  if (!box) {
    box = document.createElement('pre');
    box.id = 'ctg-error';
    box.style.cssText = 'position:fixed;left:8px;right:8px;bottom:8px;max-height:40%;overflow:auto;margin:0;padding:10px 12px;z-index:9999;background:rgba(120,10,10,.92);color:#fff;font:12px/1.4 monospace;white-space:pre-wrap;border-radius:6px;cursor:pointer';
    box.title = 'Клик — скрыть';
    box.onclick = () => box!.remove();
    document.body.appendChild(box);
  }
  box.textContent = `Ошибка (пришли этот текст):\n${msg}\n\n${box.textContent ?? ''}`.slice(0, 6000);
}
window.addEventListener('error', (e) => showError(`${e.message}\n${(e.error as Error | undefined)?.stack ?? ''}`));
window.addEventListener('unhandledrejection', (e) => showError(`${(e.reason as Error)?.message ?? e.reason}\n${(e.reason as Error)?.stack ?? ''}`));

// разбитые кубы бойцов вне арены восстанавливаются со временем; при закрытой игре — догоняются при загрузке
setInterval(() => store.online && store.act('tick'), 1000);

// свёрнутая или закрываемая вкладка — отправить несохранённое на сервер сразу
document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && void store.flush());
