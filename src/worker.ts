import { type FunctionComponent } from "preact";
import {
  createRouter,
  matchRoute,
  findLayouts,
  wrapWithLayouts,
  renderComponent,
  renderToStream,
  renderErrorPage,
  type ModuleMap,
  type Route,
  type SolarflareStream,
} from "./server";
import { isConsoleRequest, processConsoleLogs, type LogLevel } from "./console-forward.ts";
import { isDevToolsRequest, handleDevToolsRequest } from "./devtools-json.ts";
import { isHmrRequest, handleHmrRequest } from "./server.hmr.ts";
export { broadcastHmrUpdate, type HmrEventType } from "./server.hmr.ts";
import {
  generateStaticShell,
  createEarlyFlushStream,
  generateResourceHints,
  type StreamingShell,
} from "./early-flush.ts";
import { extractCriticalCss, generateAsyncCssLoader } from "./critical-css.ts";
import { collectEarlyHints, generateEarlyHintsHeader } from "./early-hints.ts";
import { ResponseCache, withCache } from "./route-cache.ts";
import { parseMetaConfig, workerConfigMeta } from "./worker-config.ts";
export { workerConfigMeta };
import { getHeadContext } from "./head.ts";
import type { ChunkManifest } from "./manifest.ts";
// @ts-ignore - Generated at build time, aliased by bundler
import modules from ".modules.generated";
// @ts-ignore - Generated at build time, aliased by bundler
import chunkManifest from ".chunks.generated.json";

const typedModules = modules as ModuleMap;

const manifest = chunkManifest as ChunkManifest;

const responseCache = new ResponseCache(100);

const staticShellCache = new Map<string, StreamingShell>();

/** Gets or creates a static shell. */
function getStaticShell(lang: string) {
  let shell = staticShellCache.get(lang);
  if (!shell) {
    shell = generateStaticShell({ lang });
    staticShellCache.set(lang, shell);
  }
  return shell;
}

/** Worker optimization options. */
export interface WorkerOptimizations {
  earlyFlush?: boolean;
  criticalCss?: boolean;
  readCss?: (path: string) => Promise<string>;
}

/** Gets the script path for a route from the chunk manifest. */
function getScriptPath(tag: string) {
  return manifest.tags[tag];
}

/** Gets stylesheets for a route pattern from the chunk manifest. */
function getStylesheets(pattern: string) {
  return manifest.styles[pattern] ?? [];
}

/** Gets dev mode scripts from the chunk manifest. */
function getDevScripts() {
  return manifest.devScripts;
}

/** Server data loader function type. */
type ServerLoader = (
  request: Request,
  params: Record<string, string>,
) => Record<string, unknown> | Promise<Record<string, unknown>>;

const router = createRouter(typedModules);

/** Finds paired module (server for client, or client for server). */
function findPairedModule(path: string) {
  if (path.includes(".client.")) {
    const serverPath = path.replace(".client.", ".server.");
    return serverPath in typedModules.server ? serverPath : null;
  }
  if (path.includes(".server.")) {
    const clientPath = path.replace(".server.", ".client.");
    return clientPath in typedModules.client ? clientPath : null;
  }
  return null;
}

/** Worker environment. */
interface WorkerEnv {
  WRANGLER_LOG?: LogLevel;
  SF_OPTIMIZATIONS?: WorkerOptimizations;
  [key: string]: unknown;
}

interface SsrContext {
  url: URL;
  route: Route;
  params: Record<string, string>;
  content: ReturnType<typeof renderComponent>;
  shellData: Record<string, unknown>;
  deferredData: Record<string, Promise<unknown>> | null;
  responseHeaders?: Record<string, string>;
  responseStatus?: number;
  responseStatusText?: string;
  scriptPath?: string;
  stylesheets: string[];
  devScripts?: string[];
  metaConfig: ReturnType<typeof parseMetaConfig>;
}

interface RenderPlan {
  ssrStream: SolarflareStream;
  finalHeaders: Record<string, string>;
  status: number;
  statusText?: string;
  metaConfig: ReturnType<typeof parseMetaConfig>;
  stylesheets: string[];
  resourceHints: string;
  useEarlyFlush: boolean;
  useCriticalCss: boolean;
  pathname: string;
}

type MatchAndLoadResult =
  | { kind: "not-found" }
  | { kind: "api"; response: Response }
  | { kind: "ssr"; context: SsrContext };

function getDefaultHeaders() {
  return {
    "Content-Type": "text/html; charset=utf-8",
    "Content-Encoding": "identity",
    "Content-Security-Policy": "frame-ancestors 'self'",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Transfer-Encoding": "chunked",
    "X-Content-Type-Options": "nosniff",
  };
}

async function handleDevEndpoints(request: Request, env?: WorkerEnv) {
  if (isHmrRequest(request)) {
    return handleHmrRequest();
  }

  if (isConsoleRequest(request)) {
    const logLevel = env?.WRANGLER_LOG ?? "log";
    return processConsoleLogs(request, logLevel);
  }

  if (isDevToolsRequest(request)) {
    return handleDevToolsRequest();
  }

  return null;
}

async function renderErrorResponse(
  error: Error,
  url: URL,
  status: number,
  headers: Record<string, string>,
) {
  const errorContent = await renderErrorPage(error, url, typedModules, status);
  const stylesheets = getStylesheets("/");
  const devScripts = getDevScripts();

  const stream = await renderToStream(errorContent, {
    pathname: url.pathname,
    styles: stylesheets,
    devScripts,
  });

  return new Response(stream, {
    headers,
    status,
  });
}

async function matchAndLoad(request: Request, url: URL): Promise<MatchAndLoadResult> {
  const match = matchRoute(router, url);

  if (!match) {
    return { kind: "not-found" };
  }

  const { route, params } = match;

  if (route.type === "server") {
    const pairedClientPath = findPairedModule(route.path);
    if (!pairedClientPath) {
      const mod = await route.loader();
      const handler = mod.default as (request: Request) => Response | Promise<Response>;
      return { kind: "api", response: await handler(request) };
    }
  }

  let serverPath: string | null = null;
  let clientPath: string;

  if (route.type === "server") {
    serverPath = route.path;
    clientPath = route.path.replace(".server.", ".client.");
  } else {
    clientPath = route.path;
    serverPath = findPairedModule(route.path);
  }

  let shellData: Record<string, unknown> = {};
  let deferredData: Record<string, Promise<unknown>> | null = null;
  let responseHeaders: Record<string, string> | undefined;
  let responseStatus: number | undefined;
  let responseStatusText: string | undefined;

  if (serverPath && serverPath in typedModules.server) {
    const serverMod = await typedModules.server[serverPath]();
    const loader = serverMod.default as ServerLoader;
    const result = (await loader(request, params)) as Record<string, unknown> & {
      _headers?: Record<string, string>;
      _status?: number;
      _statusText?: string;
    };

    responseHeaders = result._headers;
    responseStatus = result._status;
    responseStatusText = result._statusText;

    const immediateData: Record<string, unknown> = {};
    const deferredPromises: Record<string, Promise<unknown>> = {};

    const dataEntries = Object.entries(result).filter(([key]) => !key.startsWith("_"));

    for (const [key, value] of dataEntries) {
      if (value instanceof Promise) {
        deferredPromises[key] = value;
      } else {
        immediateData[key] = value;
      }
    }

    shellData = immediateData;
    deferredData = Object.keys(deferredPromises).length > 0 ? deferredPromises : null;
  }

  const props: Record<string, unknown> = { ...params, ...shellData };

  const clientMod = await typedModules.client[clientPath]();
  const Component = clientMod.default as FunctionComponent<any>;

  let content = renderComponent(Component, route.tag, props);

  const layouts = findLayouts(route.path, typedModules);
  if (layouts.length > 0) {
    content = await wrapWithLayouts(content, layouts);
  }

  const scriptPath = getScriptPath(route.tag);
  const stylesheets = getStylesheets(route.parsedPattern.pathname);
  const devScripts = getDevScripts();

  const headCtx = getHeadContext();
  const headHtml = headCtx.renderToString();
  const metaConfig = parseMetaConfig(headHtml);

  return {
    kind: "ssr",
    context: {
      url,
      route,
      params,
      content,
      shellData,
      deferredData,
      responseHeaders,
      responseStatus,
      responseStatusText,
      scriptPath,
      stylesheets,
      devScripts,
      metaConfig,
    },
  };
}

async function renderStream(
  context: SsrContext,
  headers: Record<string, string>,
  envOptimizations: WorkerOptimizations,
) {
  const { url, route, params, content, shellData, deferredData, metaConfig } = context;
  const { scriptPath, stylesheets, devScripts } = context;

  const earlyHints = collectEarlyHints({
    scriptPath,
    stylesheets,
    preconnectOrigins: metaConfig.preconnectOrigins,
  });

  const resourceHints = generateResourceHints({
    scripts: scriptPath ? [scriptPath] : [],
    stylesheets,
  });

  const useEarlyFlush = envOptimizations.earlyFlush ?? metaConfig.earlyFlush;
  const useCriticalCss = envOptimizations.criticalCss ?? metaConfig.criticalCss;

  const ssrStream = await renderToStream(content, {
    params,
    serverData: shellData,
    pathname: url.pathname,
    script: scriptPath,
    styles: useEarlyFlush ? [] : stylesheets,
    devScripts,
    deferred: deferredData ? { tag: route.tag, promises: deferredData } : undefined,
    _headers: context.responseHeaders,
    _status: context.responseStatus,
    _statusText: context.responseStatusText,
  });

  const finalHeaders: Record<string, string> = { ...headers };
  if (ssrStream.headers) {
    for (const [key, value] of Object.entries(ssrStream.headers)) {
      finalHeaders[key] = value;
    }
  }

  if (earlyHints.length > 0) {
    finalHeaders["Link"] = generateEarlyHintsHeader(earlyHints);
  }

  return {
    ssrStream,
    finalHeaders,
    status: ssrStream.status ?? 200,
    statusText: ssrStream.statusText,
    metaConfig,
    stylesheets,
    resourceHints,
    useEarlyFlush,
    useCriticalCss,
    pathname: route.parsedPattern.pathname,
  };
}

async function applyPerfFeatures(plan: RenderPlan, envOptimizations: WorkerOptimizations) {
  const {
    ssrStream,
    finalHeaders,
    status,
    statusText,
    stylesheets,
    resourceHints,
    useEarlyFlush,
    useCriticalCss,
    pathname,
    metaConfig,
  } = plan;

  if (useEarlyFlush) {
    const staticShell = getStaticShell(metaConfig.lang);

    let criticalCss = "";
    if (useCriticalCss && envOptimizations.readCss) {
      criticalCss = await extractCriticalCss(pathname, stylesheets, {
        readCss: envOptimizations.readCss,
        cache: true,
      });
    }

    const optimizedStream = createEarlyFlushStream(staticShell, {
      criticalCss,
      preloadHints: resourceHints,
      contentStream: ssrStream,
      headTags: "",
      bodyTags: generateAsyncCssLoader(stylesheets),
    });

    return new Response(optimizedStream, {
      headers: finalHeaders,
      status,
      statusText,
    });
  }

  return new Response(ssrStream, {
    headers: finalHeaders,
    status,
    statusText,
  });
}

/** Cloudflare Worker fetch handler with auto-discovered routes and streaming SSR. */
async function worker(request: Request, env?: WorkerEnv) {
  const url = new URL(request.url);
  const devResponse = await handleDevEndpoints(request, env);
  if (devResponse) return devResponse;

  const headers = getDefaultHeaders();

  try {
    const result = await matchAndLoad(request, url);

    if (result.kind === "not-found") {
      const notFoundError = new Error(`Page not found: ${url.pathname}`);
      return renderErrorResponse(notFoundError, url, 404, headers);
    }

    if (result.kind === "api") {
      return result.response;
    }

    const { context } = result;
    const envOptimizations = env?.SF_OPTIMIZATIONS ?? {};

    const render = async () => {
      const plan = await renderStream(context, headers, envOptimizations);
      return applyPerfFeatures(plan, envOptimizations);
    };

    if (context.metaConfig.cacheConfig) {
      return withCache(
        request,
        context.params,
        context.metaConfig.cacheConfig,
        render,
        responseCache,
      );
    }

    return render();
  } catch (error) {
    const serverError = error instanceof Error ? error : new Error(String(error));
    console.error("[solarflare] Server error:", serverError);
    return renderErrorResponse(serverError, url, 500, headers);
  }
}

export default worker;
