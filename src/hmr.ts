/** Hot Module Replacement utilities for Preact components. */
import { type FunctionComponent, type VNode, h, Component as PreactComponent } from "preact";
import { signal, type Signal } from "@preact/signals";

// ============================================================================
// Hook State Preservation
// ============================================================================

/** Global storage for component hook state across HMR updates. */
const hookStateMap = new Map<string, unknown[]>();

/** Global storage for component refs across HMR updates. */
const refStateMap = new Map<string, Map<number, unknown>>();

/** Saves hook state for a component before HMR update. */
export function saveHookState(componentId: string, hookState: unknown[]): void {
  hookStateMap.set(componentId, [...hookState]);
}

/** Restores hook state for a component after HMR update. */
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

// ============================================================================
// Scroll Position Preservation
// ============================================================================

/** Stored scroll positions keyed by component tag. */
const scrollPositions = new Map<string, { x: number; y: number }>();

/** Saves current scroll position before HMR update. */
export function saveScrollPosition(tag?: string): void {
  const key = tag ?? "__global__";
  scrollPositions.set(key, {
    x: globalThis.scrollX ?? 0,
    y: globalThis.scrollY ?? 0,
  });
}

/** Restores scroll position after HMR update. */
export function restoreScrollPosition(tag?: string): void {
  const key = tag ?? "__global__";
  const pos = scrollPositions.get(key);
  if (pos) {
    // Use requestAnimationFrame to ensure DOM is updated
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

// ============================================================================
// Error Boundary for HMR
// ============================================================================

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
    // Subscribe to HMR version changes to auto-recover
    this.lastHmrVersion = this.props.hmrVersion.value;
    this.unsubscribe = this.props.hmrVersion.subscribe((version) => {
      if (version !== this.lastHmrVersion && this.state.error) {
        // New HMR update, try to recover
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

      // Default error UI
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

// ============================================================================
// CSS Hot Module Replacement
// ============================================================================

/** Tracks loaded CSS files for HMR. */
const loadedStylesheets = new Map<string, HTMLLinkElement>();

/** Reloads a CSS file by updating its href with a cache-busting query. */
export function reloadStylesheet(href: string): void {
  // Find existing link element
  const existing =
    loadedStylesheets.get(href) ?? document.querySelector<HTMLLinkElement>(`link[href^="${href}"]`);

  if (existing) {
    // Update href with cache-busting query param
    const url = new URL(existing.href, window.location.origin);
    url.searchParams.set("t", Date.now().toString());
    existing.href = url.toString();
    console.log(`[HMR] Reloaded stylesheet: ${href}`);
  } else {
    // Stylesheet not found, inject it
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
  // Initial load
  for (const file of cssFiles) {
    reloadStylesheet(file);
  }

  // Return cleanup function
  return () => {
    for (const file of cssFiles) {
      removeStylesheet(file);
    }
  };
}

// ============================================================================
// HMR Wrapper Component Factory
// ============================================================================

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
    // Subscribe to HMR version changes (force re-render)
    void hmrVersion.value;

    // Save scroll position before potential re-render
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

// ============================================================================
// HMR Event Helpers
// ============================================================================

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

// ============================================================================
// Exports
// ============================================================================

export { signal };
