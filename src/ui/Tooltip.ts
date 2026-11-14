import Phaser from 'phaser';
import { isDragRelease } from './dragGuard';
import { panel, dottedLine } from './Panel';
import { text } from './text';
import { COLOR, DEPTH, GAME_W, GAME_H } from './theme';
import { createSpreadView } from './SpreadView';
import { PATTERN_LABEL } from '../data/labels';
import type { WeaponPattern, WeaponPerk } from '../data/types';

export interface TooltipContent {
  title?: string;
  /** Строки «метка — значение», как в «Статах слота». */
  rows?: Array<[label: string, value: string, color?: string]>;
  note?: string;
  /** Подробности под зажатым Alt (у оружия — прокачка). Есть — внизу подсказка «Alt — …». */
  alt?: TooltipContent;
  /** Что показывает alt — для подсказки внизу («прокачка»). */
  altLabel?: string;
  /** Схема удара оружия — рисуется кубами после строк (вместо строки «Удар»). */
  strike?: { pattern: WeaponPattern; perk?: WeaponPerk; desc: string };
  /** Уровни прокачки (Alt): подпись, схема удара, описание; on — уровень взят (тёмный), иначе бледнее. */
  levels?: Array<{ label: string; desc: string; on: boolean; pattern: WeaponPattern; perk?: WeaponPerk }>;
}

const WIDTH = 260;
/** Ещё не взятые уровни прокачки — бледнее обычного «тихого» текста. */
const LEVEL_PALE = '#b39a7c';
const registry = new WeakMap<Phaser.Scene, Tooltip>();

// Alt зажат — открытые тултипы показывают alt-вариант. Слушаем окно: Phaser-клавиатура теряет keyup при смене фокуса.
let altHeld = false;
const live = new Set<Tooltip>();
function setAlt(v: boolean) {
  if (altHeld === v) return;
  altHeld = v;
  for (const t of live) t.refresh();
}
if (typeof window !== 'undefined') {
  // preventDefault — иначе Alt в Chrome/Firefox на Windows уводит фокус в меню браузера
  window.addEventListener('keydown', (e) => { if (e.key === 'Alt') { e.preventDefault(); setAlt(true); } });
  window.addEventListener('keyup', (e) => { if (e.key === 'Alt') { e.preventDefault(); setAlt(false); } });
  window.addEventListener('blur', () => setAlt(false));
}

/** Одна всплывашка на сцену, следует за курсором. */
export class Tooltip {
  private root: Phaser.GameObjects.Container;
  private last: { content: TooltipContent; x: number; y: number } | null = null;

  static for(scene: Phaser.Scene): Tooltip {
    let t = registry.get(scene);
    if (!t) {
      const tip = new Tooltip(scene);
      t = tip;
      registry.set(scene, tip);
      live.add(tip);
      scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
        registry.delete(scene);
        live.delete(tip);
      });
    }
    return t;
  }

  private constructor(private scene: Phaser.Scene) {
    this.root = scene.add.container(0, 0).setDepth(DEPTH.tooltip).setVisible(false);
  }

  /** Перерисовать открытый тултип (зажали / отпустили Alt). */
  refresh() {
    if (this.last && this.root.visible && this.root.active) this.show(this.last.content, this.last.x, this.last.y);
  }

  show(base: TooltipContent, x: number, y: number) {
    this.last = { content: base, x, y };
    const content = altHeld && base.alt ? base.alt : base;
    const altHint = base.alt ? (content === base ? `Зажми Alt — ${base.altLabel ?? 'подробнее'}` : null) : null;
    this.root.removeAll(true);
    const s = this.scene;
    const pad = 14;
    const items: Phaser.GameObjects.GameObject[] = [];
    let cy = pad;

    if (content.title) {
      items.push(text(s, pad, cy - 2, content.title, { kind: 'display', size: 20 }));
      cy += 28;
    }
    for (const [label, value, color] of content.rows ?? []) {
      const l = text(s, pad, cy, label.toUpperCase(), { size: 13, color: COLOR.inkQuiet });
      items.push(l);
      const v = text(s, WIDTH - pad, cy - 1, value, { kind: 'mono', size: 14, color: color ?? COLOR.ink }).setOrigin(1, 0);
      if (v.width > WIDTH - pad * 2 - l.width - 12) {
        // длинное значение не влезает справа от метки — переносим под неё, по ширине тултипа
        v.setOrigin(0, 0).setPosition(pad, cy + 18).setWordWrapWidth(WIDTH - pad * 2, true).setLineSpacing(2);
        cy += 18 + v.height + 2;
      } else {
        cy += 20;
      }
      items.push(v);
      items.push(dottedLine(s, pad, cy - 3, WIDTH - pad, 0x9a7a58));
      cy += 4;
    }
    if (content.strike) {
      const { pattern, perk, desc } = content.strike;
      cy += 2;
      items.push(text(s, pad, cy, `УДАР · ${PATTERN_LABEL[pattern].toUpperCase()}`, { size: 13, color: COLOR.inkQuiet }));
      cy += 18;
      items.push(createSpreadView(s, WIDTH / 2, cy + 46, WIDTH - pad * 2, 92, pattern, perk));
      cy += 96;
      const d = text(s, pad, cy, desc, { size: 12, color: COLOR.ink, wrap: WIDTH - pad * 2 });
      items.push(d);
      cy += d.height + 4;
    }
    for (const [k, lv] of (content.levels ?? []).entries()) {
      if (k) {
        cy += 8;
        items.push(dottedLine(s, pad, cy, WIDTH - pad, 0x9a7a58));
        cy += 10;
      }
      const color = lv.on ? COLOR.ink : LEVEL_PALE;
      items.push(text(s, pad, cy, lv.label, { size: 14, weight: 700, color }));
      cy += 22;
      items.push(createSpreadView(s, WIDTH / 2, cy + 38, WIDTH - pad * 2, 76, lv.pattern, lv.perk).setAlpha(lv.on ? 1 : 0.45));
      cy += 82;
      const d = text(s, pad, cy, lv.desc, { size: 13, color, wrap: WIDTH - pad * 2 }).setLineSpacing(3);
      items.push(d);
      cy += d.height;
    }
    if (content.note) {
      cy += 4;
      const n = text(s, pad, cy, content.note, { size: 13, color: COLOR.inkQuiet, wrap: WIDTH - pad * 2 });
      items.push(n);
      cy += n.height;
    }
    if (altHint) {
      cy += 6;
      const n = text(s, pad, cy, altHint, { size: 12, color: COLOR.inkQuiet, wrap: WIDTH - pad * 2 }).setAlpha(0.8);
      items.push(n);
      cy += n.height;
    }
    const h = cy + pad;
    this.root.add([panel(s, 0, 0, WIDTH, h, 'light'), ...items]);

    // справа-снизу от курсора, но не за краем экрана
    const px = x + 18 + WIDTH > GAME_W ? x - 18 - WIDTH : x + 18;
    const py = Math.min(y + 18, GAME_H - h - 8);
    this.root.setPosition(px, Math.max(8, py)).setVisible(true);
  }

  hide() {
    this.last = null;
    this.root.setVisible(false);
  }
}

/** Показывать тултип при наведении на интерактивный объект. null — не показывать. */
export function attachTooltip(target: Phaser.GameObjects.GameObject, content: () => TooltipContent | null) {
  const scene = target.scene;
  const move = (p: Phaser.Input.Pointer) => {
    if (isDragRelease(scene)) return; // идёт перетаскивание — без всплывашек
    const c = content();
    if (c) Tooltip.for(scene).show(c, p.x, p.y);
  };
  target.on('pointerover', move);
  target.on('pointermove', move);
  target.on('pointerout', () => Tooltip.for(scene).hide());
}
