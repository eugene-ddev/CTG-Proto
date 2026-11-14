import { describe, expect, it } from 'vitest';
import { BLUEPRINTS, getBlueprint } from '../../data/catalog';
import { adjacency, buildOrder, faceNeighbours, frontier, seedBlock } from '../build';
import { countsAfterPaint, countsAfterRepaint, defaultCounts, nextStat, totalCount, usedCounts } from '../stats';
import type { Stat } from '../../data/types';

describe('порядок сборки', () => {
  it('начинается с одного куба — самого нижнего', () => {
    const bp = getBlueprint('bp-sword');
    const f = frontier(bp.blocks, new Set());
    expect(f).toHaveLength(1);
    expect(bp.blocks[f[0]].pos[1]).toBe(Math.min(...bp.blocks.map((b) => b.pos[1])));
    expect(f[0]).toBe(seedBlock(bp.blocks));
  });
  it('доступны только соседи поставленных блоков', () => {
    const bp = getBlueprint('bp-sword');
    const seed = seedBlock(bp.blocks);
    for (const j of frontier(bp.blocks, new Set([seed]))) {
      const d = Math.hypot(...([0, 1, 2] as const).map((k) => bp.blocks[j].pos[k] - bp.blocks[seed].pos[k]));
      expect(d).toBeLessThanOrEqual(1.05);
    }
  });
  it('камень: центральный куб ставится до верхнего слоя — сверху над ним пусто', () => {
    const bp = getBlueprint('bp-gem');
    const order = buildOrder(bp.blocks);
    const center = bp.blocks.findIndex((b) => b.pos[0] === 0 && b.pos[1] === 1 && b.pos[2] === 0);
    const firstTop = order.findIndex((i) => bp.blocks[i].pos[1] === 2);
    expect(order.indexOf(center)).toBeLessThan(firstTop);
  });
  it('ни один блок не замурован: в момент установки сверху пусто и хотя бы одна сторона свободна', () => {
    // много случайных порядков: на каждом шаге берём любой доступный блок
    let seedRnd = 7;
    const rnd = () => ((seedRnd = (seedRnd * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    for (const bp of BLUEPRINTS) {
      const adj = adjacency(bp.blocks);
      for (let run = 0; run < 20; run++) {
        const placed = new Set<number>();
        while (placed.size < bp.blocks.length) {
          const f = frontier(bp.blocks, placed, adj);
          expect(f.length, bp.id).toBeGreaterThan(0);
          const i = f[Math.floor(rnd() * f.length)];
          const sides = faceNeighbours(bp.blocks, i, adj);
          expect(sides.some((k) => k < 0 || !placed.has(k)), `${bp.id} блок ${i}`).toBe(true);
          // выше ставящегося блока ничего не стоит — его верх виден камерой сверху
          for (const k of placed) expect(bp.blocks[k].pos[1], `${bp.id} блок ${i} накрыт ${k}`).toBeLessThanOrEqual(bp.blocks[i].pos[1] + 0.01);
          placed.add(i);
        }
      }
    }
  });
  it('каждый чертёж собирается целиком, каждый блок по одному разу', () => {
    for (const bp of BLUEPRINTS) {
      const order = buildOrder(bp.blocks);
      expect(order, bp.id).toHaveLength(bp.blocks.length);
      expect(new Set(order).size, bp.id).toBe(bp.blocks.length);
    }
  });
});

describe('распределение стат', () => {
  it('по умолчанию пропорционально baseStats, сумма = число блоков', () => {
    const lobster = getBlueprint('bp-lobster');
    if (lobster.kind !== 'character') throw new Error();
    const c = defaultCounts(lobster);
    expect(totalCount(c)).toBe(38);
    expect([c.Strength, c.Stamina, c.Dexterity].sort()).toEqual([12, 13, 13]);
    expect(c.Armor + c.Intelligence + c.Luck).toBe(0);
  });
  it('кисть берёт свою стату, пока квота не кончилась, потом — следующую с остатком', () => {
    const target = { Armor: 1, Strength: 2, Dexterity: 0, Intelligence: 0, Stamina: 0, Luck: 0 };
    const assigned = new Map<number, Stat>();
    expect(nextStat(target, assigned, 'Strength')).toBe('Strength');
    assigned.set(0, 'Strength').set(1, 'Strength');
    expect(nextStat(target, assigned, 'Strength')).toBe('Armor');
    assigned.set(2, 'Armor');
    expect(nextStat(target, assigned, 'Strength')).toBeNull();
    expect(usedCounts(assigned).Strength).toBe(2);
  });
});

describe('ручной цвет', () => {
  const C = (o: Partial<Record<Stat, number>>) => ({ Armor: 0, Strength: 0, Dexterity: 0, Intelligence: 0, Stamina: 0, Luck: 0, ...o });
  it('квота есть — ползунки не трогаем', () => {
    const t = C({ Strength: 5, Dexterity: 5 });
    expect(countsAfterPaint(t, new Map(), 'Dexterity', 10)).toBe(t);
  });
  it('квоты нет — берём у статы с наибольшим запасом', () => {
    const t = C({ Strength: 4, Dexterity: 2, Stamina: 4 });
    const a = new Map<number, Stat>([[0, 'Dexterity'], [1, 'Dexterity'], [2, 'Stamina'], [3, 'Stamina'], [4, 'Stamina']]);
    // запас: сила 4, выносливость 1 → берём у силы
    const c = countsAfterPaint(t, a, 'Dexterity', 10)!;
    expect(c).toEqual(C({ Strength: 3, Dexterity: 3, Stamina: 4 }));
    expect(totalCount(c)).toBe(10);
  });
  it('есть нераспределённые — сперва они', () => {
    const t = C({ Strength: 4 });
    expect(countsAfterPaint(t, new Map(), 'Luck', 10)).toEqual(C({ Strength: 4, Luck: 1 }));
  });
  it('забрать не у кого — null', () => {
    const t = C({ Strength: 2 });
    const a = new Map<number, Stat>([[0, 'Strength'], [1, 'Strength']]);
    expect(countsAfterPaint(t, a, 'Luck', 2)).toBeNull();
  });
  it('перекраска переносит единицу квоты', () => {
    expect(countsAfterRepaint(C({ Armor: 3, Luck: 1 }), 'Armor', 'Luck')).toEqual(C({ Armor: 2, Luck: 2 }));
  });
});
