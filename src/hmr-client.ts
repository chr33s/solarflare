/**
 * Framework HMR Client
 *
 * Provides a framework-native HMR API that replaces Vite's import.meta.hot.
 * In production builds, the dev implementation tree-shakes to nothing.
 *
 * Build-time replacement:
 * - Development: globalThis.__SF_DEV__ → true (full HMR with SSE/EventSource)
 * - Production: globalThis.__SF_DEV__ → false (no-op, tree-shakes away)
 */

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
function createDevHmr(): HmrApi {
  const listeners = new Map<string, Set<HmrCallback>>();
  const disposeCallbacks: Array<() => void> = [];
  const data: Record<string, unknown> = {};

  // Connect to dev server via SSE
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
    dispose(cb) {
      disposeCallbacks.push(cb);
    },
    data,
  };
}

/**
 * HMR instance - dev in dev mode, no-op in production (tree-shakes away).
 * The globalThis.__SF_DEV__ check is replaced at build time.
 */
export const hmr: HmrApi = (globalThis as unknown as { __SF_DEV__?: boolean }).__SF_DEV__
  ? createDevHmr()
  : noopHmr;
