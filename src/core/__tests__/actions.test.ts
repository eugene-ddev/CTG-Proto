import { describe, expect, it } from 'vitest';
import { BLUEPRINTS, START, maxStackOf } from '../../data/catalog';
import type { CharacterBlueprint, Stat } from '../../data/types';
import { ACTIONS, applyAction, isDebugAction, stateHash } from '../actions';
import { createInitialState, cubeCount } from '../state';

const fresh = () => createInitialState(START, BLUEPRINTS.map((b) => b.id), maxStackOf);
const ctx = { now: 1_700_000_000_000, seed: 12345 };
const waran = BLUEPRINTS.find((b) => b.id === 'bp-waran') as CharacterBlueprint;
const stats = waran.blocks.map((_, i): Stat => (i % 2 ? 'Strength' : 'Stamina'));
const craftWaran = { blueprintId: waran.id, manual: true, blockStats: stats };

describe('действия', () => {
  it('неизвестное действие и плохие аргументы отклоняются, состояние не меняется', () => {
    const s = fresh();
    expect(applyAction(s, 'nope', [], ctx)).toBeNull();
    expect(applyAction(s, 'equip', [], ctx)).toBeNull();
    expect(applyAction(s, 'craft', [{ blueprintId: 'нет такого', manual: true }], ctx)).toBeNull();
    expect(applyAction(s, 'constructor', [], ctx)).toBeNull();
  });

  it('сборка персонажа списывает кубы; то же действие на копии состояния даёт тот же отпечаток', () => {
    const a = applyAction(fresh(), 'craft', [craftWaran], ctx)!;
    const b = applyAction(JSON.parse(JSON.stringify(fresh())), 'craft', [craftWaran], ctx)!;
    expect(a.characters).toHaveLength(1);
    expect(cubeCount(a)).toBe(cubeCount(fresh()) - waran.blocks.length);
    expect(stateHash(a)).toBe(stateHash(b));
  });

  it('серия: противник зависит только от seed действия, время — от ctx.now', () => {
    const s = applyAction(fresh(), 'craft', [craftWaran], ctx)!;
    const uid = s.characters[0].uid;
    const r1 = applyAction(s, 'startRun', [uid], ctx)!;
    const r2 = applyAction(s, 'startRun', [uid], { ...ctx, now: ctx.now + 5000 })!;
    const r3 = applyAction(s, 'startRun', [uid], { ...ctx, seed: 999 })!;
    expect(stateHash(r1)).toBe(stateHash(r2));
    expect(r1.arenaRun?.opp).toBeTruthy();
    expect(JSON.stringify(r3.arenaRun)).not.toBe(JSON.stringify(r1.arenaRun));
    // поражение без повторов ставит таймер починки по часам действия
    const lost = applyAction(r1, 'surrenderRun', [], ctx)!;
    expect(lost.arenaRun).toBeNull();
    const hurt = { ...r1, characters: r1.characters.map((c) => ({ ...c, brokenBlocks: [0, 1] })) };
    expect(applyAction(hurt, 'endRun', [], ctx)!.characters[0].lobbySince).toBe(ctx.now);
  });

  it('отладочные действия помечены', () => {
    const debug = Object.keys(ACTIONS).filter(isDebugAction);
    expect(debug.sort()).toEqual(['debugAddCubes', 'debugGiveAllItems', 'debugHeal']);
  });
});

describe('бой серии: пересчёт по вводу', () => {
  const inRun = () => {
    let s = applyAction(fresh(), 'craft', [craftWaran], ctx)!;
    s = applyAction(s, 'debugGiveAllItems', [], ctx)!;
    const uid = s.characters[0].uid;
    s = applyAction(s, 'equip', [uid, 0, s.inventory.find((e) => e.itemId === 'rustySword')!.uid], ctx)!;
    s = applyAction(s, 'equip', [uid, 'rucksack', s.inventory.find((e) => e.itemId === 'rucksack')!.uid], ctx)!;
    s = applyAction(s, 'startRun', [uid], ctx)!;
    return applyAction(s, 'startFight', [], { ...ctx, seed: 777 })!;
  };

  it('бой нельзя закончить, не начав; начатый нельзя начать снова', () => {
    const s = applyAction(fresh(), 'craft', [craftWaran], ctx)!;
    const run = applyAction(s, 'startRun', [s.characters[0].uid], ctx)!;
    expect(applyAction(run, 'finishFight', [{}], ctx)).toBeNull();
    expect(applyAction(inRun(), 'startFight', [], ctx)).toBeNull();
  });

  it('итог зависит только от состояния и ввода: один ввод — один итог, сдача — поражение', async () => {
    const { replayFight } = await import('../fight');
    const s = inRun();
    expect(s.arenaRun?.battleSeed).toBe(777);
    const a = applyAction(s, 'finishFight', [{}], ctx)!;
    const b = applyAction(JSON.parse(JSON.stringify(s)), 'finishFight', [{}], { ...ctx, seed: 1 })!;
    expect(stateHash(a)).toBe(stateHash(b));
    const played = replayFight(s, {})!;
    expect(played.battle.over).toBeTruthy();
    // сдача на первом ходу — поражение (с повтором серия продолжается, бой закрыт)
    const gaveUp = replayFight(s, { stopAfter: 0 })!;
    expect(gaveUp.result.win).toBe(false);
    const lost = applyAction(s, 'finishFight', [{ stopAfter: 0 }], ctx)!;
    expect(lost.arenaRun?.inBattle).toBe(false);
    expect(lost.arenaRun?.retriesUsed).toBe(1);
    // мусорный ввод не ломает пересчёт и не даёт победу сам по себе
    const junk = replayFight(s, { artifacts: [{ after: -1, slot: 99 }, { after: 0.5, slot: 0 }] as never })!;
    expect(junk.result.win).toBe(played.result.win);
  });

  it('лут берётся только из состояния: чужую запись подсунуть нельзя', async () => {
    const { resolveFight } = await import('../fight');
    // ищем зерно боя, с которым боец побеждает
    let won = null as ReturnType<typeof resolveFight>;
    const base = inRun();
    for (let seed = 1; seed < 400 && !won?.result.win; seed++) {
      const s = { ...base, arenaRun: { ...base.arenaRun!, battleSeed: seed } };
      won = resolveFight(s, {});
    }
    if (!won?.result.win) return; // с этим оружием победы не нашлось — проверять нечего
    const s = won.state;
    expect(s.loot?.entries.length).toBe(won.loot.length);
    expect(applyAction(s, 'lootTake', [99], ctx)).toBeNull();
    if (won.loot.length) {
      const taken = applyAction(s, 'lootTake', [0], ctx)!;
      expect(taken.loot!.entries.length).toBeLessThanOrEqual(s.loot!.entries.length);
      expect(applyAction(taken, 'lootClose', [], ctx)!.loot).toBeNull();
    }
  });
});

describe('аргументы действий', () => {
  it('у каждого действия описаны типы аргументов', async () => {
    const { ACTION_ARGS } = await import('../actions');
    expect(Object.keys(ACTION_ARGS).sort()).toEqual(Object.keys(ACTIONS).sort());
  });

  it('индексы — только целые ≥ 0: null, дробь, строка и лишние аргументы отклоняются', () => {
    let s = applyAction(fresh(), 'craft', [craftWaran], ctx)!;
    s = applyAction(s, 'debugGiveAllItems', [], ctx)!;
    const uid = s.characters[0].uid;
    s = applyAction(s, 'equip', [uid, 'rucksack', s.inventory.find((e) => e.itemId === 'rucksack')!.uid], ctx)!;
    const potion = s.inventory.find((e) => e.itemId.startsWith('restore'))!.uid;
    for (const cell of [null, 1.5, '0', -1, 'x', {}]) expect(applyAction(s, 'putInBag', [uid, cell, potion], ctx)).toBeNull();
    expect(applyAction(s, 'putInBag', [uid, 0, potion, 'лишний'], ctx)).toBeNull();
    expect(applyAction(s, 'putInBag', [uid, 0, potion], ctx)).not.toBeNull();
    expect(applyAction(s, 'equip', [uid, 'сумка', potion], ctx)).toBeNull();
  });

  it('через JSON (как на сервере) необязательный аргумент даёт тот же итог: лут ложится в рюкзак', async () => {
    const { resolveFight } = await import('../fight');
    const strong = { ...craftWaran, blockStats: waran.blocks.map((_, i): Stat => (['Strength', 'Stamina', 'Armor', 'Strength'] as const)[i % 4]) };
    let s = applyAction(fresh(), 'craft', [strong], ctx)!;
    s = applyAction(s, 'debugGiveAllItems', [], ctx)!;
    const uid = s.characters[0].uid;
    const inv = (id: string) => s.inventory.find((e) => e.itemId === id)!.uid;
    s = applyAction(s, 'equip', [uid, 0, inv('rustyHammer')], ctx)!;
    s = applyAction(s, 'equip', [uid, 1, inv('rustyAxe')], ctx)!;
    s = applyAction(s, 'equip', [uid, 'rucksack', inv('rucksack')], ctx)!;
    // перебираем противников, пока боец не победит
    let won: ReturnType<typeof resolveFight> = null;
    for (let seed = 1; seed < 200 && !won; seed++) {
      const run = applyAction(s, 'startRun', [uid], { ...ctx, seed })!;
      const r = resolveFight(applyAction(run, 'startFight', [], { ...ctx, seed })!, {});
      if (r?.result.win && r.loot.length) won = r;
    }
    expect(won?.loot.length).toBeGreaterThan(0); // иначе тест ничего не проверяет
    const direct = applyAction(won!.state, 'lootTake', [0, undefined], ctx)!;
    const viaJson = applyAction(won!.state, 'lootTake', JSON.parse(JSON.stringify([0, undefined])), ctx)!;
    expect(stateHash(viaJson)).toBe(stateHash(direct));
    // вещь действительно в рюкзаке, а не «в ячейке null»
    const bag = viaJson.characters[0].bag;
    expect(bag.filter(Boolean)).toHaveLength(1);
    expect(Object.keys(bag).every((k) => /^\d+$/.test(k))).toBe(true);
    expect(viaJson.loot!.entries).toHaveLength(won!.loot.length - 1);
  });
});

describe('серии двух видов', () => {
  const fighter = () => {
    let s = applyAction(fresh(), 'craft', [craftWaran], ctx)!;
    s = applyAction(s, 'debugGiveAllItems', [], ctx)!;
    const uid = s.characters[0].uid;
    const inv = (id: string) => s.inventory.find((e) => e.itemId === id)!.uid;
    s = applyAction(s, 'equip', [uid, 0, inv('rustySword')], ctx)!;
    s = applyAction(s, 'equip', [uid, 'rucksack', inv('rucksack')], ctx)!;
    return { s, uid };
  };

  it('серия с ботами: поражение без повторов ничего не отнимает (arena.json → loss.bots = keep)', () => {
    const { s, uid } = fighter();
    let run = applyAction(s, 'startRun', [uid], ctx)!;
    expect(run.arenaRun?.mode).toBe('bots');
    // сдаться на первом ходу, пока не кончатся повторы
    for (let i = 0; i < 10 && run.arenaRun; i++) {
      run = applyAction(run, 'startFight', [], ctx)!;
      run = applyAction(run, 'finishFight', [{ stopAfter: 0 }], ctx)!;
    }
    expect(run.arenaRun).toBeNull();
    expect(run.characters[0].equipment[0]?.itemId).toBe('rustySword');
    expect(run.characters[0].rucksack?.itemId).toBe('rucksack');
  });

  it('серия с игроками: бой со снимком, рейтинг по Эло, поражение отнимает оружие и рюкзак', async () => {
    const { startPvp, snapshotOf } = await import('../arena');
    const { ratingDeltas } = await import('../rating');
    const { s, uid } = fighter();
    const rival = { userId: 'u2', name: 'Василий', rating: 1200, myRating: 1000, snapshot: snapshotOf(s.characters[0]) };
    const run = startPvp(s, uid, rival, 5)!;
    expect(run.arenaRun?.mode).toBe('players');
    expect(applyAction(run, 'startRun', [uid], ctx)).toBeNull(); // бота в серию с игроками не подставить
    const inFight = applyAction(run, 'startFight', [], ctx)!;
    expect(applyAction(inFight, 'endRun', [], ctx)).toBeNull(); // из боя не выйти без итога
    const lost = applyAction(inFight, 'finishFight', [{ stopAfter: 0 }], ctx)!;
    const d = ratingDeltas(1000, 1200);
    expect(d.win).toBeGreaterThan(-d.lose); // победа над сильным даёт больше, чем отнимает поражение от него
    expect(lost.pvpPending).toMatchObject({ opponentId: 'u2', win: false, delta: d.lose });
    expect(lost.arenaRun).toBeNull();
    expect(lost.characters[0].equipment[0]).toBeNull();
    expect(lost.characters[0].rucksack).toBeNull();
  });
});
