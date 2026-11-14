import { describe, expect, it } from 'vitest';
import { freshState, migrate } from '../store';
import { SHARD_ID, STATE_VERSION, cubeCount, itemCount } from '../../core/state';

describe('миграция сейва', () => {
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
    expect(s.unlockedBlueprints).toEqual(['bp-waran', 'bp-sword', 'bp-potion-vial', 'bp-pouch']);
    expect(s.unlockedBlueprints).not.toContain('bp-gem');
    expect(s.manuallyCrafted).toEqual(['bp-sword']);
    expect(s.inventory.map((e) => e.itemId)).toEqual(['rustySword']);
    expect('models' in s).toBe(false);
    expect(s.characters).toHaveLength(1); // модель варана стала персонажем, модель удалённого чертежа — нет
    expect(s.characters[0]).toMatchObject({ name: 'Варан 1', blueprintId: 'bp-waran', brokenBlocks: [], rucksack: null });
    expect(s.characters[0].blockStats).toHaveLength(22);
  });

  it('сейв до v2: счётчики кубов и осколков (и осколки серии) становятся предметами', () => {
    const { inventory, ...base } = freshState();
    const old = {
      ...base,
      inventory: inventory.filter((e) => e.itemId !== 'cube'),
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
