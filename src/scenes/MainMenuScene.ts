import { BaseScene } from './BaseScene';
import type { CharacterState } from '../core/state';
import { SERIES_LENGTH, activeCharacter, fullRegenIn } from '../core/arena';
import { itemOf } from '../core/character';
import { getBlueprint, getItem, hasBlueprint, itemModel } from '../data/catalog';
import type { CharacterBlueprint } from '../data/types';
import { store } from '../game/store';
import { SCENE, type OpponentSceneData } from './keys';
import { ArrowButton } from '../ui/ArrowButton';
import { Button } from '../ui/Button';
import { text } from '../ui/text';
import { COLOR, GAME_W, GAME_H, STAT_COLOR } from '../ui/theme';
import { modelView } from '../ui/modelView';
import { net } from '../net/client';
import { RATING_START } from '../core/rating';
import { Modal } from '../ui/Modal';
import { FACE_RIGHT } from '../render/anim';

/** «3:05», «1:02:10». */
const mmss = (ms: number) => {
  const t = Math.ceil(ms / 1000);
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), sec = String(t % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
};

export { activeCharacter } from '../core/arena';

export class MainMenuScene extends BaseScene {
  constructor() {
    super(SCENE.menu);
  }

  create() {
    this.setupScreen({ title: 'Арена', tab: 'menu' });
    text(this, GAME_W / 2, 120, `ВЕРСИЯ ${__APP_VERSION__}${net.playerName ? ` · ИГРОК ${net.playerName.toUpperCase()}` : ''}`, { size: 18, color: COLOR.lightQuiet, letterSpacing: 1 }).setOrigin(0.5, 0);
    text(this, GAME_W / 2, 142, 'Cuber The Game', { kind: 'display', size: 64, color: COLOR.title }).setOrigin(0.5, 0);

    // разделы — в верхних табах; здесь — активный боец и выход на арену
    const c = activeCharacter(store.state);
    if (c && hasBlueprint(c.blueprintId)) this.activeFighter(c);
    else this.noFighter();

    this.devLink(24, 'UI-КИТ →', () => this.go(SCENE.uiKit));
    this.devLink(130, 'МОДЕЛИ →', () => this.go(SCENE.models));
  }

  /** Активный боец: модель со снаряжением, имя, кубы; стрелки — сменить (вне серии); «Персонаж» и «Арена». */
  private activeFighter(c: CharacterState) {
    const s = store.state;
    const cx = GAME_W / 2;
    const bp = getBlueprint(c.blueprintId) as CharacterBlueprint;
    const run = s.arenaRun;
    const broken = new Set(c.brokenBlocks);
    const view = modelView(this, cx, 388, {
      blocks: bp.blocks,
      width: 360,
      height: 240,
      maxBlockPx: 36,
      interactive: true,
      yaw: FACE_RIGHT,
      colorOf: (i) => STAT_COLOR[c.blockStats[i]],
      lookOf: (i) => (broken.has(i) ? 'broken' : 'solid'),
      slots: bp.slots,
      slotMarkers: false,
      equipped: bp.slots.map((_, i) => {
        const e = c.equipment[i];
        const it = e ? itemOf(e) : null;
        return it ? itemModel(it.id, 'itemLevel' in it ? it.itemLevel : 1) : null;
      }),
    });
    text(this, cx, 232, run ? 'В СЕРИИ АРЕНЫ' : 'АКТИВНЫЙ БОЕЦ', { size: 13, color: COLOR.lightQuiet, letterSpacing: 2 }).setOrigin(0.5, 0);
    text(this, cx, 516, c.name, { kind: 'display', size: 28, color: COLOR.light }).setOrigin(0.5, 0);
    const info = text(this, cx, 550, '', { size: 14, color: COLOR.lightQuiet });
    // разбитые кубы бойца в серии сами не чинятся — красным сразу за строкой
    const noRegen = text(this, cx, 550, '', { size: 14, color: COLOR.lose });
    // кубы чинятся со временем — модель и подпись обновляются сами
    let shownBroken = c.brokenBlocks.join(',');
    const refresh = () => {
      const st = store.state;
      const cur = st.characters.find((x) => x.uid === c.uid);
      if (!cur) return;
      const key = cur.brokenBlocks.join(',');
      if (key !== shownBroken) {
        shownBroken = key;
        const br = new Set(cur.brokenBlocks);
        view.setLookOf((i) => (br.has(i) ? 'broken' : 'solid'));
      }
      const r = st.arenaRun?.charUid === cur.uid ? st.arenaRun : null;
      const alive = cur.blockStats.length - cur.brokenBlocks.length;
      const all = fullRegenIn(st, cur, store.now());
      const regen = cur.brokenBlocks.length && !r && all !== null ? ` · все через ${mmss(all)}` : '';
      info.setText(`${bp.name} · кубы ${alive}/${cur.blockStats.length}${regen}${r ? ` · бой ${r.fight}/${SERIES_LENGTH}` : ''}`);
      noRegen.setText(cur.brokenBlocks.length && r ? ' · не чинятся, пока на арене' : '');
      // строка и красная приписка — вместе по центру
      const total = info.width + noRegen.width;
      info.setX(cx - total / 2);
      noRegen.setX(cx - total / 2 + info.width);
    };
    this.watch(refresh);
    this.time.addEvent({ delay: 1000, loop: true, callback: refresh });

    // сменить активного — только вне серии и если бойцов несколько
    const chars = s.characters.filter((x) => hasBlueprint(x.blueprintId));
    if (!run && chars.length > 1) {
      const k = chars.findIndex((x) => x.uid === c.uid);
      const pick = (d: number) => {
        const next = chars[(k + d + chars.length) % chars.length];
        store.act('setActiveCharacter', next.uid);
        this.scene.restart();
      };
      new ArrowButton(this, cx - 250, 388, -1, () => pick(-1));
      new ArrowButton(this, cx + 250, 388, 1, () => pick(1));
      text(this, cx, 574, `${k + 1} / ${chars.length}`, { size: 12, color: COLOR.lightQuiet }).setOrigin(0.5, 0);
    }

    // два вида серий: с ботами (при поражении всё остаётся) и с игроками (рейтинг; при поражении оружие и рюкзак пропадают).
    // Идёт серия — одна кнопка «Продолжить».
    if (run) {
      new Button(this, cx, 636, run.mode === 'players' ? 'Продолжить · игроки' : 'Продолжить серию', {
        variant: 'brown', width: 380, height: 68, size: 30,
        onClick: () => this.go(SCENE.opponent, { charUid: run.charUid } satisfies OpponentSceneData),
      });
    } else {
      new Button(this, cx - 170, 636, 'С ботами', {
        variant: 'brown', width: 320, height: 68, size: 34,
        onClick: () => this.go(SCENE.opponent, { charUid: c.uid } satisfies OpponentSceneData),
      });
      new Button(this, cx + 170, 636, 'С игроками', {
        variant: 'brown', width: 320, height: 68, size: 34,
        onClick: () => this.go(SCENE.rivals),
      });
    }
    text(this, cx, 684, `рейтинг ${s.rating ?? RATING_START}${s.pvp ? ` · побед ${s.pvp.wins} · поражений ${s.pvp.losses}` : ''}`, { size: 13, color: COLOR.lightQuiet }).setOrigin(0.5, 0);
    this.showInbox();
  }

  /** Журнал нападений: кто вызывал бойца, пока игрока не было. Показывается один раз. */
  private showInbox() {
    const inbox = store.state.inbox ?? [];
    if (!inbox.length) return;
    const shown = inbox.slice(-6).reverse();
    const m = new Modal(this, { title: 'Пока тебя не было', width: 620, height: 200 + shown.length * 44, onClose: () => store.act('inboxClear') });
    const w = m.card.innerW;
    shown.forEach((e, k) => {
      const y = 4 + k * 44;
      const reward = e.reward ? ` · награда: ${e.reward.cubes} куб.${e.reward.items.map((i) => `, ${getItem(i.itemId).name.toLowerCase()} ×${i.count}`).join('')}` : '';
      m.card.content.add(text(this, 0, y, `${e.attacker} напал — ${e.won ? 'твой боец отбился' : 'твой боец проиграл'}`, { size: 15, weight: 700, color: e.won ? COLOR.win : COLOR.lose }));
      m.card.content.add(text(this, 0, y + 20, `рейтинг ${e.ratingDelta > 0 ? '+' : ''}${e.ratingDelta}${reward}`, { size: 13, color: COLOR.inkQuiet }));
    });
    if (inbox.length > shown.length) m.card.content.add(text(this, w, 4, `и ещё ${inbox.length - shown.length}`, { size: 12, color: COLOR.inkQuiet }).setOrigin(1, 0));
    m.card.content.add(new Button(this, w / 2, m.card.innerH - 30, 'Понятно', { width: 200, height: 46, size: 20, onClick: () => m.close() }));
  }

  /** Бойцов нет — предложить собрать первого. */
  private noFighter() {
    const cx = GAME_W / 2;
    text(this, cx, 360, 'Собери первого персонажа', { kind: 'display', size: 32, color: COLOR.light }).setOrigin(0.5, 0);
    text(this, cx, 404, 'Персонаж собирается из кубов по чертежу — после сборки он сразу готов к бою.', { size: 15, color: COLOR.lightQuiet }).setOrigin(0.5, 0);
    new Button(this, cx, 480, 'Создать персонажа', {
      variant: 'brown', width: 340, height: 66, size: 30,
      onClick: () => {
        this.registry.set('blueprints.tab', 'character');
        this.openTab('blueprints');
      },
    });
  }

  /** Служебная ссылка внизу меню. */
  private devLink(x: number, label: string, onClick: () => void) {
    const t = text(this, x, GAME_H - 34, label, { size: 15, color: COLOR.lightQuiet, letterSpacing: 1 })
      .setInteractive({ useHandCursor: true })
      .on('pointerup', onClick);
    t.on('pointerover', () => t.setColor(COLOR.title)).on('pointerout', () => t.setColor(COLOR.lightQuiet));
  }
}
