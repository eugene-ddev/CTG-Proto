import { describe, expect, it } from 'vitest';
import { COMBAT, START, BLUEPRINTS, getBlueprint } from '../../data/catalog';
import { itemSummary } from '../../data/labels';
import type { CharacterBlueprint, Stat } from '../../data/types';
import {
  armorAbsorb, characterRefund, characterStats, critChance, damageCondition, damageScaling,
  disassembleCharacter, equip, putInBag, takeFromBag, bagSlots, procChance, renameCharacter, requirementGap, slotAccepts, slotDamage, unequip,
} from '../character';
import { completeCraft } from '../craft';
import { addItem, createInitialState, type PlayerState } from '../state';
import { getItem } from '../../data/catalog';
import { cubeCount } from '../state';

const maxStack = (id: string) => { const it = getItem(id); return it.kind === 'potion' ? it.maxStack : 1; };
const lobster = getBlueprint('bp-lobster') as CharacterBlueprint;
const stats38 = (): Stat[] => [...Array(13).fill('Strength'), ...Array(13).fill('Dexterity'), ...Array(12).fill('Stamina')];

function withLobster(): PlayerState {
  let s = createInitialState({ ...START, unlockAllBlueprints: true }, BLUEPRINTS.map((b) => b.id), maxStack);
  s = completeCraft(s, lobster, { manual: true, maxStack, blockStats: stats38() })!.state;
  for (const id of ['rustySword', 'rustyAxe', 'magicShieldArtifact']) s = addItem(s, id, 1, 1);
  return s;
}
const inv = (s: PlayerState, itemId: string) => s.inventory.find((e) => e.itemId === itemId)!.uid;

describe('формулы из доки', () => {
  it('крит/уворот: таблица из таба «Статы»', () => {
    expect(procChance(0)).toBe(0);
    expect(critChance(10, 20)).toBeCloseTo(0.125, 3);
    expect(critChance(50, 100)).toBeCloseTo(0.375, 3);
    expect(critChance(100, 100)).toBeCloseTo(0.469, 3);
  });
  it('крит без живых кубов Силы и уворот без живых кубов Ловкости — 0', () => {
    const noStrDex = characterStats(lobster, Array(38).fill('Luck'));
    expect(noStrDex.crit).toBe(0);
    expect(noStrDex.dodge).toBe(0);
    const strBroken = characterStats(lobster, stats38(), Array.from({ length: 13 }, (_, index) => index));
    expect(strBroken.crit).toBe(0);
    expect(strBroken.dodge).toBeGreaterThan(0);
  });
  it('урон: эталон Base 10, стата 50, ур. 10 → 25; минус 10 очков → ×0.75', () => {
    expect(10 * damageScaling(50, 10)).toBeCloseTo(25);
    expect(damageCondition(50, 40)).toBeCloseTo(0.75);
    expect(damageCondition(50, 0)).toBe(0.3);
  });
  it('броня: пол 85%', () => {
    expect(armorAbsorb(50)).toBeCloseTo(0.5);
    expect(armorAbsorb(10000)).toBe(0.85);
    expect(armorAbsorb(0)).toBe(0);
  });
  it('статы как в Sandbox Arena: базовая стата чертежа + 1 за куб', () => {
    const st = characterStats(lobster, stats38());
    expect(st.base.Strength).toBe(5 + 13);
    expect(st.base.Dexterity).toBe(5 + 13);
    expect(st.maxStamina).toBe(5 + 12);
    expect(st.maxMana).toBe(0);
    expect(st.base.Luck).toBe(0);
  });
  it('разбитый куб снимает 1 очко своей статы (как Stats.AdjustStats в клиенте)', () => {
    const st = characterStats(lobster, stats38(), [0, 1]);
    expect(st.current.Strength).toBe(5 + 13 - 2);
  });
  it('разбитые блоки снижают текущую стату и урон', () => {
    const full = characterStats(lobster, stats38());
    const hurt = characterStats(lobster, stats38(), [0, 1, 2]); // три блока силы
    expect(hurt.current.Strength).toBeLessThan(full.current.Strength);
    const axe = getItem('rustyAxe');
    if (axe.kind !== 'weapon') throw new Error();
    expect(slotDamage(axe, hurt).damage).toBeLessThan(slotDamage(axe, full).damage);
  });
  it('урон и число ударов на экранах учитывают свойство уровня: кинжал ур. 2 бьёт трижды и слабее за удар', () => {
    const st = characterStats(lobster, stats38());
    const base = getItem('rustyDagger');
    if (base.kind !== 'weapon') throw new Error();
    const perk = COMBAT.weaponLevels.perks.rustyDagger[0];
    const l1 = slotDamage(base, st);
    const l2 = slotDamage({ ...base, itemLevel: 2 }, st);
    expect(l1.hits).toBe(base.ability.hits ?? 1);
    expect(l2.hits).toBe(perk.hits);
    expect(l2.damage).toBeCloseTo(l1.damage * perk.damageMultiplier!, 6);
    expect(l2.perTurn).toBeCloseTo((l2.damage * l2.hits) / Math.max(1, base.ability.cooldown), 6);
    expect(itemSummary({ ...base, itemLevel: 2 })).toContain(`×${perk.hits}`);
  });
});

describe('персонаж', () => {
  it('слоты принимают только свой тип; рюкзак — не предмет снаряжения', () => {
    expect(slotAccepts(lobster, 0, getItem('rustySword'))).toBe(true);
    expect(slotAccepts(lobster, 2, getItem('rustySword'))).toBe(false);
    expect(slotAccepts(lobster, 2, getItem('magicShieldArtifact'))).toBe(true);
    expect(slotAccepts(lobster, 'rucksack', getItem('rucksack'))).toBe(false);
    expect(slotAccepts(lobster, 'rucksack', getItem('pouch'))).toBe(false);
  });
  it('после крафта персонаж уже в списке: пустые слоты, имя меняется', () => {
    let s = withLobster();
    const c = s.characters[0];
    expect(c.equipment).toEqual([null, null, null, null, null]);
    expect(renameCharacter(s, c.uid, '   ')).toBeNull();
    expect(renameCharacter(s, c.uid, 'x'.repeat(17))).toBeNull();
    s = renameCharacter(s, c.uid, '  Клешня  ')!;
    expect(s.characters[0].name).toBe('Клешня');
  });
  it('новый персонаж: встроенный рюкзак на 3 ячейки и все 6 малых зелий по 5 зарядов', () => {
    const s = withLobster();
    const c = s.characters[0];
    expect(c.rucksackLevel).toBe(1);
    expect(bagSlots(c)).toHaveLength(3);
    expect(Object.keys(c.potions)).toHaveLength(6);
    for (const p of Object.values(c.potions)) expect(p).toEqual({ level: 1, charges: 5 });
    const withBag = addItem(s, 'rucksack', 1, 1);
    expect(equip(withBag, c.uid, 'rucksack', inv(withBag, 'rucksack'))).toBeNull();
  });
  it('требование статы: считается с базой 5', () => {
    const noDex: Stat[] = [...Array(26).fill('Strength'), ...Array(12).fill('Stamina')];
    const st = characterStats(lobster, noDex);
    expect(requirementGap(getItem('rustySword'), st)).toBe(0); // база ловкости 5 — меч берётся и без кубов
    const highReq = { ...getItem('rustySword'), minStatRequired: 8 } as ReturnType<typeof getItem>;
    expect(requirementGap(highReq, st)).toBe(3);
    expect(requirementGap(getItem('rustyAxe'), st)).toBe(0);
  });
  it('надеть / снять / заменить — предметы не теряются', () => {
    let s = withLobster();
    const cu = s.characters[0].uid;
    const count = () => s.inventory.length + s.characters[0].equipment.filter(Boolean).length;
    const before = count();
    s = equip(s, cu, 0, inv(s, 'rustySword'))!;
    expect(s.characters[0].equipment[0]?.itemId).toBe('rustySword');
    s = equip(s, cu, 0, inv(s, 'rustyAxe'))!; // замена: меч вернулся
    expect(s.characters[0].equipment[0]?.itemId).toBe('rustyAxe');
    expect(s.inventory.some((e) => e.itemId === 'rustySword')).toBe(true);
    expect(equip(s, cu, 2, inv(s, 'rustySword'))).toBeNull(); // меч в слот артефакта
    s = unequip(s, cu, 0)!;
    expect(s.characters[0].equipment[0]).toBeNull();
    expect(count()).toBe(before);
  });
  it('разборка: половина живых кубов, снаряжение в инвентарь', () => {
    let s = withLobster();
    s = equip(s, s.characters[0].uid, 0, inv(s, 'rustySword'))!;
    s = { ...s, characters: s.characters.map((c) => ({ ...c, brokenBlocks: [0, 1, 2, 3] })) };
    expect(characterRefund(s.characters[0])).toBe(17); // (38 − 4) / 2
    const cubes = cubeCount(s);
    s = disassembleCharacter(s, s.characters[0].uid)!;
    expect(cubeCount(s)).toBe(cubes + 17);
    expect(s.characters).toHaveLength(0);
    expect(s.inventory.some((e) => e.itemId === 'rustySword')).toBe(true);
  });
  it('во встроенный рюкзак кладутся ресурсы и снаряжение, но не старые зелья и сумки', () => {
    let s = withLobster();
    const cu = s.characters[0].uid;
    expect(bagSlots(s.characters[0])).toHaveLength(3);
    s = addItem(s, 'whetstone', 5, 100);
    s = putInBag(s, cu, 0, inv(s, 'whetstone'))!;
    expect(bagSlots(s.characters[0])[0]).toMatchObject({ itemId: 'whetstone', count: 5 });
    expect(s.inventory.some((e) => e.itemId === 'whetstone')).toBe(false);
    s = takeFromBag(s, cu, 0)!;
    expect(s.inventory.find((e) => e.itemId === 'whetstone')?.count).toBe(5);
    s = addItem(s, 'restoreArmorVial', 5, 10);
    expect(putInBag(s, cu, 1, inv(s, 'restoreArmorVial'))).toBeNull();
    s = addItem(s, 'pouch', 1, 1);
    expect(putInBag(s, cu, 1, inv(s, 'pouch'))).toBeNull();
    expect(unequip(s, cu, 'rucksack')).toBeNull();
  });
});
