import { serializeToString, parseFromString } from "./serialize.ts";
import { serializeHeadState, hydrateHeadState } from "./head.ts";
import { initStore, setPathname, params, serverData, pathname } from "./store.ts";

/** Store island ID. */
const STORE_ISLAND_ID = "sf-store";

/** Head island ID. */
const HEAD_ISLAND_ID = "sf-head";

/**
 * Serializes data to a script tag for progressive hydration.
 * Includes a stable id attribute for diff-dom-streaming replacements.
 */
export async function serializeDataIsland(id: string, data: unknown) {
  const serialized = await serializeToString(data);
  return /* html */ `<script type="application/json" id="${id}" data-island="${id}">${serialized}</script>`;
}

/** Extracts and parses data from a data island script tag. */
export async function extractDataIsland<T = unknown>(id: string) {
  if (typeof document === "undefined") return null;

  const script = document.querySelector(`script[data-island="${CSS.escape(id)}"]`);
  if (!script?.textContent) return null;

  try {
    return await parseFromString<T>(script.textContent);
  } catch {
    console.error(`[solarflare] Failed to parse data island "${id}"`);
    return null;
  }
}

/** Serializes store state for client hydration. */
export async function serializeStoreForHydration() {
  const state = {
    params: params.value,
    serverData: serverData.value.data,
    pathname: pathname.value,
  };

  return serializeDataIsland(STORE_ISLAND_ID, state);
}

/** Serializes head state for client hydration. */
export async function serializeHeadForHydration() {
  return /* html */ `<script type="application/json" data-island="${HEAD_ISLAND_ID}">${serializeHeadState()}</script>`;
}

/** Hydrates store from serialized state (client-side). */
export async function hydrateStore() {
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

  const script = document.querySelector(`script[data-island="${CSS.escape(STORE_ISLAND_ID)}"]`);
  script?.remove();
}

/** Hydrates head state from serialized data island (client-side). */
export async function hydrateHead() {
  if (typeof document === "undefined") return;

  const script = document.querySelector(`script[data-island="${CSS.escape(HEAD_ISLAND_ID)}"]`);
  if (!script?.textContent) return;

  hydrateHeadState(script.textContent);

  script.remove();
}

/** Navigation mode flag - when true, don't remove data island scripts during hydration. */
let navigationMode = false;

/** Sets navigation mode (called by router during client-side navigation). */
export function setNavigationMode(active: boolean) {
  navigationMode = active;
}

/**
 * Hydrates a component when its data island arrives.
 * Removes island scripts unless navigation mode is active.
 */
export async function hydrateComponent(tag: string, dataIslandId?: string) {
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
    element._sfDeferred = { ...element._sfDeferred, ...data };

    if (!navigationMode) {
      const scripts = document.querySelectorAll(`script[data-island="${CSS.escape(islandId)}"]`);
      scripts.forEach((script) => script.remove());
    }

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
const hydrationQueue: Array<{ tag: string; id: string; attempts: number }> = [];
let eventListenerAttached = false;
let processingQueue = false;
const MAX_HYDRATION_RETRIES = 50;
const HYDRATION_RETRY_DELAY_MS = 50;

/** Handles hydration queue events. */
function handleQueueHydrateEvent(e: Event) {
  const { tag, id } = (e as CustomEvent<{ tag: string; id: string }>).detail;
  queueHydration(tag, id);
}

/** Processes the hydration queue sequentially. */
async function processHydrationQueue() {
  if (processingQueue) return;
  processingQueue = true;

  while (hydrationQueue.length > 0) {
    const item = hydrationQueue.shift();
    if (!item) continue;

    const { tag, id: dataIslandId, attempts } = item;
    // Skip stale entries for elements no longer in the DOM
    if (!document.querySelector(tag)) {
      if (attempts < MAX_HYDRATION_RETRIES) {
        hydrationQueue.push({ tag, id: dataIslandId, attempts: attempts + 1 });
      }
      await new Promise((resolve) => setTimeout(resolve, HYDRATION_RETRY_DELAY_MS));
      continue;
    }

    try {
      await hydrateComponent(tag, dataIslandId);
    } catch (err) {
      console.error("[solarflare] hydrateComponent error:", err);
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  processingQueue = false;
}

/** Queues a hydration call. */
export function queueHydration(tag: string, dataIslandId: string) {
  hydrationQueue.push({ tag, id: dataIslandId, attempts: 0 });
  if (hydrationReady) {
    void processHydrationQueue();
  }
}

/** Checks if hydration coordinator is initialized. */
export function isHydrationReady() {
  return hydrationReady;
}

/** Initializes the hydration coordinator. */
export function initHydrationCoordinator() {
  if (typeof document === "undefined") return;

  // Attach event listener for streaming SSR hydration triggers (only once)
  if (!eventListenerAttached) {
    document.addEventListener("sf:queue-hydrate", handleQueueHydrateEvent);
    eventListenerAttached = true;
  }

  if (hydrationReady) return;

  hydrationReady = true;
  void processHydrationQueue();
}

/** Cleans up the hydration coordinator (call on app unmount/navigation). */
export function cleanupHydrationCoordinator() {
  if (typeof document === "undefined") return;

  if (eventListenerAttached) {
    document.removeEventListener("sf:queue-hydrate", handleQueueHydrateEvent);
    eventListenerAttached = false;
  }

  hydrationReady = false;
  processingQueue = false;
  hydrationQueue.length = 0;
}
