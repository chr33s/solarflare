/** Server utilities for routing and streaming SSR. */
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

/** Marker for asset injection during streaming. */
export const ASSETS_MARKER = "<!--SOLARFLARE_ASSETS-->";

/** Assets placeholder component for layout injection. */
export function Assets(): VNode<any> {
  return h("solarflare-assets", { dangerouslySetInnerHTML: { __html: ASSETS_MARKER } });
}

/** Route parameter definition. */
export interface RouteParamDef {
  /** Parameter name (e.g., "slug" from ":slug") */
  name: string;
  /** Whether the parameter is optional */
  optional: boolean;
  /** Original segment in the pattern */
  segment: string;
}

/** Parsed route pattern with type information. */
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

/** Route definition with parsed pattern metadata. */
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

/** Converts file path to URLPattern with parsed metadata. */
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

/** Structured module map with typed categories. */
export interface ModuleMap {
  server: Record<string, () => Promise<{ default: unknown }>>;
  client: Record<string, () => Promise<{ default: unknown }>>;
  layout: Record<string, () => Promise<{ default: unknown }>>;
  error?: () => Promise<{ default: unknown }>;
}

/** Creates router from module map, returning sorted routes array. */
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

/** Layout definition with hierarchy information. */
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

/** Layout hierarchy result with validation metadata. */
export interface LayoutHierarchy {
  /** Ordered layouts from root to leaf */
  layouts: Layout[];
  /** Route path segments */
  segments: string[];
  /** Directories checked for layouts */
  checkedPaths: string[];
}

/** Finds all ancestor layouts for a route path, root to leaf order. */
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

/** Finds ancestor layouts for a route using structured module map. */
export function findLayouts(routePath: string, modules: ModuleMap): Layout[] {
  return findLayoutHierarchy(routePath, modules.layout).layouts;
}

/** Validated route match with type-safe params. */
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

/** Matches URL against routes using URLPattern. */
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

/** Layout props interface. */
export interface LayoutProps {
  children: VNode<any>;
}

/** Wraps content in nested layouts (root to leaf order). */
export async function wrapWithLayouts(content: VNode<any>, layouts: Layout[]): Promise<VNode<any>> {
  let wrapped: VNode<any> = content;

  for (let i = layouts.length - 1; i >= 0; i--) {
    const { loader } = layouts[i];
    const mod = await loader();
    const Layout = mod.default as FunctionComponent<LayoutProps>;
    wrapped = h(Layout, { children: wrapped });
  }

  return wrapped;
}

/** Generates asset HTML tags for injection. */
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

/** Renders a component with its tag wrapper for hydration. */
export function renderComponent(
  Component: FunctionComponent<any>,
  tag: string,
  props: Record<string, unknown>,
): VNode<any> {
  const attrs: Record<string, string> = {};
  for (const [key, value] of Object.entries(props)) {
    const type = typeof value;
    if (type === "string" || type === "number" || type === "boolean") {
      attrs[key] = String(value);
    }
  }
  return h(tag, attrs, h(Component, props));
}

/** Error page props interface. */
export interface ErrorPageProps {
  error: Error;
  url?: URL;
  statusCode?: number;
  reset?: () => void;
}

/** Renders an error page wrapped in layouts. */
export async function renderErrorPage(
  error: Error,
  url: URL,
  modules: ModuleMap,
  statusCode = 500,
): Promise<VNode<any>> {
  let ErrorComponent: FunctionComponent<ErrorPageProps>;
  if (modules.error) {
    const mod = await modules.error();
    ErrorComponent = mod.default as FunctionComponent<ErrorPageProps>;
  } else {
    ErrorComponent = ({ error, url, statusCode }: ErrorPageProps) =>
      h(
        "div",
        { class: "error-page" },
        h("h1", null, statusCode === 404 ? "Not Found" : "Something went wrong"),
        h("p", null, error.message),
        url && h("p", { class: "error-url" }, `Failed to load: ${url.pathname}`),
        h("a", { href: "/" }, "Go home"),
      );
  }

  const errorContent = h(ErrorComponent, { error, url, statusCode });

  const layouts = findLayoutHierarchy("./_error.tsx", modules.layout).layouts;
  if (layouts.length > 0) {
    return wrapWithLayouts(errorContent, layouts);
  }

  return errorContent;
}

/** Deferred data configuration for streaming. */
export interface DeferredData {
  /** Component tag to hydrate */
  tag: string;
  /** Promise that resolves to additional props */
  promise: Promise<Record<string, unknown>>;
}

/** Options for streaming rendering. */
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

/** Initializes server-side store with request context. */
export function initServerContext(options: StreamRenderOptions): void {
  resetStore();

  initStore({
    params: options.params,
    serverData: options.serverData,
  });

  if (options.pathname) {
    setPathname(options.pathname);
  }
}

/** Transforms stream to inject assets and store hydration. */
function createAssetInjectionTransformer(
  storeScript: string,
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
          buffer = buffer.replace(marker, assetTags + storeScript);
        }
        controller.enqueue(encoder.encode(buffer));
      }
    },
  });
}

/** Extended stream interface with allReady promise. */
export interface SolarflareStream extends ReadableStream<Uint8Array> {
  /** Resolves when all content has been rendered */
  allReady: Promise<void>;
}

/** Renders a VNode to a streaming response with asset injection. */
export async function renderToStream(
  vnode: VNode<any>,
  options: StreamRenderOptions = {},
): Promise<SolarflareStream> {
  initServerContext(options);

  const storeScript = await serializeStoreForHydration();
  const stream = renderToReadableStream(vnode) as RenderStream;

  const transformer = createAssetInjectionTransformer(
    storeScript,
    options.script,
    options.styles,
    options.devScripts,
  );

  const transformedStream = stream.pipeThrough(transformer);

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

/** Creates stream that flushes HTML immediately, then appends deferred data. */
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

      void (async () => {
        const reader = inputStream.getReader();

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

        try {
          const data = await promise;
          const dataIslandId = `${tag}-deferred`;
          const dataIsland = await serializeDataIsland(dataIslandId, data);
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
