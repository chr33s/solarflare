import { signal, computed, effect, type ReadonlySignal } from "@preact/signals";
import diff from "./diff-dom-streaming.ts";
import { resetHeadContext } from "./head.ts";
import { setNavigationMode } from "./store.ts";
import type { RouteManifestEntry, RoutesManifest } from "./manifest.ts";
export type { RouteManifestEntry, RoutesManifest } from "./manifest.ts";
import { dedupeDeferredScripts, handleDeferredHydrationNode } from "./router-deferred.ts";

/** Internal route representation. */
interface Route {
  pattern: URLPattern;
  entry: RouteManifestEntry;
}

/** Route match result. */
export interface RouteMatch {
  entry: RouteManifestEntry;
  params: Record<string, string>;
  url: URL;
}

/** Navigation options. */
export interface NavigateOptions {
  replace?: boolean;
  state?: unknown;
  skipTransition?: boolean;
}

/** Router configuration. */
export interface RouterConfig {
  base?: string;
  viewTransitions?: boolean;
  scrollBehavior?: "auto" | "smooth" | "instant" | false;
  onNotFound?: (url: URL) => void;
  onNavigate?: (match: RouteMatch) => void;
  onError?: (error: Error, url: URL) => void;
}

/** Subscription callback for route changes. */
export type RouteSubscriber = (match: RouteMatch | null) => void;

/** Checks if View Transitions API is supported. */
export function supportsViewTransitions(): boolean {
  return typeof document !== "undefined" && "startViewTransition" in document;
}

/** Fetch retry options. */
export interface FetchRetryOptions {
  /** Max retry attempts. @default 3 */
  maxRetries?: number;
  /** Base delay in ms between retries. @default 1000 */
  baseDelay?: number;
  /** Status codes to retry on. @default 5xx errors */
  retryOnStatus?: (status: number) => boolean;
}

/** Fetch with exponential backoff retry for transient failures. */
export async function fetchWithRetry(
  input: RequestInfo | URL,
  init?: RequestInit,
  options: FetchRetryOptions = {},
): Promise<Response> {
  const { maxRetries = 3, baseDelay = 1000, retryOnStatus = (status) => status >= 500 } = options;

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(input, init);

      // Don't retry client errors (4xx), only server errors (5xx)
      if (response.ok || !retryOnStatus(response.status)) {
        return response;
      }

      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      // Network errors are retryable
      lastError = error instanceof Error ? error : new Error(String(error));
    }

    // Don't wait after the last attempt
    if (attempt < maxRetries) {
      const delay = baseDelay * Math.pow(2, attempt);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastError ?? new Error("Fetch failed after retries");
}

/** Client-side SPA router using Navigation API and View Transitions. */
export class Router {
  #routes: Route[] = [];
  #config: Required<RouterConfig>;
  #started = false;
  #cleanupFns: (() => void)[] = [];

  /** Current route match signal. */
  readonly current = signal<RouteMatch | null>(null);

  /** Current route params signal. */
  readonly params: ReadonlySignal<Record<string, string>>;

  /** Current pathname signal. */
  readonly pathname: ReadonlySignal<string>;

  constructor(manifest: RoutesManifest, config: RouterConfig = {}) {
    const getMeta = <T extends string>(name: string): T | null => {
      if (typeof document === "undefined") return null;
      const meta = document.querySelector(`meta[name="sf:${name}"]`);
      return (meta?.getAttribute("content") as T) ?? null;
    };

    const metaBase = getMeta("base");
    const metaViewTransitions = getMeta<"true" | "false">("view-transitions");
    const metaScrollBehavior = getMeta<"auto" | "smooth" | "instant">("scroll-behavior");

    this.#config = {
      base: config.base ?? metaBase ?? manifest.base ?? "",
      viewTransitions: config.viewTransitions ?? metaViewTransitions === "true",
      scrollBehavior: config.scrollBehavior ?? metaScrollBehavior ?? "auto",
      onNotFound: config.onNotFound ?? (() => {}),
      onNavigate: config.onNavigate ?? (() => {}),
      onError:
        config.onError ??
        ((error, url) => {
          console.error(`[solarflare] Navigation error for ${url.href}:`, error);
        }),
    };

    this.params = computed(() => this.current.value?.params ?? {});
    this.pathname = computed(() => this.current.value?.url.pathname ?? "");
    this.#loadManifest(manifest);
  }

  /** Loads routes from build-time manifest. */
  #loadManifest(manifest: RoutesManifest): void {
    for (const entry of manifest.routes) {
      if (entry.type !== "client") continue;

      const pathname = this.#config.base + entry.pattern;
      this.#routes.push({
        pattern: new URLPattern({ pathname }),
        entry,
      });
    }

    this.#routes.sort((a, b) => {
      const aStatic = (a.entry.pattern.match(/[^:*]+/g) || []).join("").length;
      const bStatic = (b.entry.pattern.match(/[^:*]+/g) || []).join("").length;
      return bStatic - aStatic;
    });
  }

  /** Handles navigation errors. */
  #handleError(error: Error, url: URL): void {
    this.#config.onError(error, url);

    const app = document.querySelector("#app");
    if (app) {
      const escapeHtml = (str: string) =>
        str.replace(
          /[&<>"']/g,
          (c) =>
            ({
              "&": "&amp;",
              "<": "&lt;",
              ">": "&gt;",
              '"': "&quot;",
              "'": "&#39;",
            })[c] || c,
        );

      app.innerHTML = /* html */ `<div><h1>Error</h1><p>${escapeHtml(error.message)}</p></div>`;
    }
  }

  /** Matches a URL against routes. */
  match(url: URL): RouteMatch | null {
    for (const { pattern, entry } of this.#routes) {
      const result = pattern.exec(url);
      if (result) {
        const params: Record<string, string> = {};
        for (const [key, value] of Object.entries(result.pathname.groups)) {
          if (value != null) params[key] = value as string;
        }
        return { entry, params, url };
      }
    }
    return null;
  }

  /** Navigates to a URL. */
  async navigate(to: string | URL, options: NavigateOptions = {}): Promise<void> {
    const url = typeof to === "string" ? new URL(to, location.origin) : to;

    const nav = (window as any).navigation;
    if (nav) {
      await nav.navigate(url.href, {
        history: options.replace ? "replace" : "auto",
        state: options.state,
      });
    }
  }

  /** Executes navigation with optional view transition. */
  async #executeNavigation(url: URL, match: RouteMatch | null): Promise<void> {
    try {
      if (match) {
        await this.#loadRoute(match, url);
        this.current.value = match;
        this.#config.onNavigate(match);
      } else {
        this.current.value = null;
        this.#config.onNotFound(url);
      }
      this.#handleScroll(url);

      // Dispatch navigation event for components to re-extract deferred data
      window.dispatchEvent(new CustomEvent("sf:navigate", { detail: { url, match } }));
    } catch (error) {
      this.#handleError(error instanceof Error ? error : new Error(String(error)), url);
    }
  }

  /** Loads route assets and swaps page content. */
  async #loadRoute(match: RouteMatch, url: URL): Promise<void> {
    const { entry } = match;

    // Preload the route chunk *before* DOM diffing so any custom elements for the
    // incoming HTML are already defined when inserted.
    // This avoids edge-cases where upgraded callbacks/hydration don't run reliably
    // when elements are inserted first and defined later.
    if (entry.chunk) {
      const absoluteChunk = new URL(entry.chunk, location.origin).href;
      await import(absoluteChunk);
    }

    const response = await fetchWithRetry(
      url.href,
      { headers: { Accept: "text/html" } },
      { maxRetries: 2, baseDelay: 500 },
    );

    if (!response.ok) {
      throw new Error(`Failed to fetch ${url.href}: ${response.status}`);
    }

    // During client-side navigation we apply streamed HTML via diff-dom-streaming.
    // Track processed hydration scripts and trigger hydration as they're inserted.
    const processedScripts = new Set<string>();

    // Capture the current route tag before diffing so we can detect tag changes.
    const previousTag = document.querySelector("#app > *")?.tagName?.toLowerCase();

    // Use MutationObserver to detect when deferred hydration scripts are inserted
    // into the real DOM and trigger hydration immediately for progressive streaming.
    let observer: MutationObserver | null = null;
    if (typeof MutationObserver !== "undefined") {
      observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
          for (const node of mutation.addedNodes) {
            if (node.nodeType !== 1) continue;
            handleDeferredHydrationNode(entry.tag, processedScripts, node as Element);
          }
        }
      });
      observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
      });
    }

    // Enter navigation mode - tells hydration coordinator to preserve data island scripts
    // during diff, so they can be used by the cloned element after replacement.
    setNavigationMode(true);

    // Use view transitions for visual animation if supported and enabled.
    // Use syncMutations to apply DOM changes immediately during streaming for progressive
    // deferred content hydration. This ensures each streamed chunk is visible immediately.
    const useTransition = this.#config.viewTransitions && supportsViewTransitions();

    try {
      await diff(document, response.body!, {
        transition: useTransition,
        syncMutations: !useTransition, // Apply mutations synchronously when not using view transitions
      });
    } catch (diffError) {
      // diff-dom-streaming can fail with "insertBefore" errors when the DOM was mutated
      // by external factors (Preact custom elements, HMR, extensions). Fallback to a
      // full navigation which lets the browser handle parsing.
      observer?.disconnect();
      setNavigationMode(false);
      console.warn("[solarflare] DOM diff failed, falling back to full navigation:", diffError);
      location.href = url.href;
      return;
    } finally {
      observer?.disconnect();
    }

    // Wait for any pending DOM work to settle before element replacement.
    // With view transitions, wait for ALL transitions to complete (not just the last one).
    // Without them, mutations are flushed synchronously via FLUSH_SYNC, but wait two frames
    // to ensure custom elements have mounted.
    if (useTransition) {
      const transitions: ViewTransition[] | undefined = (window as any).lastDiffTransitions;
      if (transitions?.length) {
        await Promise.all(transitions.map((t) => t.finished.catch(() => {})));
        // Clear for next navigation
        (window as any).lastDiffTransitions = [];
      }
    } else {
      // First frame: batched mutations apply
      await new Promise((r) => requestAnimationFrame(r));
      // Second frame: custom element connectedCallbacks complete
      await new Promise((r) => requestAnimationFrame(r));
    }

    // IMPORTANT: diff-dom-streaming may patch inside an existing custom element subtree,
    // or when tag names differ, it updates children in-place then moves them to a new wrapper.
    // Either way, Preact's event delegation/handlers can be desynced, leading to "dead" UI.
    //
    // Replace the host after diffing to ensure a fresh connectedCallback + event wiring
    // when the route tag changes. When the tag is the same, trigger a rerender to
    // re-bind events without losing local state (e.g. counters).
    const host = document.querySelector(entry.tag) as HTMLElement;
    const needsReplacement = previousTag && previousTag !== entry.tag;

    if (host && needsReplacement) {
      const replacement = host.cloneNode(true) as HTMLElement;
      host.replaceWith(replacement);
      // Wait for connectedCallback of the replacement element to complete
      await new Promise((r) => requestAnimationFrame(r));
    } else if (host) {
      host.dispatchEvent(new CustomEvent("sf:rerender"));
      await new Promise((r) => requestAnimationFrame(r));
    }

    // Clean up any duplicate deferred islands or hydrate scripts introduced by
    // streaming diffs while navigation mode preserved previous scripts.
    dedupeDeferredScripts(entry.tag);

    // Exit navigation mode - allow normal script cleanup going forward
    setNavigationMode(false);

    // Reset head context after navigation - the new HTML has fresh head tags
    // and any new useHead calls from hydrated components will be fresh
    resetHeadContext();

    if (entry.styles?.length) {
      for (const href of entry.styles) {
        const absoluteHref = new URL(href, location.origin).href;
        if (!document.querySelector(`link[href="${absoluteHref}"], link[href="${href}"]`)) {
          const link = document.createElement("link");
          link.rel = "stylesheet";
          link.href = absoluteHref;
          document.head.appendChild(link);
        }
      }
    }
  }

  /** Handles scroll restoration. */
  #handleScroll(url: URL): void {
    const behavior = this.#config.scrollBehavior;
    if (behavior === false) return;

    const scrollBehavior: ScrollBehavior = behavior === "instant" ? "auto" : behavior;

    if (url.hash) {
      const target = document.querySelector(url.hash);
      if (target) {
        target.scrollIntoView({ behavior: scrollBehavior });
        return;
      }
    }

    scrollTo({ top: 0, left: 0, behavior: scrollBehavior });
  }

  /** Starts intercepting navigation. */
  start(): this {
    if (this.#started) return this;

    this.#setupNavigationAPI();

    const url = new URL(location.href);
    const match = this.match(url);
    if (match) {
      this.current.value = match;
    }

    this.#started = true;
    return this;
  }

  /** Stops the router and cleans up listeners. */
  stop(): this {
    for (const cleanup of this.#cleanupFns) {
      cleanup();
    }
    this.#cleanupFns = [];
    this.#started = false;
    return this;
  }

  /** Sets up Navigation API interception. */
  #setupNavigationAPI(): void {
    const nav = (window as any).navigation;
    if (!nav) return; // Navigation API not supported (e.g., Safari)

    const handler = (event: any) => {
      if (!event.canIntercept || event.downloadRequest) return;

      const url = new URL(event.destination.url);
      if (url.origin !== location.origin) return;

      const match = this.match(url);
      if (!match) return;

      event.intercept({
        scroll: "manual",
        handler: () => this.#executeNavigation(url, match),
      });
    };

    nav.addEventListener("navigate", handler);
    this.#cleanupFns.push(() => nav.removeEventListener("navigate", handler));
  }

  /** Subscribes to route changes. Returns unsubscribe function. */
  subscribe(callback: RouteSubscriber): () => void {
    return effect(() => {
      callback(this.current.value);
    });
  }

  back(): void {
    history.back();
  }

  forward(): void {
    history.forward();
  }

  go(delta: number): void {
    history.go(delta);
  }

  /** Checks if a path matches the current route. */
  isActive(path: string, exact = false): boolean {
    const match = this.current.value;
    if (!match) {
      if (typeof location === "undefined") return false;
      const currentPath = location.pathname;
      return exact ? currentPath === path : currentPath.startsWith(path);
    }

    const currentPath = match.url.pathname;
    return exact ? currentPath === path : currentPath.startsWith(path);
  }

  /** Returns a computed signal for reactive isActive check. */
  isActiveSignal(path: string, exact = false): ReadonlySignal<boolean> {
    return computed(() => {
      const match = this.current.value;
      if (!match) return false;
      const currentPath = match.url.pathname;
      return exact ? currentPath === path : currentPath.startsWith(path);
    });
  }
}

/** Creates a router from a build-time routes manifest. */
export function createRouter(manifest: RoutesManifest, config?: RouterConfig): Router {
  return new Router(manifest, config);
}

let globalRouter: Router | null = null;

/** Gets the global router instance (throws if not initialized). */
export function getRouter(): Router {
  if (!globalRouter) {
    throw new Error("[solarflare] Router not initialized. Call initRouter() first.");
  }
  return globalRouter;
}

/** Initializes the global router instance. */
export function initRouter(manifest: RoutesManifest, config?: RouterConfig): Router {
  globalRouter = createRouter(manifest, config);
  return globalRouter;
}

/** Navigates using the global router. */
export function navigate(to: string | URL, options?: NavigateOptions): Promise<void> {
  return getRouter().navigate(to, options);
}

/** Checks if path is active using global router. */
export function isActive(path: string, exact = false): boolean {
  return getRouter().isActive(path, exact);
}
