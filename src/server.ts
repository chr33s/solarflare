import { type FunctionComponent, type VNode, h } from "preact";
import { renderToReadableStream, type RenderStream } from "preact-render-to-string/stream";
import { parsePath } from "./paths.ts";
import { escapeJsonForHtml } from "./serialize.ts";
import { initStore, setPathname, resetStore } from "./store.ts";
import {
  serializeStoreForHydration,
  serializeDataIsland,
  getDeferredIslandId,
  getHydrateScriptId,
} from "./hydration.ts";
import { BODY_MARKER, createAssetInjectionTransformer } from "./stream-assets.ts";
import {
  createHeadContext,
  setHeadContext,
  resetHeadContext,
  installHeadHoisting,
  resetHeadElementTracking,
} from "./head.ts";

export { Head, useHead } from "./head.ts";

/** Body placeholder component for layout injection. */
export function Body() {
  return h("solarflare-body", {
    dangerouslySetInnerHTML: { __html: BODY_MARKER },
  });
}

/** Route parameter definition. */
export interface RouteParamDef {
  name: string;
  optional: boolean;
  segment: string;
}

/** Parsed route pattern. */
export interface ParsedPattern {
  filePath: string;
  pathname: string;
  params: RouteParamDef[];
  isStatic: boolean;
  specificity: number;
}

/** Route definition. */
export interface Route {
  pattern: URLPattern;
  parsedPattern: ParsedPattern;
  path: string;
  tag: string;
  loader: () => Promise<{ default: unknown }>;
  type: "client" | "server";
}

/** Converts file path to URLPattern with parsed metadata. */
export function parsePattern(filePath: string) {
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
export function createRouter(modules: ModuleMap) {
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
      if (a.parsedPattern.isStatic !== b.parsedPattern.isStatic) {
        return a.parsedPattern.isStatic ? -1 : 1;
      }
      return b.parsedPattern.specificity - a.parsedPattern.specificity;
    });

  return routes;
}

/** Layout definition. */
export interface Layout {
  path: string;
  loader: () => Promise<{ default: unknown }>;
  depth: number;
  directory: string;
}

/** Layout hierarchy result. */
export interface LayoutHierarchy {
  layouts: Layout[];
  segments: string[];
  checkedPaths: string[];
}

/** Finds all ancestor layouts for a route path, root to leaf order. */
export function findLayoutHierarchy(
  routePath: string,
  modules: Record<string, () => Promise<{ default: unknown }>>,
): LayoutHierarchy {
  const layouts: Layout[] = [];
  const checkedPaths: string[] = [];

  const segments = routePath.replace(/^\.\//, "").split("/").slice(0, -1);
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
export function findLayouts(routePath: string, modules: ModuleMap) {
  return findLayoutHierarchy(routePath, modules.layout).layouts;
}

/** Route match result. */
export interface RouteMatch {
  route: Route;
  params: Record<string, string>;
  paramDefs: RouteParamDef[];
  complete: boolean;
}

/** Matches URL against routes using URLPattern. */
export function matchRoute(routes: Route[], url: URL) {
  for (const route of routes) {
    const result = route.pattern.exec(url);
    if (result) {
      const params = (result.pathname.groups as Record<string, string>) ?? {};
      const paramDefs = route.parsedPattern.params;

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
export async function wrapWithLayouts(content: VNode<any>, layouts: Layout[]) {
  let wrapped: VNode<any> = content;

  for (let i = layouts.length - 1; i >= 0; i--) {
    const { loader } = layouts[i];
    const mod = await loader();
    const Layout = mod.default as FunctionComponent<LayoutProps>;
    wrapped = h(Layout, { children: wrapped });
  }

  return wrapped;
}

/** Renders a component with its tag wrapper for hydration. */
export function renderComponent(
  Component: FunctionComponent<any>,
  tag: string,
  props: Record<string, unknown>,
  options?: { shadow?: boolean },
) {
  const attrs: Record<string, string> = {};
  for (const [key, value] of Object.entries(props)) {
    const type = typeof value;
    if (type === "string" || type === "number" || type === "boolean") {
      attrs[key] = String(value);
    }
  }
  const children = h(Component, props);
  if (options?.shadow) {
    return h(tag, attrs, h("template", { shadowrootmode: "open" }, children));
  }
  return h(tag, attrs, children);
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
) {
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
  /** Component tag to hydrate. */
  tag: string;
  /** Multiple independent deferred props, streamed as each promise resolves. */
  promises: Record<string, Promise<unknown>>;
}

/** Streaming render options. */
export interface StreamRenderOptions {
  /** Route parameters. */
  params?: Record<string, string>;
  /** Server-loaded data for immediate render. */
  serverData?: unknown;
  /** Current pathname. */
  pathname?: string;
  /** Script path to inject. */
  script?: string;
  /** Stylesheet paths. */
  styles?: string[];
  /** Dev scripts (e.g., console forwarding). */
  devScripts?: string[];
  /** Deferred data to stream after shell. */
  deferred?: DeferredData;
  /** HTTP status code to return. */
  _status?: number;
  /** HTTP status text to return. */
  _statusText?: string;
  /** Custom HTTP headers to merge. */
  _headers?: Record<string, string>;
}

/** Initializes server-side store with request context. */
export function initServerContext(options: StreamRenderOptions) {
  resetStore();
  resetHeadContext();
  resetHeadElementTracking();

  // Install head hoisting (idempotent - only installs once)
  installHeadHoisting();

  // Create fresh head context for this request
  const headCtx = createHeadContext();
  setHeadContext(headCtx);

  initStore({
    params: options.params,
    serverData: options.serverData,
  });

  if (options.pathname) {
    setPathname(options.pathname);
  }
}

/** Extended stream interface with allReady promise. */
export interface SolarflareStream extends ReadableStream<Uint8Array> {
  /** Resolves when all content has been rendered. */
  allReady: Promise<void>;
  /** HTTP status code. */
  status?: number;
  /** HTTP status text. */
  statusText?: string;
  /** Custom HTTP headers. */
  headers?: Record<string, string>;
}

/** Renders a VNode to a streaming response with asset injection. */
export async function renderToStream(vnode: VNode<any>, options: StreamRenderOptions = {}) {
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
    const resultStream = createDeferredStream(transformedStream, options.deferred);
    (resultStream as SolarflareStream).allReady = stream.allReady;
    (resultStream as SolarflareStream).status = options._status ?? 200;
    (resultStream as SolarflareStream).statusText = options._statusText;
    (resultStream as SolarflareStream).headers = options._headers;
    return resultStream as SolarflareStream;
  }

  const resultStream = transformedStream as SolarflareStream;
  resultStream.allReady = stream.allReady;
  resultStream.status = options._status ?? 200;
  resultStream.statusText = options._statusText;
  resultStream.headers = options._headers;
  return resultStream;
}

/** Creates stream that flushes HTML immediately, then appends deferred data. */
function createDeferredStream(inputStream: ReadableStream<Uint8Array>, deferred: DeferredData) {
  const encoder = new TextEncoder();

  let controller: ReadableStreamDefaultController<Uint8Array>;

  const tag = deferred.tag;

  let inputDone = false;
  let pendingDeferred = 0;
  let allowDeferredFlush = true;
  let closed = false;
  const pendingChunks: Uint8Array[] = [];
  const emittedDeferred = new Set<string>();

  function maybeClose() {
    if (closed) return;
    if (!inputDone) return;
    if (pendingDeferred !== 0) return;
    if (!allowDeferredFlush) return;
    closed = true;
    controller.close();
  }

  function flushPendingChunks() {
    if (!allowDeferredFlush) return;

    while (pendingChunks.length > 0) {
      controller.enqueue(pendingChunks.shift()!);
    }

    maybeClose();
  }

  function enqueueDeferredChunk(html: string) {
    const chunk = encoder.encode(html);
    if (allowDeferredFlush) {
      controller.enqueue(chunk);
      maybeClose();
    } else {
      pendingChunks.push(chunk);
    }
  }

  /** Builds data island HTML with deferred hydration trigger. */
  async function buildDeferredHtml(dataIslandId: string, data: unknown, hydrateScriptId: string) {
    const dataIsland = await serializeDataIsland(dataIslandId, data);
    const hydrationDetail = escapeJsonForHtml({ tag, id: dataIslandId });
    const hydrationScript = /* html */ `<script id="${hydrateScriptId}">(function(){var s=document.currentScript;setTimeout(()=>{document.dispatchEvent(new CustomEvent("sf:queue-hydrate",{detail:${hydrationDetail}}));s?.remove();},0);})()</script>`;
    return dataIsland + hydrationScript;
  }

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

        inputDone = true;
        flushPendingChunks();
        maybeClose();
      })();

      const entries = Object.entries(deferred.promises);
      pendingDeferred = entries.length;

      entries.forEach(([key, promise]) => {
        void Promise.resolve(promise)
          .then(async (value) => {
            const safeKey = key.replace(/[^a-zA-Z0-9_-]/g, "_");
            const dataIslandId = getDeferredIslandId(tag, safeKey);
            const hydrateScriptId = getHydrateScriptId(tag, safeKey);
            if (emittedDeferred.has(dataIslandId) || emittedDeferred.has(hydrateScriptId)) return;
            emittedDeferred.add(dataIslandId);
            emittedDeferred.add(hydrateScriptId);
            const html = await buildDeferredHtml(dataIslandId, { [key]: value }, hydrateScriptId);
            enqueueDeferredChunk(html);
          })
          .catch((err) => {
            const errorScript = /* html */ `<script>console.error("[solarflare] Deferred error (${escapeJsonForHtml(key)}):", ${escapeJsonForHtml((err as Error).message)})</script>`;
            enqueueDeferredChunk(errorScript);
          })
          .finally(() => {
            pendingDeferred--;
            maybeClose();
          });
      });
    },
  });

  return stream;
}
