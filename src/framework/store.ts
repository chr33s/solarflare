/** Signal-based reactive state management using @preact/signals. */

import { signal, computed, effect, batch, type ReadonlySignal, type Signal } from "@preact/signals";
import { serializeToString, parseFromString } from "./serialize";

/** Server-rendered data passed to components. */
export interface ServerData<T = unknown> {
  /** The actual data payload */
  data: T;
  /** Whether data is still loading (for streaming) */
  loading: boolean;
  /** Error if data fetch failed */
  error: Error | null;
}

/** Store configuration. */
export interface StoreConfig {
  /** Initial route params */
  params?: Record<string, string>;
  /** Initial server data */
  serverData?: unknown;
}

/** Internal route params signal. */
const _params = signal<Record<string, string>>({});

/** Internal server data signal. */
const _serverData = signal<ServerData<unknown>>({
  data: null,
  loading: false,
  error: null,
});

/** Internal pathname signal. */
const _pathname = signal<string>("");

/** Route parameters signal (readonly). */
export const params: ReadonlySignal<Record<string, string>> = _params;

/** Server data signal (readonly). */
export const serverData: ReadonlySignal<ServerData<unknown>> = _serverData;

/** Current pathname signal (readonly). */
export const pathname: ReadonlySignal<string> = _pathname;

/** Sets route parameters. */
export function setParams(newParams: Record<string, string>): void {
  _params.value = newParams;
}

/** Sets server data. */
export function setServerData<T>(data: T): void {
  _serverData.value = {
    data,
    loading: false,
    error: null,
  };
}

/** Sets current pathname. */
export function setPathname(path: string): void {
  _pathname.value = path;
}

/** Initializes store with config. */
export function initStore(config: StoreConfig = {}): void {
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
export function resetStore(): void {
  batch(() => {
    _params.value = {};
    _serverData.value = { data: null, loading: false, error: null };
    _pathname.value = "";
  });
}

/** Serializes store state for client hydration. */
export async function serializeStoreForHydration(): Promise<string> {
  const state = {
    params: _params.value,
    serverData: _serverData.value.data,
    pathname: _pathname.value,
  };

  const serialized = await serializeToString(state);
  const escaped = JSON.stringify(serialized);

  return `<script>window.__SF_STORE__=${escaped}</script>`;
}

/** Hydrates store from serialized state (client-side). */
export async function hydrateStore(): Promise<void> {
  if (typeof window === "undefined") return;

  const serialized = (window as any).__SF_STORE__;
  if (!serialized) return;

  const state = await parseFromString<{
    params: Record<string, string>;
    serverData: unknown;
    pathname: string;
  }>(serialized);

  initStore({
    params: state.params,
    serverData: state.serverData,
  });

  setPathname(state.pathname);

  delete (window as any).__SF_STORE__;
}

export { signal, computed, effect, batch };
export type { ReadonlySignal, Signal };

/** Serializes data to a script tag for progressive hydration. */
export async function serializeDataIsland(id: string, data: unknown): Promise<string> {
  const serialized = await serializeToString(data);
  return `<script type="application/json" data-island="${id}">${serialized}</script>`;
}

/** Extracts and parses data from a data island script tag (client-side). */
export async function extractDataIsland<T = unknown>(id: string): Promise<T | null> {
  if (typeof document === "undefined") return null;

  const script = document.querySelector(`script[data-island="${id}"]`);
  if (!script?.textContent) return null;

  try {
    return await parseFromString<T>(script.textContent);
  } catch {
    console.error(`[solarflare] Failed to parse data island "${id}"`);
    return null;
  }
}

/** Hydrates a component when its data island arrives. */
export async function hydrateComponent(tag: string, dataIslandId?: string): Promise<void> {
  if (typeof document === "undefined") return;

  const element = document.querySelector(tag) as HTMLElement & {
    _sfDeferred?: Record<string, unknown>;
    _vdom?: unknown;
  };
  if (!element) {
    console.warn(`[solarflare] Element "${tag}" not found for hydration`);
    return;
  }

  const islandId = dataIslandId ?? `${tag}-data`;
  const data = await extractDataIsland<Record<string, unknown>>(islandId);

  if (data && typeof data === "object") {
    element.removeAttribute("data-loading");
    element._sfDeferred = data;

    element.dispatchEvent(
      new CustomEvent("sf:hydrate", {
        detail: data,
        bubbles: true,
      }),
    );
  }
}

/** Initializes the global hydration trigger. */
export function initHydrationCoordinator(): void {
  if (typeof window === "undefined") return;

  const queue = (window as any).__SF_HYDRATE_QUEUE__ as [string, string][] | undefined;
  if (queue) {
    for (const [tag, dataIslandId] of queue) {
      void hydrateComponent(tag, dataIslandId);
    }
    delete (window as any).__SF_HYDRATE_QUEUE__;
  }

  (window as any).__SF_HYDRATE__ = hydrateComponent;
}
