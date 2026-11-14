import { describe, expect, it } from 'vitest';
import { OPPONENTS, getBlueprint, getItem } from '../../data/catalog';
import type { CharacterBlueprint, EquipmentItem } from '../../data/types';
import { characterStats } from '../character';
import { blueprintsOfCategory, distributeCubes, gemSlotsAt, generateOpponent, mainStats, playerWeaponLevel } from '../opponent';
import { createRng } from '../rng';
import { rngDraws } from '../bag';

const count = (o: ReturnType<typeof generateOpponent>, s: string) => o.blockStats.filter((x) => x === s).length;

describe('генерация ботов', () => {
  it('детерминирована по seed и уровню игрока', () => {
    expect(generateOpponent(7, { level: 10 })).toEqual(generateOpponent(7, { level: 10 }));
  });

  it('уровень оружия — как у игрока или ниже (до −разброса), никогда не выше максимума; не ниже минимума', () => {
    const spread = OPPONENTS.weaponLevelSpread;
    const max = OPPONENTS.maxWeaponLevel;
    expect(max).toBe(3);
    const seen = new Set<number>();
    for (let seed = 1; seed < 200; seed++) {
      const o = generateOpponent(seed, { level: max });
      for (const lv of o.weaponLevels.filter((l): l is number => l !== null)) {
        expect(lv).toBeGreaterThanOrEqual(Math.max(OPPONENTS.minWeaponLevel, max - spread));
        expect(lv).toBeLessThanOrEqual(max);
        seen.add(lv);
      }
      for (const lv of generateOpponent(seed, { level: 40 }).weaponLevels.filter((l): l is number => l !== null)) expect(lv).toBeLessThanOrEqual(max);
      for (const lv of generateOpponent(seed, { level: 1 }).weaponLevels.filter((l): l is number => l !== null)) expect(lv).toBe(OPPONENTS.minWeaponLevel);
    }
    expect(seen.has(max)).toBe(true);
    expect(seen.has(max - spread)).toBe(true);
  });

  it('оружие — под главную стату, она самая большая; вторая стата оружия не качается', () => {
    for (let seed = 1; seed < 300; seed++) {
      const o = generateOpponent(seed, { level: 5 });
      const hands = o.equipment.filter((e) => e?.kind === 'weapon');
      expect(hands.length).toBeGreaterThan(0);
      const main = hands[0]!.scalingStat;
      expect(hands.every((w) => w!.scalingStat === main)).toBe(true);
      for (const s of ['Armor', 'Strength', 'Dexterity', 'Intelligence', 'Stamina', 'Luck']) if (s !== main) expect(count(o, s)).toBeLessThan(count(o, main));
      for (const s of mainStats()) if (s !== main) expect(count(o, s)).toBe(0);
      expect(o.blockStats).toHaveLength(getBlueprint(o.blueprintId).blocks.length);
    }
  });

  it('артефакт с маной (allowMana: true) — только с кубами Интеллекта; без артефакта Интеллекта нет', () => {
    let withArt = 0;
    for (let seed = 1; seed < 300; seed++) {
      const o = generateOpponent(seed, { level: 5, cfg: { ...OPPONENTS, allowMana: true } });
      const mana = Math.max(0, ...o.equipment.map((e) => e?.ability.manaCost ?? 0));
      const bp = getBlueprint(o.blueprintId) as CharacterBlueprint;
      const st = characterStats(bp, o.blockStats);
      if (mana > 0) {
        withArt++;
        expect(st.maxMana).toBeGreaterThanOrEqual(mana * OPPONENTS.manaCastsReserve);
      } else expect(count(o, 'Intelligence')).toBe(0);
      // все требования предметов выполнены
      for (const e of o.equipment) if (e) expect(st.base[e.scalingStat]).toBeGreaterThanOrEqual(e.minStatRequired);
    }
    expect(withArt).toBeGreaterThan(0);
  });

  it('рюкзак: содержимое влезает, зелья — стопками до максимума, оружие — главной статы', () => {
    let bags = 0;
    for (let seed = 1; seed < 200; seed++) {
      const o = generateOpponent(seed, { level: 5 });
      if (!o.rucksack) {
        expect(o.bag).toEqual([]);
        continue;
      }
      bags++;
      const cap = getItem(o.rucksack);
      expect(cap.kind).toBe('bag');
      expect(o.bag.length).toBeLessThanOrEqual(cap.kind === 'bag' ? cap.capacity : 0);
      const main = o.equipment.find((e) => e?.kind === 'weapon')!.scalingStat;
      for (const e of o.bag) {
        const it = getItem(e.itemId);
        if (it.kind === 'potion') expect(e.count).toBeLessThanOrEqual(it.maxStack);
        else expect(it).toMatchObject({ kind: 'weapon', scalingStat: main });
      }
    }
    expect(bags).toBeGreaterThan(0);
  });

  it('ячейки камней у бота: 0…(уровень−1), не больше 3; уровень игрока — лучшее оружие в руках', () => {
    expect(gemSlotsAt(1)).toBe(0);
    expect(gemSlotsAt(2)).toBe(1);
    expect(gemSlotsAt(3)).toBe(2);
    expect(gemSlotsAt(10)).toBe(3);
    for (let seed = 1; seed < 100; seed++) {
      const o = generateOpponent(seed, { level: 3 });
      for (const w of o.equipment) if (w?.kind === 'weapon') expect(w.gemSlots).toBeLessThanOrEqual(gemSlotsAt(w.itemLevel));
      for (const w of generateOpponent(seed, { level: 1 }).equipment) if (w?.kind === 'weapon') expect(w.gemSlots).toBe(0);
    }
    expect(playerWeaponLevel([null, null])).toBe(OPPONENTS.minWeaponLevel);
    expect(playerWeaponLevel([{ ...(getItem('rustySword') as EquipmentItem), itemLevel: 3 }, null])).toBe(3);
  });

  it('раскладка кубов покрывает требования даже при маленьком чертеже', () => {
    const c = distributeCubes(10, 'Strength', { Intelligence: 6 }, rngDraws(createRng(1)));
    expect(Object.values(c).reduce((a, b) => a + b, 0)).toBe(10);
    expect(c.Intelligence).toBe(6);
    expect(c.Strength).toBeGreaterThan(0);
  });

  it('бот той же категории, что боец игрока: лобстер против лобстера, варан против варана', () => {
    for (let seed = 1; seed < 50; seed++) {
      expect(generateOpponent(seed, { category: 3 }).blueprintId).toBe('bp-lobster');
      expect(generateOpponent(seed, { category: 1 }).blueprintId).toBe('bp-waran');
    }
    expect(blueprintsOfCategory(2).length).toBeGreaterThan(0); // нет такой — ближайшая
  });
});

describe('боты без маны (0.0.69)', () => {
  it('allowMana: false — ни артефактов с маной, ни кубов Интеллекта', () => {
    expect(OPPONENTS.allowMana).toBe(false);
    for (let seed = 1; seed <= 200; seed++) {
      const o = generateOpponent(seed);
      expect(o.equipment.some((e) => e && e.ability.manaCost > 0)).toBe(false);
      expect(o.blockStats.includes('Intelligence')).toBe(false);
    }
  });
});
