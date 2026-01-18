import { signal, batch, type ReadonlySignal } from "@preact/signals";

export interface ServerData<T = unknown> {
  data: T;
  loading: boolean;
  error: Error | null;
}

export interface StoreConfig {
  params?: Record<string, string>;
  serverData?: unknown;
}

/** Route params signal. */
const _params = signal<Record<string, string>>({});

/** Server data signal. */
const _serverData = signal<ServerData<unknown>>({
  data: null,
  loading: false,
  error: null,
});

/** Pathname signal. */
const _pathname = signal<string>("");

/** Route parameters. */
export const params: ReadonlySignal<Record<string, string>> = _params;

/** Server data. */
export const serverData: ReadonlySignal<ServerData<unknown>> = _serverData;

/** Current pathname. */
export const pathname: ReadonlySignal<string> = _pathname;

/** Sets route parameters. */
export function setParams(newParams: Record<string, string>) {
  _params.value = newParams;
}

/** Sets server data. */
export function setServerData<T>(data: T) {
  _serverData.value = {
    data,
    loading: false,
    error: null,
  };
}

/** Sets current pathname. */
export function setPathname(path: string) {
  _pathname.value = path;
}

/** Initializes store with config. */
export function initStore(config: StoreConfig = {}) {
  batch(() => {
    if (config.params) {
      _params.value = config.params;
    }
    if (config.serverData !== undefined) {
      _serverData.value = {
        data: config.serverData,
        loading: false,
        error: null,
      };
    }
  });
}

/** Resets store to initial state. */
export function resetStore() {
  batch(() => {
    _params.value = {};
    _serverData.value = { data: null, loading: false, error: null };
    _pathname.value = "";
  });
}
