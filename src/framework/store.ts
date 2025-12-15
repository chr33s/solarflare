/**
 * Solarflare Store
 * Signal-based reactive state management using @preact/signals-core
 * Provides context for route params, server data, and shared state
 */

import { signal, computed, effect, batch, type ReadonlySignal, type Signal } from "@preact/signals-core";

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
 * Set server data loading state
 */
export function setServerDataLoading(loading: boolean): void {
  _serverData.value = {
    ..._serverData.value,
    loading,
  };
}

/**
 * Set server data error
 */
export function setServerDataError(error: Error): void {
  _serverData.value = {
    data: null,
    loading: false,
    error,
  };
}

/**
 * Set current pathname
 */
export function setPathname(path: string): void {
  _pathname.value = path;
}

/**
 * Batch multiple store updates
 */
export function batchUpdate(fn: () => void): void {
  batch(fn);
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

/**
 * Get a specific param value
 */
export function getParam(name: string): string | undefined {
  return _params.value[name];
}

// ============================================================================
// Computed Helpers
// ============================================================================

/**
 * Create a computed signal that extracts a specific param
 */
export function computedParam(name: string): ReadonlySignal<string | undefined> {
  return computed(() => _params.value[name]);
}

/**
 * Create a computed signal for typed server data
 */
export function computedData<T>(): ReadonlySignal<T | null> {
  return computed(() => _serverData.value.data as T | null);
}

/**
 * Create a computed signal for loading state
 */
export function isLoading(): ReadonlySignal<boolean> {
  return computed(() => _serverData.value.loading);
}

/**
 * Create a computed signal for error state
 */
export function hasError(): ReadonlySignal<Error | null> {
  return computed(() => _serverData.value.error);
}

// ============================================================================
// Effect Helpers
// ============================================================================

/**
 * Run an effect when params change
 */
export function onParamsChange(callback: (params: Record<string, string>) => void | (() => void)): () => void {
  return effect(() => callback(_params.value));
}

/**
 * Run an effect when server data changes
 */
export function onServerDataChange<T>(callback: (data: ServerData<T>) => void | (() => void)): () => void {
  return effect(() => callback(_serverData.value as ServerData<T>));
}

// ============================================================================
// SSR Context Injection
// ============================================================================

/**
 * Serialize store state for client hydration
 * Injects a script tag with the initial state
 */
export function serializeStoreForHydration(): string {
  const state = {
    params: _params.value,
    serverData: _serverData.value.data,
    pathname: _pathname.value,
  };
  
  // Escape for safe embedding in HTML
  const json = JSON.stringify(state)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026");
  
  return `<script>window.__SF_STORE__=${json}</script>`;
}

/**
 * Hydrate store from serialized state (client-side)
 */
export function hydrateStore(): void {
  if (typeof window === "undefined") return;
  
  const state = (window as any).__SF_STORE__;
  if (!state) return;
  
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
