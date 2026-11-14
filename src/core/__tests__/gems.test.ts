import { describe, expect, it } from 'vitest';
import { BLUEPRINTS, START, getItem, maxStackOf } from '../../data/catalog';
import { EFFECTS } from '../../data/catalog';
import type { EquipmentItem, Stat } from '../../data/types';
import { applyEffect, createBattle, step, type FighterInput } from '../battle';
import { itemOf } from '../character';
import { disassembleItem } from '../craft';
import { enemyLoot } from '../arena';
import { generateOpponent } from '../opponent';
import { addItem, createInitialState, itemCount, type PlayerState } from '../state';
import { gemInfo, insertGem, removeGem } from '../upgrade';

function withSword(cells: number): { s: PlayerState; uid: string } {
  let s = createInitialState({ ...START, unlockAllBlueprints: true }, BLUEPRINTS.map((b) => b.id), maxStackOf);
  s = addItem(s, 'rustySword', 1, 1);
  for (const id of ['fireGem', 'iceGem', 'poisonGem']) s = addItem(s, id, 2, maxStackOf(id));
  const uid = s.inventory.find((e) => e.itemId === 'rustySword')!.uid;
  s = { ...s, inventory: s.inventory.map((e) => (e.uid === uid ? { ...e, cells } : e)) };
  return { s, uid };
}

describe('камни в ячейках оружия', () => {
  it('вставка: камень уходит из инвентаря, эффект добавляется к удару', () => {
    const { s, uid } = withSword(2);
    const next = insertGem(s, { kind: 'inv', uid }, 'fireGem')!;
    expect(itemCount(next, 'fireGem')).toBe(1);
    const entry = next.inventory.find((e) => e.uid === uid)!;
    expect(entry.gems).toEqual(['fireGem']);
    expect((itemOf(entry) as EquipmentItem).ability.effects).toEqual(['burn']);
    expect((getItem('rustySword') as EquipmentItem).ability.effects).toEqual([]);
  });
  it('нет свободной ячейки или такой камень уже стоит — нельзя', () => {
    const { s, uid } = withSword(1);
    expect(insertGem(withSword(0).s, { kind: 'inv', uid: withSword(0).uid }, 'fireGem')).toBeNull();
    const one = insertGem(s, { kind: 'inv', uid }, 'fireGem')!;
    expect(insertGem(one, { kind: 'inv', uid }, 'iceGem')).toBeNull();
    const two = insertGem(withSword(2).s, { kind: 'inv', uid: withSword(2).uid }, 'fireGem');
    expect(two).not.toBeNull();
    const { s: s2, uid: uid2 } = withSword(2);
    const first = insertGem(s2, { kind: 'inv', uid: uid2 }, 'fireGem')!;
    expect(insertGem(first, { kind: 'inv', uid: uid2 }, 'fireGem')).toBeNull();
    expect(gemInfo(first, { kind: 'inv', uid: uid2 })!.available.map((g) => g.itemId)).not.toContain('fireGem');
  });
  it('снятие и разборка возвращают камень в инвентарь', () => {
    const { s, uid } = withSword(2);
    const set = insertGem(insertGem(s, { kind: 'inv', uid }, 'fireGem')!, { kind: 'inv', uid }, 'poisonGem')!;
    const removed = removeGem(set, { kind: 'inv', uid }, 0)!;
    expect(removed.inventory.find((e) => e.uid === uid)!.gems).toEqual(['poisonGem']);
    expect(itemCount(removed, 'fireGem')).toBe(2);
    const gone = disassembleItem(set, uid, (id) => BLUEPRINTS.find((b) => 'itemId' in b && b.itemId === id))!;
    expect(itemCount(gone, 'fireGem')).toBe(2);
    expect(itemCount(gone, 'poisonGem')).toBe(2);
  });
});

describe('эффекты камней: стата куба', () => {
  const stats: Stat[] = [...Array(13).fill('Strength'), ...Array(13).fill('Dexterity'), ...Array(12).fill('Stamina')];
  const me: FighterInput = { name: 'Я', blueprintId: 'bp-lobster', blockStats: stats, equipment: [null, null, null, null, null] };
  it('яд: стата отравленного куба ×statMultiplier, после яда возвращается', () => {
    const b = createBattle(1, me, generateOpponent(1));
    const p = b.player;
    const str = p.stats.Strength;
    const k = p.blocks.findIndex((x) => x.stat === 'Strength');
    applyEffect(b, p, 'poison', k);
    expect(p.stats.Strength).toBeCloseTo(str - (1 - EFFECTS.poison.statMultiplier!));
    p.effects.find((e) => e.id === 'poison')!.remaining = 1;
    step(b);
    expect(p.effects.some((e) => e.id === 'poison')).toBe(false);
    expect(p.stats.Strength).toBeCloseTo(str);
  });
  it('лёд: стата замёрзшего куба не учитывается; разбитый замёрзший куб теряет очко один раз', () => {
    const b = createBattle(1, me, generateOpponent(1));
    const p = b.player;
    const dex = p.stats.Dexterity;
    const k = p.blocks.findIndex((x) => x.stat === 'Dexterity');
    applyEffect(b, p, 'freeze', k);
    expect(p.stats.Dexterity).toBeCloseTo(dex - 1);
    p.blocks[k].hp = 1;
    step(b);
    expect(p.blocks[k].alive).toBe(false);
    expect(p.stats.Dexterity).toBeCloseTo(dex - 1);
  });
  it('удар разбил куб-цель — эффект переходит на соседний живой куб, а не пропадает', () => {
    const sword = { ...(getItem('rustySword') as EquipmentItem) };
    sword.ability = { ...sword.ability, effects: ['burn'] };
    const b = createBattle(1, { ...me, equipment: [sword, null, null, null, null] }, generateOpponent(1));
    b.player.disabled.push('Luck');
    b.enemy.disabled.push('Dexterity');
    step(b);
    expect(b.log.some((e) => e.t === 'break' && e.side === 'enemy')).toBe(true);
    const burn = b.log.find((e) => e.t === 'effect' && e.side === 'enemy' && e.effect === 'burn');
    expect(burn).toBeDefined();
    expect(burn && burn.t === 'effect' && burn.block !== null && b.enemy.blocks[burn.block].alive).toBe(true);
  });
});

describe('камни в луте', () => {
  it('оружие побеждённого достаётся вместе с камнями', () => {
    const sword = { ...(getItem('rustySword') as EquipmentItem), itemLevel: 2, gemSlots: 1, gems: ['fireGem'] };
    const loot = enemyLoot([sword, null], [], 0);
    expect(loot[0]).toMatchObject({ itemId: 'rustySword', level: 2, cells: 1, gems: ['fireGem'] });
    expect((itemOf(loot[0]) as EquipmentItem).ability.effects).toEqual(['burn']);
  });
});

describe('название оружия по уровню', () => {
  it('ур. 1 — «Меч», ур. 2 — «Улучшенный меч», ур. 3 — «Сияющий меч»; род — по слову', () => {
    expect(itemOf({ itemId: 'rustySword' }).name).toBe('Меч');
    expect(itemOf({ itemId: 'rustySword', level: 2 }).name).toBe('Улучшенный меч');
    expect(itemOf({ itemId: 'rustySword', level: 3 }).name).toBe('Сияющий меч');
    expect(itemOf({ itemId: 'rustyClub', level: 2 }).name).toBe('Улучшенная булава');
    expect(itemOf({ itemId: 'rustySpear', level: 3 }).name).toBe('Сияющее копье');
  });
});
