// Единственный источник состояния игрока для сцен. Состояние приходит с сервера при входе (hydrate); любое изменение
// рассылается подписчикам и отправляется на сервер (этап 1 сети: целиком, с номером ревизии — на этапе 2 заменится
// действиями, которые сервер исполняет сам).
import { BLUEPRINTS, COMBAT, START, maxStackOf } from '../data/catalog';
import type { ArenaRun } from '../core/arena';
import { browserStorage, type KeyValueStorage } from '../core/save';
import { SHARD_ID, SHARD_STACK, STATE_VERSION, addCubes, addItem, createInitialState, type PlayerState } from '../core/state';
import { forfeitIfInBattle, lobbyRegen, setSeriesRetries } from '../core/arena';
import { defaultCharacterName } from '../core/craft';
import { buildOrder } from '../core/build';
import { defaultCounts, nextStat } from '../core/stats';
import { getBlueprint, hasBlueprint, hasItem } from '../data/catalog';
import type { Stat } from '../data/types';

type Listener = (state: PlayerState) => void;

/** Состояние отправки на сервер: всё сохранено, идёт отправка, нет связи (повтор через несколько секунд). */
export type SyncStatus = 'local' | 'saved' | 'saving' | 'error';

/** Сервер для стора: отправка состояния и сброс. Реализация — net/client.ts; в тестах не подключается. */
export interface Remote {
  sync(state: PlayerState, rev: number): Promise<{ conflict: false; rev: number } | { conflict: true; state: PlayerState; rev: number }>;
  reset(): Promise<{ state: PlayerState; rev: number }>;
}

const SYNC_DELAY_MS = 300;
const SYNC_RETRY_MS = 3000;

const maxStack = (itemId: string) => maxStackOf(itemId);

export const freshState = () => createInitialState(START, BLUEPRINTS.map((b) => b.id), maxStack);

class Store {
  /** localStorage — только для отладочных настроек; прогресс хранится на сервере. */
  private storage: KeyValueStorage | null = browserStorage();
  private listeners = new Set<Listener>();
  private statusListeners = new Set<(s: SyncStatus) => void>();
  private current: PlayerState;
  private remote: Remote | null = null;
  private rev = 0;
  private dirty = false;
  private sending = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private status: SyncStatus = 'local';

  constructor() {
    setSeriesRetries(this.debug.retries ?? null);
    // до входа — стартовое состояние (тесты и экран входа); после входа его заменяет hydrate
    this.current = freshState();
  }

  /**
   * Состояние с сервера после входа. Перезагрузка посреди боя арены — поражение; кубы, починенные в лобби
   * за время отсутствия, — на месте. Если от этого состояние изменилось — уходит на сервер.
   */
  hydrate(state: PlayerState, rev: number, remote: Remote) {
    this.remote = remote;
    this.rev = rev;
    const next = lobbyRegen(forfeitIfInBattle(migrate(state)), Date.now());
    this.current = next;
    this.setStatus('saved');
    if (JSON.stringify(next) !== JSON.stringify(state)) this.schedule();
    this.listeners.forEach((l) => l(next));
  }

  get syncStatus(): SyncStatus {
    return this.status;
  }

  onSyncStatus(listener: (s: SyncStatus) => void): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  private setStatus(s: SyncStatus) {
    if (s === this.status) return;
    this.status = s;
    this.statusListeners.forEach((l) => l(s));
  }

  private schedule(delay = SYNC_DELAY_MS) {
    if (!this.remote) return;
    this.dirty = true;
    this.setStatus(this.status === 'error' ? 'error' : 'saving');
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.flush(), delay);
  }

  /** Отправить состояние на сервер сейчас (один запрос за раз; изменения во время отправки уйдут следующим). */
  async flush(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (!this.remote || !this.dirty || this.sending) return;
    this.sending = true;
    this.dirty = false;
    try {
      const res = await this.remote.sync(this.current, this.rev);
      this.rev = res.rev;
      if (res.conflict) {
        // на сервере более новое состояние (игра открыта в другой вкладке) — берём его
        this.dirty = false;
        this.current = res.state;
        this.listeners.forEach((l) => l(res.state));
      }
      this.sending = false;
      if (this.dirty) this.schedule(0);
      else this.setStatus('saved');
    } catch {
      this.sending = false;
      this.dirty = true;
      this.setStatus('error');
      this.timer = setTimeout(() => void this.flush(), SYNC_RETRY_MS);
    }
  }

  get state(): PlayerState {
    return this.current;
  }

  /** Применить чистую операцию над состоянием. null из операции — изменение отклонено. */
  update(fn: (s: PlayerState) => PlayerState | null): boolean {
    const next = fn(this.current);
    if (!next) return false;
    this.current = next;
    this.schedule();
    this.listeners.forEach((l) => l(next));
    return true;
  }

  /** Подписка; возвращает отписку. Сцены отписываются в SHUTDOWN. */
  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Сброс прогресса: стартовое состояние выдаёт сервер (без сервера — локально). */
  reset() {
    if (!this.remote) {
      this.update(() => freshState());
      return;
    }
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.dirty = false;
    this.setStatus('saving');
    this.remote.reset().then(
      (res) => {
        this.rev = res.rev;
        this.current = res.state;
        this.setStatus('saved');
        this.listeners.forEach((l) => l(res.state));
      },
      () => this.setStatus('error'),
    );
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
