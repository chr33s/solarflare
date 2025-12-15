/**
 * Solarflare Worker
 * Cloudflare Worker fetch handler with streaming SSR
 */
import { type FunctionComponent } from "preact";
import {
  createRouter,
  matchRoute,
  findLayouts,
  wrapWithLayouts,
  renderComponent,
  renderToStream,
  type ModuleMap,
} from "./server";
import { isConsoleRequest, processConsoleLogs, type LogLevel } from "./console-forward";
// @ts-ignore - Generated at build time
import modules from "../../dist/.modules.generated";
// @ts-ignore - Generated at build time
import chunkManifest from "../../dist/.chunks.generated.json";

const typedModules = modules as ModuleMap;

/**
 * Chunk manifest type
 */
interface ChunkManifest {
  chunks: Record<string, string>; // pattern -> chunk filename
  tags: Record<string, string>; // tag -> chunk filename
  styles: Record<string, string[]>; // pattern -> CSS filenames
  devScripts?: string[]; // dev mode scripts (e.g., console-forward.js)
}

const manifest = chunkManifest as ChunkManifest;

/**
 * Get the script path for a route from the chunk manifest
 */
function getScriptPath(tag: string): string | undefined {
  return manifest.tags[tag];
}

/**
 * Get stylesheets for a route pattern from the chunk manifest
 */
function getStylesheets(pattern: string): string[] {
  return manifest.styles[pattern] ?? [];
}

/**
 * Get dev mode scripts from the chunk manifest
 */
function getDevScripts(): string[] | undefined {
  return manifest.devScripts;
}

/**
 * Server data loader function type
 * Returns props to pass to the paired client component
 */
type ServerLoader = (
  request: Request,
  params: Record<string, string>,
) => Record<string, unknown> | Promise<Record<string, unknown>>;

// Create router with sorted routes array
const router = createRouter(typedModules);

/**
 * Find paired module (server for client, or client for server)
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

/**
 * Worker environment interface
 */
interface WorkerEnv {
  /** Console forward log level (matches wrangler --log-level) */
  WRANGLER_LOG?: LogLevel;
  [key: string]: unknown;
}

/**
 * Cloudflare Worker fetch handler
 * Routes are auto-discovered at build time
 * Uses streaming SSR for improved TTFB
 */
async function worker(request: Request, env?: WorkerEnv): Promise<Response> {
  const url = new URL(request.url);

  // Handle console forward requests in dev mode
  if (isConsoleRequest(request)) {
    const logLevel = env?.WRANGLER_LOG ?? "log";
    return processConsoleLogs(request, logLevel);
  }

  // Match route using URLPattern - prefers client routes for SSR
  const match = matchRoute(router, url);

  if (!match) {
    return new Response("Not Found", { status: 404 });
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

    // Auto-detect Promise values in the result
    // Immediate values go to shellData, Promise values become deferred
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

  return new Response(stream, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Transfer-Encoding": "chunked",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export default worker;
