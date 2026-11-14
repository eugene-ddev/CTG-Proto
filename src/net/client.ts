// Связь с сервером (Nakama, CTG-Proto-Backend): вход по device id, вызовы RPC.
// Адрес сервера: ?server=host:port в адресе страницы, иначе VITE_NAKAMA_HOST / VITE_NAKAMA_PORT, иначе 127.0.0.1:7450.
// ?profile=имя — отдельный игрок в том же браузере (свой device id): удобно проверять бои с игроками в двух вкладках.
import { Client, type Session } from '@heroiclabs/nakama-js';
import type { ActionCall } from '../core/actions';
import type { PlayerState } from '../core/state';
import type { ActResult } from '../game/store';

/** Версия протокола клиент ↔ сервер: меняется вместе с несовместимыми изменениями RPC. */
export const PROTOCOL_VERSION = 3;

export interface PlayerView {
  state: PlayerState;
  rev: number;
  serverTime: number;
  server: string;
  protocol: number;
  shared: { proto: string; digest: string };
  /** Сервер в режиме отладки: исполняет debug-действия и сброс. */
  debug: boolean;
}


/** Ошибка с текстом для игрока. */
export class NetError extends Error {
  constructor(message: string, readonly kind: 'offline' | 'name' | 'version' | 'server') {
    super(message);
  }
}

const params = new URLSearchParams(typeof location === 'undefined' ? '' : location.search);
const env = import.meta.env ?? {};
const [paramHost, paramPort] = (params.get('server') ?? '').split(':');
const HOST = paramHost || (env.VITE_NAKAMA_HOST as string | undefined) || '127.0.0.1';
const PORT = paramPort || (env.VITE_NAKAMA_PORT as string | undefined) || '7450';
const SSL = (env.VITE_NAKAMA_SSL as string | undefined) === 'true';
const SERVER_KEY = (env.VITE_NAKAMA_KEY as string | undefined) || 'defaultkey';
const PROFILE = params.get('profile') ?? '';
const DEVICE_KEY = `ctg-net-device${PROFILE ? `:${PROFILE}` : ''}`;
const NAME_KEY = `ctg-net-name${PROFILE ? `:${PROFILE}` : ''}`;

export const SERVER_ADDRESS = `${HOST}:${PORT}`;

const storage = (() => {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
})();
const read = (key: string) => {
  try {
    return storage?.getItem(key) ?? null;
  } catch {
    return null;
  }
};
const write = (key: string, value: string | null) => {
  try {
    if (value === null) storage?.removeItem(key);
    else storage?.setItem(key, value);
  } catch {
    /* без хранилища вход — на одну сессию */
  }
};

const newDeviceId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `dev-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}-${Math.random().toString(36).slice(2, 12)}`;

/** Ответ Nakama на ошибку — fetch Response; сетевой сбой — TypeError. */
async function toNetError(e: unknown): Promise<NetError> {
  if (e instanceof NetError) return e;
  if (typeof Response !== 'undefined' && e instanceof Response) {
    let message = '';
    try {
      message = ((await e.json()) as { message?: string }).message ?? '';
    } catch {
      /* тело не JSON */
    }
    if (e.status === 409) return new NetError('Это имя уже занято — выбери другое.', 'name');
    return new NetError(`Сервер ответил ошибкой ${e.status}${message ? `: ${message}` : ''}`, 'server');
  }
  return new NetError(`Сервер недоступен (${SERVER_ADDRESS}). Запущен ли CTG-Proto-Backend?`, 'offline');
}

class Net {
  private readonly client = new Client(SERVER_KEY, HOST, PORT, SSL, 10000, false);
  private session: Session | null = null;
  private deviceId = read(DEVICE_KEY);

  /** Имя игрока после входа. */
  get playerName(): string {
    return this.session?.username ?? read(NAME_KEY) ?? '';
  }

  get profile(): string {
    return PROFILE;
  }

  /** Есть ли сохранённый вход на этом устройстве (профиле). */
  get hasSavedLogin(): boolean {
    return !!this.deviceId;
  }

  /**
   * Войти: сохранённым device id (name не нужен) или новым игроком с именем.
   * Возвращает состояние игрока с сервера; несовместимые версии клиента и сервера — NetError('version').
   */
  async login(name?: string): Promise<PlayerView> {
    const fresh = !this.deviceId;
    const deviceId = this.deviceId ?? newDeviceId();
    try {
      this.session = await this.client.authenticateDevice(deviceId, true, fresh ? name : undefined);
    } catch (e) {
      throw await toNetError(e);
    }
    this.deviceId = deviceId;
    write(DEVICE_KEY, deviceId);
    write(NAME_KEY, this.session.username ?? name ?? '');
    const view = await this.rpc<PlayerView>('player/read', {});
    if (view.protocol !== PROTOCOL_VERSION)
      throw new NetError(`Клиент и сервер несовместимы: протокол клиента ${PROTOCOL_VERSION}, сервера ${view.protocol}. Обнови игру и сервер.`, 'version');
    if (view.shared.digest !== __CORE_DIGEST__)
      throw new NetError(
        `Правила на клиенте и сервере разные (клиент ${__APP_VERSION__} · ${__CORE_DIGEST__}, сервер ${view.shared.proto} · ${view.shared.digest}). В CTG-Proto-Backend: npm run sync-core, затем npm run up.`,
        'version',
      );
    return view;
  }

  /** Забыть вход на этом устройстве: следующий вход — новым игроком. Аккаунт на сервере остаётся. */
  forget() {
    this.session = null;
    this.deviceId = null;
    write(DEVICE_KEY, null);
    write(NAME_KEY, null);
  }

  /** Вызов RPC. Истёкшая сессия перевыпускается по device id. */
  async rpc<T>(id: string, payload: object): Promise<T> {
    if (!this.session || !this.deviceId) throw new NetError('Нет входа.', 'server');
    try {
      if (this.session.isexpired(Date.now() / 1000 + 30)) this.session = await this.client.authenticateDevice(this.deviceId, false);
      const res = await this.client.rpc(this.session, id, payload);
      const body = (res.payload ?? {}) as T & { error?: { message: string; code: number } };
      if (body.error) throw new NetError(`Сервер отклонил запрос ${id}: ${body.error.message}`, 'server');
      return body;
    } catch (e) {
      throw await toNetError(e);
    }
  }

  readPlayer = () => this.rpc<PlayerView>('player/read', {});
  act = (rev: number, actions: ActionCall[]) => this.rpc<ActResult>('player/act', { rev, actions });
  resetPlayer = () => this.rpc<PlayerView>('player/reset', {});
}

export const net = new Net();
