import { describe, expect, it } from 'vitest';
import { COMBAT, getBlueprint, getItem } from '../../data/catalog';
import type { CharacterBlueprint, EquipmentItem, Stat } from '../../data/types';
import { columnDepths, frontToBack, layeredStats } from '../layout';
import { botTarget, generateOpponent } from '../opponent';
import { DEFAULT_TARGET } from '../battle';

const lobster = getBlueprint('bp-lobster') as CharacterBlueprint;

describe('раскладка слоями спереди назад', () => {
  it('глубина 0 — передний куб каждого столбика (x, y) вдоль +Z', () => {
    const d = columnDepths(lobster.blocks);
    const front = new Map<string, number>();
    lobster.blocks.forEach((b) => {
      const k = `${Math.round(b.pos[0])},${Math.round(b.pos[1])}`;
      front.set(k, Math.max(front.get(k) ?? -Infinity, b.pos[2]));
    });
    lobster.blocks.forEach((b, i) => expect(d[i] === 0).toBe(b.pos[2] === front.get(`${Math.round(b.pos[0])},${Math.round(b.pos[1])}`)));
  });

  it('первая стата списка занимает передние кубы, последняя — самые глубокие', () => {
    const d = columnDepths(lobster.blocks);
    const fronts = d.filter((x) => x === 0).length;
    const counts: Partial<Record<Stat, number>> = { Armor: fronts, Intelligence: 4, Stamina: lobster.blocks.length - fronts - 4 };
    const plan = layeredStats(lobster.blocks, counts, ['Armor', 'Stamina', 'Intelligence']);
    expect(plan.size).toBe(lobster.blocks.length);
    lobster.blocks.forEach((_, i) => expect(plan.get(i) === 'Armor').toBe(d[i] === 0));
    const q = frontToBack(lobster.blocks);
    expect(q.slice(-4).every((i) => plan.get(i) === 'Intelligence')).toBe(true);
  });

  it('only — раскладываются только отобранные кубы (автосборка после ручной части)', () => {
    const plan = layeredStats(lobster.blocks, { Armor: 5 }, ['Armor'], (i) => i % 2 === 0);
    expect([...plan.keys()].every((i) => i % 2 === 0)).toBe(true);
    expect(plan.size).toBe(5);
  });
});

describe('боты под геометрию', () => {
  it('раскладка — один из вариантов конфига: передний слой — стата из начала варианта', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const o = generateOpponent(seed);
      const bp = getBlueprint(o.blueprintId) as CharacterBlueprint;
      const q = frontToBack(bp.blocks);
      const has = (s: Stat) => o.blockStats.includes(s);
      // хотя бы один вариант совпадает с раскладкой бота: статы идут по frontToBack в порядке варианта
      const fits = COMBAT.layout.bots.some((v) => {
        const seq = [...v, ...(['Armor', 'Strength', 'Dexterity', 'Intelligence', 'Stamina', 'Luck'] as Stat[]).filter((s) => !v.includes(s))].filter(has);
        const got = q.map((i) => o.blockStats[i]).filter((s, k, a) => k === 0 || a[k - 1] !== s);
        return got.join() === seq.join() || got.join().startsWith(seq.join());
      });
      expect(fits).toBe(true);
    }
  });

  it('приоритет бота: сначала стата оружия игрока, дальше — что мельче', () => {
    const blockStats = lobster.blocks.map((_, i) => (i < 14 ? 'Dexterity' : i < 20 ? 'Armor' : 'Stamina')) as Stat[];
    const hand = lobster.slots.findIndex((s) => s.type === 'Hand');
    const sword = getItem('rustySword') as EquipmentItem;
    const t = botTarget({ name: 'p', blueprintId: lobster.id, blockStats, equipment: lobster.slots.map((_, i) => (i === hand ? sword : null)) });
    expect(t[0]).toBe('Dexterity');
    expect(new Set(t).size).toBe(6);
    expect(generateOpponent(1).target).toEqual(DEFAULT_TARGET); // без игрока — порядок по умолчанию
  });
});
