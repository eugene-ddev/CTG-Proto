import { describe, expect, it } from 'vitest';
import { BLUEPRINTS, START, getBlueprint, maxStackOf } from '../../data/catalog';
import type { CharacterBlueprint, Stat } from '../../data/types';
import { equipFromBag, stowToBagCell } from '../arena';
import { bagSlots, equip, moveEquipped, putInBag } from '../character';
import { completeCraft } from '../craft';
import { addItem, createInitialState, type PlayerState } from '../state';

const lobster = getBlueprint('bp-lobster') as CharacterBlueprint;
const stats: Stat[] = [...Array(13).fill('Strength'), ...Array(13).fill('Dexterity'), ...Array(12).fill('Stamina')];
const inv = (s: PlayerState, itemId: string) => s.inventory.find((e) => e.itemId === itemId)!.uid;

function setup(): { s: PlayerState; cu: string } {
  let s = createInitialState({ ...START, unlockAllBlueprints: true }, BLUEPRINTS.map((b) => b.id), maxStackOf);
  s = addItem(s, 'cube', 500, 100);
  s = completeCraft(s, lobster, { manual: true, maxStack: maxStackOf, blockStats: stats })!.state;
  for (const id of ['rustySword', 'rustyAxe', 'magicShieldArtifact', 'rucksack']) s = addItem(s, id, 1, 1);
  const cu = s.characters[0].uid;
  s = equip(s, cu, 'rucksack', inv(s, 'rucksack'))!;
  s = equip(s, cu, 0, inv(s, 'rustySword'))!;
  s = putInBag(s, cu, 0, inv(s, 'rustyAxe'))!;
  return { s, cu };
}
const hand = (s: PlayerState, slot: number) => s.characters[0].equipment[slot]?.itemId ?? null;
const cell = (s: PlayerState, k: number) => bagSlots(s.characters[0])[k]?.itemId ?? null;

describe('перетаскивание снаряжения', () => {
  it('из руки в руку; в слот артефакта оружие не встаёт', () => {
    const { s, cu } = setup();
    const moved = moveEquipped(s, cu, 0, 1)!;
    expect([hand(moved, 0), hand(moved, 1)]).toEqual([null, 'rustySword']);
    expect(moveEquipped(s, cu, 0, 2)).toBeNull();
  });
  it('из рюкзака в пустую руку и в занятую (обмен)', () => {
    const { s, cu } = setup();
    const toEmpty = equipFromBag(s, cu, 0, 1)!;
    expect([hand(toEmpty, 0), hand(toEmpty, 1), cell(toEmpty, 0)]).toEqual(['rustySword', 'rustyAxe', null]);
    const swap = equipFromBag(s, cu, 0, 0)!;
    expect([hand(swap, 0), cell(swap, 0)]).toEqual(['rustyAxe', 'rustySword']);
  });
  it('из руки в ячейку рюкзака: в пустую — убрать, в занятую оружием — обмен', () => {
    const { s, cu } = setup();
    const stowed = stowToBagCell(s, cu, 0, 1)!;
    expect([hand(stowed, 0), cell(stowed, 0), cell(stowed, 1)]).toEqual([null, 'rustyAxe', 'rustySword']);
    const swap = stowToBagCell(s, cu, 0, 0)!;
    expect([hand(swap, 0), cell(swap, 0)]).toEqual(['rustyAxe', 'rustySword']);
  });
});

describe('рюкзаки на 12 и 18 ячеек', () => {
  it('большой рюкзак даёт 12 ячеек, походный — 18; смена на меньший возвращает лишнее в инвентарь', () => {
    let { s, cu } = setup();
    for (const id of ['rucksackLarge', 'rucksackHuge']) s = addItem(s, id, 1, 1);
    s = equip(s, cu, 'rucksack', inv(s, 'rucksackHuge'))!;
    expect(bagSlots(s.characters[0])).toHaveLength(18);
    expect(cell(s, 0)).toBe('rustyAxe');
    s = addItem(s, 'rustySword', 1, 1);
    s = putInBag(s, cu, 15, inv(s, 'rustySword'))!;
    s = equip(s, cu, 'rucksack', inv(s, 'rucksackLarge'))!;
    expect(bagSlots(s.characters[0])).toHaveLength(12);
    expect(cell(s, 0)).toBe('rustyAxe');
    expect(s.inventory.some((e) => e.itemId === 'rustySword')).toBe(true);
    expect(s.inventory.some((e) => e.itemId === 'rucksackHuge')).toBe(true);
  });
});
