/** Client-side SPA router using URLPattern, Navigation API, and View Transitions. */

import { signal, computed, effect, type ReadonlySignal } from "@preact/signals";
import diff from "diff-dom-streaming";
import { resetHeadContext } from "./head.ts";

/** Route entry from build-time manifest. */
export interface RouteManifestEntry {
  pattern: string;
  tag: string;
  chunk?: string;
  styles?: string[];
  type: "client" | "server";
  params: string[];
}

/** Build-time routes manifest. */
export interface RoutesManifest {
  routes: RouteManifestEntry[];
  base?: string;
}

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
  /** Enable view transitions (default: true if supported). */
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
    this.#config = {
      base: manifest.base ?? config.base ?? "",
      viewTransitions: config.viewTransitions ?? supportsViewTransitions(),
      scrollBehavior: config.scrollBehavior ?? "auto",
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
          (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] || c,
        );

      app.innerHTML = `
        <div class="error-page">
          <h1>Something went wrong</h1>
          <p>${escapeHtml(error.message)}</p>
          <p class="error-url">Failed to load: ${escapeHtml(url.pathname)}</p>
          <button type="button" onclick="location.reload()">Try again</button>
          <a href="/">Go home</a>
        </div>
      `;
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
  async #executeNavigation(
    url: URL,
    match: RouteMatch | null,
    options: NavigateOptions,
  ): Promise<void> {
    const useTransition =
      this.#config.viewTransitions && supportsViewTransitions() && !options.skipTransition;

    try {
      if (match) {
        await this.#loadRoute(match, url, useTransition);
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
  async #loadRoute(match: RouteMatch, url: URL, useTransition: boolean): Promise<void> {
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

    await diff(document, response.body!, { transition: useTransition });

    // IMPORTANT: diff-dom-streaming may patch inside an existing custom element subtree.
    // If the subtree is already mounted by preact-custom-element, external DOM mutations can
    // desync Preact's event delegation/handlers, leading to "dead" UI after navigation.
    //
    // To keep semantics simple and reliable, remount the route's root island by swapping
    // the host element node (this triggers disconnected/connected lifecycle and a fresh mount).
    const host = document.querySelector(entry.tag) as HTMLElement & { _vdom?: unknown };
    if (host) {
      const replacement = host.cloneNode(true) as HTMLElement;
      host.replaceWith(replacement);
    }

    // Reset head context after navigation - the new HTML has fresh head tags
    // and any new useHead calls from hydrated components will be fresh
    resetHeadContext();

    this.#hydrateDeferredDataIslands();

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

  /** Hydrates deferred data islands after DOM diffing. */
  #hydrateDeferredDataIslands(): void {
    const dataIslands = document.querySelectorAll('script[type="application/json"][data-island]');
    const processedIslands = new Set<string>();

    for (const island of dataIslands) {
      const dataIslandId = island.getAttribute("data-island");

      if (!dataIslandId) continue;

      const deferredIndex = dataIslandId.indexOf("-deferred-");
      if (deferredIndex === -1) continue;

      if (processedIslands.has(dataIslandId)) {
        island.remove();
        continue;
      }
      processedIslands.add(dataIslandId);

      const tag = dataIslandId.slice(0, deferredIndex);

      if (!document.querySelector(tag)) {
        island.remove();
        continue;
      }

      // Delay to allow component mount before triggering hydration
      // Use custom event to communicate with hydration coordinator (no window pollution)
      setTimeout(() => {
        requestAnimationFrame(() => {
          document.dispatchEvent(
            new CustomEvent("sf:queue-hydrate", {
              detail: { tag, id: dataIslandId },
            }),
          );
        });
      }, 0);
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
        handler: () => this.#executeNavigation(url, match, {}),
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
