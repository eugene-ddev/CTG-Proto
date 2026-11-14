import { describe, expect, it } from 'vitest';
import { BLUEPRINTS, COMBAT, START, getBlueprint, getItem } from '../../data/catalog';
import type { CharacterBlueprint, Stat } from '../../data/types';
import { completeCraft } from '../craft';
import { applyCharacterEdit, cellCounts, editChanges, editCost, editDelta, rebalanceCells, type Cells } from '../edit';
import { CUBE_ID, addCubes, createInitialState, cubeCount, type PlayerState } from '../state';

const maxStack = (id: string) => { const it = getItem(id); return it.kind === 'potion' ? it.maxStack : 1; };
const lobster = getBlueprint('bp-lobster') as CharacterBlueprint;
const stats38 = (): Stat[] => [...Array(13).fill('Strength'), ...Array(13).fill('Dexterity'), ...Array(12).fill('Stamina')];
const withCubes = (st: PlayerState, n: number) => addCubes({ ...st, inventory: st.inventory.filter((e) => e.itemId !== CUBE_ID) }, n);

function withLobster(): PlayerState {
  const s = createInitialState({ ...START, unlockAllBlueprints: true }, BLUEPRINTS.map((b) => b.id), maxStack);
  return completeCraft(s, lobster, { manual: true, maxStack, blockStats: stats38() })!.state;
}

describe('изменение персонажа', () => {
  const orig = stats38();
  const order = COMBAT.layout.autoBuild;

  it('цена — число изменённых кубов; убрал и вернул тем же цветом — бесплатно', () => {
    const cells: Cells = [...orig];
    cells[0] = 'Luck';
    cells[1] = null;
    cells[2] = 'Strength'; // был сила
    expect(editChanges(orig, cells)).toBe(1);
    expect(editCost(orig, cells)).toBe(1);
    expect(editDelta(orig, cells)).toEqual([['Strength', -2], ['Luck', 1]]);
  });

  it('ползунки: −3 силы освобождают 3 места, +3 брони ставятся в них; обратно — исходная модель', () => {
    const locked = new Set<number>();
    const down = { ...cellCounts(orig), Strength: 10 };
    const a = rebalanceCells(lobster.blocks, orig, orig, locked, down, order);
    expect(a.filter((x) => x === null)).toHaveLength(3);
    expect(cellCounts(a).Strength).toBe(10);
    const up = { ...down, Armor: 3 };
    const b = rebalanceCells(lobster.blocks, orig, a, locked, up, order);
    expect(b.every((x) => x)).toBe(true);
    expect(cellCounts(b).Armor).toBe(3);
    expect(editChanges(orig, b)).toBe(3);
    // вернуть: −3 брони, +3 силы — в исходные места силы
    const c = rebalanceCells(lobster.blocks, orig, b, locked, down, order);
    const d = rebalanceCells(lobster.blocks, orig, c, locked, cellCounts(orig), order);
    expect(d).toEqual(orig);
  });

  it('разбитые кубы не трогаются ползунками', () => {
    const locked = new Set([0, 1]); // сила
    const t = { ...cellCounts(orig), Strength: 2, Luck: 11 };
    const r = rebalanceCells(lobster.blocks, orig, orig, locked, t, order);
    expect(r[0]).toBe('Strength');
    expect(r[1]).toBe('Strength');
    expect(cellCounts(r).Luck).toBe(11);
  });

  it('подтверждение: кубы списываются, пустые места и разбитые кубы — нельзя', () => {
    let s = withLobster();
    const uid = s.characters[0].uid;
    const cubes = cubeCount(s);
    const cells: Cells = [...orig];
    expect(applyCharacterEdit(s, uid, cells)).toBeNull(); // без изменений
    cells[5] = null;
    expect(applyCharacterEdit(s, uid, cells)).toBeNull(); // пустое место
    cells[5] = 'Armor';
    cells[6] = 'Armor';
    expect(applyCharacterEdit(withCubes(s, 1), uid, cells)).toBeNull(); // нужно 2
    const broken = { ...s, characters: s.characters.map((c) => ({ ...c, brokenBlocks: [5] })) };
    expect(applyCharacterEdit(broken, uid, cells)).toBeNull();
    s = applyCharacterEdit(s, uid, cells)!;
    expect(cubeCount(s)).toBe(cubes - 2);
    expect(s.characters[0].blockStats[5]).toBe('Armor');
    expect(s.characters[0].blockStats[6]).toBe('Armor');
  });
});
