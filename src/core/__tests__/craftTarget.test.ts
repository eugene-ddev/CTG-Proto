import { describe, expect, it } from 'vitest';
import { START, BLUEPRINTS, getBlueprint, getItem } from '../../data/catalog';
import type { CharacterBlueprint, Stat } from '../../data/types';
import { completeCraft } from '../craft';
import { applyTarget, targetFit, targetLabel } from '../craftTarget';
import { addItem, createInitialState, type PlayerState } from '../state';

const maxStack = (id: string) => { const it = getItem(id); return it.kind === 'potion' ? it.maxStack : 1; };
const lobster = getBlueprint('bp-lobster') as CharacterBlueprint;
const stats38 = (): Stat[] => [...Array(13).fill('Strength'), ...Array(13).fill('Dexterity'), ...Array(12).fill('Stamina')];

function fresh(): { s: PlayerState; uid: string } {
  const s = completeCraft(createInitialState({ ...START, unlockAllBlueprints: true }, BLUEPRINTS.map((b) => b.id), maxStack), lobster, { manual: true, maxStack, blockStats: stats38() })!.state;
  return { s, uid: s.characters[0].uid };
}

describe('контекст сборки', () => {
  it('меч — в руку, зелье — нет; подпись ячейки', () => {
    const { s, uid } = fresh();
    expect(targetLabel(s, { charUid: uid, slot: 0 })).toMatch(/рука/);
    expect(targetFit(s, { charUid: uid, slot: 0 }, getItem('rustySword'))).toBe('ok');
    expect(targetFit(s, { charUid: uid, slot: 0 }, getItem('restoreStrengthFlask'))).toBeNull();
    expect(targetFit(s, { charUid: 'nobody', slot: 0 }, getItem('rustySword'))).toBeNull();
  });

  it('надеть скрафченное из инвентаря', () => {
    const { s, uid } = fresh();
    const st = applyTarget(addItem(s, 'rustySword', 1, 1), { charUid: uid, slot: 0 }, 'rustySword')!;
    expect(st.characters[0].equipment[0]?.itemId).toBe('rustySword');
    expect(st.inventory.some((e) => e.itemId === 'rustySword')).toBe(false);
  });

  it('во встроенный рюкзак — снаряжение; зелье в ячейку не подходит', () => {
    const { s, uid } = fresh();
    const t = { charUid: uid, bagCell: 0 };
    expect(targetFit(s, t, getItem('restoreStrengthFlask'))).toBeNull();
    const st = addItem(s, 'rustyAxe', 1, 1);
    const out = applyTarget(st, t, 'rustyAxe')!;
    expect(out.characters[0].bag[0]).toMatchObject({ itemId: 'rustyAxe', count: 1 });
  });
});
