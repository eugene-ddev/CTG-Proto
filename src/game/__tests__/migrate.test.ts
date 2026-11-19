import { describe, expect, it } from 'vitest';
import { freshState, migrate } from '../store';
import { SHARD_ID, STATE_VERSION, cubeCount, itemCount, normalizeState } from '../../core/state';

describe('миграция сейва', () => {
  it('сейв v6: ранее выбранный закрытый скин сбрасывается', () => {
    const base = migrate({ ...freshState(), models: [{ uid: 'm1', blueprintId: 'bp-waran' }] });
    const old = { ...base, version: 6, characters: [{ ...base.characters[0], skinId: 'waran-rock' }] };
    expect(normalizeState(old)).toEqual(base);
    expect(migrate(old).characters[0]).toEqual(base.characters[0]);
  });
  it('старый сейв: открыты только стартовые чертежи, удалённые предметы и чертежи убраны', () => {
    const old = {
      ...freshState(),
      version: 2,
      unlockedBlueprints: ['bp-sword', 'bp-gem-lightning'],
      manuallyCrafted: ['bp-gem-lightning', 'bp-sword'],
      inventory: [
        { uid: 'i1', itemId: 'rustySword', count: 1 },
        { uid: 'i2', itemId: 'lightningGem', count: 1 },
      ],
      models: [
        { uid: 'm1', blueprintId: 'bp-gem-old', blockStats: [] },
        { uid: 'm2', blueprintId: 'bp-waran' }, // до этапа 5 — без стат
      ],
    };
    const s = migrate(old);
    // до версии 4 были открыты все чертежи — теперь стартовый набор, остальное открывается пергаментом
    expect(s.unlockedBlueprints).toEqual(['bp-waran', 'bp-sword']);
    expect(s.unlockedBlueprints).not.toContain('bp-gem');
    expect(s.manuallyCrafted).toEqual(['bp-sword']);
    expect(s.inventory.map((e) => e.itemId)).toEqual(['rustySword']);
    expect('models' in s).toBe(false);
    expect(s.characters).toHaveLength(1); // модель варана стала персонажем, модель удалённого чертежа — нет
    expect(s.characters[0]).toMatchObject({ name: 'Варан 1', blueprintId: 'bp-waran', brokenBlocks: [], rucksackLevel: 1, potions: { Strength: { level: 1, charges: 5 } } });
    expect(s.characters[0].blockStats).toHaveLength(22);
  });

  it('старый надетый рюкзак сохраняет уровень; старые зелья и сумки перестают быть предметами', () => {
    const old = {
      ...freshState(),
      version: 4,
      inventory: [
        { uid: 'i1', itemId: 'restoreStrengthVial', count: 5 },
        { uid: 'i2', itemId: 'rucksack', count: 1 },
        { uid: 'i3', itemId: SHARD_ID, count: 2 },
      ],
      characters: [{
        uid: 'c1', name: 'Старый', blueprintId: 'bp-waran', blockStats: Array(22).fill('Strength'), brokenBlocks: [],
        equipment: [null, null, null, null, null], rucksack: { uid: 'bag1', itemId: 'rucksackHuge' },
        potions: { Strength: { level: 2, charges: 10 } },
        bag: [{ uid: 'i1', itemId: 'restoreStrengthVial', count: 5 }, { uid: 'i3', itemId: SHARD_ID, count: 2 }],
      }],
      models: [],
    } as unknown as Parameters<typeof migrate>[0];
    const s = migrate(old);
    expect(s.characters[0].rucksackLevel).toBe(4);
    expect(s.characters[0].bag).toEqual([null, expect.objectContaining({ itemId: SHARD_ID, count: 2 })]);
    expect(s.inventory.map((e) => e.itemId)).toEqual([SHARD_ID]);
    expect(s.characters[0].potions.Strength).toEqual({ level: 2, charges: 5 });
    expect(s.characters[0].potions.Luck).toEqual({ level: 1, charges: 5 });
  });

  it('сейв до v2: счётчики кубов и осколков (и осколки серии) становятся предметами', () => {
    const { inventory, ...base } = freshState();
    const old = {
      ...base,
      // стартовый набор сам содержит осколки (все предметы) — в старом сейве их в инвентаре не было
      inventory: inventory.filter((e) => e.itemId !== 'cube' && e.itemId !== SHARD_ID),
      cubes: 250,
      shards: 10,
      arenaRun: null,
    } as unknown as Parameters<typeof migrate>[0];
    const s = migrate(old);
    expect(cubeCount(s)).toBe(250);
    expect(itemCount(s, SHARD_ID)).toBe(10);
    expect('cubes' in s).toBe(false);
    expect('shards' in s).toBe(false);
    expect(s.version).toBe(STATE_VERSION);
  });
});
