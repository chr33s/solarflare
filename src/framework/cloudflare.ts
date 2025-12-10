import { plugin } from "bun";
import { getPlatformProxy, type GetPlatformProxyOptions } from "wrangler";

/**
 * Extends globalThis to include the platform proxy
 */
declare global {
  var __bun_plugin_cloudflare_platform_proxy: Awaited<
    ReturnType<typeof getPlatformProxy>
  > | undefined;
}

/**
 * Options for the Bun Cloudflare plugin
 */
export interface BunPluginCloudflareOptions {
  /**
   * Options to pass to Wrangler's getPlatformProxy
   */
  getPlatformProxyOptions?: GetPlatformProxyOptions;
  /**
   * Whether to expose Cloudflare globals like `caches` and `WebSocketPair` to globalThis
   */
  exposeGlobals?: boolean;
}

/**
 * Register the Cloudflare Workers plugin for Bun.
 * 
 * This plugin enables imports from `cloudflare:workers` during local development,
 * providing access to `env` and `waitUntil` through Wrangler's platform proxy.
 * 
 * @param options - Configuration options for the plugin
 * @returns A dispose function to clean up the platform proxy
 * 
 * @example
 * ```typescript
 * import { registerCloudflare } from "bun-plugin-cloudflare";
 * 
 * const dispose = await registerCloudflare({
 *   exposeGlobals: true,
 *   getPlatformProxyOptions: {
 *     configPath: "./wrangler.toml",
 *   },
 * });
 * 
 * // Now you can import from cloudflare:workers
 * import { env, waitUntil } from "cloudflare:workers";
 * 
 * // When done, clean up
 * await dispose();
 * ```
 */
export async function registerCloudflare(
  options?: BunPluginCloudflareOptions
): Promise<() => Promise<void>> {
  const { getPlatformProxyOptions, exposeGlobals } = options ?? {};

  // Initialize the Wrangler platform proxy
  const platformProxy = await getPlatformProxy(getPlatformProxyOptions);

  // Store the platform proxy on globalThis for access in the virtual module
  globalThis.__bun_plugin_cloudflare_platform_proxy = platformProxy;

  // Optionally expose globals
  if (exposeGlobals) {
    // Add caches if not already present
    if (!("caches" in globalThis)) {
      Object.assign(globalThis, {
        caches: platformProxy.caches,
      });
    }

    // Try to import and expose WebSocketPair from miniflare
    try {
      const miniflare = await import("miniflare");
      if (typeof miniflare.WebSocketPair === "function") {
        Object.assign(globalThis, { WebSocketPair: miniflare.WebSocketPair });
      }
    } catch {
      // miniflare is optional, silently ignore if not available
    }
  }

  // Register the Bun plugin
  plugin({
    name: "bun-plugin-cloudflare",
    setup(build) {
      // Intercept imports of "cloudflare:workers"
      build.onResolve({ filter: /^cloudflare:workers$/ }, (args) => ({
        path: args.path,
        namespace: "cloudflare-workers",
      }));

      // Provide the synthetic module for cloudflare:workers
      build.onLoad({ filter: /.*/, namespace: "cloudflare-workers" }, () => {
        // Validate that the platform proxy is initialized
        if (!globalThis.__bun_plugin_cloudflare_platform_proxy) {
          throw new Error(
            "Platform proxy not initialized. Ensure registerCloudflare() was called before importing from cloudflare:workers"
          );
        }

        return {
          contents: `
const proxy = globalThis.__bun_plugin_cloudflare_platform_proxy;
if (!proxy) {
  throw new Error("Platform proxy not initialized");
}
export const env = proxy.env;
const __ctx = proxy.ctx;
export const waitUntil = __ctx.waitUntil.bind(__ctx);
`,
          loader: "js",
        };
      });
    },
  });

  // Return a dispose function to clean up the platform proxy
  return async () => {
    await platformProxy.dispose();
  };
}

export default registerCloudflare;
