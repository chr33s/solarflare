import { hydrateComponent } from "./store.ts";

/** Module-level hydration state. */
let hydrationReady = false;
const hydrationQueue: Array<{ tag: string; id: string; attempts: number }> = [];
let eventListenerAttached = false;
let processingQueue = false;
const MAX_HYDRATION_RETRIES = 50;
const HYDRATION_RETRY_DELAY_MS = 50;

/** Handles hydration queue events. */
function handleQueueHydrateEvent(e: Event): void {
  const { tag, id } = (e as CustomEvent<{ tag: string; id: string }>).detail;
  queueHydration(tag, id);
}

/** Processes the hydration queue sequentially. */
async function processHydrationQueue(): Promise<void> {
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
export function queueHydration(tag: string, dataIslandId: string): void {
  hydrationQueue.push({ tag, id: dataIslandId, attempts: 0 });
  if (hydrationReady) {
    void processHydrationQueue();
  }
}

/** Checks if hydration coordinator is initialized. */
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

  hydrationReady = true;
  void processHydrationQueue();
}

/** Cleans up the hydration coordinator (call on app unmount/navigation). */
export function cleanupHydrationCoordinator(): void {
  if (typeof document === "undefined") return;

  if (eventListenerAttached) {
    document.removeEventListener("sf:queue-hydrate", handleQueueHydrateEvent);
    eventListenerAttached = false;
  }

  hydrationReady = false;
  processingQueue = false;
  hydrationQueue.length = 0;
}
