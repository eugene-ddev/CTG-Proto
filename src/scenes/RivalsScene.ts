// «Соперники»: список игроков для боя. Бой идёт с активным бойцом соперника (со снимком — хозяин может быть не
// в игре); у каждого — сколько рейтинга даст победа и сколько отнимет поражение.
import Phaser from 'phaser';
import { SERIES_LENGTH, activeCharacter } from '../core/arena';
import { itemOf } from '../core/character';
import { getBlueprint, hasBlueprint, hasItem } from '../data/catalog';
import type { CharacterBlueprint } from '../data/types';
import { store } from '../game/store';
import { net, type Rival, type RivalList } from '../net/client';
import { Button } from '../ui/Button';
import { Card } from '../ui/Panel';
import { VoxelView } from '../ui/VoxelView';
import { text } from '../ui/text';
import { COLOR, STAT_COLOR } from '../ui/theme';
import { BaseScene } from './BaseScene';
import { SCENE, type OpponentSceneData } from './keys';

const ROW_H = 96;
const PER_PAGE = 5;

export class RivalsScene extends BaseScene {
  private page = 0;
  private busy = false;

  constructor() {
    super(SCENE.rivals);
  }

  create() {
    this.busy = false;
    const s = store.state;
    const run = s.arenaRun?.mode === 'players' ? s.arenaRun : null;
    // соперник уже выбран — к нему
    if (run?.opp) return void this.scene.start(SCENE.opponent, { charUid: run.charUid } satisfies OpponentSceneData);
    const c = activeCharacter(s);
    this.setupScreen({
      title: 'Соперники',
      kicker: run ? `Бой с игроками · бой ${run.fight} из ${SERIES_LENGTH} · побед ${run.wins}` : `Бой с игроками · серия из ${SERIES_LENGTH} боёв`,
      subtitle: `твой рейтинг ${store.arena.rating} · победил — забираешь лут соперника и рейтинг, проиграл — теряешь оружие, рюкзак и рейтинг`,
      back: run ? null : SCENE.menu,
    });
    if (run) {
      new Button(this, 150, 676, 'Забрать и выйти', {
        variant: 'beige', width: 220, height: 50, size: 18,
        onClick: () => {
          store.act('endRun');
          this.go(SCENE.menu);
        },
      });
    }
    const card = new Card(this, 140, 150, 1000, 500, { title: 'Выбери соперника', aside: c ? `твой боец · ${c.name}` : '' });
    const note = text(this, card.innerW / 2, 200, c ? 'Загрузка списка…' : 'Сначала собери бойца.', { size: 16 }).setOrigin(0.5);
    card.content.add(note);
    if (!c || (s.arenaRun && !run)) {
      if (s.arenaRun && !run) note.setText('Идёт серия с ботами — закончи её, чтобы драться с игроками.');
      return;
    }
    net.opponents().then(
      (list) => {
        store.setArena(list.me);
        if (this.scene.isActive()) (note.destroy(), this.renderList(card, list, c.uid));
      },
      (e: Error) => this.scene.isActive() && note.setText(e.message),
    );
  }

  private renderList(card: Card, list: RivalList, charUid: string) {
    const body = this.add.container(0, 0);
    card.content.add(body);
    const w = card.innerW;
    const draw = () => {
      body.removeAll(true);
      if (!list.opponents.length) {
        body.add(text(this, w / 2, 190, 'Других игроков с бойцом пока нет.\nОткрой игру вторым игроком: добавь ?profile=имя в адрес страницы.', { size: 16, align: 'center' }).setOrigin(0.5));
        return;
      }
      const pages = Math.ceil(list.opponents.length / PER_PAGE);
      this.page = Phaser.Math.Clamp(this.page, 0, pages - 1);
      list.opponents.slice(this.page * PER_PAGE, (this.page + 1) * PER_PAGE).forEach((r, k) => this.row(body, r, k * ROW_H, w, charUid));
      if (pages > 1) {
        const y = card.innerH - 14;
        body.add(text(this, w / 2, y, `${this.page + 1} / ${pages}`, { size: 13, color: COLOR.inkQuiet }).setOrigin(0.5));
        const nav = (x: number, label: string, d: number) => {
          const t = text(this, x, y, label, { size: 20 }).setOrigin(0.5).setInteractive({ useHandCursor: true });
          t.on('pointerup', () => {
            this.page += d;
            draw();
          });
          body.add(t);
        };
        nav(w / 2 - 50, '◀', -1);
        nav(w / 2 + 50, '▶', 1);
      }
    };
    draw();
  }

  /** Строка соперника: модель бойца, имя и рейтинг, оружие, изменение рейтинга, «Вызвать». */
  private row(body: Phaser.GameObjects.Container, r: Rival, y: number, w: number, charUid: string) {
    const snap = r.snapshot;
    const known = hasBlueprint(snap.blueprintId);
    if (known) {
      const bp = getBlueprint(snap.blueprintId) as CharacterBlueprint;
      body.add(new VoxelView(this, 52, y + 42, { blocks: bp.blocks, width: 92, height: 72, maxBlockPx: 11, yaw: 270, colorOf: (i) => STAT_COLOR[snap.blockStats[i]] }));
    }
    body.add(text(this, 116, y + 6, r.name, { kind: 'display', size: 24 }));
    body.add(text(this, 116, y + 38, `рейтинг ${r.rating} · побед ${r.wins} · поражений ${r.losses}`, { size: 13, color: COLOR.inkQuiet }));
    const weapons = snap.equipment.filter((e): e is NonNullable<typeof e> => !!e && hasItem(e.itemId)).map((e) => itemOf(e).name);
    const fighter = `${snap.charName}${known ? ` · ${getBlueprint(snap.blueprintId).name} · ${snap.blockStats.length} куб.` : ''} · ${weapons.length ? weapons.join(', ') : 'без оружия'}`;
    body.add(text(this, 116, y + 58, fighter, { size: 13, wrap: w - 116 - 330 }));
    // сколько рейтинга за победу и за поражение
    body.add(text(this, w - 300, y + 14, 'победа', { size: 12, color: COLOR.inkQuiet }).setOrigin(0.5, 0));
    body.add(text(this, w - 300, y + 30, `+${r.winDelta}`, { kind: 'mono', size: 24, weight: 700, color: COLOR.win }).setOrigin(0.5, 0));
    body.add(text(this, w - 220, y + 14, 'поражение', { size: 12, color: COLOR.inkQuiet }).setOrigin(0.5, 0));
    body.add(text(this, w - 220, y + 30, `${r.loseDelta}`, { kind: 'mono', size: 24, weight: 700, color: COLOR.lose }).setOrigin(0.5, 0));
    body.add(
      new Button(this, w - 80, y + 42, 'Вызвать', {
        width: 150, height: 50, size: 20,
        onClick: () => {
          if (this.busy) return;
          this.busy = true;
          void store.call(() => net.challenge(r.userId, charUid)).then((ok) => {
            this.busy = false;
            if (!this.scene.isActive()) return;
            if (ok) this.go(SCENE.opponent, { charUid } satisfies OpponentSceneData);
            else this.cameras.main.shake(120, 0.003);
          });
        },
      }),
    );
    const line = this.add.graphics();
    line.fillStyle(0x6b4a2a, 0.35).fillRect(0, y + ROW_H - 8, w, 1);
    body.add(line);
  }
}
