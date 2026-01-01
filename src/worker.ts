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
} from "./server";
import { isConsoleRequest, processConsoleLogs, type LogLevel } from "./console-forward.ts";
import { isDevToolsRequest, handleDevToolsRequest } from "./devtools-json.ts";
import { isHmrRequest, handleHmrRequest } from "./hmr-server.ts";
export { broadcastHmrUpdate, type HmrEventType } from "./hmr-server.ts";
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
// @ts-ignore - Generated at build time, aliased by bundler
import modules from ".modules.generated";
// @ts-ignore - Generated at build time, aliased by bundler
import chunkManifest from ".chunks.generated.json";

const typedModules = modules as ModuleMap;

/** Chunk manifest mapping routes to assets. */
interface ChunkManifest {
  chunks: Record<string, string>;
  tags: Record<string, string>;
  styles: Record<string, string[]>;
  devScripts?: string[];
}

const manifest = chunkManifest as ChunkManifest;

const responseCache = new ResponseCache(100);

const staticShellCache = new Map<string, StreamingShell>();

/** Gets or creates a static shell. */
function getStaticShell(lang: string): StreamingShell {
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
function getScriptPath(tag: string): string | undefined {
  return manifest.tags[tag];
}

/** Gets stylesheets for a route pattern from the chunk manifest. */
function getStylesheets(pattern: string): string[] {
  return manifest.styles[pattern] ?? [];
}

/** Gets dev mode scripts from the chunk manifest. */
function getDevScripts(): string[] | undefined {
  return manifest.devScripts;
}

/** Server data loader function type. */
type ServerLoader = (
  request: Request,
  params: Record<string, string>,
) => Record<string, unknown> | Promise<Record<string, unknown>>;

const router = createRouter(typedModules);

/** Finds paired module (server for client, or client for server). */
function findPairedModule(path: string): string | null {
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

/** Cloudflare Worker fetch handler with auto-discovered routes and streaming SSR. */
async function worker(request: Request, env?: WorkerEnv): Promise<Response> {
  const url = new URL(request.url);

  // Handle HMR WebSocket upgrade requests in dev mode
  if (isHmrRequest(request)) {
    return handleHmrRequest();
  }

  // Handle console forward requests in dev mode
  if (isConsoleRequest(request)) {
    const logLevel = env?.WRANGLER_LOG ?? "log";
    return processConsoleLogs(request, logLevel);
  }

  // Handle Chrome DevTools project settings in dev mode
  if (isDevToolsRequest(request)) {
    return handleDevToolsRequest();
  }

  const headers = {
    "Content-Type": "text/html; charset=utf-8",
    "Content-Encoding": "identity",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Transfer-Encoding": "chunked",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "SAMEORIGIN",
  };

  try {
    // Match route using URLPattern - prefers client routes for SSR
    const match = matchRoute(router, url);

    if (!match) {
      // Render 404 error page wrapped in layouts
      const notFoundError = new Error(`Page not found: ${url.pathname}`);
      const errorContent = await renderErrorPage(notFoundError, url, typedModules, 404);

      // Get stylesheets for error page (use root layout styles)
      const stylesheets = getStylesheets("/");
      const devScripts = getDevScripts();

      const stream = await renderToStream(errorContent, {
        pathname: url.pathname,
        styles: stylesheets,
        devScripts,
      });

      return new Response(stream, {
        headers,
        status: 404,
      });
    }

    const { route, params } = match;

    // If this is a server-only route (no paired client), return Response directly
    if (route.type === "server") {
      const pairedClientPath = findPairedModule(route.path);
      if (!pairedClientPath) {
        // No paired client component - this is an API route
        const mod = await route.loader();
        const handler = mod.default as (request: Request) => Response | Promise<Response>;
        return handler(request);
      }
    }

    // Determine the server and client paths
    let serverPath: string | null = null;
    let clientPath: string;

    if (route.type === "server") {
      serverPath = route.path;
      clientPath = route.path.replace(".server.", ".client.");
    } else {
      clientPath = route.path;
      serverPath = findPairedModule(route.path);
    }

    // Load props from server loader if available
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

      // Extract response metadata from underscore-prefixed properties
      responseHeaders = result._headers;
      responseStatus = result._status;
      responseStatusText = result._statusText;

      const immediateData: Record<string, unknown> = {};
      const deferredPromises: Record<string, Promise<unknown>> = {};

      // Filter out underscore-prefixed properties (response metadata)
      const dataEntries = Object.entries(result).filter(([key]) => !key.startsWith("_"));

      for (const [key, value] of dataEntries) {
        if (value instanceof Promise) {
          deferredPromises[key] = value;
        } else {
          immediateData[key] = value;
        }
      }

      shellData = immediateData;

      const deferredKeys = Object.keys(deferredPromises);
      deferredData = deferredKeys.length > 0 ? deferredPromises : null;
    }

    // Combine params and shell data as initial props
    const props: Record<string, unknown> = { ...params, ...shellData };

    // Load the client component
    const clientMod = await typedModules.client[clientPath]();
    const Component = clientMod.default as FunctionComponent<any>;

    // Render component wrapped in custom element tag
    let content = renderComponent(Component, route.tag, props);

    // Find and apply layouts
    const layouts = findLayouts(route.path, typedModules);
    if (layouts.length > 0) {
      content = await wrapWithLayouts(content, layouts);
    }

    // Get the script and styles for this route's chunk
    const scriptPath = getScriptPath(route.tag);
    const stylesheets = getStylesheets(route.parsedPattern.pathname);
    const devScripts = getDevScripts();

    // Get rendered head HTML to extract meta config
    // useHead calls have already populated the context during component rendering
    const headCtx = getHeadContext();
    const headHtml = headCtx.renderToString();

    // Parse worker configuration from meta tags
    // Supports: sf:preconnect, sf:cache-max-age, sf:cache-swr, sf:early-flush, sf:critical-css
    const metaConfig = parseMetaConfig(headHtml);

    // Collect early hints using meta-configured preconnect origins
    const earlyHints = collectEarlyHints({
      scriptPath,
      stylesheets,
      preconnectOrigins: metaConfig.preconnectOrigins,
    });

    // Generate resource hints HTML for <head>
    const resourceHints = generateResourceHints({
      scripts: scriptPath ? [scriptPath] : [],
      stylesheets,
    });

    // Get optimization settings from environment (can override meta)
    const envOptimizations = env?.SF_OPTIMIZATIONS ?? {};
    const useEarlyFlush = envOptimizations.earlyFlush ?? metaConfig.earlyFlush;
    const useCriticalCss = envOptimizations.criticalCss ?? metaConfig.criticalCss;

    // Render function (potentially cached)
    const render = async (): Promise<Response> => {
      // Render to streaming response with signal context
      const ssrStream = await renderToStream(content, {
        params,
        serverData: shellData,
        pathname: url.pathname,
        script: scriptPath,
        styles: useEarlyFlush ? [] : stylesheets, // Styles loaded async with early flush
        devScripts,
        deferred: deferredData ? { tag: route.tag, promises: deferredData } : undefined,
        _headers: responseHeaders,
        _status: responseStatus,
        _statusText: responseStatusText,
      });

      // Merge custom headers with defaults, custom headers take priority
      const finalHeaders: Record<string, string> = { ...headers };
      if (ssrStream.headers) {
        for (const [key, value] of Object.entries(ssrStream.headers)) {
          finalHeaders[key] = value;
        }
      }

      // Add Link header for early hints
      if (earlyHints.length > 0) {
        finalHeaders["Link"] = generateEarlyHintsHeader(earlyHints);
      }

      // Use early flush stream for faster TTFB if enabled
      if (useEarlyFlush) {
        const staticShell = getStaticShell(metaConfig.lang);

        // Extract critical CSS if enabled and reader provided
        let criticalCss = "";
        if (useCriticalCss && envOptimizations.readCss) {
          criticalCss = await extractCriticalCss(route.parsedPattern.pathname, stylesheets, {
            readCss: envOptimizations.readCss,
            cache: true,
          });
        }

        const optimizedStream = createEarlyFlushStream(staticShell, {
          criticalCss,
          preloadHints: resourceHints,
          contentStream: ssrStream,
          headTags: "", // Head tags handled by existing system
          bodyTags: generateAsyncCssLoader(stylesheets),
        });

        return new Response(optimizedStream, {
          headers: finalHeaders,
          status: ssrStream.status ?? 200,
          statusText: ssrStream.statusText,
        });
      }

      return new Response(ssrStream, {
        headers: finalHeaders,
        status: ssrStream.status ?? 200,
        statusText: ssrStream.statusText,
      });
    };

    // Use cache if meta-configured for this route
    if (metaConfig.cacheConfig) {
      return withCache(request, params, metaConfig.cacheConfig, render, responseCache);
    }

    return render();
  } catch (error) {
    // Render 500 error page wrapped in layouts
    const serverError = error instanceof Error ? error : new Error(String(error));
    console.error("[solarflare] Server error:", serverError);

    const errorContent = await renderErrorPage(serverError, url, typedModules, 500);

    // Get stylesheets for error page (use root layout styles)
    const stylesheets = getStylesheets("/");
    const devScripts = getDevScripts();

    const stream = await renderToStream(errorContent, {
      pathname: url.pathname,
      styles: stylesheets,
      devScripts,
    });

    return new Response(stream, {
      headers,
      status: 500,
    });
  }
}

export default worker;
