/** Callback type for HMR events. */
export type HmrCallback<T = unknown> = (data: T) => void;

/** HMR API interface for SSE-based hot module replacement. */
export interface HmrApi {
  /** Listen to an HMR event. */
  on<T = unknown>(event: string, cb: HmrCallback<T>): void;
  /** Remove an HMR event listener. */
  off<T = unknown>(event: string, cb: HmrCallback<T>): void;
  /** Register cleanup callback before module disposal. */
  dispose(cb: () => void): void;
  /** Persistent data across HMR updates. */
  data: Record<string, unknown>;
}

/** No-op HMR implementation for production - tree-shakes to nothing. */
const noopHmr: HmrApi = {
  on() {},
  off() {},
  dispose() {},
  data: {},
};

/** Creates the development HMR client with SSE connection. */
function createDevHmr() {
  const listeners = new Map<string, Set<HmrCallback>>();
  const disposeCallbacks: Array<() => void> = [];
  const data: Record<string, unknown> = {};

  if (typeof EventSource !== "undefined" && typeof location !== "undefined") {
    const es = new EventSource(`${location.origin}/_hmr`);

    es.onopen = () => {
      console.log("[HMR] Connected to dev server");
    };

    es.onmessage = (e) => {
      try {
        const { type, ...payload } = JSON.parse(e.data);
        const cbs = listeners.get(type);
        if (cbs) {
          for (const cb of cbs) {
            try {
              cb(payload);
            } catch (err) {
              console.error(`[HMR] Error in handler for ${type}:`, err);
            }
          }
        }
      } catch (err) {
        console.error("[HMR] Failed to parse message:", err);
      }
    };

    es.onerror = () => {
      console.log("[HMR] Connection lost, reconnecting...");
    };
  }

  return {
    on<T = unknown>(event: string, cb: HmrCallback<T>) {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)!.add(cb as HmrCallback);
    },
    off<T = unknown>(event: string, cb: HmrCallback<T>) {
      listeners.get(event)?.delete(cb as HmrCallback);
    },
    dispose(cb: () => void) {
      disposeCallbacks.push(cb);
    },
    data,
  };
}

declare global {
  /**
   * Build-time define, substituted by the bundler's replace plugin
   * (key: `globalThis.__SF_DEV__`). Must be referenced textually as
   * `globalThis.__SF_DEV__` so the substitution matches — a type-cast form like
   * `(globalThis as ...).__SF_DEV__` does not contain that literal and is left
   * as `undefined`, which silently disabled HMR in dev.
   */
  // eslint-disable-next-line no-var
  var __SF_DEV__: boolean | undefined;
}

/** HMR instance - dev in dev mode, no-op in production. */
export const hmr: HmrApi = globalThis.__SF_DEV__ ? createDevHmr() : noopHmr;
