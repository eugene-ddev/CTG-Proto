// Сохранение в localStorage (или любое хранилище с тем же интерфейсом — в тестах).
import { STATE_VERSION, type PlayerState } from './state';

export const SAVE_KEY = 'ctg-prototype-save';

export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** localStorage, если доступен. В песочнице артефакта он может бросать — тогда работаем без сохранения. */
export function browserStorage(): KeyValueStorage | null {
  try {
    const ls = window.localStorage;
    const probe = '__ctg_probe__';
    ls.setItem(probe, '1');
    ls.removeItem(probe);
    return ls;
  } catch {
    return null;
  }
}

/**
 * Прочитать сохранение. Поля, которых нет в старом сейве, берутся из fresh —
 * так новые поля из следующих этапов не ломают прогресс. Битый JSON или чужая версия → null.
 */
export function loadState(storage: KeyValueStorage | null, fresh: PlayerState): PlayerState | null {
  if (!storage) return null;
  let raw: string | null;
  try {
    raw = storage.getItem(SAVE_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const data = JSON.parse(raw) as Partial<PlayerState>;
    // старые версии принимаются — их подтягивает migrate (store.ts); из будущего — нет
    if (typeof data !== 'object' || data === null || typeof data.version !== 'number' || data.version < 1 || data.version > STATE_VERSION) return null;
    return { ...fresh, ...data };
  } catch {
    return null;
  }
}

export function saveState(storage: KeyValueStorage | null, state: PlayerState): boolean {
  if (!storage) return false;
  try {
    storage.setItem(SAVE_KEY, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}

export function clearSave(storage: KeyValueStorage | null): void {
  try {
    storage?.removeItem(SAVE_KEY);
  } catch {
    /* хранилище недоступно — нечего чистить */
  }
}
