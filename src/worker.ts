/** Cloudflare Worker fetch handler with streaming SSR. */
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

/**
 * Gets the script path for a route from the chunk manifest.
 * @param tag - Custom element tag name
 * @returns Script path or undefined if not found
 */
function getScriptPath(tag: string): string | undefined {
  return manifest.tags[tag];
}

/**
 * Gets stylesheets for a route pattern from the chunk manifest.
 * @param pattern - Route pattern
 * @returns Array of stylesheet paths
 */
function getStylesheets(pattern: string): string[] {
  return manifest.styles[pattern] ?? [];
}

/**
 * Gets dev mode scripts from the chunk manifest.
 * @returns Array of dev script paths or undefined
 */
function getDevScripts(): string[] | undefined {
  return manifest.devScripts;
}

/** Server data loader function type. */
type ServerLoader = (
  request: Request,
  params: Record<string, string>,
) => Record<string, unknown> | Promise<Record<string, unknown>>;

const router = createRouter(typedModules);

/**
 * Finds paired module (server for client, or client for server).
 * @param path - Module path to find pair for
 * @returns Paired module path or null if not found
 */
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
  /** Log level for console forwarding */
  WRANGLER_LOG?: LogLevel;
  [key: string]: unknown;
}

/**
 * Cloudflare Worker fetch handler with auto-discovered routes and streaming SSR.
 * @param request - Incoming HTTP request
 * @param env - Worker environment bindings
 * @returns HTTP Response with streamed HTML or error page
 */
async function worker(request: Request, env?: WorkerEnv): Promise<Response> {
  const url = new URL(request.url);

  // Handle console forward requests in dev mode
  if (isConsoleRequest(request)) {
    const logLevel = env?.WRANGLER_LOG ?? "log";
    return processConsoleLogs(request, logLevel);
  }

  const headers = {
    "Content-Type": "text/html; charset=utf-8",
    "Content-Encoding": "identity", // Workaround: https://github.com/cloudflare/workers-sdk/issues/8004
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
    let deferredPromise: Promise<Record<string, unknown>> | null = null;

    if (serverPath && serverPath in typedModules.server) {
      const serverMod = await typedModules.server[serverPath]();
      const loader = serverMod.default as ServerLoader;
      const result = await loader(request, params);

      const immediateData: Record<string, unknown> = {};
      const deferredData: Record<string, Promise<unknown>> = {};

      for (const [key, value] of Object.entries(result)) {
        if (value instanceof Promise) {
          deferredData[key] = value;
        } else {
          immediateData[key] = value;
        }
      }

      shellData = immediateData;

      // If there are deferred promises, combine them into a single promise
      const deferredKeys = Object.keys(deferredData);
      if (deferredKeys.length > 0) {
        deferredPromise = (async () => {
          const resolved: Record<string, unknown> = {};
          const entries = await Promise.all(
            deferredKeys.map(async (key) => [key, await deferredData[key]]),
          );
          for (const [key, value] of entries) {
            resolved[key as string] = value;
          }
          return resolved;
        })();
      }
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

    // Render to streaming response with signal context
    const stream = await renderToStream(content, {
      params,
      serverData: shellData,
      pathname: url.pathname,
      script: scriptPath,
      styles: stylesheets,
      devScripts,
      deferred: deferredPromise ? { tag: route.tag, promise: deferredPromise } : undefined,
    });

    return new Response(stream, { headers });
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
