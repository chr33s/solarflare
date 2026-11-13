import { serializeToString, parseFromString, escapeScriptText } from "./serialize.ts";
import { initStore, setPathname, params, serverData, pathname } from "./store.ts";

/** Store island ID. */
const STORE_ISLAND_ID = "sf-store";

/** Gets the default data island ID for a component tag. */
export function getComponentDataIslandId(tag: string) {
  return `${tag}-data`;
}

/** Gets the deferred data island ID for a component tag and key. */
export function getDeferredIslandId(tag: string, key: string) {
  return `${tag}-deferred-${key}`;
}

/** Gets the deferred hydration script ID for a component tag and key. */
export function getHydrateScriptId(tag: string, key: string) {
  return `${tag}-hydrate-${key}`;
}

/** Gets the deferred data island prefix for a component tag. */
export function getDeferredIslandPrefix(tag: string) {
  return `${tag}-deferred-`;
}

/** Gets the hydration script prefix for a component tag. */
export function getHydrateScriptPrefix(tag: string) {
  return `${tag}-hydrate-`;
}

/**
 * Serializes data to a script tag for progressive hydration.
 * Includes a stable id attribute for diff-dom-streaming replacements.
 */
export async function serializeDataIsland(id: string, data: unknown) {
  const serialized = escapeScriptText(await serializeToString(data));
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

  const islandId = dataIslandId ?? getComponentDataIslandId(tag);
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

/** Processes ready hydration items without blocking siblings on missing tags. */
async function processHydrationQueue() {
  if (processingQueue) return;
  processingQueue = true;

  while (hydrationQueue.length > 0) {
    const ready: Array<{ tag: string; id: string; attempts: number }> = [];
    const deferred: Array<{ tag: string; id: string; attempts: number }> = [];

    while (hydrationQueue.length > 0) {
      const item = hydrationQueue.shift();
      if (!item) continue;
      if (document.querySelector(item.tag)) {
        ready.push(item);
      } else if (item.attempts < MAX_HYDRATION_RETRIES) {
        deferred.push({ ...item, attempts: item.attempts + 1 });
      }
    }

    for (const item of ready) {
      try {
        await hydrateComponent(item.tag, item.id);
      } catch (err) {
        console.error("[solarflare] hydrateComponent error:", err);
      }
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    if (deferred.length === 0) break;

    // Re-queue missing tags after a short delay without stalling ready siblings
    await new Promise((resolve) => setTimeout(resolve, HYDRATION_RETRY_DELAY_MS));
    for (const item of deferred) {
      hydrationQueue.push(item);
    }
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
