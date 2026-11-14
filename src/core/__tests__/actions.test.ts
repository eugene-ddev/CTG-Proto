import { describe, expect, it } from 'vitest';
import { BLUEPRINTS, START, maxStackOf } from '../../data/catalog';
import type { CharacterBlueprint, Stat } from '../../data/types';
import { ACTIONS, applyAction, isDebugAction, stateHash } from '../actions';
import { createInitialState, cubeCount } from '../state';

const fresh = () => createInitialState(START, BLUEPRINTS.map((b) => b.id), maxStackOf);
const ctx = { now: 1_700_000_000_000, seed: 12345 };
const waran = BLUEPRINTS.find((b) => b.id === 'bp-waran') as CharacterBlueprint;
const stats = waran.blocks.map((_, i): Stat => (i % 2 ? 'Strength' : 'Stamina'));
const craftWaran = { blueprintId: waran.id, manual: true, blockStats: stats };

describe('действия', () => {
  it('неизвестное действие и плохие аргументы отклоняются, состояние не меняется', () => {
    const s = fresh();
    expect(applyAction(s, 'nope', [], ctx)).toBeNull();
    expect(applyAction(s, 'equip', [], ctx)).toBeNull();
    expect(applyAction(s, 'craft', [{ blueprintId: 'нет такого', manual: true }], ctx)).toBeNull();
    expect(applyAction(s, 'constructor', [], ctx)).toBeNull();
  });

  it('сборка персонажа списывает кубы; то же действие на копии состояния даёт тот же отпечаток', () => {
    const a = applyAction(fresh(), 'craft', [craftWaran], ctx)!;
    const b = applyAction(JSON.parse(JSON.stringify(fresh())), 'craft', [craftWaran], ctx)!;
    expect(a.characters).toHaveLength(1);
    expect(cubeCount(a)).toBe(cubeCount(fresh()) - waran.blocks.length);
    expect(stateHash(a)).toBe(stateHash(b));
  });

  it('серия: противник зависит только от seed действия, время — от ctx.now', () => {
    const s = applyAction(fresh(), 'craft', [craftWaran], ctx)!;
    const uid = s.characters[0].uid;
    const r1 = applyAction(s, 'startRun', [uid], ctx)!;
    const r2 = applyAction(s, 'startRun', [uid], { ...ctx, now: ctx.now + 5000 })!;
    const r3 = applyAction(s, 'startRun', [uid], { ...ctx, seed: 999 })!;
    expect(stateHash(r1)).toBe(stateHash(r2));
    expect(r1.arenaRun?.opp).toBeTruthy();
    expect(JSON.stringify(r3.arenaRun)).not.toBe(JSON.stringify(r1.arenaRun));
    // поражение без повторов ставит таймер починки по часам действия
    const lost = applyAction(r1, 'surrenderRun', [], ctx)!;
    expect(lost.arenaRun).toBeNull();
    const hurt = { ...r1, characters: r1.characters.map((c) => ({ ...c, brokenBlocks: [0, 1] })) };
    expect(applyAction(hurt, 'endRun', [], ctx)!.characters[0].lobbySince).toBe(ctx.now);
  });

  it('отладочные действия помечены', () => {
    const debug = Object.keys(ACTIONS).filter(isDebugAction);
    expect(debug.sort()).toEqual(['debugAddCubes', 'debugGiveAllItems', 'debugHeal']);
  });
});
