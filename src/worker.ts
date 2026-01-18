import { type FunctionComponent } from "preact";
import * as server from "./server";
import type { Route, SolarflareStream } from "./server";
import { isConsoleRequest, processConsoleLogs, type LogLevel } from "./console-forward.ts";
import { isDevToolsRequest, handleDevToolsRequest } from "./devtools-json.ts";
import { isHmrRequest, handleHmrRequest } from "./server.hmr.ts";
import {
  generateStaticShell,
  createEarlyFlushStream,
  generateResourceHints,
  type StreamingShell,
} from "./early-flush.ts";
import { extractCriticalCss, generateAsyncCssLoader } from "./critical-css.ts";
import { collectEarlyHints, generateEarlyHintsHeader } from "./early-hints.ts";
import { ResponseCache, withCache } from "./route-cache.ts";
import { parseMetaConfig } from "./worker.config.ts";
import { getHeadContext, type HeadTag } from "./head.ts";
import { typedModules, getScriptPath, getStylesheets, getDevScripts } from "./manifest.runtime.ts";
import { findPairedModulePath } from "./paths.ts";

const responseCache = new ResponseCache(100);

const staticShellCache = new Map<string, StreamingShell>();

const PATCH_ENDPOINT = "/_sf/patch";

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

/** Server data loader function type. */
type ServerLoader = (
  request: Request,
  params: Record<string, string>,
) => Record<string, unknown> | Promise<Record<string, unknown>>;

const router = server.createRouter(typedModules);

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
  content: ReturnType<typeof server.renderComponent>;
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
  const errorContent = await server.renderErrorPage(error, url, typedModules, status);
  const stylesheets = getStylesheets("/");
  const devScripts = getDevScripts();

  const stream = await server.renderToStream(errorContent, {
    pathname: url.pathname,
    styles: stylesheets,
    devScripts,
  });

  return new Response(stream, {
    headers,
    status,
  });
}

type PatchMetaChunk = {
  type: "meta";
  outlet: string;
  head: HeadTag[];
  htmlAttrs: Record<string, string>;
  bodyAttrs: Record<string, string>;
};

function createPatchStream(
  htmlStream: ReadableStream<Uint8Array>,
  outlet: string,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const reader = htmlStream.getReader();

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        const first = await reader.read();

        const headCtx = getHeadContext();
        const meta: PatchMetaChunk = {
          type: "meta",
          outlet,
          head: headCtx.resolveTags(),
          htmlAttrs: headCtx.htmlAttrs,
          bodyAttrs: headCtx.bodyAttrs,
        };

        controller.enqueue(encoder.encode(`${JSON.stringify(meta)}\n`));

        if (!first.done) {
          const firstChunk = decoder.decode(first.value, { stream: true });
          if (firstChunk) {
            controller.enqueue(
              encoder.encode(`${JSON.stringify({ type: "html", chunk: firstChunk })}\n`),
            );
          }
        }

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value, { stream: true });
          if (chunk) {
            controller.enqueue(encoder.encode(`${JSON.stringify({ type: "html", chunk })}\n`));
          }
        }

        const tail = decoder.decode();
        if (tail) {
          controller.enqueue(encoder.encode(`${JSON.stringify({ type: "html", chunk: tail })}\n`));
        }

        controller.enqueue(encoder.encode(`${JSON.stringify({ type: "done" })}\n`));
        controller.close();
      } catch (error) {
        controller.error(error);
      }
    },
  });
}

function getPatchHeaders(
  baseHeaders: Record<string, string>,
  responseHeaders?: Record<string, string>,
) {
  return {
    ...baseHeaders,
    ...responseHeaders,
    "Cache-Control": "private, no-store",
    "Content-Encoding": "identity",
    "Content-Type": "application/x-ndjson; charset=utf-8",
    "X-Content-Type-Options": "nosniff",
  };
}

async function renderPatchResponse(
  context: SsrContext,
  headers: Record<string, string>,
  outlet: string,
) {
  const { url, route, params, content, shellData, deferredData } = context;
  const { scriptPath, stylesheets, devScripts } = context;

  const ssrStream = await server.renderToStream(content, {
    params,
    serverData: shellData,
    pathname: url.pathname,
    script: scriptPath,
    styles: stylesheets,
    devScripts,
    deferred: deferredData ? { tag: route.tag, promises: deferredData } : undefined,
    _headers: context.responseHeaders,
    _status: context.responseStatus,
    _statusText: context.responseStatusText,
  });

  const patchStream = createPatchStream(ssrStream, outlet);
  const finalHeaders = getPatchHeaders(headers, ssrStream.headers);

  return new Response(patchStream, {
    headers: finalHeaders,
    status: ssrStream.status ?? 200,
    statusText: ssrStream.statusText,
  });
}

async function matchAndLoad(request: Request, url: URL): Promise<MatchAndLoadResult> {
  const match = server.matchRoute(router, url);

  if (!match) {
    return { kind: "not-found" };
  }

  const { route, params } = match;

  if (route.type === "server") {
    const pairedClientPath = findPairedModulePath(route.path, typedModules);
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
    serverPath = findPairedModulePath(route.path, typedModules);
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

  let content = server.renderComponent(Component, route.tag, props);

  const layouts = server.findLayouts(route.path, typedModules);
  if (layouts.length > 0) {
    content = await server.wrapWithLayouts(content, layouts);
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

  const ssrStream = await server.renderToStream(content, {
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

async function handlePatchRequest(request: Request) {
  const url = new URL(request.url);
  if (!(request.method === "POST" && url.pathname === PATCH_ENDPOINT)) return;

  const headers = getDefaultHeaders();
  try {
    const body = (await request.json()) as { url?: string; outlet?: string };
    if (!body?.url) {
      return new Response("Missing url", { status: 400, headers });
    }

    const targetUrl = new URL(body.url, url.origin);
    if (targetUrl.origin !== url.origin) {
      return new Response("Invalid url", { status: 400, headers });
    }

    const targetRequest = new Request(targetUrl, {
      method: "GET",
      headers: request.headers,
    });

    const result = await matchAndLoad(targetRequest, targetUrl);

    if (result.kind === "not-found") {
      return new Response("Not Found", { status: 404, headers });
    }

    if (result.kind === "api") {
      return new Response("Invalid patch target", { status: 400, headers });
    }

    const outlet = body.outlet ?? "#app";
    return renderPatchResponse(result.context, headers, outlet);
  } catch (error) {
    const serverError = error instanceof Error ? error : new Error(String(error));
    console.error("[solarflare] Patch error:", serverError);
    return new Response("Patch error", { status: 500, headers });
  }
}

/** Cloudflare Worker fetch handler with auto-discovered routes and streaming SSR. */
async function worker(request: Request, env?: WorkerEnv) {
  const url = new URL(request.url);
  const devResponse = await handleDevEndpoints(request, env);
  if (devResponse) return devResponse;

  const patchResponse = await handlePatchRequest(request);
  if (patchResponse) return patchResponse;

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
