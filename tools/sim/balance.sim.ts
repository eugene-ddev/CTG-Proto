// Симулятор баланса боя (docs/battle-rework.md, этап 0). Запуск: `npm run sim`.
// Прогоняет бои на ядре прототипа и пишет отчёт в tools/sim/report.md:
// - оружие против манекена (кулак): ходы до победы, кубов за удар (с переносом остатка), доля боёв до лимита ходов;
// - матрица побед «оружие × оружие» (каждый билд — под скалирующую стату своего оружия);
// - этап 8: матрица на ур. 3 и «ур. 2/3 против ур. 1» тем же оружием;
// - матрица побед «приоритет × приоритет» в зеркале (меч против меча);
// - игрок против ботов (этап 5: боты раскладывают статы слоями, приоритет — под сборку игрока): приоритет по умолчанию
//   и лучший из «стата первой»;
// - фактические крит и уворот против заявленных (проверка марбл-бэгов);
// - в конце: итог, изменения с прошлого прогона (tools/sim/report.json) и что выбивается из коридоров баланса (BAND):
//   «явно» — за коридором дальше погрешности, «на грани» — в её пределах; по убыванию перекоса.
// Первый ход даёт преимущество, поэтому каждая пара играется поровну с обеих сторон.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { it } from 'vitest';
import { getBlueprint, getItem } from '../../src/data/catalog';
import { STAT_LABEL } from '../../src/data/labels';
import type { CharacterBlueprint, EquipmentItem, Stat } from '../../src/data/types';
import { generateOpponent } from '../../src/core/opponent';
import { BLOCK_DURABILITY, DEFAULT_TARGET, createBattle, critOf, dodgeOf, runToEnd, step as runStep, type BattleState, type FighterInput } from '../../src/core/battle';

/** Боёв на ячейку матрицы (поровну с каждой стороны). */
const N = Number(process.env.SIM_N ?? 200);
const BP = getBlueprint('bp-lobster') as CharacterBlueprint;
const WEAPONS = ['rustyDagger', 'rustySword', 'rustyAxe', 'rustyClub', 'rustyHammer'] // копьё и нож вне ротации (0.0.73);

/** Билд лобстера: m кубов главной статы (по умолчанию 14), 6 Брони, 10 Выносливости, 6 Удачи, 2 второй статы урона. */
function build(main: 'Strength' | 'Dexterity', m = 14): Stat[] {
  const other = main === 'Strength' ? 'Dexterity' : 'Strength';
  const counts: Array<[Stat, number]> = [[main, m], ['Armor', 6], ['Stamina', 10], ['Luck', 6], [other, 2]];
  const out: Stat[] = counts.flatMap(([s, n]) => Array<Stat>(n).fill(s));
  while (out.length < BP.blocks.length) out.push('Stamina');
  return out.slice(0, BP.blocks.length);
}

/** Боец: оружие в обеих руках (как у ботов и у игрока с двумя руками), сборка под его стату. */
function fighter(weaponId: string | null, target?: Stat[], main?: 'Strength' | 'Dexterity', m = 14, level = 1): FighterInput {
  const w = weaponId ? { ...(getItem(weaponId) as EquipmentItem), itemLevel: level } : null;
  const stat = main ?? (w?.scalingStat === 'Strength' ? 'Strength' : 'Dexterity');
  return { name: weaponId ?? 'Кулак', blueprintId: BP.id, blockStats: build(stat, m), equipment: BP.slots.map((s) => (s.type === 'Hand' ? w : null)), target };
}

/** Кубов главной статы в k-м бою пары: стороны берут 10/14/18 независимо — чтобы не подгонять баланс под одну сборку. */
const mainOf = (k: number, side: 0 | 1) => 10 + 4 * ((side ? Math.floor(k / 3) : k) % 3);

/** Доля побед a над b: N/2 боёв a ходит первым, N/2 — b. */
/** Бои в матрицах: сколько закончились по лимиту ходов и средняя длина — для отчёта. */
const totals = { fights: 0, limit: 0, turns: 0 };

function winRate(mkA: (m: number) => FighterInput, mkB: (m: number) => FighterInput, seed0 = 1): number {
  let wins = 0;
  for (let k = 0; k < N; k++) {
    const seed = seed0 + k;
    const first = k % 2 === 0;
    const a = mkA(mainOf(k, 0));
    const b = mkB(mainOf(k, 1));
    const r = runToEnd(first ? createBattle(seed, a, b) : createBattle(seed, b, a));
    wins += r.over!.winner === (first ? 'player' : 'enemy') ? 1 : 0;
    totals.fights++;
    totals.turns += r.turn;
    if (r.over!.reason === 'turns') totals.limit++;
  }
  return wins / N;
}

const pct = (v: number) => `${Math.round(v * 100)}%`;
const name = (id: string) => getItem(id).name.replace('Ржавый ', '').replace('Ржавая ', '').replace('Ржавое ', '');

function table(head: string[], rows: string[][]): string {
  return [`| ${head.join(' | ')} |`, `| ${head.map(() => '---').join(' | ')} |`, ...rows.map((r) => `| ${r.join(' | ')} |`)].join('\n');
}

/** Коридоры баланса: что за их пределами — в раздел «Выбивается из баланса». */
const BAND = {
  /** Пара (оружие × оружие, приоритет × приоритет): дальше 50 ± 15% — перекос. */
  pair: 0.15,
  /** Среднее оружия/приоритета по матрице: дальше 50 ± 10%. */
  overall: 0.1,
  /** Ур. 2/3 против ур. 1 тем же оружием: апгрейд должен помогать, но не решать бой сам. */
  levelMin: 0.55,
  levelMax: 0.85,
  /** Игрок против ботов с лучшим приоритетом. */
  botsMin: 0.4,
  botsMax: 0.7,
  /** Ходов до победы над манекеном: самое медленное оружие не дольше самого быстрого в 1.5 раза. */
  dummySpread: 1.5,
  /** Доля боёв до лимита ходов. */
  limit: 0.02,
  /** Крит/уворот: факт против заявленного, доля. */
  proc: 0.01,
  /** В «Изменения с прошлого прогона» — сдвиги доли побед от 5% и ходов от 10%. */
  diffRate: 0.05,
  diffTurns: 0.1,
};

/** Погрешность доли побед по n боям (95%, p = 0.5). */
const noise = (fights: number) => 1.96 * Math.sqrt(0.25 / fights);

/** m[i][j] — доля побед i над j; диагональ — NaN. */
type Matrix = number[][];

interface Issue {
  text: string;
  /** Насколько за коридором. */
  over: number;
  /** Погрешность: over не больше неё — «на грани». */
  noise: number;
}

interface Metric {
  value: number;
  kind: 'rate' | 'turns';
}

function matrix(n: number, rate: (i: number, j: number) => number): Matrix {
  return Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? NaN : rate(i, j))));
}

/** Перевес i над j по обеим ячейкам пары (i против j и j против i). */
const edge = (m: Matrix, i: number, j: number) => (m[i][j] + 1 - m[j][i]) / 2;

function rowAverage(m: Matrix, i: number): number {
  const others = m.map((_, j) => j).filter((j) => j !== i);
  return others.reduce((sum, j) => sum + edge(m, i, j), 0) / others.length;
}

const offDiagonal = (m: Matrix) => m.flatMap((row, i) => row.filter((_, j) => j !== i));
const cells = (m: Matrix, labels: string[]) => m.map((row, i) => [labels[i], ...row.map((v) => (Number.isNaN(v) ? '—' : pct(v)))]);

/** Сильнейший и слабейший по среднему, разброс пар. */
function matrixSummary(m: Matrix, labels: string[]): string {
  const averages = labels.map((_, i) => rowAverage(m, i));
  const best = averages.indexOf(Math.max(...averages));
  const worst = averages.indexOf(Math.min(...averages));
  const values = offDiagonal(m);
  return `сильнее всех — ${labels[best]} (${pct(averages[best])}), слабее — ${labels[worst]} (${pct(averages[worst])}); пары ${pct(Math.min(...values))}–${pct(Math.max(...values))}`;
}

function matrixIssues(title: string, m: Matrix, labels: string[], issues: Issue[], metrics: Record<string, Metric>) {
  const rowNoise = noise(2 * N * (labels.length - 1));
  labels.forEach((label, i) => {
    const average = rowAverage(m, i);
    metrics[`${title} · ${label}`] = { value: average, kind: 'rate' };
    const over = Math.abs(average - 0.5) - BAND.overall;
    if (over > 0) issues.push({ text: `${title}: ${label} — в среднем ${pct(average)} побед (${average > 0.5 ? 'сильнее' : 'слабее'} остальных)`, over, noise: rowNoise });
  });
  for (let i = 0; i < labels.length; i++) {
    for (let j = i + 1; j < labels.length; j++) {
      const value = edge(m, i, j);
      const over = Math.abs(value - 0.5) - BAND.pair;
      if (over <= 0) continue;
      const [winner, loser, share] = value > 0.5 ? [i, j, value] : [j, i, 1 - value];
      issues.push({ text: `${title}: ${labels[winner]} > ${labels[loser]} — ${pct(share)}`, over, noise: noise(2 * N) });
    }
  }
}

/** Выход за коридор [min, max]: 0 — внутри. */
const outside = (value: number, min: number, max: number) => Math.max(min - value, value - max, 0);

it('balance', () => {
  const out: string[] = [`# Симуляция баланса`, '', `Лобстер (38 кубов), оружие в обеих руках, билд под стату оружия: 10/14/18 кубов главной (в матрицах стороны перебирают независимо), 6 Брони, 10 Выносливости, 6 Удачи. Прочность куба ${BLOCK_DURABILITY}. Боёв на ячейку: ${N} (погрешность ячейки ±${pct(noise(N))}).`, ''];
  const issues: Issue[] = [];
  const metrics: Record<string, Metric> = {};
  const weaponNames = WEAPONS.map(name);

  // 1) оружие против манекена
  const dummy: Array<{ weapon: string; turns: number; damage: number; cubes: number; limit: number }> = [];
  const procs = { crit: 0, critExp: 0, atk: 0, dodge: 0, dodgeExp: 0, def: 0 };
  for (const w of WEAPONS) {
    let turns = 0, hits = 0, broken = 0, dmg = 0, limit = 0;
    for (let seed = 1; seed <= N; seed++) {
      const b: BattleState = createBattle(seed, fighter(w), fighter(null, undefined, 'Strength'));
      let last = '';
      while (!b.over) {
        const pc = critOf(b.player), ed = dodgeOf(b.enemy);
        const from = b.log.length;
        runStep(b);
        for (const e of b.log.slice(from)) {
          if (e.t === 'attack' && e.side === 'player') {
            last = e.weapon;
            if (e.weapon !== 'Кулак') {
              procs.atk++; procs.critExp += pc; if (e.crit) procs.crit++;
              procs.def++; procs.dodgeExp += ed; if (e.outcome === 'evade') procs.dodge++;
            }
            if (e.outcome === 'hit' && e.weapon !== 'Кулак') { hits++; dmg += e.damage; }
          }
          if (e.t === 'break' && e.side === 'enemy' && last !== 'Кулак') broken++;
        }
      }
      turns += b.turn;
      if (b.over?.reason === 'turns') limit++;
    }
    dummy.push({ weapon: name(w), turns: turns / N, damage: dmg / Math.max(1, hits), cubes: broken / Math.max(1, hits), limit: limit / N });
  }
  out.push('## Оружие против манекена (кулак)', '', table(['Оружие', 'Ходов до победы', 'Урон за попадание', 'Кубов за попадание', 'До лимита ходов'],
    dummy.map((d) => [d.weapon, d.turns.toFixed(1), d.damage.toFixed(1), d.cubes.toFixed(2), pct(d.limit)])), '');

  // 2) оружие × оружие
  const w1 = matrix(WEAPONS.length, (i, j) => winRate((m) => fighter(WEAPONS[i], undefined, undefined, m), (m) => fighter(WEAPONS[j], undefined, undefined, m)));
  out.push('## Оружие × оружие (побед строки над столбцом)', '', table(['', ...weaponNames], cells(w1, weaponNames)), '');

  // 2б) этап 8: свойства уровней — матрица на ур. 3 и «ур. 3 против ур. 1» тем же оружием
  const w3 = matrix(WEAPONS.length, (i, j) => winRate((m) => fighter(WEAPONS[i], undefined, undefined, m, 3), (m) => fighter(WEAPONS[j], undefined, undefined, m, 3)));
  out.push('## Оружие × оружие на ур. 3 (свойства этапа 8)', '', table(['', ...weaponNames], cells(w3, weaponNames)), '');
  const levels = WEAPONS.map((w) => ({
    weapon: name(w),
    lv2: winRate((m) => fighter(w, undefined, undefined, m, 2), (m) => fighter(w, undefined, undefined, m, 1)),
    lv3: winRate((m) => fighter(w, undefined, undefined, m, 3), (m) => fighter(w, undefined, undefined, m, 1)),
  }));
  out.push('## Уровень против уровня тем же оружием', '', table(['Оружие', 'ур. 2 против ур. 1', 'ур. 3 против ур. 1'], levels.map((l) => [l.weapon, pct(l.lv2), pct(l.lv3)])), '');

  // 3) приоритет × приоритет: каждая стата первой, остальное — по умолчанию
  const orders = DEFAULT_TARGET.map((s) => [s, ...DEFAULT_TARGET.filter((x) => x !== s)] as Stat[]);
  const orderNames = orders.map((o) => `${STAT_LABEL[o[0]]} первой`);
  const pm = matrix(orders.length, (i, j) => winRate((m) => fighter('rustySword', orders[i], undefined, m), (m) => fighter('rustySword', orders[j], undefined, m)));
  out.push('## Приоритет × приоритет (меч против меча)', '', table(['', ...orderNames], cells(pm, orderNames)), '');

  // 3б) против ботов: боты той же категории, раскладка слоями по вариантам, их приоритет — под сборку игрока;
  // игрок — с приоритетом по умолчанию и с лучшим из «стата первой» (какой приоритет выгоден против ботов)
  const bots = WEAPONS.map((w) => {
    const me = fighter(w);
    const opponents = Array.from({ length: N }, (_, k) => generateOpponent(1000 + k, { level: 1, category: BP.category, player: me }));
    const rate = (target?: Stat[]) => opponents.filter((bot, k) => runToEnd(createBattle(k + 1, { ...me, target }, bot)).over!.winner === 'player').length / N;
    const byOrder = orders.map((o) => rate(o));
    const best = byOrder.indexOf(Math.max(...byOrder));
    return { weapon: name(w), def: rate(), best: byOrder[best], bestName: orderNames[best] };
  });
  out.push('## Игрок против ботов (игрок: 14 главной, ходит первым)', '', table(['Оружие игрока', 'Приоритет по умолчанию', 'Лучший приоритет'], bots.map((r) => [r.weapon, pct(r.def), `${pct(r.best)} (${r.bestName})`])), '');

  const avgTurns = totals.turns / totals.fights;
  const limitShare = totals.limit / totals.fights;
  out.push(`Бои в матрицах: в среднем ${avgTurns.toFixed(1)} ходов, до лимита ходов — ${pct(limitShare)}.`, '');

  // 4) марбл-бэги: факт против заявленного
  const critExp = procs.critExp / procs.atk, critFact = procs.crit / procs.atk;
  const dodgeExp = procs.dodgeExp / procs.def, dodgeFact = procs.dodge / procs.def;
  out.push('## Крит и уворот: факт против шанса', '', table(['', 'Заявлено (среднее)', 'Факт'], [
    ['Крит игрока', pct(critExp), pct(critFact)],
    ['Уворот манекена', pct(dodgeExp), pct(dodgeFact)],
  ]), '');

  // 5) выбивается из баланса
  const fastest = dummy.reduce((a, b) => (b.turns < a.turns ? b : a));
  const slowest = dummy.reduce((a, b) => (b.turns > a.turns ? b : a));
  for (const d of dummy) metrics[`Манекен · ${d.weapon}, ходов`] = { value: d.turns, kind: 'turns' };
  const spread = slowest.turns / fastest.turns;
  if (spread > BAND.dummySpread) issues.push({ text: `Манекен: ${slowest.weapon} убивает за ${slowest.turns.toFixed(1)} ходов — в ${spread.toFixed(1)} раза дольше, чем ${fastest.weapon} (${fastest.turns.toFixed(1)})`, over: (spread - BAND.dummySpread) / BAND.dummySpread, noise: 0 });
  for (const d of dummy) if (d.limit > BAND.limit) issues.push({ text: `Манекен: ${d.weapon} не добивает до лимита ходов в ${pct(d.limit)} боёв`, over: d.limit - BAND.limit, noise: 0 });
  matrixIssues('Оружие ур. 1', w1, weaponNames, issues, metrics);
  matrixIssues('Оружие ур. 3', w3, weaponNames, issues, metrics);
  for (const l of levels) {
    metrics[`Апгрейд · ${l.weapon} ур. 2`] = { value: l.lv2, kind: 'rate' };
    metrics[`Апгрейд · ${l.weapon} ур. 3`] = { value: l.lv3, kind: 'rate' };
    for (const [lv, value] of [[2, l.lv2], [3, l.lv3]] as const) {
      const over = outside(value, BAND.levelMin, BAND.levelMax);
      if (over > 0) issues.push({ text: `Апгрейд: ${l.weapon} ур. ${lv} против ур. 1 — ${pct(value)}, ${value < BAND.levelMin ? 'уровень почти не помогает' : 'уровень решает бой сам'}`, over, noise: noise(N) });
    }
    if (l.lv3 < l.lv2) issues.push({ text: `Апгрейд: ${l.weapon} ур. 3 слабее ур. 2 (${pct(l.lv3)} против ${pct(l.lv2)} над ур. 1)`, over: l.lv2 - l.lv3, noise: noise(N) * Math.SQRT2 });
  }
  matrixIssues('Приоритет', pm, orderNames, issues, metrics);
  for (const r of bots) {
    metrics[`Боты · ${r.weapon}`] = { value: r.best, kind: 'rate' };
    const over = outside(r.best, BAND.botsMin, BAND.botsMax);
    if (over > 0) issues.push({ text: `Боты: ${r.weapon} — ${pct(r.best)} побед с лучшим приоритетом (коридор ${pct(BAND.botsMin)}–${pct(BAND.botsMax)})`, over, noise: noise(N) });
  }
  if (limitShare > BAND.limit) issues.push({ text: `Матрицы: до лимита ходов доходит ${pct(limitShare)} боёв`, over: limitShare - BAND.limit, noise: 0 });
  for (const [label, fact, expected] of [['крит', critFact, critExp], ['уворот', dodgeFact, dodgeExp]] as const) {
    const over = Math.abs(fact - expected) - BAND.proc;
    if (over > 0) issues.push({ text: `Марбл-бэг: ${label} ${pct(fact)} при заявленных ${pct(expected)}`, over, noise: 0 });
  }

  // 6) итог
  const bestValues = bots.map((r) => r.best);
  const lv3Values = levels.map((l) => l.lv3);
  const procsOk = Math.abs(critFact - critExp) <= BAND.proc && Math.abs(dodgeFact - dodgeExp) <= BAND.proc;
  out.push('## Итог', '',
    `- Манекен: быстрее всех ${fastest.weapon} (${fastest.turns.toFixed(1)} ходов), дольше всех ${slowest.weapon} (${slowest.turns.toFixed(1)}).`,
    `- Оружие ур. 1: ${matrixSummary(w1, weaponNames)}.`,
    `- Оружие ур. 3: ${matrixSummary(w3, weaponNames)}.`,
    `- Апгрейд ур. 3 против ур. 1: ${pct(Math.min(...lv3Values))}–${pct(Math.max(...lv3Values))}.`,
    `- Приоритет: ${matrixSummary(pm, orderNames)}.`,
    `- Против ботов (лучший приоритет): ${pct(Math.min(...bestValues))}–${pct(Math.max(...bestValues))}, в среднем ${pct(bestValues.reduce((a, b) => a + b, 0) / bestValues.length)}.`,
    `- Бои: в среднем ${avgTurns.toFixed(1)} ходов, до лимита — ${pct(limitShare)}; крит ${pct(critFact)} / уворот ${pct(dodgeFact)} — ${procsOk ? 'как заявлено' : 'расходятся с заявленными'}.`,
    `- За коридорами: явно — ${issues.filter((x) => x.over > x.noise).length}, на грани — ${issues.filter((x) => x.over <= x.noise).length}.`,
    '');

  // 7) изменения с прошлого прогона
  const jsonUrl = new URL('./report.json', import.meta.url);
  const previous: Record<string, Metric> = existsSync(jsonUrl) ? JSON.parse(readFileSync(jsonUrl, 'utf8')).metrics ?? {} : {};
  const changes = Object.entries(metrics)
    .filter(([key]) => previous[key])
    .map(([key, now]) => ({ key, now, was: previous[key].value }))
    .filter(({ now, was }) => (now.kind === 'rate' ? Math.abs(now.value - was) >= BAND.diffRate : Math.abs(now.value - was) / was >= BAND.diffTurns))
    .sort((a, b) => Math.abs(b.now.value - b.was) / (b.now.kind === 'turns' ? b.was : 1) - Math.abs(a.now.value - a.was) / (a.now.kind === 'turns' ? a.was : 1));
  const show = (value: number, kind: Metric['kind']) => (kind === 'rate' ? pct(value) : value.toFixed(1));
  out.push('## Изменения с прошлого прогона', '',
    ...(!Object.keys(previous).length ? ['Прошлого прогона нет — сравнение появится со следующего запуска.']
      : changes.length ? changes.map(({ key, now, was }) => `- ${key}: ${show(was, now.kind)} → ${show(now.value, now.kind)}`)
        : [`Заметных сдвигов нет (порог: доля побед ±${pct(BAND.diffRate)}, ходы ±${pct(BAND.diffTurns)}).`]),
    '');

  // 8) выбивается из баланса: явно — по убыванию перекоса, на грани — в пределах погрешности
  const clear = issues.filter((x) => x.over > x.noise).sort((a, b) => b.over - a.over);
  const borderline = issues.filter((x) => x.over <= x.noise).sort((a, b) => b.over - a.over);
  out.push('## Выбивается из баланса', '',
    `Коридоры: пара 50 ± ${pct(BAND.pair)}, среднее по матрице 50 ± ${pct(BAND.overall)}, апгрейд ${pct(BAND.levelMin)}–${pct(BAND.levelMax)} (и ур. 3 не слабее ур. 2), боты ${pct(BAND.botsMin)}–${pct(BAND.botsMax)}, манекен — разброс ходов не больше ×${BAND.dummySpread}.`, '');
  if (!issues.length) out.push('Всё в коридорах.', '');
  if (clear.length) out.push('### Явно', '', ...clear.map((x) => `- ${x.text}`), '');
  if (borderline.length) out.push('### На грани (в пределах погрешности)', '', ...borderline.map((x) => `- ${x.text}`), '');

  const report = out.join('\n');
  writeFileSync(new URL('./report.md', import.meta.url), report + '\n');
  writeFileSync(jsonUrl, JSON.stringify({ n: N, metrics }, null, 1) + '\n');
  console.log(report);
});
