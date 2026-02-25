import { signal, computed, effect, type ReadonlySignal } from "@preact/signals";
import { resetHeadContext, applyHeadTags, type HeadTag } from "./head.ts";
import { setNavigationMode } from "./hydration.ts";
import type { RouteManifestEntry, RoutesManifest } from "./manifest.ts";
export type { RouteManifestEntry, RoutesManifest } from "./manifest.ts";
import { dedupeDeferredScripts, handleDeferredHydrationNode } from "./router-deferred.ts";
import { fetchWithRetry } from "./fetch.ts";
import { applyPatchStream } from "./router-stream.ts";

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
  /** Elements matching this predicate are atomically replaced instead of diffed. */
  shouldReplaceNode?: (node: Node) => boolean;
}

/** Subscription callback for route changes. */
export type RouteSubscriber = (match: RouteMatch | null) => void;

/**
 * Creates a node matcher from a glob-like pattern.
 * Supports: "s-*" (prefix), "*-element" (suffix), "my-component" (exact)
 * Multiple patterns can be comma-separated: "s-*,ui-*"
 */
export function createNodeMatcher(pattern: string): (node: Node) => boolean {
  const patterns = pattern.split(",").map((p) => p.trim().toUpperCase());
  const matchers = patterns.map((p) => {
    if (p.endsWith("*")) return (name: string) => name.startsWith(p.slice(0, -1));
    if (p.startsWith("*")) return (name: string) => name.endsWith(p.slice(1));
    return (name: string) => name === p;
  });
  return (node: Node) => {
    const name = node.nodeName;
    return matchers.some((m) => m(name));
  };
}

/** Checks if View Transitions API is supported. */
export function supportsViewTransitions() {
  return typeof document !== "undefined" && "startViewTransition" in document;
}

/** Client-side SPA router using Navigation API and View Transitions. */
export class Router {
  #routes: Route[] = [];
  #config: Required<Omit<RouterConfig, "shouldReplaceNode">> &
    Pick<RouterConfig, "shouldReplaceNode">;
  #started = false;
  #cleanupFns: (() => void)[] = [];
  #inflightAbort: AbortController | null = null;

  /** Current route match signal. */
  readonly current = signal<RouteMatch | null>(null);

  /** Current route params signal. */
  readonly params: ReadonlySignal<Record<string, string>>;

  /** Current pathname signal. */
  readonly pathname: ReadonlySignal<string>;

  constructor(manifest: RoutesManifest, config: RouterConfig = {}) {
    const getMeta = <T extends string>(name: string) => {
      if (typeof document === "undefined") return null;
      const meta = document.querySelector(`meta[name="sf:${name}"]`);
      return (meta?.getAttribute("content") as T) ?? null;
    };

    const metaBase = getMeta("base");
    const metaViewTransitions = getMeta<"true" | "false">("view-transitions");
    const metaScrollBehavior = getMeta<"auto" | "smooth" | "instant">("scroll-behavior");
    const metaSkipNodeReplace = getMeta("skip-node-replacement");

    // Convert glob pattern (e.g., "s-*") to shouldReplaceNode predicate
    const shouldReplaceNode =
      config.shouldReplaceNode ??
      (metaSkipNodeReplace ? createNodeMatcher(metaSkipNodeReplace) : undefined);

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
      shouldReplaceNode,
    };

    this.params = computed(() => this.current.value?.params ?? {});
    this.pathname = computed(() => this.current.value?.url.pathname ?? "");
    this.#loadManifest(manifest);
  }

  /** Loads routes from build-time manifest. */
  #loadManifest(manifest: RoutesManifest) {
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
  #handleError(error: Error, url: URL) {
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
  match(url: URL) {
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
  async navigate(to: string | URL, options: NavigateOptions = {}) {
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
  async #executeNavigation(url: URL, match: RouteMatch | null) {
    try {
      if (match) {
        await this.#loadRoute(match, url);
        this.current.value = match;
        this.#config.onNavigate(match);
      } else {
        this.current.value = null;
        this.#config.onNotFound(url);
      }
      // Dispatch navigation event for components to re-extract deferred data
      window.dispatchEvent(new CustomEvent("sf:navigate", { detail: { url, match } }));
    } catch (error) {
      this.#handleError(error instanceof Error ? error : new Error(String(error)), url);
    }
  }

  /** Loads route assets and swaps page content. */
  async #loadRoute(match: RouteMatch, url: URL) {
    const { entry } = match;

    // Preload the route chunk *before* DOM diffing so any custom elements for the
    // incoming HTML are already defined when inserted.
    // This avoids edge-cases where upgraded callbacks/hydration don't run reliably
    // when elements are inserted first and defined later.
    if (entry.chunk) {
      const absoluteChunk = new URL(entry.chunk, location.origin).href;
      await import(absoluteChunk);
    }

    if (this.#inflightAbort) {
      this.#inflightAbort.abort();
    }
    const abortController = new AbortController();
    this.#inflightAbort = abortController;

    const patchUrl = new URL("/_sf/patch", location.origin);

    const response = await fetchWithRetry(
      patchUrl.href,
      {
        method: "POST",
        headers: {
          Accept: "application/x-turbo-stream",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ url: url.pathname + url.search + url.hash, outlet: "#app" }),
        signal: abortController.signal,
      },
      { maxRetries: 0 },
    );

    if (!response.ok || !response.body) {
      throw new Error(`Failed to fetch patch for ${url.href}: ${response.status}`);
    }

    // During client-side navigation we apply streamed HTML via diff-dom-streaming.
    // Track processed hydration scripts and trigger hydration as they're inserted.
    const processedScripts = new Set<string>();

    // Capture the current route host before diffing so we can detect tag changes
    // and whether the host element was actually replaced.
    const previousHost = document.querySelector("#app > *") as HTMLElement | null;
    const previousTag = previousHost?.tagName?.toLowerCase();

    // Use MutationObserver to detect when deferred hydration scripts are inserted
    // into the real DOM and trigger hydration immediately for progressive streaming.
    let observer: MutationObserver | null = null;
    if (typeof MutationObserver !== "undefined") {
      observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
          for (const node of mutation.addedNodes) {
            if (node.nodeType !== 1) continue;
            handleDeferredHydrationNode(entry.tag, processedScripts, node as Element);

            // Also scan subtree for scripts as diff-dom-streaming may insert trees
            if (node.nodeName !== "SCRIPT") {
              const el = node as Element;
              const scripts = el.getElementsByTagName("script");
              for (const script of scripts) {
                handleDeferredHydrationNode(entry.tag, processedScripts, script);
              }
            }
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
    let didScroll = false;

    const applyAttrs = (el: HTMLElement, attrs?: Record<string, string>) => {
      if (!attrs) return;
      for (const [key, value] of Object.entries(attrs)) {
        if (value === "") {
          el.setAttribute(key, "");
        } else {
          el.setAttribute(key, value);
        }
      }
    };

    const applyMeta = (meta: {
      head?: HeadTag[];
      htmlAttrs?: Record<string, string>;
      bodyAttrs?: Record<string, string>;
    }) => {
      if (meta.head?.length) {
        applyHeadTags(meta.head);
      }
      if (typeof document !== "undefined") {
        applyAttrs(document.documentElement, meta.htmlAttrs);
        applyAttrs(document.body, meta.bodyAttrs);
      }
    };

    try {
      await applyPatchStream(response, {
        useTransition,
        applyMeta,
        shouldReplaceNode: this.#config.shouldReplaceNode,
        onChunkProcessed: () => {
          if (didScroll) return;
          didScroll = true;
          // Scroll after the first chunk has been applied so we don't
          // jump to top when deferred content resolves later.
          requestAnimationFrame(() => {
            requestAnimationFrame(() => this.#handleScroll(url));
          });
        },
      });
    } catch (diffError) {
      abortController.abort();
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
      if (this.#inflightAbort === abortController) {
        this.#inflightAbort = null;
      }
    }

    // Fix for broken interactivity + flicker:
    // If navigating to a different component tag, replace the host immediately
    // to ensure a fresh hydration without stale properties from previous component.
    // Doing this BEFORE the settlement delay prevents visual flicker (replacement happens in same frame).
    const host = document.querySelector(entry.tag) as HTMLElement | null;
    const sameTag = previousTag && previousTag === entry.tag;

    if (host && previousTag && !sameTag && previousHost && host === previousHost) {
      const replacement = host.cloneNode(true) as HTMLElement;
      host.replaceWith(replacement);
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
    // which can desync event delegation/handlers. When the route tag is the same,
    // trigger a rerender to re-bind events without losing local state (e.g. counters).
    if (sameTag) {
      const currentHost = document.querySelector(entry.tag) as HTMLElement;
      if (currentHost) {
        currentHost.dispatchEvent(new CustomEvent("sf:rerender"));
        await new Promise((r) => requestAnimationFrame(r));
      }
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
      const fragment = document.createDocumentFragment();
      let hasNew = false;
      for (const href of entry.styles) {
        const absoluteHref = new URL(href, location.origin).href;
        if (!document.querySelector(`link[href="${absoluteHref}"], link[href="${href}"]`)) {
          const link = document.createElement("link");
          link.rel = "stylesheet";
          link.href = absoluteHref;
          fragment.appendChild(link);
          hasNew = true;
        }
      }
      if (hasNew) {
        document.head.appendChild(fragment);
      }
    }
  }

  /** Handles scroll restoration. */
  #handleScroll(url: URL) {
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
  start() {
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
  stop() {
    for (const cleanup of this.#cleanupFns) {
      cleanup();
    }
    this.#cleanupFns = [];
    this.#started = false;
    return this;
  }

  /** Sets up Navigation API interception. */
  #setupNavigationAPI() {
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
  subscribe(callback: RouteSubscriber) {
    return effect(() => {
      callback(this.current.value);
    });
  }

  back() {
    history.back();
  }

  forward() {
    history.forward();
  }

  go(delta: number) {
    history.go(delta);
  }

  /** Checks if a path matches the current route. */
  isActive(path: string, exact = false) {
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
  isActiveSignal(path: string, exact = false) {
    return computed(() => {
      const match = this.current.value;
      if (!match) return false;
      const currentPath = match.url.pathname;
      return exact ? currentPath === path : currentPath.startsWith(path);
    });
  }
}

/** Creates a router from a build-time routes manifest. */
export function createRouter(manifest: RoutesManifest, config?: RouterConfig) {
  return new Router(manifest, config);
}

let globalRouter: Router | null = null;

/** Gets the global router instance (throws if not initialized). */
export function getRouter() {
  if (!globalRouter) {
    throw new Error("[solarflare] Router not initialized. Call initRouter() first.");
  }
  return globalRouter;
}

/** Initializes the global router instance. */
export function initRouter(manifest: RoutesManifest, config?: RouterConfig) {
  if (globalRouter) return globalRouter;
  globalRouter = createRouter(manifest, config);
  return globalRouter;
}

/** Navigates using the global router. */
export function navigate(to: string | URL, options?: NavigateOptions) {
  return getRouter().navigate(to, options);
}

/** Checks if path is active using global router. */
export function isActive(path: string, exact = false) {
  return getRouter().isActive(path, exact);
}
