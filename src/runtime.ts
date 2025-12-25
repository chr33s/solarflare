import type { HeadContext } from "./head.ts";

const NAMESPACE = "__solarflare__" as const;

export interface SolarflareRuntime {
  /** Preloaded stylesheets from SSR. */
  preloadedStyles?: Map<string, CSSStyleSheet>;
  /** Head context for deduplication. */
  headContext?: HeadContext;
  /** HMR data for hot module replacement. */
  hmrData?: Record<string, unknown>;
}

type GlobalWithSolarflare = typeof globalThis & {
  [NAMESPACE]?: SolarflareRuntime;
};

/** Gets the runtime context, creating it if needed. */
export function getRuntime(): SolarflareRuntime {
  const g = globalThis as GlobalWithSolarflare;
  return (g[NAMESPACE] ??= {});
}

/** Gets the runtime if it exists (no creation). */
export function peekRuntime(): SolarflareRuntime | undefined {
  return (globalThis as GlobalWithSolarflare)[NAMESPACE];
}

/** Clears the runtime (useful for testing). */
export function clearRuntime(): void {
  delete (globalThis as GlobalWithSolarflare)[NAMESPACE];
}
