import Phaser from 'phaser';
import { FONT } from './fonts';
import { COLOR } from './theme';

type Kind = 'display' | 'body' | 'mono';

export interface TextOpts {
  size?: number;
  color?: string;
  kind?: Kind;
  weight?: number;
  align?: 'left' | 'center' | 'right';
  wrap?: number;
  letterSpacing?: number;
}

/** Текст с чёткой отрисовкой при масштабировании канваса. */
export function text(scene: Phaser.Scene, x: number, y: number, value: string, opts: TextOpts = {}) {
  const kind = opts.kind ?? 'body';
  const t = scene.add.text(x, y, kind === 'display' ? value.toUpperCase() : value, {
    fontFamily: FONT[kind],
    fontSize: `${opts.size ?? 16}px`,
    fontStyle: opts.weight ? String(opts.weight) : undefined,
    color: opts.color ?? COLOR.ink,
    align: opts.align ?? 'left',
    wordWrap: opts.wrap ? { width: opts.wrap, useAdvancedWrap: true } : undefined,
  });
  if (opts.letterSpacing) t.setLetterSpacing(opts.letterSpacing);
  t.setResolution(Math.max(2, window.devicePixelRatio || 1));
  return t;
}
