// Единственный источник состояния игрока для сцен. Состояние приходит с сервера при входе (hydrate).
// Изменить его можно только действием (store.act, список — core/actions.ts): действие исполняется сразу здесь
// и уходит на сервер, который исполняет его сам над состоянием из базы и сверяет итог. Разошлись — берётся
// состояние сервера.
import { BLUEPRINTS, COMBAT, ITEMS, START, maxStackOf } from '../data/catalog';
import type { ArenaRun } from '../core/arena';
import { browserStorage, type KeyValueStorage } from '../core/save';
import { SHARD_ID, SHARD_STACK, addCubes, addItem, createInitialState, newCharacterPotions, normalizeCharacter, normalizeState, type PlayerState } from '../core/state';
import { freshArenaProfile, setSeriesRetries, type ArenaProfile } from '../core/arena';
import { applyAction, isServerSeeded, stateHash, type ActionArgs, type ActionCall, type ActionName } from '../core/actions';
import { randomSeed } from '../core/rng';
import { defaultCharacterName } from '../core/craft';
import { buildOrder } from '../core/build';
import { defaultCounts, nextStat } from '../core/stats';
import { getBlueprint, getItem, hasBlueprint, hasItem } from '../data/catalog';
import type { Stat } from '../data/types';

type Listener = (state: PlayerState) => void;

/** Состояние отправки на сервер: всё подтверждено, идёт отправка, нет связи (повтор через несколько секунд). */
export type SyncStatus = 'local' | 'saved' | 'saving' | 'error';

/** Ответ сервера на пачку действий. */
export type ActResult =
  | { ok: true; rev: number; hash: string; state?: PlayerState; arena?: ArenaProfile }
  /** rejected — действие отклонено сервером, conflict — ревизия устарела (игра в другой вкладке): берём состояние сервера. */
  | { ok: false; reason: 'rejected' | 'conflict'; state: PlayerState; rev: number; action?: string };

/** Сервер для стора. Реализация — net/client.ts; в тестах не подключается. */
export interface Remote {
  act(rev: number, actions: ActionCall[]): Promise<ActResult>;
  read(): Promise<{ state: PlayerState; rev: number; serverTime: number; arena?: ArenaProfile }>;
  reset(): Promise<{ state: PlayerState; rev: number }>;
}

const SEND_DELAY_MS = 150;
const SEND_RETRY_MS = 3000;

const maxStack = (itemId: string) => maxStackOf(itemId);

export const freshState = () => createInitialState(START, BLUEPRINTS.map((b) => b.id), maxStack, ITEMS.map((i) => i.id));

class Store {
  /** localStorage — только для отладочных настроек; прогресс хранится на сервере. */
  private storage: KeyValueStorage | null = browserStorage();
  private listeners = new Set<Listener>();
  private statusListeners = new Set<(s: SyncStatus) => void>();
  private current: PlayerState;
  private remote: Remote | null = null;
  private rev = 0;
  /** Действия, ещё не подтверждённые сервером: sent первых уже в пути. */
  private queue: ActionCall[] = [];
  private sent = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private status: SyncStatus = 'local';
  /** Часы сервера минус часы браузера, мс. */
  private clockOffset = 0;
  /** Идёт запрос, итог которого решает сервер (request): обычная отправка ждёт. */
  private requesting = false;
  /** Рейтинг, счёт и журнал нападений — отдельная запись на сервере (не часть состояния). */
  private profile: ArenaProfile = freshArenaProfile();

  constructor() {
    setSeriesRetries(this.debug.retries ?? null);
    // до входа — стартовое состояние (тесты и экран входа); после входа его заменяет hydrate
    this.current = freshState();
  }

  /** Состояние с сервера после входа. */
  hydrate(view: { state: PlayerState; rev: number; serverTime: number; arena?: ArenaProfile }, remote: Remote) {
    this.remote = remote;
    // лимит повторов на сервере — из конфига: отладочное переопределение работает только без сервера
    setSeriesRetries(null);
    this.adopt(view);
  }

  /** Принять состояние сервера: неподтверждённые действия отбрасываются. */
  private adopt(view: { state: PlayerState; rev: number; serverTime?: number; arena?: ArenaProfile }) {
    if (view.arena) this.profile = view.arena;
    this.queue = [];
    this.sent = 0;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.rev = view.rev;
    if (view.serverTime !== undefined) this.clockOffset = view.serverTime - Date.now();
    this.current = view.state;
    this.setStatus('saved');
    this.listeners.forEach((l) => l(view.state));
  }

  /** Рейтинг, счёт боёв с игроками и журнал нападений. */
  get arena(): ArenaProfile {
    return this.profile;
  }

  /** Свежие рейтинг и журнал от сервера (после боя с игроком, из списка соперников). */
  setArena(arena: ArenaProfile | undefined) {
    if (!arena) return;
    this.profile = arena;
    this.listeners.forEach((l) => l(this.current));
  }

  /** Время сервера по оценке клиента, мс — для таймеров на экране и для действий. */
  now(): number {
    return Date.now() + this.clockOffset;
  }

  get online(): boolean {
    return this.remote !== null;
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

  get state(): PlayerState {
    return this.current;
  }

  /**
   * Выполнить действие (core/actions.ts): сразу здесь и следом на сервере. false — действие отклонено
   * (условия не выполнены), состояние не изменилось.
   */
  act<K extends ActionName>(name: K, ...args: ActionArgs<K>): boolean {
    if (this.remote && isServerSeeded(name)) throw new Error(`Действие ${name} решает сервер — вызывай store.request`);
    // аргументы — как их увидит сервер (после JSON): иначе undefined здесь и null там дали бы разный итог
    const call: ActionCall = { name, args: JSON.parse(JSON.stringify(args)) as unknown[], now: this.now(), seed: randomSeed() };
    const next = applyAction(this.current, name, call.args, call);
    if (!next) return false;
    if (next === this.current) return true; // ничего не изменилось — серверу сообщать нечего
    this.current = next;
    if (this.remote) {
      this.queue.push(call);
      this.setStatus(this.status === 'error' ? 'error' : 'saving');
      if (!this.sent && !this.timer && !this.requesting) this.timer = setTimeout(() => void this.flush(), SEND_DELAY_MS);
    }
    this.listeners.forEach((l) => l(next));
    return true;
  }

  /** Отправить накопленные действия сейчас (одна пачка за раз; сделанное за время отправки уйдёт следующей). */
  async flush(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const remote = this.remote;
    if (!remote || this.sent || this.requesting || !this.queue.length) return;
    const batch = this.queue.slice();
    this.sent = batch.length;
    const expected = stateHash(this.current); // состояние после всех действий пачки
    try {
      const res = await remote.act(this.rev, batch);
      if (!res.ok) {
        console.warn(`[store] сервер не принял действия (${res.reason}${res.action ? `: ${res.action}` : ''}) — берём его состояние`);
        return this.adopt(res);
      }
      this.rev = res.rev;
      this.setArena(res.arena);
      this.queue = this.queue.slice(batch.length);
      this.sent = 0;
      if (res.hash !== expected) {
        // итог на сервере другой (часы, версия правил) — перечитать; действия, сделанные за это время, уже применены там или уйдут следом
        console.warn('[store] состояние разошлось с сервером — перечитываю');
        if (!this.queue.length) return this.adopt(await remote.read());
      }
      if (this.queue.length) void this.flush();
      else this.setStatus('saved');
    } catch {
      this.sent = 0;
      this.setStatus('error');
      this.timer = setTimeout(() => void this.flush(), SEND_RETRY_MS);
    }
  }

  /** Подписка; возвращает отписку. Сцены отписываются в SHUTDOWN. */
  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Действие, итог которого решает сервер (выбор противника, зерно боя): клиент его не предсказывает, а ждёт
   * ответ и берёт состояние сервера. Сначала уходят накопленные действия. false — отклонено или нет связи.
   * Без сервера (тесты) исполняется локально.
   */
  async request<K extends ActionName>(name: K, ...args: ActionArgs<K>): Promise<boolean> {
    const remote = this.remote;
    if (!remote) {
      const next = applyAction(this.current, name, JSON.parse(JSON.stringify(args)) as unknown[], { now: this.now(), seed: randomSeed() });
      if (!next) return false;
      this.current = next;
      this.listeners.forEach((l) => l(next));
      return true;
    }
    if (this.requesting) return false;
    // дождаться, пока сервер подтвердит всё сделанное раньше
    for (let i = 0; i < 100 && (this.queue.length || this.sent); i++) {
      await this.flush();
      if (this.queue.length || this.sent) await new Promise((r) => setTimeout(r, 100));
    }
    if (this.queue.length || this.sent) return false;
    this.requesting = true;
    this.setStatus('saving');
    try {
      const res = await remote.act(this.rev, [{ name, args: JSON.parse(JSON.stringify(args)) as unknown[], now: this.now(), seed: 0 }]);
      this.requesting = false;
      if (!res.ok) {
        console.warn(`[store] сервер отклонил ${name} (${res.reason})`);
        this.adopt(res);
        return false;
      }
      this.adopt(res.state ? { state: res.state, rev: res.rev } : await remote.read());
      return true;
    } catch {
      this.requesting = false;
      this.setStatus('error');
      return false;
    }
  }

  /**
   * Запрос к серверу, который сам меняет состояние игрока (вызов соперника): сначала уходят накопленные
   * действия, затем запрос; его ответ — новое состояние. false — отклонено или нет связи.
   */
  async call(fn: () => Promise<{ state: PlayerState; rev: number; arena?: ArenaProfile }>): Promise<boolean> {
    if (!this.remote || this.requesting) return false;
    for (let i = 0; i < 100 && (this.queue.length || this.sent); i++) {
      await this.flush();
      if (this.queue.length || this.sent) await new Promise((r) => setTimeout(r, 100));
    }
    if (this.queue.length || this.sent) return false;
    this.requesting = true;
    this.setStatus('saving');
    try {
      const res = await fn();
      this.requesting = false;
      this.adopt(res);
      return true;
    } catch (e) {
      this.requesting = false;
      console.warn(`[store] запрос отклонён: ${(e as Error).message}`);
      this.setStatus('saved');
      return false;
    }
  }

  /** Сброс прогресса (отладка): стартовое состояние выдаёт сервер; без сервера — локально. */
  reset() {
    if (!this.remote) {
      this.current = freshState();
      this.listeners.forEach((l) => l(this.current));
      return;
    }
    this.setStatus('saving');
    this.remote.reset().then((res) => this.adopt(res), () => this.setStatus('error'));
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
    if (this.remote) return; // на сервере лимит — из конфига
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
    inventory: rest.inventory.filter((e) => hasItem(e.itemId) && getItem(e.itemId).kind !== 'potion' && getItem(e.itemId).kind !== 'bag').map(clampLevel),
    characters: rest.characters
      .filter((c) => hasBlueprint(c.blueprintId))
      .map((c) => normalizeCharacter({ ...c, bag: Array.isArray(c.bag) ? c.bag.map((e) => (e && hasItem(e.itemId) ? clampLevel(e) : null)) : [], equipment: c.equipment.map((e) => (e && hasItem(e.itemId) ? clampLevel(e) : null)) })),
  };
  if (oldCubes) s = addCubes(s, oldCubes);
  if ((oldShards ?? 0) + runShards > 0) s = addItem(s, SHARD_ID, (oldShards ?? 0) + runShards, SHARD_STACK);
  s = normalizeState({ ...s, version: s.version ?? 1 });
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
        { uid: `c${s.nextUid}`, name: defaultCharacterName(s, bp), blueprintId: bp.id, blockStats, brokenBlocks: [], equipment: bp.slots.map(() => null), rucksackLevel: 1, potions: newCharacterPotions(), bag: [] },
      ],
      nextUid: s.nextUid + 1,
    };
  }
  return s;
}
