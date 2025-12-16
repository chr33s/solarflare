/** Web component registration, hydration, and signal-based state. */
import { type FunctionComponent } from "preact";
import register from "preact-custom-element";
import { parsePath } from "./paths";
import { hydrateStore, initHydrationCoordinator } from "./store";

/** Schedules work during browser idle time (falls back to setTimeout). */
export function scheduleIdle(
  callback: () => void,
  options?: { timeout?: number }
): number {
  if (typeof window === "undefined") {
    return -1;
  }

  if ("requestIdleCallback" in window) {
    return requestIdleCallback(callback, options);
  }

  // Fallback: use setTimeout with minimal delay
  return setTimeout(callback, 1) as unknown as number;
}

/** Cancels a scheduled idle callback. */
export function cancelIdle(handle: number): void {
  if (typeof window === "undefined" || handle === -1) return;

  if ("cancelIdleCallback" in window) {
    cancelIdleCallback(handle);
  } else {
    clearTimeout(handle);
  }
}

/** Initializes client-side store from SSR hydration data. */
export async function initClient(): Promise<void> {
  await hydrateStore();
  initHydrationCoordinator();
}

/** Parsed tag metadata from file path. */
export interface TagMeta {
  /** Generated custom element tag name */
  tag: string;
  /** Original file path */
  filePath: string;
  /** Route segments extracted from path */
  segments: string[];
  /** Dynamic parameter names (from $param segments) */
  paramNames: string[];
  /** Whether this is the root/index component */
  isRoot: boolean;
  /** Component type based on file suffix */
  type: "client" | "server" | "unknown";
}

/** Validation result for tag generation. */
export interface TagValidation {
  /** Whether the tag is valid */
  valid: boolean;
  /** Validation errors */
  errors: string[];
  /** Validation warnings */
  warnings: string[];
}

/** Parses file path into structured tag metadata. */
export function parseTagMeta(path: string): TagMeta {
  const parsed = parsePath(path);

  // Map ModuleKind to TagMeta type
  const type: TagMeta["type"] =
    parsed.kind === "client" || parsed.kind === "server" ? parsed.kind : "unknown";

  return {
    tag: parsed.tag,
    filePath: parsed.original,
    segments: parsed.segments,
    paramNames: parsed.params,
    isRoot: parsed.isIndex,
    type,
  };
}

/** Validates a tag against web component naming rules. */
export function validateTag(meta: TagMeta): TagValidation {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Custom element names must contain a hyphen
  if (!meta.tag.includes("-")) {
    errors.push(`Tag "${meta.tag}" must contain a hyphen for custom elements`);
  }

  // Must start with a lowercase letter
  if (!/^[a-z]/.test(meta.tag)) {
    errors.push(`Tag "${meta.tag}" must start with a lowercase letter`);
  }

  // Must not start with reserved prefixes
  const reservedPrefixes = ["xml", "xlink", "xmlns"];
  for (const prefix of reservedPrefixes) {
    if (meta.tag.toLowerCase().startsWith(prefix)) {
      errors.push(`Tag "${meta.tag}" must not start with reserved prefix "${prefix}"`);
    }
  }

  // Must only contain valid characters
  if (!/^[a-z][a-z0-9-]*$/.test(meta.tag)) {
    errors.push(
      `Tag "${meta.tag}" contains invalid characters (only lowercase letters, numbers, and hyphens allowed)`,
    );
  }

  // Warn about very long tag names
  if (meta.tag.length > 50) {
    warnings.push(
      `Tag "${meta.tag}" is very long (${meta.tag.length} chars), consider shorter path`,
    );
  }

  // Warn about server components being registered as custom elements
  if (meta.type === "server") {
    warnings.push(
      `Server component "${meta.filePath}" should not be registered as a custom element`,
    );
  }

  // Warn about unknown component types
  if (meta.type === "unknown") {
    warnings.push(
      `Component "${meta.filePath}" has unknown type (missing .client. or .server. suffix)`,
    );
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

export interface DefineOptions {
  /** Custom element tag name. Defaults to generated from file path */
  tag?: string;
  /** Whether to use Shadow DOM. Defaults to false */
  shadow?: boolean;
  /** Observed attributes to pass as props. Auto-extracted if not provided */
  observedAttributes?: string[];
  /** Whether to validate the tag and warn on issues. Defaults to true in development */
  validate?: boolean;
}

/** Registers a Preact component as a web component (build-time macro). */
export function define<P extends Record<string, any>>(
  Component: FunctionComponent<P>,
  options?: DefineOptions,
): FunctionComponent<P> {
  // Only register custom elements in the browser
  if (typeof window !== "undefined" && typeof HTMLElement !== "undefined") {
    const propNames = options?.observedAttributes ?? [];
    const filePath = import.meta.path;
    const meta = parseTagMeta(filePath);
    const tag = options?.tag ?? meta.tag;
    const shadow = options?.shadow ?? false;
    const shouldValidate = options?.validate ?? import.meta.env?.DEV ?? false;

    // Check if already registered
    if (customElements.get(tag)) {
      console.warn(`[solarflare] Custom element "${tag}" is already registered, skipping`);
      return Component;
    }

    // Validate tag if enabled
    if (shouldValidate) {
      const validation = validateTag({ ...meta, tag });

      // Log validation warnings in development
      for (const warning of validation.warnings) {
        console.warn(`[solarflare] ${warning}`);
      }

      // Log validation errors (but don't throw to allow recovery)
      for (const error of validation.errors) {
        console.error(`[solarflare] ${error}`);
      }

      if (!validation.valid) {
        console.error(
          `[solarflare] Tag validation failed for "${filePath}", component may not work correctly`,
        );
      }
    }

    // Register the component as a custom element
    register(Component, tag, propNames, { shadow });
  }

  return Component;
}

// Store re-exports
export {
  // Signals
  params,
  serverData,
  pathname,
  // Actions
  initStore,
  setParams,
  setServerData,
  setPathname,
  hydrateStore,
  resetStore,
  // Data islands
  serializeDataIsland,
  extractDataIsland,
  // Hydration coordinator
  hydrateComponent,
  initHydrationCoordinator,
  // Re-exports from signals-core
  signal,
  computed,
  effect,
  batch,
  // Types
  type ServerData,
  type StoreConfig,
  type ReadonlySignal,
  type Signal,
} from "./store";

// Router re-exports
export {
  createRouter,
  initRouter,
  getRouter,
  supportsViewTransitions,
  Router,
  navigate,
  isActive,
  type RouteManifestEntry,
  type RoutesManifest,
  type RouteMatch,
  type NavigateOptions,
  type RouterConfig,
  type RouteSubscriber,
} from "./router";
