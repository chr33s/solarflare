import { type FunctionComponent } from "preact";
import * as server from "./server";
import type { Route, SolarflareStream, HeadSnapshot } from "./server";
import { isConsoleRequest, processConsoleLogs, type LogLevel } from "./console-forward.ts";
import { isDevToolsRequest, handleDevToolsRequest } from "./devtools-json.ts";
import { isHmrRequest, handleHmrRequest } from "./server.hmr.ts";
import { generateResourceHints } from "./early-flush.ts";
import { collectEarlyHints, generateEarlyHintsHeader } from "./early-hints.ts";
import { ResponseCache, withDeferredCache } from "./route-cache.ts";
import {
  parseMetaConfigFromHead,
  buildSpeculationRulesFromConfig,
  type WorkerMetaConfig,
} from "./worker.config.ts";
import { renderSpeculationRulesTag } from "./speculation-rules.ts";
import { type HeadTag } from "./head.ts";
import {
  typedModules,
  getScriptPath,
  getStylesheets,
  getDevScripts,
  isShadowTag,
  isDev,
} from "./manifest.runtime.ts";
import { encode } from "turbo-stream";

const responseCache = new ResponseCache(100);

const PATCH_HEADER = "x-solarflare-patch";

/** Worker optimization options. */
export interface WorkerOptimizations {
  earlyFlush?: boolean;
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

/** Cloudflare ExecutionContext subset used for background cache writes. */
interface WorkerExecutionContext {
  waitUntil?(promise: Promise<unknown>): void;
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
}

interface RenderPlan {
  ssrStream: SolarflareStream;
  finalHeaders: Record<string, string>;
  status: number;
  statusText?: string;
  metaConfig: WorkerMetaConfig;
  headSnapshot?: HeadSnapshot;
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
    "X-Content-Type-Options": "nosniff",
  };
}

async function handleDevEndpoints(request: Request, env?: WorkerEnv) {
  // Dev-only endpoints (/_hmr SSE, /_console log sink, devtools JSON) must never
  // be reachable in production — they leak internals and accept arbitrary input.
  if (!isDev()) return null;

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

/** Patch stream payload: meta plus an async iterable of HTML chunks. */
interface PatchPayload {
  meta: {
    outlet: string;
    head: HeadTag[];
    htmlAttrs: Record<string, string>;
    bodyAttrs: Record<string, string>;
  };
  html: AsyncIterable<string>;
}

/** @yields HTML string chunks decoded from the byte stream. */
async function* htmlChunkGenerator(htmlStream: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const decoder = new TextDecoder();
  const reader = htmlStream.getReader();

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      if (chunk) yield chunk;
    }
    const tail = decoder.decode();
    if (tail) yield tail;
  } finally {
    reader.releaseLock();
  }
}

/** Creates a turbo-stream encoded patch response from a request-scoped head snapshot. */
function createPatchStream(
  htmlStream: ReadableStream<Uint8Array>,
  outlet: string,
  headSnapshot: HeadSnapshot,
): ReadableStream<Uint8Array> {
  const payload: PatchPayload = {
    meta: {
      outlet,
      head: headSnapshot.tags,
      htmlAttrs: headSnapshot.htmlAttrs,
      bodyAttrs: headSnapshot.bodyAttrs,
    },
    html: htmlChunkGenerator(htmlStream),
  };

  // encode() returns ReadableStream<string>, convert to Uint8Array
  const turboStream = encode(payload);
  return turboStream.pipeThrough(new TextEncoderStream());
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
    "Content-Type": "application/x-turbo-stream; charset=utf-8",
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

  const headSnapshot = ssrStream.headSnapshot ?? {
    html: "",
    tags: [],
    htmlAttrs: {},
    bodyAttrs: {},
  };
  const patchStream = createPatchStream(ssrStream, outlet, headSnapshot);
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

  // Server-only route with no client pair → API handler
  if (route.type === "server" && !route.clientPath) {
    const mod = await route.loader();
    const handler = mod.default as (request: Request) => Response | Promise<Response>;
    return { kind: "api", response: await handler(request) };
  }

  const clientPath = route.clientPath ?? route.path;
  const serverPath = route.serverPath ?? null;

  let shellData: Record<string, unknown> = {};
  let deferredData: Record<string, Promise<unknown>> | null = null;
  let responseHeaders: Record<string, string> | undefined;
  let responseStatus: number | undefined;
  let responseStatusText: string | undefined;

  // The client component module doesn't depend on the loader's data, so start
  // importing it now and let it evaluate concurrently with the loader I/O.
  const clientModPromise = typedModules.client[clientPath]();

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
        // Non-primitive values can't be serialized as HTML attributes on the
        // custom element. Emit them as instantly-resolved deferred data islands
        // so the client-side hydration mechanism picks them up.
        const t = typeof value;
        if (value != null && t !== "string" && t !== "number" && t !== "boolean") {
          deferredPromises[key] = Promise.resolve(value);
        }
      }
    }

    shellData = immediateData;
    deferredData = Object.keys(deferredPromises).length > 0 ? deferredPromises : null;
  }

  const props: Record<string, unknown> = { ...params, ...shellData };

  const clientMod = await clientModPromise;
  const Component = clientMod.default as FunctionComponent<any>;

  let content = server.renderComponent(Component, route.tag, props, {
    shadow: isShadowTag(route.tag),
  });

  const layouts = server.findLayouts(route.path, typedModules);
  if (layouts.length > 0) {
    content = await server.wrapWithLayouts(content, layouts);
  }

  const scriptPath = getScriptPath(route.tag);
  const stylesheets = getStylesheets(route.parsedPattern.pathname);
  const devScripts = getDevScripts();

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
    },
  };
}

async function renderStream(
  context: SsrContext,
  headers: Record<string, string>,
  envOptimizations: WorkerOptimizations,
) {
  const { url, route, params, content, shellData, deferredData } = context;
  const { scriptPath, stylesheets, devScripts } = context;

  const resourceHints = generateResourceHints({
    scripts: scriptPath ? [scriptPath] : [],
    stylesheets,
  });

  const ssrStream = await server.renderToStream(content, {
    params,
    serverData: shellData,
    pathname: url.pathname,
    script: scriptPath,
    styles: stylesheets,
    devScripts,
    // Resolve early-flush after the sync shell populates this request's head —
    // no separate throwaway render for meta.
    resolvePreloadHints: (snapshot) => {
      const meta = parseMetaConfigFromHead(snapshot);
      const useEarlyFlush = envOptimizations.earlyFlush ?? meta.earlyFlush;
      return useEarlyFlush ? resourceHints : undefined;
    },
    deferred: deferredData ? { tag: route.tag, promises: deferredData } : undefined,
    _headers: context.responseHeaders,
    _status: context.responseStatus,
    _statusText: context.responseStatusText,
  });

  const headSnapshot = ssrStream.headSnapshot ?? {
    html: "",
    tags: [],
    htmlAttrs: {},
    bodyAttrs: {},
  };
  const metaConfig = parseMetaConfigFromHead(headSnapshot);

  const earlyHints = collectEarlyHints({
    scriptPath,
    stylesheets,
    preconnectOrigins: metaConfig.preconnectOrigins,
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

  // Speculation rules from meta: append as a trailer script (browsers accept
  // speculationrules outside <head>). Lang is applied via htmlAttrs in the SSR
  // document / patch meta from the head snapshot.
  const speculationRules = buildSpeculationRulesFromConfig(metaConfig);
  let body: ReadableStream<Uint8Array> = ssrStream;
  if (speculationRules) {
    const tag = renderSpeculationRulesTag(speculationRules);
    const encoder = new TextEncoder();
    body = ssrStream.pipeThrough(
      new TransformStream<Uint8Array, Uint8Array>({
        flush(controller) {
          controller.enqueue(encoder.encode(tag));
        },
        transform(chunk, controller) {
          controller.enqueue(chunk);
        },
      }),
    );
  }

  return {
    ssrStream: body as SolarflareStream,
    finalHeaders,
    status: ssrStream.status ?? 200,
    statusText: ssrStream.statusText,
    metaConfig,
    headSnapshot,
  };
}

function applyPerfFeatures(plan: RenderPlan) {
  const { ssrStream, finalHeaders, status, statusText } = plan;

  // Early-flush resource hints are injected directly into the streamed document
  // head (see renderStream), so there is no separate shell to wrap here — doing
  // so previously nested a second <html> document and dropped stylesheets.
  return new Response(ssrStream, {
    headers: finalHeaders,
    status,
    statusText,
  });
}

async function handlePatchRequest(request: Request) {
  const outlet = request.headers.get(PATCH_HEADER);
  if (!outlet) return;

  const url = new URL(request.url);
  const headers = getDefaultHeaders();
  try {
    const result = await matchAndLoad(request, url);

    if (result.kind === "not-found") {
      return new Response("Not Found", { status: 404, headers });
    }

    if (result.kind === "api") {
      return new Response("Invalid patch target", { status: 400, headers });
    }

    return renderPatchResponse(result.context, headers, outlet);
  } catch (error) {
    const serverError = error instanceof Error ? error : new Error(String(error));
    console.error("[solarflare] Patch error:", serverError);
    return new Response("Patch error", { status: 500, headers });
  }
}

/** Cloudflare Worker fetch handler with auto-discovered routes and streaming SSR. */
async function worker(request: Request, env?: WorkerEnv, ctx?: WorkerExecutionContext) {
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
    const waitUntil = ctx?.waitUntil?.bind(ctx);

    return withDeferredCache(
      request,
      context.params,
      async () => {
        const plan = await renderStream(context, headers, envOptimizations);
        return {
          response: applyPerfFeatures(plan),
          cacheConfig: plan.metaConfig.cacheConfig,
        };
      },
      responseCache,
      { waitUntil },
    );
  } catch (error) {
    const serverError = error instanceof Error ? error : new Error(String(error));
    console.error("[solarflare] Server error:", serverError);
    return renderErrorResponse(serverError, url, 500, headers);
  }
}

export default worker;
