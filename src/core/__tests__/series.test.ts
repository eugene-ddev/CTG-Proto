import { describe, expect, it } from 'vitest';
import { ARENA, BLUEPRINTS, START, getBlueprint, maxStackOf } from '../../data/catalog';
import type { CharacterBlueprint, Stat } from '../../data/types';
import { SERIES_LENGTH, finishFight, markInBattle, opponentDraws, rollSeriesReward, seriesBotLevel, startRun } from '../arena';
import { generateOpponent } from '../opponent';
import { bagSlots, equip } from '../character';
import { completeCraft } from '../craft';
import { PARCHMENT_ID, WHETSTONE_ID, addItem, createInitialState, cubeCount, itemCount, type PlayerState } from '../state';
import { JEWELER_ID, MAX_WEAPON_LEVEL, addGemCell, cellInfo, upgradeCost, upgradeInfo, upgradePotion, upgradeRucksack, upgradeWeapon } from '../upgrade';

const lobster = getBlueprint('bp-lobster') as CharacterBlueprint;
const stats38 = (): Stat[] => [...Array(13).fill('Strength'), ...Array(13).fill('Dexterity'), ...Array(12).fill('Stamina')];

function ready(): { s: PlayerState; uid: string } {
  let s = createInitialState({ ...START, unlockAllBlueprints: true }, BLUEPRINTS.map((b) => b.id), maxStackOf);
  s = completeCraft(s, lobster, { manual: true, maxStack: maxStackOf, blockStats: stats38() })!.state;
  s = addItem(s, 'rustySword', 1, 1);
  const uid = s.characters[0].uid;
  s = equip(s, uid, 0, s.inventory.find((e) => e.itemId === 'rustySword')!.uid)!;
  return { s, uid };
}

const win = (seed: number) => ({ win: true, brokenBlocks: [], enemyBroken: 0, seed });

describe('серия арены: длина и награда', () => {
  it(`в серии ${SERIES_LENGTH} боя; награда — за победу в последнем, серия закрывается`, () => {
    expect(SERIES_LENGTH).toBe(3);
    const { s, uid } = ready();
    const cubes0 = cubeCount(s);
    let st = startRun(s, uid)!;
    for (let k = 1; k < SERIES_LENGTH; k++) {
      const out = finishFight(markInBattle(st)!, win(k))!;
      expect(out.reward).toBeUndefined();
      expect(out.state.arenaRun).toMatchObject({ fight: k + 1, wins: k });
      st = out.state;
    }
    const out = finishFight(markInBattle(st)!, win(99))!;
    expect(out.state.arenaRun).toBeNull();
    expect(out.reward!.items).toHaveLength(1);
    expect(Object.keys(out.state.bags)).toContain('reward.drop'); // награда — из мешка игрока
    expect(cubeCount(out.state)).toBe(cubes0 + ARENA.reward.cubes);
    for (const e of out.reward!.items) expect(itemCount(out.state, e.itemId)).toBe(e.count);
  });

  it('поражение в последнем бою — без награды', () => {
    const { s, uid } = ready();
    let st = startRun(s, uid)!;
    for (let k = 1; k < SERIES_LENGTH; k++) st = finishFight(markInBattle(st)!, win(k))!.state;
    const out = finishFight(markInBattle(st)!, { win: false, brokenBlocks: [], enemyBroken: 0, seed: 1 })!;
    expect(out.reward).toBeUndefined();
    expect(cubeCount(out.state)).toBe(cubeCount(s));
  });

  it('награда: 100 кубов + точильные камни 1–5 (~45%), пергамент, один из трёх наборов или камень стихии', () => {
    let stones = 0;
    let parch = 0;
    let kits = 0;
    let alchemist = 0;
    let leatherworker = 0;
    let gems = 0;
    for (let seed = 1; seed <= 4000; seed++) {
      const r = rollSeriesReward(seed);
      expect(r.cubes).toBe(100);
      expect(r.items).toHaveLength(1);
      const [e] = r.items;
      if (e.itemId === WHETSTONE_ID) {
        stones++;
        expect(e.count).toBeGreaterThanOrEqual(1);
        expect(e.count).toBeLessThanOrEqual(5);
      } else if (e.itemId === PARCHMENT_ID) {
        expect(e.count).toBe(1);
        parch++;
      } else if (e.itemId === JEWELER_ID) {
        expect(e.count).toBe(1);
        kits++;
      } else if (e.itemId === 'alchemistKit' || e.itemId === 'leatherworkerKit') {
        expect(e.count).toBe(1);
        if (e.itemId === 'alchemistKit') alchemist++;
        else leatherworker++;
      } else {
        expect(['fireGem', 'iceGem', 'poisonGem']).toContain(e.itemId);
        expect(e.count).toBe(1);
        gems++;
      }
    }
    expect(stones / 4000).toBeGreaterThan(0.42);
    expect(gems / 4000).toBeGreaterThan(0.12);
    expect(parch / 4000).toBeGreaterThan(0.07);
    expect(kits / 4000).toBeGreaterThan(0.07);
    expect(alchemist / 4000).toBeGreaterThan(0.07);
    expect(leatherworker / 4000).toBeGreaterThan(0.07);
  });
});

describe('прокачка оружия за точильные камни', () => {
  it('2-й уровень — 10 камней, 3-й — 25; надетое и в инвентаре; выше 3 нельзя', () => {
    let { s, uid } = ready();
    s = addItem(s, WHETSTONE_ID, 45, 100);
    s = addItem(s, 'rustyDagger', 1, 1);
    const eq = { kind: 'equip' as const, charUid: uid, slot: 0 };
    expect(upgradeInfo(s, eq)).toMatchObject({ level: 1, cost: 10, have: 45, ok: true });
    s = upgradeWeapon(s, eq)!;
    expect(s.characters[0].equipment[0]?.level).toBe(2);
    expect(itemCount(s, WHETSTONE_ID)).toBe(35);
    s = upgradeWeapon(s, eq)!; // 2 → 3 за 25
    expect(s.characters[0].equipment[0]?.level).toBe(3);
    expect(itemCount(s, WHETSTONE_ID)).toBe(10);
    expect(upgradeInfo(s, eq)).toMatchObject({ ok: false, reason: 'max' });
    expect(upgradeWeapon(s, eq)).toBeNull();
    const inv = { kind: 'inv' as const, uid: s.inventory.find((e) => e.itemId === 'rustyDagger')!.uid };
    s = upgradeWeapon(s, inv)!;
    expect(s.inventory.find((e) => e.itemId === 'rustyDagger')!.level).toBe(2);
    expect(itemCount(s, WHETSTONE_ID)).toBe(0);
    expect(upgradeInfo(s, inv)).toMatchObject({ cost: 25, have: 0, ok: false });
  });

  it('боец на арене не качается; на максимуме — нельзя; не оружие — нельзя', () => {
    let { s, uid } = ready();
    s = addItem(s, WHETSTONE_ID, 100, 100);
    const eq = { kind: 'equip' as const, charUid: uid, slot: 0 };
    const run = startRun(s, uid)!;
    expect(upgradeInfo(run, eq)).toMatchObject({ ok: false, reason: 'arena' });
    const maxed = { ...s, characters: s.characters.map((c) => ({ ...c, equipment: c.equipment.map((e, i) => (i === 0 && e ? { ...e, level: MAX_WEAPON_LEVEL } : e)) })) };
    expect(MAX_WEAPON_LEVEL).toBe(3);
    expect(upgradeInfo(maxed, eq)).toMatchObject({ ok: false, reason: 'max' });
    const resource = s.inventory.find((e) => e.itemId === 'cube')!;
    expect(upgradeInfo(s, { kind: 'inv', uid: resource.uid })).toMatchObject({ ok: false, reason: 'notWeapon' });
    expect(upgradeCost(1)).toBe(10);
    expect(upgradeCost(2)).toBe(25);
    expect(upgradeCost(3)).toBe(Infinity);
  });
});

describe('наборы алхимика и кожевника', () => {
  it('один набор — один уровень; зелье наполняется, другие зелья не меняются; рюкзак 3 → 6 → 12 → 18', () => {
    let { s, uid } = ready();
    expect(upgradePotion(s, uid, 'Strength')).toBeNull();
    expect(upgradeRucksack(s, uid)).toBeNull();
    s = addItem(s, 'alchemistKit', 1, 100);
    s = { ...s, characters: [{ ...s.characters[0], potions: { ...s.characters[0].potions, Strength: { level: 1, charges: 0 } } }] };
    s = upgradePotion(s, uid, 'Strength')!;
    expect(s.characters[0].potions.Strength).toEqual({ level: 2, charges: 5 });
    expect(s.characters[0].potions.Armor).toEqual({ level: 1, charges: 5 });
    expect(itemCount(s, 'alchemistKit')).toBe(0);
    expect(upgradePotion(s, uid, 'Strength')).toBeNull();
    s = addItem(s, 'leatherworkerKit', 3, 100);
    for (const capacity of [6, 12, 18]) {
      s = upgradeRucksack(s, uid)!;
      expect(bagSlots(s.characters[0])).toHaveLength(capacity);
    }
    expect(itemCount(s, 'leatherworkerKit')).toBe(0);
    expect(upgradeRucksack(s, uid)).toBeNull();
  });
});

describe('ювелирный набор: ячейки камней', () => {
  it('набор создаёт ячейку и тратится; максимум 3; на арене нельзя; без набора нельзя', () => {
    let { s, uid } = ready();
    const eq = { kind: 'equip' as const, charUid: uid, slot: 0 };
    expect(cellInfo(s, eq)).toMatchObject({ cells: 0, max: 3, have: 0, ok: false });
    expect(addGemCell(s, eq)).toBeNull();
    s = addItem(s, JEWELER_ID, 5, 100);
    for (let i = 1; i <= 3; i++) {
      s = addGemCell(s, eq)!;
      expect(s.characters[0].equipment[0]?.cells).toBe(i);
    }
    expect(itemCount(s, JEWELER_ID)).toBe(2);
    expect(cellInfo(s, eq)).toMatchObject({ cells: 3, ok: false, reason: 'max' });
    expect(addGemCell(s, eq)).toBeNull();
    const inv = { kind: 'inv' as const, uid: (s = addItem(s, 'rustyDagger', 1, 1)).inventory.find((e) => e.itemId === 'rustyDagger')!.uid };
    s = addGemCell(s, inv)!;
    expect(s.inventory.find((e) => e.itemId === 'rustyDagger')!.cells).toBe(1);
    expect(itemCount(s, JEWELER_ID)).toBe(1);
    const fresh = ready();
    const run = startRun(addItem(fresh.s, JEWELER_ID, 1, 100), fresh.uid)!;
    expect(cellInfo(run, { kind: 'equip', charUid: fresh.uid, slot: 0 })).toMatchObject({ ok: false, reason: 'arena' });
  });
});

describe('марбл-бэг вне боя (этап 6)', () => {
  it('награда: из каждых 10 серий ровно 1 пергамент, камни 1–5 — каждое значение по разу за 5 выпадений', () => {
    const { s, uid } = ready();
    let st = s;
    const got: Array<{ itemId: string; count: number }> = [];
    for (let series = 0; series < 20; series++) {
      st = startRun(st, uid)!;
      for (let k = 1; k <= SERIES_LENGTH; k++) {
        const out = finishFight(markInBattle(st)!, win(series * 10 + k))!;
        st = out.state;
        if (out.reward) got.push(...out.reward.items);
      }
    }
    expect(got).toHaveLength(20);
    for (const half of [got.slice(0, 10), got.slice(10)]) expect(half.filter((e) => e.itemId === PARCHMENT_ID)).toHaveLength(1);
    const stones = got.filter((e) => e.itemId === WHETSTONE_ID).map((e) => e.count);
    expect([...stones.slice(0, 5)].sort()).toEqual([1, 2, 3, 4, 5]);
  });

  it('серия идёт от простого к сложному: уровень оружия бота растёт к последнему бою и не выше, чем у игрока', () => {
    expect([1, 2, 3].map((fight) => seriesBotLevel(3, fight))).toEqual([1, 2, 3]);
    expect([1, 2, 3].map((fight) => seriesBotLevel(2, fight))).toEqual([1, 1, 2]);
    expect([1, 2, 3].map((fight) => seriesBotLevel(1, fight))).toEqual([1, 1, 1]);
    const { s, uid } = ready();
    let st = startRun({ ...s, characters: s.characters.map((c) => ({ ...c, equipment: c.equipment.map((e) => (e ? { ...e, level: 3 } : e)) })) }, uid, 11)!;
    const levels: number[] = [];
    for (let k = 1; k <= SERIES_LENGTH; k++) {
      const opp = st.arenaRun!.opp!;
      const bot = generateOpponent(opp.seed, { level: opp.level, exactLevel: opp.exact, draws: opponentDraws(opp) });
      levels.push(Math.max(...bot.weaponLevels.filter((l): l is number => l !== null)));
      if (k < SERIES_LENGTH) st = finishFight(markInBattle(st)!, win(k))!.state;
    }
    expect(levels).toEqual([1, 2, 3]);
  });

  it('бот собирается повтором записанных бросков: экран противника и бой видят одного и того же', () => {
    const { s, uid } = ready();
    const st = startRun(s, uid, 77)!;
    const opp = st.arenaRun!.opp!;
    const a = generateOpponent(opp.seed, { level: opp.level, exactLevel: opp.exact, draws: opponentDraws(opp) });
    const b = generateOpponent(opp.seed, { level: opp.level, exactLevel: opp.exact, draws: opponentDraws(opp) });
    expect(a).toEqual(b);
    // мешки сдвинулись: следующий выбор с тем же seed берёт другие шарики
    expect(Object.keys(st.bags).some((k) => k.startsWith('bot.'))).toBe(true);
  });

  it('боты: главная стата — из мешка, без повторов, пока не выпадут все', () => {
    const { s, uid } = ready();
    let st = s;
    const mains: string[] = [];
    for (let k = 0; k < 4; k++) {
      st = startRun(st, uid, 500 + k)!;
      const opp = st.arenaRun!.opp!;
      mains.push(generateOpponent(opp.seed, { level: opp.level, exactLevel: opp.exact, draws: opponentDraws(opp) }).presetId.split('/')[1]);
      st = { ...st, arenaRun: null };
    }
    expect(new Set(mains.slice(0, 2)).size).toBe(2); // Сила и Ловкость — по разу за круг
    expect(new Set(mains.slice(2, 4)).size).toBe(2);
  });
});

