/** Client-side SPA router using URLPattern, Navigation API, and View Transitions. */

import { signal, computed, effect, type ReadonlySignal } from "@preact/signals";
import diff from "diff-dom-streaming";

/** Route definition from build-time manifest. */
export interface RouteManifestEntry {
  /** URL pattern pathname (e.g., '/blog/:slug') */
  pattern: string;
  /** Custom element tag name */
  tag: string;
  /** Chunk path for this route's JS */
  chunk?: string;
  /** CSS stylesheets for this route */
  styles?: string[];
  /** Route type */
  type: "client" | "server";
  /** Dynamic parameter names */
  params: string[];
}

/** Build-time routes manifest. */
export interface RoutesManifest {
  routes: RouteManifestEntry[];
  /** Base path for all routes */
  base?: string;
}

/** Internal route representation. */
interface Route {
  pattern: URLPattern;
  entry: RouteManifestEntry;
}

/** Route match result. */
export interface RouteMatch {
  /** Matched manifest entry */
  entry: RouteManifestEntry;
  /** Extracted URL parameters */
  params: Record<string, string>;
  /** The matched URL */
  url: URL;
}

/** Navigation options. */
export interface NavigateOptions {
  /** Replace current history entry instead of pushing */
  replace?: boolean;
  /** State to associate with the history entry */
  state?: unknown;
  /** Skip view transition entirely */
  skipTransition?: boolean;
}

/** Router configuration. */
export interface RouterConfig {
  /** Base path for all routes */
  base?: string;
  /** Enable view transitions (default: true if supported) */
  viewTransitions?: boolean;
  /** Scroll behavior after navigation */
  scrollBehavior?: "auto" | "smooth" | "instant" | false;
  /** Called when no route matches */
  onNotFound?: (url: URL) => void;
  /** Called after navigation completes */
  onNavigate?: (match: RouteMatch) => void;
  /** Called when navigation fails with an error */
  onError?: (error: Error, url: URL) => void;
}

/** Subscription callback for route changes. */
export type RouteSubscriber = (match: RouteMatch | null) => void;

/** Checks if View Transitions API is supported. */
export function supportsViewTransitions(): boolean {
  return typeof document !== "undefined" && "startViewTransition" in document;
}

/** Client-side SPA router using native browser APIs. */
export class Router {
  #routes: Route[] = [];
  #config: Required<RouterConfig>;
  #started = false;
  #cleanupFns: (() => void)[] = [];

  /** Reactive current match */
  readonly current = signal<RouteMatch | null>(null);

  /** Reactive params derived from current match */
  readonly params: ReadonlySignal<Record<string, string>>;

  /** Reactive pathname for easy access */
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
        str.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] || c));
      
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
    } catch (error) {
      this.#handleError(error instanceof Error ? error : new Error(String(error)), url);
    }
  }

  /** Loads route assets and swaps page content. */
  async #loadRoute(match: RouteMatch, url: URL, useTransition: boolean): Promise<void> {
    const { entry } = match;

    const response = await fetch(url.href, {
      headers: { Accept: "text/html" },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch ${url.href}: ${response.status}`);
    }

    await diff(document, response.body!, { transition: useTransition });

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

    if (entry.chunk) {
      const absoluteChunk = new URL(entry.chunk, location.origin).href;
      await import(absoluteChunk);
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

/** Gets the global router instance. Throws if not initialized. */
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
