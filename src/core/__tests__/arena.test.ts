import { describe, expect, it } from 'vitest';
import { START, BLUEPRINTS, getBlueprint, getItem } from '../../data/catalog';
import type { CharacterBlueprint, Stat } from '../../data/types';
import {
  LOBBY_REGEN_MS, SHARDS_PER_CUBE, convertShards, drinkFromBag, endRun, equipFromBag, finishFight, forfeitIfInBattle, lobbyRegen,
  markInBattle, startRun, stowToBag, SERIES_RETRIES, retriesLeft, surrenderRun, drinkPotion, potionSources, enemyLoot, takeLoot, fullRegenIn, repairAll, repairCost, repairCostForStat,
  activeCharacter, healFull, seriesRetries, setSeriesRetries,
} from '../arena';
import { discardFromBag, equip, moveInBag, putInBag } from '../character';
import { completeCraft } from '../craft';
import { SHARD_ID, SHARD_STACK, addItem, createInitialState, cubeCount, itemCount, type PlayerState } from '../state';

const maxStack = (id: string) => { const it = getItem(id); return it.kind === 'potion' ? it.maxStack : 1; };
const lobster = getBlueprint('bp-lobster') as CharacterBlueprint;
const stats38 = (): Stat[] => [...Array(13).fill('Strength'), ...Array(13).fill('Dexterity'), ...Array(12).fill('Stamina')];

/** Лобстер с мечом в левой руке, щитом в первом артефакте и рюкзаком с зельями силы. */
function ready(): { s: PlayerState; uid: string } {
  let s = createInitialState({ ...START, unlockAllBlueprints: true }, BLUEPRINTS.map((b) => b.id), maxStack);
  s = completeCraft(s, lobster, { manual: true, maxStack, blockStats: stats38() })!.state;
  for (const id of ['rustySword', 'rustyAxe', 'magicShieldArtifact', 'rucksack']) s = addItem(s, id, 1, 1);
  s = addItem(s, 'restoreStrengthFlask', 2, maxStack('restoreStrengthFlask'));
  const uid = s.characters[0].uid;
  const inv = (id: string) => s.inventory.find((e) => e.itemId === id)!.uid;
  s = equip(s, uid, 0, inv('rustySword'))!;
  s = equip(s, uid, 2, inv('magicShieldArtifact'))!;
  s = equip(s, uid, 'rucksack', inv('rucksack'))!;
  s = putInBag(s, uid, 0, inv('restoreStrengthFlask'))!;
  s = putInBag(s, uid, 1, inv('rustyAxe'))!;
  return { s, uid };
}

const win = (broken: number[], _items: string[] = []) => ({ win: true, brokenBlocks: broken, enemyBroken: 22, seed: 7 });

describe('серия арены', () => {
  it('победа: разбитые кубы остаются, сам лут не падает — его забирают в рюкзак (takeLoot)', () => {
    const { s, uid } = ready();
    let st = startRun(s, uid)!;
    st = markInBattle(st)!;
    const out = finishFight(st, win([0, 1, 2]))!;
    const c = out.state.characters[0];
    expect(c.brokenBlocks).toEqual([0, 1, 2]);
    expect(c.bag.filter(Boolean)).toHaveLength(2); // как было: флаконы и топор
    expect(out.state.arenaRun).toMatchObject({ fight: 2, wins: 1, inBattle: false });
    const loot = enemyLoot([{ id: 'rustyDagger', itemLevel: 7 }, null], [{ itemId: 'restoreStrengthFlask', count: 2 }], 22);
    expect(loot).toEqual([
      { itemId: 'rustyDagger', count: 1, level: 7 },
      { itemId: 'restoreStrengthFlask', count: 2 },
      { itemId: SHARD_ID, count: 22 },
    ]);
    // кинжал — в ячейку 3, с уровнем экземпляра
    let r = takeLoot(out.state, uid, loot[0], 3)!;
    expect(r.left).toBe(0);
    expect(r.state.characters[0].bag[3]).toMatchObject({ itemId: 'rustyDagger', level: 7 });
    // флаконы без ячейки — докладываются к своим (2 + 2)
    r = takeLoot(r.state, uid, loot[1])!;
    expect(r.state.characters[0].bag[0]).toMatchObject({ itemId: 'restoreStrengthFlask', count: 4 });
    // в занятую чужим предметом ячейку — нельзя
    expect(takeLoot(r.state, uid, loot[2], 3)).toBeNull();
    r = takeLoot(r.state, uid, loot[2])!;
    expect(r.state.characters[0].bag.some((e) => e?.itemId === SHARD_ID && e.count === 22)).toBe(true);
    const done = endRun(r.state);
    expect(done.arenaRun).toBeNull();
    expect(done.characters[0].bag.some((e) => e?.itemId === SHARD_ID)).toBe(true); // лут остаётся в рюкзаке
  });

  it('поражение: оружие в руках и рюкзак с содержимым пропадают, артефакт остаётся, осколки сгорают', () => {
    const { s, uid } = ready();
    let st = startRun(s, uid)!;
    st = finishFight(st, win([]))!.state;
    st = { ...st, arenaRun: { ...st.arenaRun!, retriesUsed: SERIES_RETRIES } }; // повторы кончились
    const out = finishFight(markInBattle(st)!, { win: false, brokenBlocks: [5], enemyBroken: 3, seed: 1 })!;
    const c = out.state.characters[0];
    expect(c.equipment[0]).toBeNull();
    expect(c.equipment[2]?.itemId).toBe('magicShieldArtifact');
    expect(c.rucksack).toBeNull();
    expect(c.bag).toEqual([]);
    expect(out.lost).toEqual(expect.arrayContaining(['rustySword', 'rucksack', 'rustyAxe', 'restoreStrengthFlask']));
    expect(out.state.arenaRun).toBeNull();
    expect(c.brokenBlocks).toEqual([5]);
  });

  it('перезагрузка посреди боя — проигранный бой: тратит повтор, без повторов — поражение', () => {
    const { s, uid } = ready();
    const st = forfeitIfInBattle(markInBattle(startRun(s, uid)!)!);
    expect(st.arenaRun).toMatchObject({ fight: 1, inBattle: false, retriesUsed: 1 });
    expect(st.characters[0].rucksack).not.toBeNull();
    const none = { ...st, arenaRun: { ...st.arenaRun!, retriesUsed: SERIES_RETRIES } };
    const lost = forfeitIfInBattle(markInBattle(none)!);
    expect(lost.arenaRun).toBeNull();
    expect(lost.characters[0].rucksack).toBeNull();
  });

  it(`повторы: ${SERIES_RETRIES} на всю серию — тот же противник, боец как до боя, ничего не пропадает; сдаться — поражение`, () => {
    const { s, uid } = ready();
    let st = startRun(s, uid, 42)!;
    st = finishFight(markInBattle(st)!, win([1]))!.state; // бой 1 выигран, разбит куб 1
    const opp = st.arenaRun!.opp;
    for (let k = 1; k <= SERIES_RETRIES; k++) {
      const out = finishFight(markInBattle(st)!, { win: false, brokenBlocks: [1, 2, 3], enemyBroken: 0, seed: k })!;
      expect(out.retry).toBe(true);
      expect(out.lost).toEqual([]);
      expect(out.state.arenaRun).toMatchObject({ fight: 2, wins: 1, inBattle: false, retriesUsed: k, opp });
      expect(out.state.characters[0].brokenBlocks).toEqual([1]);
      expect(retriesLeft(out.state.arenaRun)).toBe(SERIES_RETRIES - k);
      st = out.state;
    }
    const last = finishFight(markInBattle(st)!, { win: false, brokenBlocks: [1, 2], enemyBroken: 0, seed: 9 })!;
    expect(last.retry).toBeUndefined();
    expect(last.state.arenaRun).toBeNull();
    expect(last.state.characters[0].brokenBlocks).toEqual([1, 2]);
    // сдаться можно и с оставшимися повторами
    const fresh = finishFight(markInBattle(startRun(ready().s, uid)!)!, { win: false, brokenBlocks: [], enemyBroken: 0, seed: 1 })!;
    const sur = surrenderRun(fresh.state)!;
    expect(sur.state.arenaRun).toBeNull();
    expect(sur.lost).toEqual(expect.arrayContaining(['rustySword', 'rucksack']));
  });

  it('до первого боя бойца можно переодеть, но не сменить; противник зафиксирован', () => {
    const { s, uid } = ready();
    const st = startRun(s, uid, 42)!;
    expect(st.arenaRun!.opp).toMatchObject({ seed: 42, level: 1 });
    expect(st.arenaRun!.opp!.draws!.length).toBeGreaterThan(0); // бот выбран из мешков, броски записаны
    expect(startRun(st, uid, 99)!.arenaRun!.opp!.seed).toBe(42); // повторный вход — тот же противник
    const other = completeCraft(st, lobster, { manual: true, maxStack, blockStats: stats38() })!.state;
    expect(startRun(other, other.characters[1].uid)).toBeNull(); // другой боец — нельзя
    expect(equip(addItem(st, 'rustyClub', 1, 1), uid, 1, addItem(st, 'rustyClub', 1, 1).inventory.find((e) => e.itemId === 'rustyClub')!.uid)).not.toBeNull();
  });

  it('в серии снаряжение из инвентаря не меняется, только из рюкзака', () => {
    const { s, uid } = ready();
    let st = finishFight(startRun(s, uid)!, win([], []))!.state; // после первой победы — замок
    st = addItem(st, 'rustyClub', 1, 1);
    expect(equip(st, uid, 1, st.inventory.find((e) => e.itemId === 'rustyClub')!.uid)).toBeNull();
    // топор из ячейки 1 в правую руку, затем меч из левой — в рюкзак
    st = equipFromBag(st, uid, 1, 1)!;
    expect(st.characters[0].equipment[1]?.itemId).toBe('rustyAxe');
    expect(st.characters[0].bag[1]).toBeNull();
    st = stowToBag(st, uid, 0)!;
    expect(st.characters[0].equipment[0]).toBeNull();
    expect(st.characters[0].bag.some((e) => e?.itemId === 'rustySword')).toBe(true);
    // артефакт в руку не встаёт
    expect(equipFromBag(st, uid, st.characters[0].bag.findIndex((e) => e?.itemId === 'rustySword'), 2)).toBeNull();
  });

  it('зелье из рюкзака чинит кубы своей статы и тратится', () => {
    const { s, uid } = ready();
    let st = finishFight(startRun(s, uid)!, win([0, 1, 2, 3, 30]))!.state; // 0–3 — сила, 30 — выносливость
    expect(drinkFromBag(startRun(s, uid)!, uid, 0)).toBeNull(); // целый боец — нечего чинить
    st = drinkFromBag(st, uid, 0)!; // флакон — 3 куба
    expect(st.characters[0].brokenBlocks).toEqual([3, 30]);
    expect(st.characters[0].bag[0]?.count).toBe(1);
  });

  it('в лобби зелье пьётся и из инвентаря, в серии — только из рюкзака', () => {
    const { s, uid } = ready();
    let st = addItem(s, 'restoreStrengthVial', 2, maxStack('restoreStrengthVial'));
    st = { ...st, characters: [{ ...st.characters[0], brokenBlocks: [0, 1] }] };
    const inv = st.inventory.find((e) => e.itemId === 'restoreStrengthVial')!.uid;
    const after = drinkPotion(st, uid, { kind: 'inv', uid: inv }, 1)!;
    expect(after.characters[0].brokenBlocks).toEqual([0]); // сначала выбранный куб
    expect(after.inventory.find((e) => e.uid === inv)!.count).toBe(st.inventory.find((e) => e.uid === inv)!.count - 1);
    const inSeries = finishFight(startRun(st, uid)!, win([0, 1], []))!.state;
    expect(drinkPotion(inSeries, uid, { kind: 'inv', uid: inv })).toBeNull();
    expect(potionSources(inSeries, inSeries.characters[0], 'Strength').every((x) => x.src.kind === 'bag')).toBe(true);
  });

  it('осколки → кубы по курсу', () => {
    const { s } = ready();
    const st = convertShards(addItem(s, SHARD_ID, SHARDS_PER_CUBE * 3 + 2, SHARD_STACK))!;
    expect(cubeCount(st)).toBe(cubeCount(s) + 3);
    expect(itemCount(st, SHARD_ID)).toBe(2);
    expect(convertShards(addItem(s, SHARD_ID, SHARDS_PER_CUBE - 1, SHARD_STACK))).toBeNull();
  });

  it('восстановление: один куб за интервал вне арены; на арене (и между боями серии) — нет', () => {
    const { s, uid } = ready();
    const t0 = 1_000_000;
    let st: PlayerState = { ...s, characters: [{ ...s.characters[0], brokenBlocks: [1, 2, 3], lobbySince: t0 }] };
    st = lobbyRegen(st, t0 + LOBBY_REGEN_MS * 2 + 10);
    expect(st.characters[0].brokenBlocks).toEqual([3]);
    const fighting = markInBattle(startRun(st, uid)!)!;
    expect(lobbyRegen(fighting, t0 + LOBBY_REGEN_MS * 10)).toBe(fighting);
    const between = { ...fighting, arenaRun: { ...fighting.arenaRun!, inBattle: false, wins: 1 } };
    expect(lobbyRegen(between, t0 + LOBBY_REGEN_MS * 10)).toBe(between);
    const beforeFirst = startRun(st, uid)!; // на арене, но ещё не дрался
    expect(lobbyRegen(beforeFirst, t0 + LOBBY_REGEN_MS * 10)).toBe(beforeFirst);
    expect(fullRegenIn(st, st.characters[0], t0 + LOBBY_REGEN_MS * 2 + 10)).toBe(LOBBY_REGEN_MS - 10);
    st = lobbyRegen(st, t0 + LOBBY_REGEN_MS * 3 + 20);
    expect(st.characters[0].brokenBlocks).toEqual([]);
    expect(st.characters[0].lobbySince).toBeUndefined();
  });
});

describe('после победы', () => {

  it('сразу выбирается новый противник', () => {
    const { s, uid } = ready();
    const st = markInBattle(startRun(s, uid, 1)!)!;
    const out = finishFight(st, { win: true, brokenBlocks: [], enemyBroken: 0, seed: 3 })!;
    expect(out.state.arenaRun!.opp!.seed).not.toBe(1);
  });
});

describe('рюкзак: перетаскивание между ячейками', () => {
  it('в пустую — переезд, на другое — обмен, на то же зелье — докладывается; в серии тоже можно', () => {
    const { s, uid } = ready(); // 0 — 2 флакона силы, 1 — топор
    let st = moveInBag(s, uid, 1, 4)!;
    expect(st.characters[0].bag[1]).toBeNull();
    expect(st.characters[0].bag[4]?.itemId).toBe('rustyAxe');
    st = moveInBag(st, uid, 0, 4)!;
    expect(st.characters[0].bag[0]?.itemId).toBe('rustyAxe');
    expect(st.characters[0].bag[4]).toMatchObject({ itemId: 'restoreStrengthFlask', count: 2 });
    st = addItem(st, 'restoreStrengthFlask', 4, maxStack('restoreStrengthFlask'));
    st = putInBag(st, uid, 2, st.inventory.find((e) => e.itemId === 'restoreStrengthFlask')!.uid)!;
    st = moveInBag(st, uid, 2, 4)!; // 4 + 2, стопка до 5: в 4 — 5, в 2 — 1
    expect(st.characters[0].bag[4]?.count).toBe(5);
    expect(st.characters[0].bag[2]?.count).toBe(1);
    expect(moveInBag(st, uid, 3, 0)).toBeNull(); // из пустой — нечего
    const inSeries = finishFight(markInBattle(startRun(st, uid)!)!, win([], []))!.state;
    expect(moveInBag(inSeries, uid, 0, 3)).not.toBeNull();
  });
});

describe('починка за кубы', () => {
  it('цена — самый дешёвый набор флаконов; на арене нельзя', () => {
    const vial = getBlueprint(getItem('restoreStrengthVial').blueprintId!).blocks.length;
    const flask = getBlueprint(getItem('restoreStrengthFlask').blueprintId!).blocks.length;
    const cheapest = (n: number) => {
      let best = Infinity;
      for (let f = 0; f <= Math.ceil(n / 3); f++) best = Math.min(best, f * flask + Math.max(0, n - 3 * f) * vial);
      return best;
    };
    for (const n of [1, 2, 3, 4, 7]) expect(repairCostForStat('Strength', n)).toBe(cheapest(n));
    const { s, uid } = ready(); // 0..12 — сила, 13..25 — ловкость
    const st = { ...s, characters: [{ ...s.characters[0], brokenBlocks: [0, 1, 13] }] };
    const cost = repairCost(st.characters[0]);
    expect(cost).toBe(cheapest(2) + cheapest(1));
    const out = repairAll(st, uid)!;
    expect(out.characters[0].brokenBlocks).toEqual([]);
    expect(cubeCount(out)).toBe(cubeCount(st) - cost);
    expect(repairAll(startRun(st, uid)!, uid)).toBeNull();
  });
});

describe('выбросить из рюкзака', () => {
  it('ячейка освобождается, выброшенное возвращается; можно и в серии', () => {
    const { s, uid } = ready();
    const inSeries = finishFight(markInBattle(startRun(s, uid)!)!, win([], []))!.state;
    const r = discardFromBag(inSeries, uid, 1)!;
    expect(r.entry.itemId).toBe('rustyAxe');
    expect(r.state.characters[0].bag[1]).toBeNull();
    expect(discardFromBag(r.state, uid, 1)).toBeNull();
  });
});

describe('отладка', () => {
  it('лимит повторов переопределяется и возвращается к конфигу', () => {
    const run = { retriesUsed: 2 };
    setSeriesRetries(5);
    expect(seriesRetries()).toBe(5);
    expect(retriesLeft(run)).toBe(3);
    setSeriesRetries(0);
    expect(retriesLeft(run)).toBe(0);
    setSeriesRetries(null);
    expect(seriesRetries()).toBe(SERIES_RETRIES);
  });

  it('полное лечение активного бойца: кубы целы, таймер сброшен; целого не лечит', () => {
    const { s, uid } = ready();
    const hurt = lobbyRegen({ ...s, characters: s.characters.map((c) => ({ ...c, brokenBlocks: [0, 3, 5] })) }, 1000);
    expect(activeCharacter(hurt)?.uid).toBe(uid);
    const healed = healFull(hurt, uid)!;
    expect(healed.characters[0].brokenBlocks).toEqual([]);
    expect(healed.characters[0].lobbySince).toBeUndefined();
    expect(healFull(healed, uid)).toBeNull();
  });
});
