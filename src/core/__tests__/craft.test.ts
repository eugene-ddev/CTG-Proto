import { describe, expect, it } from 'vitest';
import { BLUEPRINTS, START, getBlueprint, getItem } from '../../data/catalog';
import { canAutoCraft, completeCraft, craftCost, craftFailure, disassembleItem, disassembleMany, disassemblyRefund, disassemblyRefundOf, unlockBlueprint } from '../craft';
import { addItem } from '../state';
import { createInitialState } from '../state';
import type { Stat } from '../../data/types';
import { CUBE_ID, addCubes as addCubesH, cubeCount, type PlayerState as PS } from '../state';
/** Состояние с ровно n кубов в инвентаре. */
const withCubes = (st: PS, n: number): PS => addCubesH({ ...st, inventory: st.inventory.filter((e) => e.itemId !== CUBE_ID) }, n);
const allStr = (n: number): Stat[] => Array.from({ length: n }, () => 'Strength');

const maxStack = (id: string) => {
  const i = getItem(id);
  return i.kind === 'potion' ? i.maxStack : 1;
};
const fresh = () => createInitialState({ ...START, unlockAllBlueprints: true }, BLUEPRINTS.map((b) => b.id), maxStack);
const blueprintOf = (itemId: string) => {
  const id = getItem(itemId).blueprintId;
  return id ? getBlueprint(id) : undefined;
};

describe('крафт', () => {
  it('меч вручную: −8 кубов, меч в инвентаре, открыта автосборка', () => {
    const r = completeCraft(fresh(), getBlueprint('bp-sword'), { manual: true, maxStack })!;
    expect(cubeCount(r.state)).toBe(START.cubes - 8);
    expect(r.state.inventory.some((e) => e.itemId === 'rustySword')).toBe(true);
    expect(canAutoCraft(r.state, 'bp-sword')).toBe(true);
  });
  it('автосборка недоступна до первой ручной', () => {
    expect(completeCraft(fresh(), getBlueprint('bp-sword'), { manual: false, maxStack })).toBeNull();
  });
  it('лобстер: −38 кубов, сразу персонаж — имя по умолчанию, без снаряжения', () => {
    expect(completeCraft(fresh(), getBlueprint('bp-lobster'), { manual: true, maxStack })).toBeNull(); // без стат нельзя
    const r = completeCraft(fresh(), getBlueprint('bp-lobster'), { manual: true, maxStack, blockStats: allStr(38) })!;
    expect(cubeCount(r.state)).toBe(START.cubes - 38);
    const c = r.state.characters[0];
    expect(c).toEqual({ uid: expect.any(String), name: 'Лобстер 1', blueprintId: 'bp-lobster', blockStats: allStr(38), brokenBlocks: [], equipment: [null, null, null, null, null], rucksack: null, bag: [] });
    expect(r.result).toEqual({ kind: 'character', blueprintId: 'bp-lobster', charUid: c.uid });
    const r2 = completeCraft(r.state, getBlueprint('bp-lobster'), { manual: true, maxStack, blockStats: allStr(38) })!;
    expect(r2.state.characters.map((x) => x.name)).toEqual(['Лобстер 1', 'Лобстер 2']);
  });
  it('зелье и камень требуют вариант и дают предмет этого варианта', () => {
    const flask = getBlueprint('bp-potion-flask');
    expect(completeCraft(fresh(), flask, { manual: true, maxStack })).toBeNull();
    const r = completeCraft(fresh(), flask, { manual: true, maxStack, variantKey: 'Luck' })!;
    expect(r.result).toEqual({ kind: 'item', itemId: 'restoreLuckFlask' });
    const g = completeCraft(fresh(), getBlueprint('bp-gem'), { manual: true, maxStack, variantKey: 'freeze' })!;
    expect(g.result).toEqual({ kind: 'item', itemId: 'iceGem' });
  });
  it('не хватает кубов — ничего не меняется', () => {
    const poor = withCubes(fresh(), 7);
    expect(completeCraft(poor, getBlueprint('bp-sword'), { manual: true, maxStack })).toBeNull();
  });
});

describe('причина отказа', () => {
  it('совпадает с completeCraft', () => {
    const sword = getBlueprint('bp-sword');
    expect(craftFailure(fresh(), sword, { manual: true, maxStack })).toBeNull();
    expect(craftFailure(withCubes(fresh(), 3), sword, { manual: true, maxStack })).toBe('Не хватает 5 куб.');
    expect(completeCraft(withCubes(fresh(), 3), sword, { manual: true, maxStack })).toBeNull();
    expect(craftFailure(fresh(), sword, { manual: false, maxStack })).toMatch(/Автосборка/);
    const holes = allStr(38);
    delete (holes as Array<Stat | undefined>)[5];
    expect(craftFailure(fresh(), getBlueprint('bp-lobster'), { manual: true, maxStack, blockStats: holes })).toMatch(/стата/);
    expect(completeCraft(fresh(), getBlueprint('bp-lobster'), { manual: true, maxStack, blockStats: holes })).toBeNull();
  });
});

describe('разборка', () => {
  it('половина кубов вниз: меч 8 → 4, лобстер 38 → 19, нож 19 → 9', () => {
    expect(disassemblyRefund(8)).toBe(4);
    expect(disassemblyRefund(38)).toBe(19);
    expect(disassemblyRefund(19)).toBe(9);
  });
  it('предмет из инвентаря: −1 штука, +половина кубов', () => {
    const s = completeCraft(fresh(), getBlueprint('bp-sword'), { manual: true, maxStack })!.state;
    const sword = s.inventory.find((e) => e.itemId === 'rustySword')!;
    const after = disassembleItem(s, sword.uid, blueprintOf)!;
    expect(cubeCount(after)).toBe(cubeCount(s) + 4);
    expect(after.inventory.some((e) => e.uid === sword.uid)).toBe(false);
  });
  it('из стопки зелий разбирается одна штука', () => {
    const s = fresh();
    const stack = s.inventory.find((e) => e.itemId.startsWith('restore'))!;
    const after = disassembleItem(s, stack.uid, blueprintOf)!;
    expect(after.inventory.find((e) => e.uid === stack.uid)?.count).toBe(stack.count - 1);
    expect(cubeCount(after)).toBe(cubeCount(s) + 1); // малый флакон: 3 → 1
  });
});

describe('разборка нескольких', () => {
  const bpOf = (id: string) => {
    const b = getItem(id).blueprintId;
    return b ? getBlueprint(b) : undefined;
  };
  it('разбирает выбранные записи целиком, стопки — все штуки, кубы — сумма половин', () => {
    let s = addItem(addItem(fresh(), 'rustySword', 1, 1), 'rustyAxe', 1, 1);
    const sword = s.inventory.find((e) => e.itemId === 'rustySword')!.uid;
    const axe = s.inventory.find((e) => e.itemId === 'rustyAxe')!.uid;
    const vials = s.inventory.find((e) => e.itemId === 'restoreStrengthVial')!; // 5 шт. на старте
    const expected =
      disassemblyRefund(craftCost(bpOf('rustySword')!)) + disassemblyRefund(craftCost(bpOf('rustyAxe')!)) + disassemblyRefund(craftCost(bpOf(vials.itemId)!)) * vials.count;
    expect(disassemblyRefundOf(s, [sword, axe, vials.uid], bpOf)).toBe(expected);
    const out = disassembleMany(s, [sword, axe, vials.uid], bpOf)!;
    expect(cubeCount(out)).toBe(cubeCount(s) + expected);
    expect(out.inventory.some((e) => [sword, axe, vials.uid].includes(e.uid))).toBe(false);
    expect(out.inventory.filter((e) => e.itemId !== CUBE_ID).length).toBe(s.inventory.filter((e) => e.itemId !== CUBE_ID).length - 3);
    expect(disassembleMany(s, ['nope'], bpOf)).toBeNull();
    s = out;
  });
});

describe('закрытые чертежи', () => {
  const start = () => createInitialState(START, BLUEPRINTS.map((b) => b.id), maxStack);
  it('с начала открыты варан, меч, малый флакон и подсумок', () => {
    expect(start().unlockedBlueprints).toEqual(['bp-waran', 'bp-sword', 'bp-potion-vial', 'bp-pouch']);
    expect(completeCraft(start(), getBlueprint('bp-axe'), { manual: true, maxStack })).toBeNull();
  });
  it('чертёж открывается чистым пергаментом', () => {
    expect(unlockBlueprint(start(), 'bp-axe')).toBeNull();
    const opened = unlockBlueprint(addItem(start(), 'parchment', 1, 20), 'bp-axe')!;
    expect(opened.unlockedBlueprints).toContain('bp-axe');
    expect(opened.inventory.some((e) => e.itemId === 'parchment')).toBe(false);
    expect(completeCraft(opened, getBlueprint('bp-axe'), { manual: true, maxStack })).not.toBeNull();
  });
});
