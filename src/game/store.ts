// Единственный источник состояния игрока для сцен. Любое изменение сохраняется
// и рассылается подписчикам — UI перерисовывает счётчики без ручного опроса.
import { BLUEPRINTS, COMBAT, START, maxStackOf } from '../data/catalog';
import type { ArenaRun } from '../core/arena';
import { browserStorage, clearSave, loadState, saveState, type KeyValueStorage } from '../core/save';
import { SHARD_ID, SHARD_STACK, STATE_VERSION, addCubes, addItem, createInitialState, type PlayerState } from '../core/state';
import { forfeitIfInBattle, lobbyRegen, setSeriesRetries } from '../core/arena';
import { defaultCharacterName } from '../core/craft';
import { buildOrder } from '../core/build';
import { defaultCounts, nextStat } from '../core/stats';
import { getBlueprint, hasBlueprint, hasItem } from '../data/catalog';
import type { Stat } from '../data/types';

type Listener = (state: PlayerState) => void;

const maxStack = (itemId: string) => maxStackOf(itemId);

export const freshState = () => createInitialState(START, BLUEPRINTS.map((b) => b.id), maxStack);

class Store {
  private storage: KeyValueStorage | null = browserStorage();
  private listeners = new Set<Listener>();
  private current: PlayerState;
  /** false — хранилище недоступно, прогресс живёт до перезагрузки. */
  readonly persistent: boolean;

  constructor() {
    this.persistent = this.storage !== null;
    setSeriesRetries(this.debug.retries ?? null);
    const fresh = freshState();
    // перезагрузка посреди боя арены — поражение; кубы, починенные в лобби за время отсутствия, — на месте
    this.current = lobbyRegen(forfeitIfInBattle(migrate(loadState(this.storage, fresh) ?? fresh)), Date.now());
    saveState(this.storage, this.current);
  }

  get state(): PlayerState {
    return this.current;
  }

  /** Применить чистую операцию над состоянием. null из операции — изменение отклонено. */
  update(fn: (s: PlayerState) => PlayerState | null): boolean {
    const next = fn(this.current);
    if (!next) return false;
    this.current = next;
    saveState(this.storage, next);
    this.listeners.forEach((l) => l(next));
    return true;
  }

  /** Подписка; возвращает отписку. Сцены отписываются в SHUTDOWN. */
  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  reset() {
    clearSave(this.storage);
    this.update(() => freshState());
  }

  /** Отладочные настройки (вкладка Debug) — отдельно от сейва, сброс прогресса их не трогает. */
  get debug(): DebugSettings {
    try {
      return JSON.parse(this.storage?.getItem(DEBUG_KEY) ?? '{}') as DebugSettings;
    } catch {
      return {};
    }
  }

  /** Лимит повторов на серию (null — из конфига). Подписчики перерисовываются — счётчики повторов обновятся. */
  setRetries(n: number | null) {
    setSeriesRetries(n);
    const { retries: _r, ...rest } = this.debug;
    const next: DebugSettings = n === null ? rest : { ...rest, retries: Math.max(0, Math.floor(n)) };
    try {
      this.storage?.setItem(DEBUG_KEY, JSON.stringify(next));
    } catch {
      /* без сохранения — живёт до перезагрузки */
    }
    this.listeners.forEach((l) => l(this.current));
  }

  maxStack = maxStack;
}

const DEBUG_KEY = 'ctg-prototype-debug';

export interface DebugSettings {
  /** Переопределённый лимит повторов на серию арены. */
  retries?: number;
}

export const store = new Store();

/** Уровень экземпляра оружия — не выше максимума (этап 8: уровни 1–3 вместо 1–100). */
function clampLevel<T extends { level?: number }>(e: T): T {
  return e.level !== undefined && e.level > COMBAT.weaponLevels.max ? { ...e, level: COMBAT.weaponLevels.max } : e;
}

/** Модель из сейвов этапов 5–6: персонаж без имени и снаряжения, ещё не «собранный». */
interface LegacyModel {
  uid: string;
  blueprintId: string;
  blockStats?: Stat[];
}

/**
 * Подтянуть старый сейв к текущим конфигам:
 * - «всё открыто на старте» — новые чертежи (камень, флаконы) открываются и в старом сейве;
 * - предметы и персонажи удалённых чертежей (старые камни по стихиям) убираются;
 * - скрафченные модели (этапы 5–6) становятся персонажами с именем по умолчанию;
 *   модели без стат блоков раскрашиваются по распределению по умолчанию.
 */
export function migrate(input: PlayerState & { models?: LegacyModel[]; cubes?: number; shards?: number }): PlayerState {
  const { models = [], cubes: oldCubes, shards: oldShards, ...rest } = input;
  // сейвы до версии 2: кубы и осколки были счётчиками — теперь это предметы (осколки серии — туда же)
  const runShards = (rest.arenaRun as { shards?: number } | null)?.shards ?? 0;
  const oldRun = rest.arenaRun ? (({ shards: _s, ...r }) => r)(rest.arenaRun as ArenaRun & { shards?: number }) : null;
  let s: PlayerState = {
    ...rest,
    arenaRun: oldRun && rest.characters.some((c) => c.uid === oldRun.charUid) ? oldRun : null,
    bags: rest.bags ?? {},
    // до версии 4 все чертежи были открыты (в 3-й стартовый набор ещё менялся) — теперь открыты стартовые,
    // остальные открываются пергаментом
    unlockedBlueprints: START.unlockAllBlueprints ? BLUEPRINTS.map((b) => b.id)
      : (rest.version ?? 1) < 4 ? (START.blueprints ?? []).filter(hasBlueprint) : rest.unlockedBlueprints.filter(hasBlueprint),
    manuallyCrafted: rest.manuallyCrafted.filter(hasBlueprint),
    // уровни оружия 1–3 (этап 8): старые 2–100 → 3
    inventory: rest.inventory.filter((e) => hasItem(e.itemId)).map(clampLevel),
    characters: rest.characters
      .filter((c) => hasBlueprint(c.blueprintId))
      .map((c) => ({ ...c, rucksack: c.rucksack ?? null, bag: Array.isArray(c.bag) ? c.bag.map((e) => (e && hasItem(e.itemId) ? clampLevel(e) : null)) : [], equipment: c.equipment.map((e) => (e && hasItem(e.itemId) ? clampLevel(e) : null)) })),
  };
  if (oldCubes) s = addCubes(s, oldCubes);
  if ((oldShards ?? 0) + runShards > 0) s = addItem(s, SHARD_ID, (oldShards ?? 0) + runShards, SHARD_STACK);
  s = { ...s, version: STATE_VERSION };
  for (const m of models) {
    if (!hasBlueprint(m.blueprintId)) continue;
    const bp = getBlueprint(m.blueprintId);
    if (bp.kind !== 'character') continue;
    let blockStats = m.blockStats;
    if (!Array.isArray(blockStats) || blockStats.length !== bp.blocks.length) {
      const counts = defaultCounts(bp);
      const assigned = new Map<number, Stat>();
      for (const i of buildOrder(bp.blocks)) assigned.set(i, nextStat(counts, assigned, 'Strength')!);
      blockStats = bp.blocks.map((_, i) => assigned.get(i)!);
    }
    s = {
      ...s,
      characters: [
        ...s.characters,
        { uid: `c${s.nextUid}`, name: defaultCharacterName(s, bp), blueprintId: bp.id, blockStats, brokenBlocks: [], equipment: bp.slots.map(() => null), rucksack: null, bag: [] },
      ],
      nextUid: s.nextUid + 1,
    };
  }
  return s;
}
