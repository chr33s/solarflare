/** Signal-based reactive state management using `@preact/signals`. */

import { signal, computed, effect, batch, type ReadonlySignal, type Signal } from "@preact/signals";
import { serializeToString, parseFromString } from "./serialize.ts";
import { serializeHeadState, hydrateHeadState } from "./head.ts";

/** Server-rendered data. */
export interface ServerData<T = unknown> {
  /** Data payload */
  data: T;
  /** Loading state (for streaming) */
  loading: boolean;
  /** Fetch error if any */
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

/**
 * Sets route parameters.
 * @param newParams - New parameter values
 */
export function setParams(newParams: Record<string, string>): void {
  // Use Object.assign to prevent prototype pollution
  _params.value = Object.assign({}, newParams);
}

/**
 * Sets server data.
 * @template T - Data type
 * @param data - Server data value
 */
export function setServerData<T>(data: T): void {
  _serverData.value = {
    data,
    loading: false,
    error: null,
  };
}

/**
 * Sets current pathname.
 * @param path - Pathname value
 */
export function setPathname(path: string): void {
  _pathname.value = path;
}

/**
 * Initializes store with config.
 * @param config - Store configuration
 */
export function initStore(config: StoreConfig = {}): void {
  batch(() => {
    if (config.params) {
      // Use Object.assign to prevent prototype pollution
      _params.value = Object.assign({}, config.params);
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

/** Data island ID for store hydration. */
const STORE_ISLAND_ID = "sf-store";

/** Data island ID for head hydration. */
const HEAD_ISLAND_ID = "sf-head";

/**
 * Serializes store state for client hydration using a data island.
 * @returns HTML script tag with serialized state
 */
export async function serializeStoreForHydration(): Promise<string> {
  const state = {
    params: _params.value,
    serverData: _serverData.value.data,
    pathname: _pathname.value,
  };

  return serializeDataIsland(STORE_ISLAND_ID, state);
}

/**
 * Serializes head state for client hydration using a data island.
 * @returns HTML script tag with serialized head state
 */
export async function serializeHeadForHydration(): Promise<string> {
  return /* html */ `<script type="application/json" data-island="${HEAD_ISLAND_ID}">${serializeHeadState()}</script>`;
}

/**
 * Hydrates store from serialized state (client-side).
 * @returns Promise that resolves when hydration completes
 */
export async function hydrateStore(): Promise<void> {
  if (typeof document === "undefined") return;

  const state = await extractDataIsland<{
    params: Record<string, string>;
    serverData: unknown;
    pathname: string;
  }>(STORE_ISLAND_ID);

  if (!state) return;

  initStore({
    params: state.params,
    serverData: state.serverData,
  });

  setPathname(state.pathname);

  // Clean up the data island after extraction
  const script = document.querySelector(`script[data-island="${STORE_ISLAND_ID}"]`);
  script?.remove();
}

/**
 * Hydrates head state from serialized data island (client-side).
 * @returns Promise that resolves when hydration completes
 */
export async function hydrateHead(): Promise<void> {
  if (typeof document === "undefined") return;

  const script = document.querySelector(`script[data-island="${HEAD_ISLAND_ID}"]`);
  if (!script?.textContent) return;

  hydrateHeadState(script.textContent);

  // Clean up the data island after extraction
  script.remove();
}

export { signal, computed, effect, batch };
export type { ReadonlySignal, Signal };

/**
 * Serializes data to a script tag for progressive hydration.
 * @param id - Unique data island identifier
 * @param data - Data to serialize
 * @returns HTML script tag with serialized data
 */
export async function serializeDataIsland(id: string, data: unknown): Promise<string> {
  const serialized = await serializeToString(data);
  return /* html */ `<script type="application/json" data-island="${id}">${serialized}</script>`;
}

/**
 * Extracts and parses data from a data island script tag (client-side).
 * @template T - Expected data type
 * @param id - Data island identifier
 * @returns Parsed data or null if not found
 */
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

/**
 * Hydrates a component when its data island arrives.
 * @param tag - Custom element tag name
 * @param dataIslandId - Optional data island identifier
 * @returns Promise that resolves when hydration completes
 */
export async function hydrateComponent(tag: string, dataIslandId?: string): Promise<void> {
  if (typeof document === "undefined") return;

  const element = document.querySelector(tag) as HTMLElement & {
    _sfDeferred?: Record<string, unknown>;
    _vdom?: unknown;
  };
  if (!element) return;

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

/** Module-level hydration state. */
let hydrationReady = false;
const hydrationQueue: [string, string][] = [];
let eventListenerAttached = false;

/** Handles hydration queue events. */
function handleQueueHydrateEvent(e: Event): void {
  const { tag, id } = (e as CustomEvent<{ tag: string; id: string }>).detail;
  queueHydration(tag, id);
}

/**
 * Queues a hydration call or executes immediately if coordinator is ready.
 * @param tag - Custom element tag name
 * @param dataIslandId - Data island identifier
 */
export function queueHydration(tag: string, dataIslandId: string): void {
  if (hydrationReady) {
    void hydrateComponent(tag, dataIslandId);
  } else {
    hydrationQueue.push([tag, dataIslandId]);
  }
}

/**
 * Checks if hydration coordinator is initialized.
 * @returns Whether hydration is ready
 */
export function isHydrationReady(): boolean {
  return hydrationReady;
}

/** Initializes the hydration coordinator. */
export function initHydrationCoordinator(): void {
  if (typeof document === "undefined") return;

  // Attach event listener for streaming SSR hydration triggers (only once)
  if (!eventListenerAttached) {
    document.addEventListener("sf:queue-hydrate", handleQueueHydrateEvent);
    eventListenerAttached = true;
  }

  if (hydrationReady) return;

  // Process any queued hydration calls
  for (const [tag, dataIslandId] of hydrationQueue) {
    // Skip stale entries for elements no longer in the DOM
    if (!document.querySelector(tag)) continue;
    void hydrateComponent(tag, dataIslandId);
  }
  hydrationQueue.length = 0;

  hydrationReady = true;
}

/** Cleans up the hydration coordinator (call on app unmount/navigation). */
export function cleanupHydrationCoordinator(): void {
  if (typeof document === "undefined") return;

  if (eventListenerAttached) {
    document.removeEventListener("sf:queue-hydrate", handleQueueHydrateEvent);
    eventListenerAttached = false;
  }

  hydrationReady = false;
  hydrationQueue.length = 0;
}
