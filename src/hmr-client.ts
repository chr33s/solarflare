/**
 * Framework HMR Client
 *
 * Provides a framework-native HMR API that replaces Vite's import.meta.hot.
 * In production builds, the dev implementation tree-shakes to nothing.
 *
 * Build-time replacement:
 * - Development: globalThis.__SF_DEV__ → true (full HMR with WebSocket)
 * - Production: globalThis.__SF_DEV__ → false (no-op, tree-shakes away)
 */

/** Callback type for HMR events. */
export type HmrCallback<T = unknown> = (data: T) => void;

/** HMR API interface matching Vite's import.meta.hot. */
export interface HmrApi {
  /** Listen to an HMR event. */
  on<T = unknown>(event: string, cb: HmrCallback<T>): void;
  /** Remove an HMR event listener. */
  off<T = unknown>(event: string, cb: HmrCallback<T>): void;
  /** Accept module updates (compatibility stub). */
  accept(dep?: string | ((mod: unknown) => void), cb?: (mod: unknown) => void): void;
  /** Register cleanup callback before module disposal. */
  dispose(cb: () => void): void;
  /** Send an event to the HMR server. */
  send(event: string, data?: unknown): void;
  /** Persistent data across HMR updates. */
  data: Record<string, unknown>;
}

/** No-op HMR implementation for production - tree-shakes to nothing. */
const noopHmr: HmrApi = {
  on() {},
  off() {},
  accept() {},
  dispose() {},
  send() {},
  data: {},
};

/** Creates the development HMR client with WebSocket connection. */
function createDevHmr(): HmrApi {
  const listeners = new Map<string, Set<HmrCallback>>();
  const disposeCallbacks: Array<() => void> = [];
  const data: Record<string, unknown> = {};
  let ws: WebSocket | null = null;
  let messageQueue: Array<{ type: string; data?: unknown }> = [];

  // Connect to dev server WebSocket
  if (typeof WebSocket !== "undefined" && typeof location !== "undefined") {
    const protocol = location.protocol === "https:" ? "wss:" : "ws:";
    ws = new WebSocket(`${protocol}//${location.host}/_hmr`);

    ws.onopen = () => {
      console.log("[HMR] Connected to dev server");
      for (const msg of messageQueue) {
        ws?.send(JSON.stringify(msg));
      }
      messageQueue = [];
    };

    ws.onmessage = (e) => {
      try {
        const { type, data } = JSON.parse(e.data);
        const cbs = listeners.get(type);
        if (cbs) {
          for (const cb of cbs) {
            try {
              cb(data);
            } catch (err) {
              console.error(`[HMR] Error in handler for ${type}:`, err);
            }
          }
        }
      } catch (err) {
        console.error("[HMR] Failed to parse message:", err);
      }
    };

    ws.onclose = () => {
      console.log("[HMR] Disconnected from dev server");
      setTimeout(() => {
        if (typeof location !== "undefined") location.reload();
      }, 1000);
    };

    ws.onerror = (err) => {
      console.error("[HMR] WebSocket error:", err);
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
    accept() {},
    dispose(cb) {
      disposeCallbacks.push(cb);
    },
    send(event: string, payload?: unknown) {
      const msg = { type: event, data: payload };
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(msg));
      } else {
        messageQueue.push(msg);
      }
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
