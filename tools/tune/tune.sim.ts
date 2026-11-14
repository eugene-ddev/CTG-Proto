import { it } from 'vitest';
import { existsSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { getBlueprint, getItem } from '../../src/data/catalog';
import type { CharacterBlueprint, EquipmentItem, Stat } from '../../src/data/types';
import { createBattle, runToEnd, type FighterInput } from '../../src/core/battle';
import { botTarget, generateOpponent } from '../../src/core/opponent';

const N = Number(process.env.SIM_N ?? 40);
const BP = getBlueprint('bp-lobster') as CharacterBlueprint;
const W = ['rustyDagger', 'rustySword', 'rustyAxe', 'rustyClub', 'rustyHammer'] // копьё и нож вне ротации (0.0.73);
function build(main: 'Strength' | 'Dexterity', m = 14): Stat[] {
  const other = main === 'Strength' ? 'Dexterity' : 'Strength';
  const counts: Array<[Stat, number]> = [[main, m], ['Armor', 6], ['Stamina', 10], ['Luck', 6], [other, 2]];
  const out: Stat[] = counts.flatMap(([s, n]) => Array<Stat>(n).fill(s));
  while (out.length < BP.blocks.length) out.push('Stamina');
  return out.slice(0, BP.blocks.length);
}
const fighter = (id: string, m: number): FighterInput => {
  const w = getItem(id) as EquipmentItem;
  return { name: id, blueprintId: BP.id, blockStats: build(w.scalingStat === 'Strength' ? 'Strength' : 'Dexterity', m), equipment: BP.slots.map((s) => (s.type === 'Hand' ? w : null)) };
};
const mainOf = (k: number, side: 0 | 1) => 10 + 4 * ((side ? Math.floor(k / 3) : k) % 3);
function rate(a: string, b: string): number {
  let wins = 0;
  for (let k = 0; k < N; k++) {
    const first = k % 2 === 0;
    const A = fighter(a, mainOf(k, 0)), B = fighter(b, mainOf(k, 1));
    const r = runToEnd(first ? createBattle(1000 + k, A, B) : createBattle(1000 + k, B, A));
    wins += r.over!.winner === (first ? 'player' : 'enemy') ? 1 : 0;
  }
  return wins / N;
}
const STATE = process.env.HOME + '/chk/tools/tune/dmg.json';
it('tune', () => {
  const dmg: Record<string, number> = existsSync(STATE) ? JSON.parse(readFileSync(STATE, 'utf8')) : Object.fromEntries(W.map((id) => [id, (getItem(id) as EquipmentItem).ability.damage]));
  const cd: Record<string, number> = JSON.parse(process.env.CD ?? '{}');
  for (const id of W) { const it = getItem(id) as EquipmentItem; (it as { ability: unknown }).ability = { ...it.ability, damage: dmg[id], ...(cd[id] ? { cooldown: cd[id] } : {}) }; }
  const avg: Record<string, number> = {};
  const mat: Record<string, number> = {}, bot: Record<string, number> = {};
  for (const a of W) {
    let s = 0; for (const b of W) if (a !== b) s += rate(a, b); mat[a] = s / (W.length - 1);
    let w = 0;
    for (let k = 0; k < N; k++) {
      const me = fighter(a, 14);
      const o = generateOpponent(1000 + k, { level: 1, category: BP.category, player: me });
      w += runToEnd(createBattle(k + 1, { ...me, target: botTarget(o) }, o)).over!.winner === 'player' ? 1 : 0;
    }
    bot[a] = w / N;
    avg[a] = (mat[a] + bot[a]) / 2;
  }
  appendFileSync(process.env.HOME + '/chk/tools/tune/log.txt', W.map((id) => `${id.replace('rusty', '')} ${dmg[id].toFixed(1)}→${Math.round(mat[id] * 100)}/${Math.round(bot[id] * 100)}`).join(' | ') + '\n');
  for (const id of W) dmg[id] = Math.round(dmg[id] * Math.pow(0.5 / Math.min(0.97, Math.max(0.03, avg[id])), Number(process.env.K ?? 0.35)));
  writeFileSync(STATE, JSON.stringify(dmg));
}, 600000);
