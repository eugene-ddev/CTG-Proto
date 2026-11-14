import { describe, expect, it } from 'vitest';
import { COMBAT, getItem } from '../../data/catalog';
import { STATS, type EquipmentItem, type Stat } from '../../data/types';
import {
  BLOCK_DURABILITY, CRIT_MULTIPLIER, DEFAULT_TARGET, FIST, perkOf, MAX_TURNS, applyEffect, createBattle, createFighter, normalizeTarget, runToEnd, step, digGoal, digPreview,
  digTarget, useArtifact, canUseArtifact, cubesToDisable, critOf, damageBlock, dodgeOf, slotDamageValue, staminaRegenOf, STAMINA_REGEN, THRESHOLDS, type FighterInput, type BattleState, type Fighter,
} from '../battle';
import { OPPONENT_PRESETS, generateOpponent, opponentFromPreset } from '../opponent';
import { createRng } from '../rng';
import { damageCondition } from '../character';

const stats38: Stat[] = [...Array(13).fill('Strength'), ...Array(13).fill('Dexterity'), ...Array(12).fill('Stamina')];
const item = (id: string) => getItem(id) as EquipmentItem;
const me = (equipment: Array<EquipmentItem | null> = [item('rustyAxe'), item('rustySword'), null, null, null]): FighterInput => ({
  name: 'Я', blueprintId: 'bp-lobster', blockStats: stats38, equipment,
});

describe('rng', () => {
  it('один seed — одна последовательность', () => {
    const a = createRng(42), b = createRng(42);
    expect([a.next(), a.next(), a.int(1, 6)]).toEqual([b.next(), b.next(), b.int(1, 6)]);
  });
});

describe('бой', () => {
  it('один seed — один исход и тот же лог', () => {
    const opp = generateOpponent(7);
    const a = runToEnd(createBattle(123, me(), opp));
    const b = runToEnd(createBattle(123, me(), opp));
    expect(a.over).toEqual(b.over);
    expect(a.log).toEqual(b.log);
    expect(a.turn).toBeLessThanOrEqual(MAX_TURNS);
  });
  it('первым ходит игрок, дальше по очереди', () => {
    const b = createBattle(1, me(), generateOpponent(1));
    expect(step(b)[0]).toEqual({ t: 'turn', turn: 1, side: 'player' });
    expect(step(b)[0]).toEqual({ t: 'turn', turn: 2, side: 'enemy' });
  });
  it('разбитый куб снимает 1 очко своей статы', () => {
    const b = createBattle(1, me(), generateOpponent(1));
    const p = b.player;
    const str = p.stats.Strength;
    const k = p.blocks.findIndex((x) => x.stat === 'Strength');
    applyEffect(b, p, 'poison', k);
    p.blocks[k].hp = 1;
    // тик яда на ходу игрока
    step(b);
    expect(p.blocks[k].alive).toBe(false);
    expect(p.stats.Strength).toBeCloseTo(str - 1);
  });
  it('пустые руки бьют кулаком, у бойца без снаряжения есть шанс', () => {
    const b = createBattle(9, me([null, null, null, null, null]), generateOpponent(3));
    step(b);
    const atk = b.log.find((e) => e.t === 'attack');
    expect(atk && atk.t === 'attack' && atk.weapon).toBe('Кулак');
  });
  it('щит: физический урон 0, владелец не атакует; истекает на его ходу', () => {
    const shieldArt = item('magicShieldArtifact');
    // артефакту нужны кубы Интеллекта: без них Интеллект отключён с начала боя
    const withInt: Stat[] = [...stats38.slice(0, 34), ...Array(4).fill('Intelligence')];
    const b = createBattle(3, { ...me([item('rustyAxe'), null, shieldArt, null, null]), blockStats: withInt }, generateOpponent(2));
    b.player.maxMana = b.player.mana = 50;
    step(b); // ход игрока
    expect(useArtifact(b, 'player', 2)).toBe(true);
    expect(useArtifact(b, 'player', 2)).toBe(false); // кулдаун
    const before = b.player.blocks.map((x) => x.hp).join();
    const ev = step(b); // ход противника — бьёт в щит
    expect(ev.some((e) => e.t === 'attack' && e.outcome === 'shield') || ev.some((e) => e.t === 'skip')).toBe(true);
    expect(b.player.blocks.map((x) => x.hp).join()).toBe(before);
    step(b); // ход игрока — щит истёк в начале хода, атака проходит
    expect(b.player.effects.some((e) => e.id === 'shield')).toBe(false);
  });
  it('горение тикает, расползается и гаснет вместе с блоком', () => {
    const b = createBattle(11, me(), generateOpponent(1));
    const f = b.player;
    applyEffect(b, f, 'burn', 20);
    applyEffect(b, f, 'burn', 20); // повтор — обновление, без дубля
    expect(f.effects.filter((e) => e.id === 'burn' && e.block === 20)).toHaveLength(1);
    step(b);
    expect(b.log.some((e) => e.t === 'damage' && e.source === 'burn')).toBe(true);
  });
  it('горение перекидывается не больше чем на один куб за тик и только на соседний через грань', () => {
    let spreads = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const b = createBattle(seed, me(), generateOpponent(1));
      const f = b.player;
      const from = 20;
      applyEffect(b, f, 'burn', from);
      const ev = step(b); // ход игрока: тик его горения
      const lit = ev.filter((e) => e.t === 'effect' && e.side === 'player' && e.effect === 'burn' && !e.refreshed);
      expect(lit.length).toBeLessThanOrEqual(1);
      for (const e of lit) {
        if (e.t !== 'effect' || e.block === null) continue;
        const p = f.blocks[from].pos;
        const q = f.blocks[e.block].pos;
        expect(Math.abs(p[0] - q[0]) + Math.abs(p[1] - q[1]) + Math.abs(p[2] - q[2])).toBeCloseTo(1, 6);
        spreads++;
      }
    }
    expect(spreads).toBeGreaterThan(0);
    expect(spreads).toBeLessThan(40);
  });
  it('противники — пресеты Sandbox: кубы подряд по статам, оружие и камни, свой порядок атаки', () => {
    const o = opponentFromPreset(OPPONENT_PRESETS[1]);
    expect(o.blueprintId).toBe('bp-waran');
    expect(o.blockStats.slice(0, 10).every((s) => s === 'Dexterity')).toBe(true);
    expect(o.blockStats.filter((s) => s === 'Luck')).toHaveLength(7);
    expect(o.equipment[0]?.ability.effects).toContain('burn');
    expect(o.target![0]).toBe('Armor');
    const lob = opponentFromPreset(OPPONENT_PRESETS[0]);
    expect(lob.equipment[0]).toMatchObject({ id: 'rustyDagger', itemLevel: 3 }) // пресет 10 → потолок 3;
    expect(generateOpponent(5, { except: 'bp-waran/Dexterity' }).presetId).not.toBe('bp-waran/Dexterity');
    expect(generateOpponent(5)).toEqual(generateOpponent(5));
  });
  it('бой всегда заканчивается: смерть или лимит ходов', () => {
    for (let s = 0; s < 30; s++) {
      const b = runToEnd(createBattle(s, me(), generateOpponent(s)));
      expect(b.over).not.toBeNull();
      if (b.over!.reason === 'death') expect(Math.min(b.player.aliveBlocks, b.enemy.aliveBlocks)).toBe(0);
    }
  });
});

describe('пороги стат', () => {
  /** Разбить куб ровно его прочностью — без переноса остатка. */
  const smash = (b: BattleState, f: Fighter, stat: Stat, n: number) => {
    for (let k = 0; k < n; k++) {
      const blk = f.blocks.find((x) => x.alive && x.stat === stat)!;
      damageBlock(b, f, blk.index, blk.hp, 'attack');
    }
  };
  const disables = (b: BattleState) => b.log.filter((e) => e.t === 'disable');

  it('больше половины кубов статы разбито — стата отключается, событие одно', () => {
    const b = createBattle(1, me(), generateOpponent(1));
    const p = b.player; // Ловкости 13 кубов → порог 7
    expect(cubesToDisable(p, 'Dexterity')).toBe(7);
    expect(cubesToDisable(p, 'Luck')).toBeNull(); // кубов нет
    expect(cubesToDisable(p, 'Armor')).toBeNull(); // у брони порога нет
    // стат без кубов (Интеллект, Удача) отключены с начала боя
    expect(p.disabled).toEqual(['Intelligence', 'Luck']);
    smash(b, p, 'Dexterity', 6);
    expect(p.disabled).toEqual(['Intelligence', 'Luck']);
    expect(cubesToDisable(p, 'Dexterity')).toBe(1);
    smash(b, p, 'Dexterity', 2);
    expect(p.disabled).toEqual(['Intelligence', 'Luck', 'Dexterity']);
    expect(disables(b)).toEqual([{ t: 'disable', side: 'player', stat: 'Dexterity' }]);
    expect(dodgeOf(p)).toBe(0);
    // событие сразу после разбитого куба, который перешёл порог
    const k = b.log.findIndex((e) => e.t === 'disable');
    expect(b.log[k - 1]).toMatchObject({ t: 'break', stat: 'Dexterity' });
  });

  it('разбитые до боя кубы считаются: стата отключена с первого хода', () => {
    const dex = stats38.map((s, i) => (s === 'Dexterity' ? i : -1)).filter((i) => i >= 0).slice(0, 7);
    const f = createFighter('player', { ...me(), brokenBlocks: dex });
    expect(f.disabled).toEqual(['Dexterity', 'Intelligence', 'Luck']);
    expect(cubesToDisable(f, 'Dexterity')).toBe(0);
  });

  it('Выносливость: порога нет (этап 4); разбитые кубы снижают максимум, а с ним и реген (0.0.70)', () => {
    const b = createBattle(1, me(), generateOpponent(1));
    const max0 = b.player.maxStamina;
    expect(cubesToDisable(b.player, 'Stamina')).toBeNull();
    smash(b, b.player, 'Stamina', 7);
    expect(b.player.disabled).not.toContain('Stamina');
    expect(b.player.maxStamina).toBeCloseTo(max0 - 7);
    expect(staminaRegenOf(b.player)).toBeCloseTo(STAMINA_REGEN + COMBAT.stamina.regenShare * (max0 - 7));
  });

  it('Сила: силовое оружие бьёт ×0.6 поверх штрафа за потерянные очки', () => {
    const b = createBattle(1, me(), generateOpponent(1));
    const p = b.player;
    const axe = p.slots[0]; // топор — Сила
    const before = slotDamageValue(p, axe);
    const str0 = p.stats.Strength;
    smash(b, p, 'Strength', 7);
    expect(p.disabled).toContain('Strength');
    expect(slotDamageValue(p, axe) / before).toBeCloseTo(damageCondition(str0, p.stats.Strength) * THRESHOLDS.strengthWeaponMultiplier, 5);
  });

  it('Интеллект: артефакты не работают', () => {
    const blockStats: Stat[] = [...Array(4).fill('Intelligence'), ...stats38.slice(4)];
    const shield = item('magicShieldArtifact');
    const b = createBattle(1, { ...me([null, null, shield, null, null]), blockStats }, generateOpponent(1));
    const k = b.player.slots.findIndex((s) => s.item?.id === 'magicShieldArtifact');
    b.player.mana = 99;
    expect(canUseArtifact(b, 'player', k)).toBe(true);
    smash(b, b.player, 'Intelligence', 3);
    expect(b.player.disabled).toContain('Intelligence');
    expect(canUseArtifact(b, 'player', k)).toBe(false);
  });
});

describe('раскопка', () => {
  /** Перед кубом i в его столбике есть живой куб? */
  const covered = (f: Fighter, i: number) => {
    const col = f.columns.find((c) => c.includes(i))!;
    return col.slice(0, col.indexOf(i)).some((j) => f.blocks[j].alive);
  };
  /** Сколько живых кубов закрывает ближайший куб статы stat в лучшем столбике. */
  const bestCost = (f: Fighter, stat: Stat) =>
    Math.min(...f.columns.map((col) => {
      const alive = col.filter((j) => f.blocks[j].alive);
      const k = alive.findIndex((j) => f.blocks[j].stat === stat);
      return k < 0 ? Infinity : k;
    }));

  it(`прочность куба — ${BLOCK_DURABILITY} (combat.json)`, () => {
    const b = createBattle(1, me(), generateOpponent(1));
    expect(b.enemy.blocks.every((x) => x.hp === BLOCK_DURABILITY)).toBe(true);
  });

  it('бьём только передний живой куб столбика, и по самому короткому пути к главной цели', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const e = createFighter('enemy', generateOpponent(seed));
      const order = normalizeTarget(createRng(seed).shuffle(STATS));
      let alive = e.blocks.filter((x) => x.alive).length;
      while (alive > 0) {
        const goal = digGoal(order, e)!;
        const i = digTarget(order, e)!;
        expect(covered(e, i)).toBe(false);
        // столбик выбранного куба ведёт к главной цели не длиннее любого другого
        const col = e.columns.find((c) => c.includes(i))!.filter((j) => e.blocks[j].alive);
        expect(col.findIndex((j) => e.blocks[j].stat === goal)).toBe(bestCost(e, goal));
        e.blocks[i].alive = false;
        alive--;
      }
    }
  });

  it('главная цель открыта — бьём её сразу; цели нет — следующая стата приоритета', () => {
    const e = createFighter('enemy', me());
    const front = e.columns.map((c) => c[0]);
    const stat = e.blocks[front[0]].stat;
    expect(e.blocks[digTarget([stat, ...STATS.filter((x) => x !== stat)], e)!].stat).toBe(stat);
    const p = createFighter('player', { ...me(), target: ['Luck', 'Stamina'] });
    expect(digGoal(p.target, e)).toBe('Stamina'); // удачи у цели нет
    expect(normalizeTarget(['Luck', 'Luck'])).toEqual(['Luck', ...DEFAULT_TARGET.filter((s) => s !== 'Luck')]);
  });

  it('предпросмотр: тот же порядок, что дадут удары, если каждый ломает куб', () => {
    const e = createFighter('enemy', generateOpponent(3));
    const order = normalizeTarget(['Stamina', 'Luck']);
    const preview = digPreview(order, e, 5);
    expect(new Set(preview).size).toBe(5);
    for (const i of preview) {
      expect(digTarget(order, e)).toBe(i);
      e.blocks[i].alive = false;
    }
  });

  it('carry (кулак, оружие без схемы): остаток уходит в следующий куб раскопки', () => {
    const big = { ...item('rustyHammer'), pattern: undefined, itemLevel: 1, ability: { ...item('rustyHammer').ability, damage: 500 } };
    const b = createBattle(5, me([big, null, null, null, null]), generateOpponent(1));
    b.player.disabled.push('Luck'); // без крита
    b.enemy.disabled.push('Dexterity'); // без уворота
    b.enemy.stats.Armor = 0;
    const preview = digPreview(b.player.target, b.enemy, 40);
    step(b);
    const hits = b.log.filter((e) => e.t === 'damage' && e.side === 'enemy' && e.source === 'attack');
    expect(hits.length).toBeGreaterThan(1); // удар ~670 больше прочности куба — минимум один перенос
    expect(hits[0]).toMatchObject({ block: preview[0], spread: false });
    // переносы идут ровно по порядку раскопки
    hits.forEach((e, k) => expect(e.t === 'damage' && e.block).toBe(preview[k]));
    expect(hits.slice(1).every((e) => e.t === 'damage' && e.spread)).toBe(true);
  });
});

describe('схемы ударов', () => {
  /** Бой: у игрока одно оружие с уроном damage; без крита, уворота и брони у цели. */
  const setup = (id: string, damage: number, seed = 5) => {
    const w = { ...item(id), itemLevel: 1, ability: { ...item(id).ability, damage, staminaCost: 0 } };
    const b = createBattle(seed, me([w, null, null, null, null]), generateOpponent(seed));
    b.player.disabled.push('Luck');
    b.enemy.disabled.push('Dexterity');
    b.enemy.stats.Armor = 0;
    return b;
  };
  const hitsOf = (b: BattleState) => b.log.filter((e): e is Extract<typeof e, { t: 'damage' }> => e.t === 'damage' && e.side === 'enemy' && e.source === 'attack');
  const xy = (f: Fighter, i: number) => [Math.round(f.blocks[i].pos[0]), Math.round(f.blocks[i].pos[1])];

  it('precise: остаток — цепочкой вглубь своего столбика, без ограничения дальности (0.0.73)', () => {
    const z = (f: Fighter, i: number) => Math.round(f.blocks[i].pos[2]);
    const small = setup('rustyKnife', 40);
    step(small);
    expect(hitsOf(small)).toHaveLength(1); // меньше прочности — переноса нет
    const b = setup('rustyKnife', 450);
    step(b);
    const h = hitsOf(b);
    expect(h.length).toBeGreaterThan(1);
    expect(h[0].spread).toBe(false);
    // все переносы — в том же столбике, каждый следующий глубже предыдущего
    for (let k = 1; k < h.length; k++) {
      expect(b.enemy.colOf[h[k].block]).toBe(b.enemy.colOf[h[0].block]);
      expect(z(b.enemy, h[k].block)).toBeLessThan(z(b.enemy, h[k - 1].block));
    }
  });

  it('precise: половина брони не действует', () => {
    const b = setup('rustyKnife', 8);
    b.enemy.stats.Armor = 50; // поглощение 50 / (50 + 50) = 50%
    step(b);
    const atk = b.log.find((e) => e.t === 'attack' && e.side === 'player');
    expect(atk && atk.t === 'attack' && atk.absorbed / (atk.damage + atk.absorbed)).toBeCloseTo(0.25, 5);
  });

  const zAt = (f: Fighter, i: number) => Math.round(f.blocks[i].pos[2]);

  it('pierce: остаток идёт вглубь того же столбика, не дальше depth клеток', () => {
    const b = setup('rustySpear', 200);
    step(b);
    const h = hitsOf(b);
    const col = b.enemy.colOf[h[0].block];
    expect(h.slice(1).every((e) => b.enemy.colOf[e.block] === col)).toBe(true);
    expect(h.slice(1).every((e) => zAt(b.enemy, h[0].block) - zAt(b.enemy, e.block) <= 2)).toBe(true);
  });

  it('pierce: через пустоту дальше depth клеток не достаёт, внутри дальности — проходит насквозь', () => {
    // столбик из 4+ кубов подряд; остальные кубы цели разбиты — цель только в нём
    const probe = setup('rustySpear', 200);
    const col = probe.enemy.columns.find((c) => c.length >= 4 && c.slice(0, 4).every((j, k) => k === 0 || zAt(probe.enemy, c[k - 1]) - zAt(probe.enemy, j) === 1))!;
    expect(col).toBeDefined();
    const run = (dead: number[]) => {
      const b = setup('rustySpear', 200);
      b.enemy.blocks.forEach((x) => (x.alive = col.includes(x.index) && !dead.includes(x.index)));
      b.enemy.aliveBlocks = b.enemy.blocks.filter((x) => x.alive).length;
      step(b);
      return hitsOf(b).map((e) => e.block);
    };
    expect(run([col[1], col[2]])).toEqual([col[0]]); // за целью 2 пустые клетки, следующий куб в 3 — не достаёт
    expect(run([col[1]])).toEqual([col[0], col[2]]); // пустая клетка внутри дальности — насквозь
  });

  it('cleave: остаток делится между передними кубами соседних столбиков по ряду', () => {
    const b = setup('rustySword', 200);
    step(b);
    const h = hitsOf(b);
    const [x, y] = xy(b.enemy, h[0].block);
    for (const e of h.slice(1)) {
      const [ex, ey] = xy(b.enemy, e.block);
      expect(ey).toBe(y);
      expect(Math.abs(ex - x)).toBe(1);
      expect(Math.abs(zAt(b.enemy, e.block) - zAt(b.enemy, h[0].block))).toBeLessThanOrEqual(1); // вплотную
    }
    expect(h.length - 1).toBeLessThanOrEqual(2);
  });

  it('crush: крест на передней грани и куб за целью — до 5 кубов', () => {
    const b = setup('rustyHammer', 400);
    step(b);
    const h = hitsOf(b);
    expect(h.length).toBeGreaterThan(1);
    expect(h.length - 1).toBeLessThanOrEqual(5);
    // все цели — вплотную к первой: соседний столбик по кресту с |Δz| ≤ 1 или клетка прямо позади
    const [x, y] = xy(b.enemy, h[0].block);
    const z0 = zAt(b.enemy, h[0].block);
    for (const e of h.slice(1)) {
      const [ex, ey] = xy(b.enemy, e.block);
      const dz = zAt(b.enemy, e.block) - z0;
      const behind = ex === x && ey === y && dz === -1;
      const side = Math.abs(ex - x) + Math.abs(ey - y) === 1 && Math.abs(dz) <= 1;
      expect(behind || side).toBe(true);
    }
  });

  it('кинжал: 2 удара за ход, стамина и кулдаун — один раз', () => {
    const d = item('rustyDagger');
    expect(d.ability.hits).toBe(2);
    const b = createBattle(3, me([d, null, null, null, null]), generateOpponent(3));
    const st = b.player.stamina;
    step(b);
    const atk = b.log.filter((e) => e.t === 'attack' && e.side === 'player');
    expect(atk).toHaveLength(2);
    expect(b.player.stamina).toBe(Math.min(b.player.maxStamina, st + staminaRegenOf(b.player)) - d.ability.staminaCost);
    expect(b.player.slots[0].cooldown).toBe(d.ability.cooldown);
  });
});

describe('две руки (0.0.54)', () => {
  it('обе готовые руки бьют за ход, стамина — за каждую; кулдауны свои', () => {
    const axe = item('rustyAxe'), sword = item('rustySword');
    const b = createBattle(4, me([axe, sword, null, null, null]), generateOpponent(4));
    const st = b.player.stamina;
    step(b);
    const slots = new Set(b.log.filter((e) => e.t === 'attack' && e.side === 'player').map((e) => (e as { slot: number }).slot));
    expect([...slots].sort()).toEqual([0, 1]);
    expect(b.player.stamina).toBe(Math.min(b.player.maxStamina, st + staminaRegenOf(b.player)) - axe.ability.staminaCost - sword.ability.staminaCost);
    expect(b.player.slots[0].cooldown).toBe(axe.ability.cooldown);
    expect(b.player.slots[1].cooldown).toBe(sword.ability.cooldown);
  });

  it('на вторую руку не хватает стамины — бьёт только первая', () => {
    const axe = item('rustyAxe'), sword = item('rustySword');
    const b = createBattle(4, me([axe, sword, null, null, null]), generateOpponent(4));
    // бюджет на ход — ровно на топор (реген = регенBase + доля × максимум, не больше максимума)
    b.player.maxStamina = axe.ability.staminaCost;
    b.player.stamina = 0;
    step(b);
    const slots = b.log.filter((e) => e.t === 'attack' && e.side === 'player').map((e) => (e as { slot: number }).slot);
    expect(new Set(slots)).toEqual(new Set([0]));
  });

  it('кулак — только без оружия и одной рукой; с оружием пустая рука не бьёт', () => {
    const bare = createBattle(4, me([null, null, null, null, null]), generateOpponent(4));
    expect(bare.player.slots.filter((x) => x.ability === FIST)).toHaveLength(1);
    const one = createBattle(4, me([item('rustyAxe'), null, null, null, null]), generateOpponent(4));
    expect(one.player.slots.some((x) => x.ability === FIST)).toBe(false);
  });
});


describe('свойства уровня оружия (этап 8)', () => {
  const setup = (id: string, damage: number, level: number, seed = 5) => {
    const w = { ...item(id), itemLevel: level, ability: { ...item(id).ability, damage, staminaCost: 0, hits: 1 } };
    const b = createBattle(seed, me([w, null, null, null, null]), generateOpponent(seed));
    b.player.disabled.push('Luck');
    b.enemy.disabled.push('Dexterity');
    b.enemy.stats.Armor = 0;
    return b;
  };
  const hitsOf = (b: BattleState) => b.log.filter((e): e is Extract<typeof e, { t: 'damage' }> => e.t === 'damage' && e.side === 'enemy' && e.source === 'attack');
  const xyz = (f: Fighter, i: number) => f.blocks[i].pos.map((v) => Math.round(v));
  const atkOf = (b: BattleState) => b.log.find((e): e is Extract<typeof e, { t: 'attack' }> => e.t === 'attack' && e.side === 'player')!;

  it('ур. 1 — без свойств; ур. 2–3 — из combat.json; выше 3 считается как 3', () => {
    expect(perkOf({ id: 'rustyDagger', itemLevel: 1 })).toEqual({});
    expect(perkOf({ id: 'rustyDagger', itemLevel: 2 })).toEqual({ armorIgnore: 1, hits: 3, damageMultiplier: 0.67 });
    expect(perkOf({ id: 'rustyDagger', itemLevel: 3 })).toEqual({ armorIgnore: 1, critMultiplier: 3, hits: 3, damageMultiplier: 0.7 });
    expect(perkOf({ id: 'rustyDagger', itemLevel: 10 })).toEqual(perkOf({ id: 'rustyDagger', itemLevel: 3 }));
    expect(perkOf(null)).toEqual({});
  });

  it('урон от уровня не зависит', () => {
    const dmg = (level: number) => {
      const p = createBattle(1, me([{ ...item('rustySword'), itemLevel: level }, null, null, null, null]), generateOpponent(1)).player;
      return slotDamageValue(p, p.slots[0]);
    };
    expect(dmg(3)).toBe(dmg(1));
  });

  it('кинжал/нож ур. 2: броня игнорируется полностью', () => {
    for (const id of ['rustyDagger', 'rustyKnife']) {
      const b = setup(id, 8, 2);
      b.enemy.stats.Armor = 50;
      step(b);
      expect(atkOf(b).absorbed).toBe(0);
    }
  });

  it('кинжал ур. 3: крит ×3, броня не действует (0.0.73 — вместо «пробивает на 1 клетку»)', () => {
    expect(perkOf({ id: 'rustyDagger', itemLevel: 3 })).toEqual({ armorIgnore: 1, critMultiplier: 3, hits: 3, damageMultiplier: 0.7 });
  });

  it('нож ур. 3: крит ×3 вместо ×' + CRIT_MULTIPLIER, () => {
    const crit = (level: number) => {
      const b = setup('rustyKnife', 8, level);
      b.player.disabled = b.player.disabled.filter((s) => s !== 'Luck');
      b.player.bags.crit.marbles = Array(10).fill(true);
      step(b);
      const a = atkOf(b);
      expect(a.crit).toBe(true);
      return a.damage;
    };
    expect(crit(3) / crit(2)).toBeCloseTo(3 / CRIT_MULTIPLIER, 5);
  });

  it('копьё ур. 2–3: дальность пробивания 3 и 4 клетки', () => {
    for (const [level, depth] of [[2, 3], [3, 4]]) {
      const b = setup('rustySpear', 400, level);
      step(b);
      const h = hitsOf(b);
      expect(h.slice(1).every((e) => b.enemy.colOf[e.block] === b.enemy.colOf[h[0].block])).toBe(true);
      expect(h.slice(1).every((e) => xyz(b.enemy, h[0].block)[2] - xyz(b.enemy, e.block)[2] <= depth)).toBe(true);
    }
  });

  it('меч ур. 2: остаток ещё и вверх/вниз (до 4 соседей); ур. 3 — каждому целиком', () => {
    const b2 = setup('rustySword', 200, 2);
    step(b2);
    const h2 = hitsOf(b2);
    const [x, y] = xyz(b2.enemy, h2[0].block);
    expect(h2.length - 1).toBeLessThanOrEqual(4);
    for (const e of h2.slice(1)) {
      const [ex, ey] = xyz(b2.enemy, e.block);
      expect(Math.abs(ex - x) + Math.abs(ey - y)).toBe(1);
    }
    // ур. 3: соседям уходит остаток целиком — суммарно больше, чем при делении
    const total = (level: number) => {
      const b = setup('rustySword', 14, level);
      step(b);
      return hitsOf(b).slice(1).reduce((a, e) => a + e.damage, 0);
    };
    expect(total(3)).toBeGreaterThanOrEqual(total(2));
  });

  it('топор ур. 2: в обе стороны; ур. 3 — ещё и 2 клетки позади', () => {
    for (const level of [2, 3]) {
      const b = setup('rustyAxe', 400, level);
      step(b);
      const h = hitsOf(b);
      const [x, y, z] = xyz(b.enemy, h[0].block);
      expect(h.length - 1).toBeLessThanOrEqual(level === 2 ? 3 : 4);
      for (const e of h.slice(1)) {
        const [ex, ey, ez] = xyz(b.enemy, e.block);
        const behind = ex === x && ey === y && z - ez >= 1 && z - ez <= (level === 2 ? 1 : 2);
        const side = ey === y && Math.abs(ex - x) === 1;
        expect(behind || side).toBe(true);
      }
    }
  });

  it('молот ур. 2: крест + диагонали; ур. 3 — ещё и 2 позади', () => {
    for (const level of [2, 3]) {
      const b = setup('rustyHammer', 800, level);
      step(b);
      const h = hitsOf(b);
      const [x, y, z] = xyz(b.enemy, h[0].block);
      expect(h.length - 1).toBeLessThanOrEqual(level === 2 ? 9 : 10);
      for (const e of h.slice(1)) {
        const [ex, ey, ez] = xyz(b.enemy, e.block);
        const behind = ex === x && ey === y && z - ez >= 1 && z - ez <= (level === 2 ? 1 : 2);
        const ring = Math.max(Math.abs(ex - x), Math.abs(ey - y)) === 1 && Math.abs(ez - z) <= 1;
        expect(behind || ring).toBe(true);
      }
    }
  });

  it('булава ур. 2–3: оглушение — цель пропускает ровно один ход', () => {
    const b = setup('rustyClub', 5, 2);
    b.player.bags.stun.marbles = Array(10).fill(true);
    step(b);
    expect(b.log.some((e) => e.t === 'stun' && e.side === 'enemy')).toBe(true);
    const enemyTurn = step(b);
    expect(enemyTurn).toContainEqual({ t: 'skip', side: 'enemy', reason: 'stunned' });
    expect(enemyTurn.some((e) => e.t === 'attack')).toBe(false);
    expect(b.enemy.stunned).toBe(false);
    // ур. 1 — не оглушает
    const b1 = setup('rustyClub', 5, 1);
    b1.player.bags.stun.marbles = Array(10).fill(true);
    step(b1);
    expect(b1.log.some((e) => e.t === 'stun')).toBe(false);
  });
});

describe('крит и уворот требуют живых кубов', () => {
  it('без кубов Ловкости уворота нет, без кубов Силы — крита', () => {
    const b = createBattle(1, { ...me(), blockStats: Array(38).fill('Stamina') }, generateOpponent(1));
    b.player.stats.Luck = 50;
    expect(critOf(b.player)).toBe(0);
    expect(dodgeOf(b.player)).toBe(0);
  });
  it('разбит последний куб Силы — крит 0, уворот остаётся', () => {
    const withLuck: Stat[] = [...stats38.slice(0, 34), ...Array(4).fill('Luck')];
    const b = createBattle(1, { ...me(), blockStats: withLuck }, generateOpponent(1));
    const p = b.player;
    p.stats.Luck = 50;
    expect(critOf(p)).toBeGreaterThan(0);
    p.blocks.forEach((blk, index) => {
      if (blk.stat === 'Strength') damageBlock(b, p, index, blk.hp, 'attack');
    });
    expect(critOf(p)).toBe(0);
    expect(dodgeOf(p)).toBeGreaterThan(0);
  });
  it('без шанса мешок крита не тянется', () => {
    const b = createBattle(1, { ...me(), blockStats: Array(38).fill('Stamina') }, generateOpponent(1));
    b.player.bags.crit.marbles = Array(10).fill(true);
    step(b);
    expect(b.player.bags.crit.marbles.length).toBe(10);
    expect(b.log.some((e) => e.t === 'attack' && e.side === 'player' && e.crit)).toBe(false);
  });
});

describe('стата без кубов отключена с начала боя', () => {
  it('нет кубов Силы — силовое оружие бьёт со штрафом; с кубами — без', () => {
    const noStr: Stat[] = [...Array(26).fill('Dexterity'), ...Array(12).fill('Stamina')];
    const weak = createFighter('player', { ...me([item('rustyAxe'), null, null, null, null]), blockStats: noStr });
    expect(weak.disabled).toContain('Strength');
    const one: Stat[] = ['Strength', ...noStr.slice(1)];
    const armed = createFighter('player', { ...me([item('rustyAxe'), null, null, null, null]), blockStats: one });
    expect(armed.disabled).not.toContain('Strength');
    // один куб даёт +1 к стате (чуть больше урона) и снимает штраф ×strengthWeaponMultiplier
    expect(slotDamageValue(weak, weak.slots[0]) / slotDamageValue(armed, armed.slots[0])).toBeLessThan(THRESHOLDS.strengthWeaponMultiplier + 0.01);
  });
  it('нет кубов Удачи — крита нет; нет кубов Ловкости — уворота нет', () => {
    const f = createFighter('player', { ...me(), blockStats: Array(38).fill('Strength') });
    expect(f.disabled).toEqual(['Dexterity', 'Intelligence', 'Luck']);
    f.stats.Luck = 50;
    expect(critOf(f)).toBe(0);
    expect(dodgeOf(f)).toBe(0);
  });
});
