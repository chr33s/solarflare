/**
 * Solarflare Store
 * Signal-based reactive state management using @preact/signals
 * Provides context for route params, server data, and shared state
 */

import { signal, computed, effect, batch, type ReadonlySignal, type Signal } from "@preact/signals";
import { serializeToString, parseFromString } from "./serialize";

// ============================================================================
// Types
// ============================================================================

/**
 * Server-rendered data passed to components
 */
export interface ServerData<T = unknown> {
  /** The actual data payload */
  data: T;
  /** Whether data is still loading (for streaming) */
  loading: boolean;
  /** Error if data fetch failed */
  error: Error | null;
}

/**
 * Store configuration
 */
export interface StoreConfig {
  /** Initial route params */
  params?: Record<string, string>;
  /** Initial server data */
  serverData?: unknown;
}

// ============================================================================
// Global Signals Store
// ============================================================================

/**
 * Internal signals for the store
 * These are module-level singletons for both SSR and client
 */
const _params = signal<Record<string, string>>({});
const _serverData = signal<ServerData<unknown>>({
  data: null,
  loading: false,
  error: null,
});
const _pathname = signal<string>("");

/**
 * Route parameters signal (readonly)
 * Use getRouter().params for reactive access in components
 */
export const params: ReadonlySignal<Record<string, string>> = _params;

/**
 * Server data signal (readonly)
 * Contains data loaded by server components
 */
export const serverData: ReadonlySignal<ServerData<unknown>> = _serverData;

/**
 * Current pathname signal (readonly)
 */
export const pathname: ReadonlySignal<string> = _pathname;

// ============================================================================
// Store API
// ============================================================================

/**
 * Set route parameters
 * Called by the router on navigation
 */
export function setParams(newParams: Record<string, string>): void {
  _params.value = newParams;
}

/**
 * Set server data
 * Called during SSR or after server component loads
 */
export function setServerData<T>(data: T): void {
  _serverData.value = {
    data,
    loading: false,
    error: null,
  };
}

/**
 * Set current pathname
 */
export function setPathname(path: string): void {
  _pathname.value = path;
}

/**
 * Initialize store with config
 * Called on SSR and client hydration
 */
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

/**
 * Reset store to initial state
 */
export function resetStore(): void {
  batch(() => {
    _params.value = {};
    _serverData.value = { data: null, loading: false, error: null };
    _pathname.value = "";
  });
}

// ============================================================================
// SSR Context Injection
// ============================================================================

/**
 * Serialize store state for client hydration using turbo-stream
 * Injects a script tag with the initial state
 * Supports complex types: Date, Map, Set, RegExp, BigInt, Promises, etc.
 */
export async function serializeStoreForHydration(): Promise<string> {
  const state = {
    params: _params.value,
    serverData: _serverData.value.data,
    pathname: _pathname.value,
  };

  // Use turbo-stream for safe serialization of complex types
  const serialized = await serializeToString(state);
  // JSON.stringify to properly escape for embedding in a JS string literal
  // This handles quotes, newlines, backslashes, etc.
  const escaped = JSON.stringify(serialized);

  return `<script>window.__SF_STORE__=${escaped}</script>`;
}

/**
 * Hydrate store from serialized state (client-side)
 * Uses turbo-stream's decode for complex type reconstruction
 */
export async function hydrateStore(): Promise<void> {
  if (typeof window === "undefined") return;

  const serialized = (window as any).__SF_STORE__;
  if (!serialized) return;

  // Parse with turbo-stream to reconstruct complex types
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

  // Clean up
  delete (window as any).__SF_STORE__;
}

// ============================================================================
// Re-exports for convenience
// ============================================================================

export { signal, computed, effect, batch };
export type { ReadonlySignal, Signal };

// ============================================================================
// Data Islands
// ============================================================================

/**
 * Serialize data to a script tag for progressive hydration
 * Uses turbo-stream to preserve complex types (Date, Map, Set, etc.)
 *
 * @example
 * ```tsx
 * const island = await serializeDataIsland('sf-blog-slug-data', {
 *   title: 'Hello',
 *   createdAt: new Date(),
 * });
 * // <script type="application/json" data-island="sf-blog-slug-data">[...]</script>
 * ```
 */
export async function serializeDataIsland(id: string, data: unknown): Promise<string> {
  const serialized = await serializeToString(data);
  return `<script type="application/json" data-island="${id}">${serialized}</script>`;
}

/**
 * Extract and parse data from a data island script tag (client-side)
 * Reconstructs complex types using turbo-stream's decode
 *
 * @example
 * ```tsx
 * const data = await extractDataIsland<BlogPost>('sf-blog-slug-data');
 * console.log(data?.createdAt instanceof Date); // true
 * ```
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

// ============================================================================
// Hydration Coordinator
// ============================================================================

/**
 * Hydrate a component when its data island arrives
 * Called by the injected hydration script after streaming
 * Updates element attributes to trigger preact-custom-element re-render
 */
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

  // Get data from island if specified
  const islandId = dataIslandId ?? `${tag}-data`;
  const data = await extractDataIsland<Record<string, unknown>>(islandId);

  if (data && typeof data === "object") {
    // Remove loading state
    element.removeAttribute("data-loading");

    // Always store deferred data on element for component to read
    // This handles the case where hydration runs before component mounts
    element._sfDeferred = data;

    // If component is already mounted, also dispatch event to trigger re-render
    // The component listens for this event to handle late-arriving data
    element.dispatchEvent(
      new CustomEvent("sf:hydrate", {
        detail: data,
        bubbles: true,
      }),
    );
  }
}

/**
 * Initialize the global hydration trigger
 * Called during client initialization
 */
export function initHydrationCoordinator(): void {
  if (typeof window === "undefined") return;

  // Process any queued hydration calls that arrived before JS loaded
  const queue = (window as any).__SF_HYDRATE_QUEUE__ as [string, string][] | undefined;
  if (queue) {
    for (const [tag, dataIslandId] of queue) {
      void hydrateComponent(tag, dataIslandId);
    }
    delete (window as any).__SF_HYDRATE_QUEUE__;
  }

  // Expose global hydration trigger for streaming scripts
  (window as any).__SF_HYDRATE__ = hydrateComponent;
}
