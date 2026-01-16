import { type FunctionComponent, type VNode, h, Component as PreactComponent } from "preact";
import { signal, type Signal, useSignal, useSignalEffect } from "@preact/signals";
import { useMemo } from "preact/hooks";
import register from "preact-custom-element";
import { initRouter, getRouter } from "./router.ts";
import { extractDataIsland } from "./store.ts";
import { initHydrationCoordinator } from "./hydration.ts";
import { installHeadHoisting, createHeadContext, setHeadContext } from "./head.ts";
import { getRuntime } from "./runtime.ts";
import type { RoutesManifest } from "./manifest.ts";
import type { HmrApi } from "./client.hmr.ts";
import { stylesheets } from "./stylesheets.ts";

/** Global storage for component hook state across HMR updates. */
const hookStateMap = new Map<string, unknown[]>();

/** Global storage for component refs across HMR updates. */
const refStateMap = new Map<string, Map<number, unknown>>();

/** Saves hook state for a component. */
export function saveHookState(componentId: string, hookState: unknown[]): void {
  hookStateMap.set(componentId, [...hookState]);
}

/** Restores hook state for a component. */
export function restoreHookState(componentId: string): unknown[] | undefined {
  return hookStateMap.get(componentId);
}

/** Clears hook state for a component. */
export function clearHookState(componentId: string): void {
  hookStateMap.delete(componentId);
  refStateMap.delete(componentId);
}

/** Gets or creates the ref storage for a component. */
export function getRefStorage(componentId: string): Map<number, unknown> {
  let storage = refStateMap.get(componentId);
  if (!storage) {
    storage = new Map();
    refStateMap.set(componentId, storage);
  }
  return storage;
}

/** Stored scroll positions keyed by component tag. */
const scrollPositions = new Map<string, { x: number; y: number }>();

/** Saves current scroll position. */
export function saveScrollPosition(tag?: string): void {
  const key = tag ?? "__global__";
  scrollPositions.set(key, {
    x: globalThis.scrollX ?? 0,
    y: globalThis.scrollY ?? 0,
  });
}

/** Restores scroll position. */
export function restoreScrollPosition(tag?: string): void {
  const key = tag ?? "__global__";
  const pos = scrollPositions.get(key);
  if (pos) {
    requestAnimationFrame(() => {
      globalThis.scrollTo(pos.x, pos.y);
    });
  }
}

/** Clears stored scroll position. */
export function clearScrollPosition(tag?: string): void {
  const key = tag ?? "__global__";
  scrollPositions.delete(key);
}

/** Clears all HMR state maps (call periodically or on app reset to prevent memory growth). */
export function clearAllHMRState(): void {
  hookStateMap.clear();
  refStateMap.clear();
  scrollPositions.clear();
}

/** Gets the current size of HMR state maps. */
export function getHMRStateSize(): {
  hookStates: number;
  refStates: number;
  scrollPositions: number;
} {
  return {
    hookStates: hookStateMap.size,
    refStates: refStateMap.size,
    scrollPositions: scrollPositions.size,
  };
}

/** Props for HMR error boundary. */
interface HMRErrorBoundaryProps {
  /** Child components to render. */
  children?: VNode;
  /** Component tag for identification. */
  tag: string;
  /** HMR version signal to trigger re-render on updates. */
  hmrVersion: Signal<number>;
  /** Fallback UI when error occurs. */
  fallback?: (error: Error, retry: () => void) => VNode;
}

/** State for HMR error boundary. */
interface HMRErrorBoundaryState {
  error: Error | null;
  errorInfo: { componentStack?: string } | null;
}

/** Error boundary that recovers on HMR updates. */
export class HMRErrorBoundary extends PreactComponent<
  HMRErrorBoundaryProps,
  HMRErrorBoundaryState
> {
  state: HMRErrorBoundaryState = { error: null, errorInfo: null };

  private lastHmrVersion = -1;
  private unsubscribe?: () => void;

  componentDidMount(): void {
    this.lastHmrVersion = this.props.hmrVersion.value;
    this.unsubscribe = this.props.hmrVersion.subscribe((version) => {
      if (version !== this.lastHmrVersion && this.state.error) {
        console.log(`[HMR] Attempting recovery for <${this.props.tag}>`);
        this.setState({ error: null, errorInfo: null });
      }
      this.lastHmrVersion = version;
    });
  }

  componentWillUnmount(): void {
    this.unsubscribe?.();
  }

  static getDerivedStateFromError(error: Error): Partial<HMRErrorBoundaryState> {
    return { error };
  }

  componentDidCatch(error: Error, errorInfo: { componentStack?: string }): void {
    this.setState({ errorInfo });
    console.error(`[HMR] Error in <${this.props.tag}>:`, error);
    if (errorInfo.componentStack) {
      console.error("Component stack:", errorInfo.componentStack);
    }
  }

  retry = (): void => {
    this.setState({ error: null, errorInfo: null });
  };

  // biome-ignore lint/suspicious/noExplicitAny: VNode types are complex
  render(): VNode<any> {
    const { error, errorInfo } = this.state;
    const { children, tag, fallback } = this.props;

    if (error) {
      if (fallback) {
        return fallback(error, this.retry);
      }

      return h(
        "div",
        {
          style: {
            padding: "16px",
            margin: "8px",
            backgroundColor: "#fee2e2",
            border: "1px solid #ef4444",
            borderRadius: "8px",
            fontFamily: "system-ui, sans-serif",
          },
        },
        h(
          "div",
          {
            style: {
              display: "flex",
              alignItems: "center",
              gap: "8px",
              marginBottom: "8px",
            },
          },
          h("span", { style: { fontSize: "20px" } }, "⚠️"),
          h("strong", { style: { color: "#991b1b" } }, `Error in <${tag}>`),
        ),
        h(
          "pre",
          {
            style: {
              margin: "8px 0",
              padding: "8px",
              backgroundColor: "#fef2f2",
              borderRadius: "4px",
              overflow: "auto",
              fontSize: "12px",
              color: "#7f1d1d",
            },
          },
          error.message,
        ),
        errorInfo?.componentStack &&
          h(
            "details",
            { style: { marginTop: "8px" } },
            h("summary", { style: { cursor: "pointer", color: "#991b1b" } }, "Component Stack"),
            h(
              "pre",
              {
                style: {
                  fontSize: "10px",
                  color: "#7f1d1d",
                  whiteSpace: "pre-wrap",
                },
              },
              errorInfo.componentStack,
            ),
          ),
        h(
          "button",
          {
            onClick: this.retry,
            style: {
              marginTop: "12px",
              padding: "8px 16px",
              backgroundColor: "#ef4444",
              color: "white",
              border: "none",
              borderRadius: "4px",
              cursor: "pointer",
              fontSize: "14px",
            },
          },
          "Retry",
        ),
      );
    }

    return children ?? h("span", null);
  }
}

/** Tracks loaded CSS files for HMR. */
const loadedStylesheets = new Map<string, HTMLLinkElement>();

/** CSS HMR update payload. */
export interface CssHmrUpdate {
  id: string;
  css: string;
  /** Specific rules that changed (for incremental updates) */
  changedRules?: Array<{
    selector: string;
    properties: string;
    action: "add" | "update" | "delete";
  }>;
}

/** Handles CSS HMR updates. */
export function handleCssHmrUpdate(update: CssHmrUpdate): void {
  const { id, css, changedRules } = update;

  // Try granular update first
  if (changedRules && changedRules.length < 10) {
    const success = applyGranularUpdates(id, changedRules);
    if (success) {
      console.log(`[HMR] Incrementally updated ${changedRules.length} rules in ${id}`);
      return;
    }
  }

  // Fall back to full replacement
  const updated = stylesheets.update(id, css);
  if (updated) {
    console.log(`[HMR] Replaced stylesheet: ${id}`);
  }
}

/** Applies granular rule updates using insertRule/deleteRule. */
function applyGranularUpdates(id: string, changes: CssHmrUpdate["changedRules"]): boolean {
  if (!changes) return false;

  const sheet = stylesheets.get(id);
  if (!sheet) return false;

  try {
    // Build a map of existing rules by selector
    const ruleMap = new Map<string, number>();
    for (let i = 0; i < sheet.cssRules.length; i++) {
      const rule = sheet.cssRules[i];
      if (rule instanceof CSSStyleRule) {
        ruleMap.set(rule.selectorText, i);
      }
    }

    // Process changes in reverse order to maintain indices
    const sortedChanges = [...changes].sort((a, b) => {
      const idxA = ruleMap.get(a.selector) ?? -1;
      const idxB = ruleMap.get(b.selector) ?? -1;
      return idxB - idxA; // Reverse order
    });

    for (const change of sortedChanges) {
      const existingIndex = ruleMap.get(change.selector);

      switch (change.action) {
        case "delete":
          if (existingIndex !== undefined) {
            sheet.deleteRule(existingIndex);
          }
          break;

        case "update":
          if (existingIndex !== undefined) {
            // Delete and re-insert at same position
            sheet.deleteRule(existingIndex);
            sheet.insertRule(`${change.selector} { ${change.properties} }`, existingIndex);
          }
          break;

        case "add":
          sheet.insertRule(`${change.selector} { ${change.properties} }`, sheet.cssRules.length);
          break;
      }
    }

    return true;
  } catch (e) {
    console.warn("[HMR] Granular update failed, falling back to full replace", e);
    return false;
  }
}

/** Registers HMR handlers for CSS files. */
export function setupCssHmr(hmr: {
  on: (event: string, cb: (data: unknown) => void) => void;
}): void {
  hmr.on("sf:css-update", (data) => {
    handleCssHmrUpdate(data as CssHmrUpdate);
  });

  // Handle full CSS file replacement
  hmr.on("sf:css-replace", (data) => {
    const { id, css } = data as { id: string; css: string };
    stylesheets.update(id, css);
    console.log(`[HMR] Full CSS replacement: ${id}`);
  });
}

/** Reloads a CSS file by updating its href with a cache-busting query. */
export function reloadStylesheet(href: string): void {
  const existing =
    loadedStylesheets.get(href) ?? document.querySelector<HTMLLinkElement>(`link[href^="${href}"]`);

  if (existing) {
    const url = new URL(existing.href, window.location.origin);
    url.searchParams.set("t", Date.now().toString());
    existing.href = url.toString();
    console.log(`[HMR] Reloaded stylesheet: ${href}`);
  } else {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = `${href}?t=${Date.now()}`;
    document.head.appendChild(link);
    loadedStylesheets.set(href, link);
    console.log(`[HMR] Injected stylesheet: ${href}`);
  }
}

/** Removes a stylesheet from the document. */
export function removeStylesheet(href: string): void {
  const existing =
    loadedStylesheets.get(href) ?? document.querySelector<HTMLLinkElement>(`link[href^="${href}"]`);

  if (existing) {
    existing.remove();
    loadedStylesheets.delete(href);
    console.log(`[HMR] Removed stylesheet: ${href}`);
  }
}

/** Accepts CSS HMR updates. */
export function acceptCssHMR(cssFiles: string[]): () => void {
  for (const file of cssFiles) {
    reloadStylesheet(file);
  }

  return () => {
    for (const file of cssFiles) {
      removeStylesheet(file);
    }
  };
}

/** Options for creating an HMR wrapper. */
export interface HMRWrapperOptions {
  /** Component tag name. */
  tag: string;
  /** Preserve scroll position. */
  preserveScroll?: boolean;
  /** Preserve hook state. */
  preserveHookState?: boolean;
  /** Custom error fallback. */
  errorFallback?: (error: Error, retry: () => void) => VNode;
}

/** Creates an HMR-enabled component wrapper. */
export function createHMRWrapper<P extends Record<string, unknown>>(
  hmrVersion: Signal<number>,
  getComponent: () => FunctionComponent<P>,
  options: HMRWrapperOptions,
): FunctionComponent<P> {
  const { tag, preserveScroll = true, errorFallback } = options;

  return function HMRWrapper(props: P) {
    void hmrVersion.value;

    if (preserveScroll && typeof window !== "undefined") {
      saveScrollPosition(tag);
    }

    const CurrentComponent = getComponent();
    const inner = h(CurrentComponent, props);

    return h(
      HMRErrorBoundary,
      {
        tag,
        hmrVersion,
        fallback: errorFallback,
      },
      inner,
    );
  };
}

/** Dispatches an HMR event for external listeners. */
export function dispatchHMREvent(
  type: "update" | "error" | "recover",
  detail: { tag: string; error?: Error },
): void {
  if (typeof document === "undefined") return;

  document.dispatchEvent(
    new CustomEvent(`sf:hmr:${type}`, {
      detail,
      bubbles: true,
    }),
  );
}

/** Registers an HMR event listener. */
export function onHMREvent(
  type: "update" | "error" | "recover",
  handler: (detail: { tag: string; error?: Error }) => void,
): () => void {
  if (typeof document === "undefined") return () => {};

  const listener = (e: Event) => {
    handler((e as CustomEvent).detail);
  };

  document.addEventListener(`sf:hmr:${type}`, listener);
  return () => document.removeEventListener(`sf:hmr:${type}`, listener);
}

export interface HmrEntryOptions {
  tag: string;
  props: string[];
  routesManifest: RoutesManifest;
  BaseComponent: FunctionComponent<any>;
  hmr: HmrApi;
  cssFiles?: string[];
  onCssUpdate?: () => void;
}

function initClientRuntime(): void {
  if (typeof document !== "undefined") {
    const runtime = getRuntime();
    runtime.headContext ??= createHeadContext();
    setHeadContext(runtime.headContext);
    installHeadHoisting();
  }
  initHydrationCoordinator();
}

export function createHmrEntryComponent(options: HmrEntryOptions): FunctionComponent<any> {
  const { tag, routesManifest, BaseComponent, hmr, cssFiles = [], onCssUpdate } = options;

  initClientRuntime();

  let CurrentComponent = BaseComponent;
  const hmrVersion = signal(0);
  const navVersion = signal(0);

  if (onCssUpdate) {
    hmr.on("sf:css-update", onCssUpdate);
  }

  for (const file of cssFiles) {
    hmr.on<string>(`sf:css:${file}`, (newCss) => {
      if (!newCss) return;
      stylesheets.update(file, newCss);
      console.log(`[HMR] Updated stylesheet: ${file}`);
    });
  }

  const captureHookState = (el: any) => {
    if (!el?._vdom?.__hooks?.list) return;
    const list = el._vdom.__hooks.list as Array<{ _value?: unknown; current?: unknown } | null>;
    saveHookState(
      tag,
      list.map((hook) => (hook?._value !== undefined ? hook._value : hook?.current)),
    );
  };

  const applyHookState = (el: any) => {
    const saved = restoreHookState(tag);
    if (!saved || !el?._vdom?.__hooks?.list) return;
    const list = el._vdom.__hooks.list as Array<{ _value?: unknown; current?: unknown } | null>;
    list.forEach((hook, i) => {
      if (saved[i] !== undefined) {
        if (hook?._value !== undefined) hook._value = saved[i];
        else if (hook?.current !== undefined) hook.current = saved[i];
      }
    });
  };

  hmr.on<{ default?: FunctionComponent<any> }>(`sf:module:${tag}`, (newModule) => {
    if (newModule?.default) {
      saveScrollPosition(tag);

      const el = document.querySelector(tag) as any;
      captureHookState(el);

      CurrentComponent = newModule.default;
      console.log(`[HMR] Updated <${tag}>`);
      hmrVersion.value++;

      requestAnimationFrame(() => {
        restoreScrollPosition(tag);
        const nextEl = document.querySelector(tag) as any;
        applyHookState(nextEl);
      });

      dispatchHMREvent("update", { tag });
    }
  });

  hmr.dispose(() => {
    console.log(`[HMR] Disposing <${tag}>`);
    saveScrollPosition(tag);
    const el = document.querySelector(tag) as any;
    captureHookState(el);
  });

  let routerInitialized = false;
  function ensureRouter() {
    if (typeof document === "undefined") return null;
    if (routerInitialized) {
      try {
        return getRouter();
      } catch {
        return null;
      }
    }
    routerInitialized = true;
    return initRouter(routesManifest).start();
  }

  return function Component(props) {
    const deferredSignals = useMemo(() => new Map<string, Signal<unknown>>(), []);
    const deferredVersion = useSignal(0);
    void hmrVersion.value;
    const navVer = navVersion.value;

    const getOrCreateSignal = (key: string, value: unknown) => {
      if (!deferredSignals.has(key)) {
        deferredSignals.set(key, signal(value));
        deferredVersion.value++;
      } else {
        deferredSignals.get(key)!.value = value;
      }
    };

    useSignalEffect(() => {
      const el = document.querySelector(tag) as any;
      if (!el) return;

      const extractDeferred = () => {
        if (!el.isConnected) return;

        if (el._sfDeferred) {
          for (const [key, value] of Object.entries(el._sfDeferred)) {
            getOrCreateSignal(key, value);
          }
          delete el._sfDeferred;
          return;
        }

        const scripts = document.querySelectorAll(
          `script[type="application/json"][data-island^="${tag}-deferred"]`,
        );
        if (!scripts.length) return;

        void (async () => {
          for (const script of scripts) {
            if (!el.isConnected) return;
            const id = script.getAttribute("data-island");
            if (!id) continue;
            const data = await extractDataIsland<Record<string, unknown>>(id);
            if (data && typeof data === "object") {
              for (const [key, value] of Object.entries(data)) {
                getOrCreateSignal(key, value);
              }
            }
            await new Promise((r) => setTimeout(r, 0));
          }
        })();
      };

      extractDeferred();

      const hydrateHandler = (e: Event) => {
        const detail = (e as CustomEvent).detail as Record<string, unknown>;
        for (const [key, value] of Object.entries(detail)) {
          getOrCreateSignal(key, value);
        }
        delete el._sfDeferred;
      };

      el.addEventListener("sf:hydrate", hydrateHandler);

      const navHandler = () => setTimeout(extractDeferred, 0);
      const rerenderHandler = () => {
        navVersion.value++;
      };
      window.addEventListener("sf:navigate", navHandler);
      el.addEventListener("sf:rerender", rerenderHandler);

      ensureRouter();

      return () => {
        el.removeEventListener("sf:hydrate", hydrateHandler);
        window.removeEventListener("sf:navigate", navHandler);
        el.removeEventListener("sf:rerender", rerenderHandler);
      };
    });

    const cleanProps: Record<string, unknown> = {};
    for (const key in props) {
      if (props[key] !== "undefined" && props[key] !== undefined) {
        cleanProps[key] = props[key];
      }
    }

    const _ver = deferredVersion.value;
    void _ver;
    void navVer;

    const deferredProps: Record<string, unknown> = {};
    for (const [key, sig] of deferredSignals) {
      deferredProps[key] = sig.value;
    }

    const finalProps = { ...cleanProps, ...deferredProps };

    return h(HMRErrorBoundary, { tag, hmrVersion }, h(CurrentComponent, finalProps));
  };
}

export function initHmrEntry(options: HmrEntryOptions): void {
  const Component = createHmrEntryComponent(options);
  if (!customElements.get(options.tag)) {
    register(Component, options.tag, options.props, { shadow: false });
  }
}

export { signal };
