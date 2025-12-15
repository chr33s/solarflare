/**
 * Solarflare Client
 * Web component registration, hydration & signal-based state
 */
import { type FunctionComponent } from "preact";
import { useEffect, useState } from "preact/hooks";
import register from "preact-custom-element";
import { parsePath } from "./paths";
import {
  params as paramsSignal,
  serverData as serverDataSignal,
  hydrateStore,
  initHydrationCoordinator,
  type ServerData,
} from "./store";
import { getRouter } from "./router";

/**
 * Hook to access current route params
 * Uses signals internally for reactivity with web components
 *
 * @example
 * ```tsx
 * function BlogPost() {
 *   const params = useParams();
 *   return <h1>Post: {params.slug}</h1>;
 * }
 * ```
 *
 * For signal-based reactive access, use:
 * ```tsx
 * import { getRouter } from "solarflare/client";
 *
 * function BlogPost() {
 *   const router = getRouter();
 *   // router.params is a ReadonlySignal<Record<string, string>>
 *   return <h1>Post: {router.params.value.slug}</h1>;
 * }
 * ```
 */
export function useParams(): Record<string, string> {
  // Try to get params from router first (client-side)
  try {
    const router = getRouter();
    // Subscribe to signal changes and re-render
    const [params, setParams] = useState(router.params.value);

    useEffect(() => {
      // Return cleanup function from effect subscription
      return router.subscribe(() => {
        setParams(router.params.value);
      });
    }, []);

    return params;
  } catch {
    // Fallback to signal store (SSR or before router init)
    return paramsSignal.value;
  }
}

/**
 * Hook to access server data with loading/error states
 *
 * @example
 * ```tsx
 * function MyComponent() {
 *   const { data, loading, error } = useServerData<Post>();
 *
 *   if (loading) return <Spinner />;
 *   if (error) return <Error message={error.message} />;
 *   return <Article data={data} />;
 * }
 * ```
 */
export function useServerData<T>(): ServerData<T> {
  const [state, setState] = useState<ServerData<T>>(
    serverDataSignal.value as ServerData<T>
  );

  useEffect(() => {
    // Use effect to subscribe - signals-core effect returns cleanup
    const { effect } = require("@preact/signals-core");
    return effect(() => {
      setState(serverDataSignal.value as ServerData<T>);
    });
  }, []);

  return state;
}

/**
 * Initialize client-side store from SSR hydration data
 * Call this early in your client entry point
 */
export function initClient(): void {
  hydrateStore();
  initHydrationCoordinator();
}

/**
 * Parsed tag metadata from file path
 */
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

/**
 * Validation result for tag generation
 */
export interface TagValidation {
  /** Whether the tag is valid */
  valid: boolean;
  /** Validation errors */
  errors: string[];
  /** Validation warnings */
  warnings: string[];
}

/**
 * Parse file path into structured tag metadata
 * Delegates to parsePath from ast.ts for unified path handling
 */
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

/**
 * Validate a generated tag against web component naming rules
 */
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

/**
 * Generate custom element tag from file path with validation
 * e.g., "app/blog/$slug.client.tsx" → "sf-blog-slug"
 */
export function pathToTagName(path: string): string {
  return parsePath(path).tag;
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

/**
 * Registration result with metadata for debugging
 */
export interface DefineResult<P> {
  /** The registered component */
  Component: FunctionComponent<P>;
  /** Tag metadata */
  meta: TagMeta;
  /** Validation result */
  validation: TagValidation;
  /** Whether registration succeeded */
  registered: boolean;
}

/**
 * Build-time macro that registers a Preact component as a web component
 * Extracts observed attributes from the component's props type
 *
 * @example
 * ```tsx
 * import { define } from "solarflare/client" with { type: "macro" };
 *
 * interface Props {
 *   slug: string;
 *   title: string;
 * }
 *
 * function BlogPost({ slug, title }: Props) {
 *   return <article><h1>{title}</h1></article>;
 * }
 *
 * export default define(BlogPost);
 * ```
 */
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

/**
 * Define with full metadata result (for debugging/testing)
 * Returns the component along with registration metadata
 */
export function defineWithMeta<P extends Record<string, any>>(
  Component: FunctionComponent<P>,
  options?: DefineOptions,
): DefineResult<P> {
  const filePath = import.meta.path;
  const meta = parseTagMeta(filePath);
  const tag = options?.tag ?? meta.tag;
  const validation = validateTag({ ...meta, tag });

  let registered = false;

  // Only register custom elements in the browser
  if (typeof window !== "undefined" && typeof HTMLElement !== "undefined") {
    const propNames = options?.observedAttributes ?? [];
    const shadow = options?.shadow ?? false;

    if (validation.valid) {
      register(Component, tag, propNames, { shadow });
      registered = true;
    }
  }

  return {
    Component,
    meta: { ...meta, tag },
    validation,
    registered,
  };
}

/**
 * Re-export store for signal-based state management
 */
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
  // Computed helpers
  computedParam,
  computedData,
  isLoading,
  hasError,
  // Effect helpers
  onParamsChange,
  onServerDataChange,
  // Data islands
  serializeDataIsland,
  extractDataIsland,
  // Hydration coordinator
  registerForHydration,
  getRegisteredComponent,
  hydrateComponent,
  initHydrationCoordinator,
  cleanupHydrationCoordinator,
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

/**
 * Re-export router for client-side SPA navigation
 */
export {
  // Factory functions
  createRouter,
  initRouter,
  getRouter,
  // Feature detection
  supportsViewTransitions,
  // Router class
  Router,
  // Convenience functions
  navigate,
  isActive,
  // Types
  type RouteManifestEntry,
  type RoutesManifest,
  type RouteMatch,
  type NavigateOptions,
  type RouterConfig,
  type RouteSubscriber,
} from "./router";
