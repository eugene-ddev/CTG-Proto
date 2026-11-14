// «Рейтинг»: таблица лидеров боёв с игроками — место, имя, рейтинг, победы и поражения; своя строка выделена.
import Phaser from 'phaser';
import { store } from '../game/store';
import { net, type LeaderRow, type LeaderboardView } from '../net/client';
import { Card } from '../ui/Panel';
import { text } from '../ui/text';
import { COLOR } from '../ui/theme';
import { BaseScene } from './BaseScene';
import { SCENE } from './keys';

const ROW_H = 30;
const PER_PAGE = 12;

export class LeaderboardScene extends BaseScene {
  private page = 0;

  constructor() {
    super(SCENE.leaderboard);
  }

  create() {
    this.page = 0;
    const a = store.arena;
    this.setupScreen({
      title: 'Рейтинг',
      tab: 'rating',
      subtitle: `твой рейтинг ${a.rating} · побед ${a.wins} · поражений ${a.losses} · меняется в боях с игроками: победа над сильным даёт больше`,
    });
    const card = new Card(this, 240, 146, 800, 540, { title: 'Таблица лидеров', aside: ' ' });
    const note = text(this, card.innerW / 2, 200, 'Загрузка…', { size: 16 }).setOrigin(0.5);
    card.content.add(note);
    net.leaderboard().then(
      (view) => this.scene.isActive() && (note.destroy(), this.renderTable(card, view)),
      (e: Error) => this.scene.isActive() && note.setText(e.message),
    );
  }

  private renderTable(card: Card, view: LeaderboardView) {
    const w = card.innerW;
    const c = card.content;
    card.setAside(`игроков: ${view.total}${view.me ? ` · твоё место: ${view.me.rank}` : ''}`);
    const cols = { rank: 36, name: 70, rating: w - 300, wins: w - 180, losses: w - 60 };
    const head = (x: number, label: string, right = false) => c.add(text(this, x, 0, label, { size: 12, color: COLOR.inkQuiet, letterSpacing: 1 }).setOrigin(right ? 1 : 0, 0));
    head(cols.rank, 'МЕСТО', true);
    head(cols.name, 'ИГРОК');
    head(cols.rating, 'РЕЙТИНГ', true);
    head(cols.wins, 'ПОБЕД', true);
    head(cols.losses, 'ПОРАЖЕНИЙ', true);
    const body = this.add.container(0, 26);
    c.add(body);
    const row = (r: LeaderRow, y: number) => {
      if (r.me) {
        const bg = this.add.graphics();
        bg.fillStyle(0xf2b312, 0.28).fillRoundedRect(-6, y - 4, w + 12, ROW_H - 2, 4);
        body.add(bg);
      }
      const weight = r.me ? 700 : 400;
      body.add(text(this, cols.rank, y, String(r.rank), { kind: 'mono', size: 15, weight }).setOrigin(1, 0));
      body.add(text(this, cols.name, y, r.me ? `${r.name} · ты` : r.name, { size: 16, weight }));
      body.add(text(this, cols.rating, y, String(r.rating), { kind: 'mono', size: 15, weight: 700 }).setOrigin(1, 0));
      body.add(text(this, cols.wins, y, String(r.wins), { kind: 'mono', size: 15, color: COLOR.win }).setOrigin(1, 0));
      body.add(text(this, cols.losses, y, String(r.losses), { kind: 'mono', size: 15, color: COLOR.lose }).setOrigin(1, 0));
    };
    const pages = Math.max(1, Math.ceil(view.top.length / PER_PAGE));
    const draw = () => {
      body.removeAll(true);
      if (!view.top.length) {
        body.add(text(this, w / 2, 170, 'В таблице пока никого.', { size: 16 }).setOrigin(0.5));
        return;
      }
      this.page = Phaser.Math.Clamp(this.page, 0, pages - 1);
      const rows = view.top.slice(this.page * PER_PAGE, (this.page + 1) * PER_PAGE);
      rows.forEach((r, k) => row(r, k * ROW_H));
      let y = rows.length * ROW_H;
      // своё место ниже показанных первых — строки вокруг него
      if (view.around.length && this.page === pages - 1) {
        body.add(text(this, w / 2, y + 2, '· · ·', { size: 14, color: COLOR.inkQuiet }).setOrigin(0.5, 0));
        y += ROW_H;
        view.around.slice(0, Math.max(0, Math.floor((card.innerH - 70 - y) / ROW_H))).forEach((r, k) => row(r, y + k * ROW_H));
      }
      if (pages > 1) {
        const py = card.innerH - 42;
        body.add(text(this, w / 2, py, `${this.page + 1} / ${pages}`, { size: 13, color: COLOR.inkQuiet }).setOrigin(0.5));
        const nav = (x: number, label: string, d: number) => {
          const t = text(this, x, py, label, { size: 20 }).setOrigin(0.5).setInteractive({ useHandCursor: true });
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
}
