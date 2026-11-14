import { SERVER_ADDRESS, net } from '../net/client';
import Phaser from 'phaser';
import { BLUEPRINTS, BLUEPRINT_KIND_LABEL, EFFECTS, ITEMS, getItem } from '../data/catalog';
import type { BlueprintKind } from '../data/types';
import { addCubes, addItem, cubeCount, totalItemCount, type PlayerState } from '../core/state';
import { SERIES_LENGTH, SERIES_RETRIES, activeCharacter, healFull, retriesLeft, seriesRetries } from '../core/arena';
import { store } from '../game/store';
import { text } from '../ui/text';
import { COLOR, GAME_W, GAME_H } from '../ui/theme';
import { SCENE } from './keys';

const W = 360;
const H = 520;
const SYNC_LABEL = { local: 'не подключён', saved: 'сохранено', saving: 'сохранение…', error: 'нет связи' } as const;
/** Предел лимита повторов в отладке. */
const MAX_RETRIES = 99;

/** Отладочная панель поверх всех сцен: состояние сохранения и читы. Кнопка DEBUG или клавиша `. */
export class DebugScene extends Phaser.Scene {
  private panel!: Phaser.GameObjects.Container;
  private info!: Phaser.GameObjects.Text;
  private resetArmed = false;
  private resetBtn!: Phaser.GameObjects.Text;
  private retriesVal!: Phaser.GameObjects.Text;
  private retriesDefault!: Phaser.GameObjects.Text;
  private healBtn!: Phaser.GameObjects.Text;
  private healNote!: Phaser.GameObjects.Text;

  constructor() {
    super(SCENE.debug);
  }

  create() {
    const toggle = this.chip(GAME_W - 12, GAME_H - 12, 'DEBUG', () => this.setOpen(!this.panel.visible)).setOrigin(1, 1);
    toggle.setAlpha(0.7);
    this.input.keyboard?.on('keydown-BACKTICK', () => this.setOpen(!this.panel.visible));

    const x = GAME_W - W - 12;
    const y = GAME_H - H - 44;
    this.panel = this.add.container(x, y).setVisible(false);
    const bg = this.add.rectangle(0, 0, W, H, 0x101114, 0.92).setOrigin(0).setStrokeStyle(1, 0x5a5a5e).setInteractive();
    this.info = text(this, 14, 12, '', { kind: 'mono', size: 12, color: COLOR.light });
    this.info.setLineSpacing(3);
    this.panel.add([bg, this.info]);

    const by = H - 34;
    this.panel.add(this.chip(14, by, '+100 кубов', () => store.update((s) => addCubes(s, 100))).setOrigin(0, 0.5));
    this.panel.add(this.chip(120, by, '+ все предметы', () => store.update(giveAllItems)).setOrigin(0, 0.5));
    this.resetBtn = this.chip(W - 14, by, 'Сбросить', () => this.reset()).setOrigin(1, 0.5);
    this.panel.add(this.resetBtn);

    // лимит повторов на серию: −/+ и возврат к значению из конфига
    const ry = H - 114;
    this.panel.add(text(this, 14, ry, 'ПОВТОРЫ', { kind: 'mono', size: 12, color: COLOR.lightQuiet }).setOrigin(0, 0.5));
    this.panel.add(this.chip(100, ry, '−', () => this.stepRetries(-1)).setOrigin(0, 0.5));
    this.retriesVal = text(this, 152, ry, '', { kind: 'mono', size: 12, color: COLOR.light }).setOrigin(0.5);
    this.panel.add(this.retriesVal);
    this.panel.add(this.chip(176, ry, '+', () => this.stepRetries(1)).setOrigin(0, 0.5));
    this.retriesDefault = this.chip(W - 14, ry, `из конфига (${SERIES_RETRIES})`, () => store.setRetries(null)).setOrigin(1, 0.5);
    this.panel.add(this.retriesDefault);

    // полное лечение активного бойца
    const hy = H - 74;
    this.healBtn = this.chip(14, hy, 'Вылечить активного', () => this.heal()).setOrigin(0, 0.5);
    this.healNote = text(this, 180, hy, '', { kind: 'mono', size: 12, color: COLOR.lose }).setOrigin(0, 0.5);
    this.panel.add([this.healBtn, this.healNote]);

    // другой игрок на этом устройстве: вход забывается, аккаунт на сервере остаётся
    this.panel.add(this.chip(W - 14, hy, 'Сменить игрока', () => {
      void store.flush().then(() => {
        net.forget();
        location.reload();
      });
    }).setOrigin(1, 0.5));

    // состояние отправки на сервер — всегда на экране, слева от кнопки DEBUG
    const sync = text(this, GAME_W - 78, GAME_H - 12, '', { kind: 'mono', size: 11, color: COLOR.lightQuiet }).setOrigin(1, 1).setPadding(0, 0, 0, 5);
    const showSync = () => {
      const st = store.syncStatus;
      sync.setText(st === 'saving' ? 'сохранение…' : st === 'error' ? 'нет связи с сервером — повтор…' : '').setColor(st === 'error' ? '#ff8a7a' : COLOR.lightQuiet);
      this.render(store.state);
    };
    const unsubSync = store.onSyncStatus(showSync);
    const unsub = store.subscribe((s) => this.render(s));
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, unsub);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, unsubSync);
    this.render(store.state);
  }

  private setOpen(open: boolean) {
    this.panel.setVisible(open);
    this.disarmReset();
  }

  private reset() {
    if (!this.resetArmed) {
      this.resetArmed = true;
      this.resetBtn.setText('Точно сбросить?').setColor(COLOR.lose);
      this.time.delayedCall(2500, () => this.disarmReset());
      return;
    }
    this.disarmReset();
    store.reset();
  }

  private stepRetries(d: number) {
    store.setRetries(Phaser.Math.Clamp(seriesRetries() + d, 0, MAX_RETRIES));
  }

  private heal() {
    const s = store.state;
    const c = activeCharacter(s);
    // во время боя бойца держит BattleScene — итог боя перезапишет кубы, поэтому не лечим
    const note = !c ? 'нет бойца' : s.arenaRun?.inBattle && s.arenaRun.charUid === c.uid ? 'идёт бой' : !c.brokenBlocks.length ? 'и так цел' : '';
    if (note || !store.update((st) => healFull(st, c!.uid))) {
      this.healNote.setText(note);
      this.time.delayedCall(1800, () => this.healNote.setText(''));
    }
  }

  private disarmReset() {
    this.resetArmed = false;
    this.resetBtn?.setText('Сбросить').setColor(COLOR.light);
  }

  private render(s: PlayerState) {
    const kinds = Object.keys(BLUEPRINT_KIND_LABEL) as BlueprintKind[];
    const byKind = kinds.map((k) => `${BLUEPRINT_KIND_LABEL[k].toLowerCase()} ${s.unlockedBlueprints.filter((id) => BLUEPRINTS.find((b) => b.id === id)?.kind === k).length}`);
    const inv = s.inventory.slice(0, 8).map((e) => `  ${getItem(e.itemId).name} ×${e.count}`);
    if (s.inventory.length > 8) inv.push(`  … ещё ${s.inventory.length - 8}`);
    // мешок наград (этап 6): через сколько наград выпадет редкая (пергамент)
    const deck = (s.bags?.['reward.drop'] as { deck?: string[] } | undefined)?.deck ?? [];
    const rareAt = deck.lastIndexOf('parchment');
    const rare = rareAt >= 0 ? `пергамент через ${deck.length - rareAt} из ${deck.length}` : deck.length ? `пергамента в мешке нет, осталось ${deck.length}` : 'мешок пуст — новый круг';
    const active = activeCharacter(s);
    const run = s.arenaRun;
    const overridden = store.debug.retries !== undefined;
    this.retriesVal.setText(String(seriesRetries())).setColor(overridden ? COLOR.title : COLOR.light);
    this.retriesDefault.setVisible(overridden);
    this.healBtn.setAlpha(active?.brokenBlocks.length ? 1 : 0.5);
    this.info.setText(
      [
        `ИГРОК       ${net.playerName || '— (нет входа)'}${net.profile ? ` · профиль ${net.profile}` : ''}`,
        `СЕРВЕР      ${SERVER_ADDRESS} · ${SYNC_LABEL[store.syncStatus]}`,
        `КУБЫ        ${cubeCount(s)}`,
        `ИНВЕНТАРЬ   ${s.inventory.length} зап., ${totalItemCount(s)} шт.`,
        ...inv,
        `ПЕРСОНАЖИ   ${s.characters.length}`,
        `АКТИВНЫЙ    ${active ? `${active.name}, разбито ${active.brokenBlocks.length} из ${active.blockStats.length}` : '—'}`,
        `СЕРИЯ       ${run ? `бой ${run.fight} из ${SERIES_LENGTH}, повторов ${retriesLeft(run)} из ${seriesRetries()}` : 'нет'}`,
        `ЧЕРТЕЖИ     ${s.unlockedBlueprints.length} из ${BLUEPRINTS.length}`,
        `  ${byKind.slice(0, 3).join(', ')}`,
        `  ${byKind.slice(3).join(', ')}`,
        `МЕШКИ       ${Object.keys(s.bags ?? {}).length} шт.; награда: ${rare}`,
        `КАТАЛОГ     ${ITEMS.length} предметов, ${Object.keys(EFFECTS).length} эффекта`,
      ].join('\n'),
    );
  }

  private chip(x: number, y: number, label: string, onClick: () => void) {
    const t = text(this, x, y, label, { kind: 'mono', size: 12, color: COLOR.light })
      .setPadding(8, 5, 8, 5)
      .setBackgroundColor('#2a2b30')
      .setInteractive({ useHandCursor: true });
    t.on('pointerover', () => t.setBackgroundColor('#3c3d44'));
    t.on('pointerout', () => t.setBackgroundColor('#2a2b30'));
    t.on('pointerup', onClick);
    return t;
  }
}

/** Чит: по одному каждому предмету со своим чертежом (снаряжение, камни, сумки). */
function giveAllItems(s: PlayerState): PlayerState {
  return ITEMS.filter((i) => i.blueprintId).reduce((acc, i) => addItem(acc, i.id, 1, store.maxStack(i.id)), s);
}
