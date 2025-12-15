/**
 * Solarflare Server
 * Server utilities: createRouter(), findLayouts(), matchRoute(), wrapWithLayouts()
 * Streaming SSR with preact-render-to-string/stream
 */
import { type VNode, h } from "preact";
import { type FunctionComponent } from "preact";
import { renderToReadableStream, type RenderStream } from "preact-render-to-string/stream";
import { parsePath } from "./paths";
import {
  initStore,
  setPathname,
  serializeStoreForHydration,
  serializeDataIsland,
  resetStore,
} from "./store";

/**
 * Marker for asset injection - will be replaced with actual script/style tags
 */
export const ASSETS_MARKER = "<!--SOLARFLARE_ASSETS-->";

/**
 * Assets placeholder component
 * Place this in your root layout's <head> to inject route-specific CSS
 * and at the end of <body> for the script
 */
export function Assets(): VNode<any> {
  // Render a special comment marker that will be replaced with actual assets
  return h("solarflare-assets", { dangerouslySetInnerHTML: { __html: ASSETS_MARKER } });
}

/**
 * Route parameter definition extracted from pattern
 */
export interface RouteParamDef {
  /** Parameter name (e.g., "slug" from ":slug") */
  name: string;
  /** Whether the parameter is optional */
  optional: boolean;
  /** Original segment in the pattern */
  segment: string;
}

/**
 * Parsed route pattern with type information
 */
export interface ParsedPattern {
  /** Original file path */
  filePath: string;
  /** URLPattern pathname */
  pathname: string;
  /** Extracted parameter definitions */
  params: RouteParamDef[];
  /** Whether this is a static route (no params) */
  isStatic: boolean;
  /** Route specificity score for sorting */
  specificity: number;
}

/**
 * Route definition with parsed pattern metadata
 */
export interface Route {
  /** URLPattern for matching requests */
  pattern: URLPattern;
  /** Parsed pattern with type information */
  parsedPattern: ParsedPattern;
  /** Original file path */
  path: string;
  /** Custom element tag name */
  tag: string;
  /** Dynamic module loader */
  loader: () => Promise<{ default: unknown }>;
  /** Route type: client or server */
  type: "client" | "server";
}

/**
 * Convert file path to URLPattern pathname with parsed metadata
 * Delegates to parsePath from ast.ts for unified path handling
 */
export function parsePattern(filePath: string): ParsedPattern {
  const parsed = parsePath(filePath);

  // Transform params from string[] to RouteParamDef[]
  const params: RouteParamDef[] = parsed.params.map((name) => ({
    name,
    optional: false,
    segment: `:${name}`,
  }));

  return {
    filePath: parsed.original,
    pathname: parsed.pattern,
    params,
    isStatic: params.length === 0,
    specificity: parsed.specificity,
  };
}

/**
 * Structured module map with typed categories
 */
export interface ModuleMap {
  server: Record<string, () => Promise<{ default: unknown }>>;
  client: Record<string, () => Promise<{ default: unknown }>>;
  layout: Record<string, () => Promise<{ default: unknown }>>;
}

/**
 * Create router from structured module map
 * Returns a sorted array of routes for linear URLPattern matching
 * Filters out _prefixed files, sorts by specificity using parsed pattern metadata
 */
export function createRouter(modules: ModuleMap): Route[] {
  // Combine server and client modules for routing (layouts are handled separately)
  const routeModules = { ...modules.server, ...modules.client };

  const routes = Object.entries(routeModules)
    .filter(([path]) => !path.includes("/_"))
    .map(([path, loader]) => {
      const parsedPattern = parsePattern(path);
      return {
        pattern: new URLPattern({ pathname: parsedPattern.pathname }),
        parsedPattern,
        path,
        tag: parsePath(path).tag,
        loader,
        type: path.includes(".server.") ? ("server" as const) : ("client" as const),
      };
    })
    .sort((a, b) => {
      // Static routes before dynamic routes
      if (a.parsedPattern.isStatic !== b.parsedPattern.isStatic) {
        return a.parsedPattern.isStatic ? -1 : 1;
      }
      // Higher specificity first (more specific routes win)
      return b.parsedPattern.specificity - a.parsedPattern.specificity;
    });

  return routes;
}

/**
 * Layout definition with hierarchy information
 */
export interface Layout {
  /** Layout file path */
  path: string;
  /** Dynamic layout loader */
  loader: () => Promise<{ default: unknown }>;
  /** Nesting depth (0 = root) */
  depth: number;
  /** Directory this layout applies to */
  directory: string;
}

/**
 * Layout hierarchy result with validation metadata
 */
export interface LayoutHierarchy {
  /** Ordered layouts from root to leaf */
  layouts: Layout[];
  /** Route path segments */
  segments: string[];
  /** Directories checked for layouts */
  checkedPaths: string[];
}

/**
 * Find all ancestor layouts for a route path with hierarchy metadata
 * Returns layouts from root to leaf order with validation info
 * e.g., "./blog/$slug.server.tsx" → { layouts: [...], segments: ["blog"], ... }
 */
export function findLayoutHierarchy(
  routePath: string,
  modules: Record<string, () => Promise<{ default: unknown }>>,
): LayoutHierarchy {
  const layouts: Layout[] = [];
  const checkedPaths: string[] = [];

  // Remove leading ./ and get segments (minus the file itself)
  const segments = routePath.replace(/^\.\//, "").split("/").slice(0, -1);

  // Check root layout first
  const rootLayout = "./_layout.tsx";
  checkedPaths.push(rootLayout);
  if (rootLayout in modules) {
    layouts.push({
      path: rootLayout,
      loader: modules[rootLayout],
      depth: 0,
      directory: ".",
    });
  }

  // Walk up the path checking for layouts
  let current = ".";
  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    if (!segment) continue;
    current += `/${segment}`;
    const layoutPath = `${current}/_layout.tsx`;
    checkedPaths.push(layoutPath);
    if (layoutPath in modules) {
      layouts.push({
        path: layoutPath,
        loader: modules[layoutPath],
        depth: i + 1,
        directory: current,
      });
    }
  }

  return { layouts, segments, checkedPaths };
}

/**
 * Find all ancestor layouts for a route path using structured module map
 * Returns layouts from root to leaf order
 * e.g., "./blog/$slug.server.tsx" → ["./_layout.tsx", "./blog/_layout.tsx"]
 */
export function findLayouts(routePath: string, modules: ModuleMap): Layout[] {
  // Use the layout category from the structured module map
  return findLayoutHierarchy(routePath, modules.layout).layouts;
}

/**
 * Validated route match with type-safe params
 */
export interface RouteMatch {
  /** Matched route */
  route: Route;
  /** Extracted URL parameters (validated against pattern definition) */
  params: Record<string, string>;
  /** Parameter definitions from the route pattern */
  paramDefs: RouteParamDef[];
  /** Whether all required params were matched */
  complete: boolean;
}

/**
 * Match URL against routes using URLPattern
 * Linear search through sorted routes array (fast enough for modern browsers)
 */
export function matchRoute(routes: Route[], url: URL): RouteMatch | null {
  for (const route of routes) {
    const result = route.pattern.exec(url);
    if (result) {
      const params = (result.pathname.groups as Record<string, string>) ?? {};
      const paramDefs = route.parsedPattern.params;

      // Validate that all required params are present
      const complete = paramDefs
        .filter((p) => !p.optional)
        .every((p) => p.name in params && params[p.name] !== undefined);

      return {
        route,
        params,
        paramDefs,
        complete,
      };
    }
  }
  return null;
}

/**
 * Layout props - just children, assets are injected separately
 */
export interface LayoutProps {
  children: VNode<any>;
}

/**
 * Wrap content in nested layouts (innermost first)
 * Layouts are applied from root to leaf
 * @param content - The content to wrap
 * @param layouts - The layouts to apply
 */
export async function wrapWithLayouts(content: VNode<any>, layouts: Layout[]): Promise<VNode<any>> {
  let wrapped: VNode<any> = content;

  // Apply layouts from leaf to root (reverse order)
  for (let i = layouts.length - 1; i >= 0; i--) {
    const { loader } = layouts[i];
    const mod = await loader();
    const Layout = mod.default as FunctionComponent<LayoutProps>;
    wrapped = h(Layout, { children: wrapped });
  }

  return wrapped;
}

/**
 * Generate asset HTML tags for injection
 */
export function generateAssetTags(
  script?: string,
  styles?: string[],
  devScripts?: string[],
): string {
  let html = "";

  // Add stylesheet links
  if (styles && styles.length > 0) {
    for (const href of styles) {
      html += `<link rel="stylesheet" href="${href}">`;
    }
  }

  // Add dev mode scripts (like console forwarding)
  if (devScripts && devScripts.length > 0) {
    for (const src of devScripts) {
      html += `<script src="${src}"></script>`;
    }
  }

  // Add script tag
  if (script) {
    html += `<script type="module" src="${script}"></script>`;
  }

  return html;
}

/**
 * Render a component with its tag wrapper for hydration
 */
export function renderComponent(
  Component: FunctionComponent<any>,
  tag: string,
  props: Record<string, unknown>,
): VNode<any> {
  // Create the custom element wrapper with props as attributes
  // The SSR content goes inside the custom element
  // Convert props to string attributes for the custom element
  const attrs: Record<string, string> = {};
  for (const [key, value] of Object.entries(props)) {
    // Only serialize primitive types to avoid "[object Object]" strings
    const type = typeof value;
    if (type === "string" || type === "number" || type === "boolean") {
      attrs[key] = String(value);
    }
  }
  return h(tag, attrs, h(Component, props));
}

// ============================================================================
// Streaming SSR with Signals Context
// ============================================================================

/**
 * Deferred data configuration for streaming
 */
export interface DeferredData {
  /** Component tag to hydrate */
  tag: string;
  /** Promise that resolves to additional props */
  promise: Promise<Record<string, unknown>>;
}

/**
 * Options for streaming rendering
 */
export interface StreamRenderOptions {
  /** Route parameters */
  params?: Record<string, string>;
  /** Server-loaded data (shell data for immediate render) */
  serverData?: unknown;
  /** Current pathname */
  pathname?: string;
  /** Script path to inject */
  script?: string;
  /** Stylesheet paths to inject */
  styles?: string[];
  /** Dev mode scripts to inject (e.g., console forwarding) */
  devScripts?: string[];
  /** Deferred data to stream after initial render */
  deferred?: DeferredData;
}

/**
 * Initialize server-side store with request context
 * Must be called before rendering to set up signal context
 */
export function initServerContext(options: StreamRenderOptions): void {
  // Reset store for clean SSR (important for Cloudflare Workers reuse)
  resetStore();

  // Initialize store with request-specific data
  initStore({
    params: options.params,
    serverData: options.serverData,
  });

  if (options.pathname) {
    setPathname(options.pathname);
  }
}

/**
 * Transform a ReadableStream to inject assets and store hydration
 * Replaces the ASSETS_MARKER with actual asset tags and appends store script
 * Also injects <!DOCTYPE html> before the root <html> tag
 */
function createAssetInjectionTransformer(
  script?: string,
  styles?: string[],
  devScripts?: string[],
): TransformStream<Uint8Array, Uint8Array> {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  let buffer = "";
  let doctypeInjected = false;
  const marker = `<solarflare-assets>${ASSETS_MARKER}</solarflare-assets>`;

  return new TransformStream({
    transform(chunk, controller) {
      buffer += decoder.decode(chunk, { stream: true });

      // Inject <!DOCTYPE html> before the root <html> tag (only once)
      if (!doctypeInjected) {
        const htmlIndex = buffer.indexOf("<html");
        if (htmlIndex !== -1) {
          buffer = buffer.slice(0, htmlIndex) + "<!DOCTYPE html>" + buffer.slice(htmlIndex);
          doctypeInjected = true;
        }
      }

      // Check if we have the complete marker
      const markerIndex = buffer.indexOf(marker);
      if (markerIndex !== -1) {
        // Generate replacement content
        const assetTags = generateAssetTags(script, styles, devScripts);
        const storeScript = serializeStoreForHydration();

        // Replace marker with assets + store hydration
        buffer = buffer.replace(marker, assetTags + storeScript);

        // Flush everything before and including the replacement
        controller.enqueue(encoder.encode(buffer));
        buffer = "";
      } else if (buffer.length > marker.length * 2) {
        // If buffer is getting large and no marker found, flush safe portion
        const safeLength = buffer.length - marker.length;
        controller.enqueue(encoder.encode(buffer.slice(0, safeLength)));
        buffer = buffer.slice(safeLength);
      }
    },
    flush(controller) {
      // Flush any remaining content
      if (buffer) {
        // Inject doctype if not done yet (edge case: small document)
        if (!doctypeInjected) {
          const htmlIndex = buffer.indexOf("<html");
          if (htmlIndex !== -1) {
            buffer = buffer.slice(0, htmlIndex) + "<!DOCTYPE html>" + buffer.slice(htmlIndex);
          }
        }
        // Final check for marker in remaining content
        const markerIndex = buffer.indexOf(marker);
        if (markerIndex !== -1) {
          const assetTags = generateAssetTags(script, styles, devScripts);
          const storeScript = serializeStoreForHydration();
          buffer = buffer.replace(marker, assetTags + storeScript);
        }
        controller.enqueue(encoder.encode(buffer));
      }
    },
  });
}

/**
 * Extended stream interface with allReady promise
 */
export interface SolarflareStream extends ReadableStream<Uint8Array> {
  /** Resolves when all content has been rendered */
  allReady: Promise<void>;
}

/**
 * Render a VNode to a streaming response with automatic asset injection
 * Uses preact-render-to-string/stream for progressive HTML streaming
 *
 * @example
 * ```tsx
 * const stream = await renderToStream(
 *   <Layout><Page /></Layout>,
 *   {
 *     params: { slug: 'hello-world' },
 *     serverData: await loader(request),
 *     script: '/chunk.js',
 *     styles: ['/style.css'],
 *   }
 * );
 *
 * return new Response(stream, {
 *   headers: { 'Content-Type': 'text/html; charset=utf-8' },
 * });
 * ```
 */
export async function renderToStream(
  vnode: VNode<any>,
  options: StreamRenderOptions = {},
): Promise<SolarflareStream> {
  // Initialize server context with signals
  initServerContext(options);

  // Render to streaming response
  const stream = renderToReadableStream(vnode) as RenderStream;

  // Create asset injection transformer
  const transformer = createAssetInjectionTransformer(
    options.script,
    options.styles,
    options.devScripts,
  );

  // Pipe through transformer
  const transformedStream = stream.pipeThrough(transformer);

  // If we have deferred data, we need to manually handle the stream
  if (options.deferred) {
    const { tag, promise } = options.deferred;
    const resultStream = createDeferredStream(transformedStream, tag, promise);
    (resultStream as SolarflareStream).allReady = stream.allReady;
    return resultStream as SolarflareStream;
  }

  const resultStream = transformedStream as SolarflareStream;
  resultStream.allReady = stream.allReady;
  return resultStream;
}

/**
 * Create a stream that sends HTML immediately (complete document),
 * then appends deferred data script when the promise resolves.
 *
 * The key insight: we flush complete HTML first, THEN wait for deferred.
 * Browser renders immediately, deferred script updates DOM when it arrives.
 */
function createDeferredStream(
  inputStream: ReadableStream<Uint8Array>,
  tag: string,
  promise: Promise<Record<string, unknown>>,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();

  let controller: ReadableStreamDefaultController<Uint8Array>;

  const stream = new ReadableStream<Uint8Array>({
    start(ctrl) {
      controller = ctrl;

      // Start async pipeline (non-blocking)
      void (async () => {
        const reader = inputStream.getReader();

        // 1. Pipe all HTML chunks immediately
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            controller.enqueue(value);
          }
        } catch (err) {
          controller.error(err);
          return;
        }

        // 2. HTML is now fully sent - browser starts rendering
        // Now wait for deferred data (this doesn't block the HTML)
        try {
          const data = await promise;
          const dataIslandId = `${tag}-deferred`;
          const dataIsland = serializeDataIsland(dataIslandId, data);
          // Queue hydration call if coordinator isn't ready yet, otherwise call directly
          // Use requestAnimationFrame to ensure DOM is fully parsed before querySelector
          // Note: Push a tuple [tag, dataIslandId] to the queue, not two separate elements
          const hydrationScript = `<script>requestAnimationFrame(()=>window.__SF_HYDRATE__?window.__SF_HYDRATE__("${tag}","${dataIslandId}"):(window.__SF_HYDRATE_QUEUE__??=[]).push(["${tag}","${dataIslandId}"]))</script>`;
          controller.enqueue(encoder.encode(dataIsland + hydrationScript));
        } catch (err) {
          const errorScript = `<script>console.error("[solarflare] Deferred error:", ${JSON.stringify((err as Error).message)})</script>`;
          controller.enqueue(encoder.encode(errorScript));
        }

        controller.close();
      })();
    },
  });

  return stream;
}

// Re-export store utilities for use in server components
export {
  initStore,
  setParams,
  setServerData,
  setPathname,
  resetStore,
  serializeStoreForHydration,
  serializeDataIsland,
  params,
  serverData,
  pathname,
} from "./store";
