/** Cache configuration per route. */
export interface RouteCacheConfig {
  maxAge: number;
  staleWhileRevalidate?: number;
  keyGenerator?: (request: Request, params: Record<string, string>) => string;
  /** When true, cache responses even if the request has Authorization/Cookie. */
  cacheAuthenticated?: boolean;
  /**
   * Response Cache-Control visibility. Defaults to public for successful
   * anonymous responses. Set false for always-private routes.
   */
  public?: boolean;
  vary?: string[];
}

/** Default cache configs by route type. */
export const DEFAULT_CACHE_CONFIGS: Record<string, RouteCacheConfig> = {
  static: {
    maxAge: 3600,
    staleWhileRevalidate: 86400,
    public: true,
  },
  dynamic: {
    maxAge: 60,
    staleWhileRevalidate: 300,
    public: true,
  },
  private: {
    maxAge: 0,
    public: false,
    cacheAuthenticated: false,
  },
};

/** Generates cache control header value. */
export function generateCacheControl(config: RouteCacheConfig, isPrivate: boolean) {
  const directives: string[] = [];

  // Authed requests stay private unless explicitly allowed to share.
  // Anonymous traffic is public unless config.public === false.
  if (isPrivate || config.public === false) {
    directives.push("private");
  } else {
    directives.push("public");
  }

  if (config.maxAge > 0) {
    directives.push(`max-age=${config.maxAge}`);
  } else {
    directives.push("no-cache");
  }

  if (config.staleWhileRevalidate) {
    directives.push(`stale-while-revalidate=${config.staleWhileRevalidate}`);
  }

  return directives.join(", ");
}

/** Response cache with Cloudflare Cache API (or in-memory fallback). */
export class ResponseCache {
  #cache?: Cache;
  #memory = new Map<string, { response: Response; expires: number }>();
  #maxSize: number;

  constructor(maxSize = 100) {
    this.#maxSize = maxSize;
    if (typeof caches !== "undefined") {
      this.#cache = (caches as any).default;
    }
  }

  async get(key: string) {
    if (this.#cache) {
      const res = await this.#cache.match(this.#toRequest(key));
      return res ?? null;
    }
    const entry = this.#memory.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expires) {
      this.#memory.delete(key);
      return null;
    }
    return entry.response.clone();
  }

  async set(key: string, response: Response, maxAge: number) {
    if (this.#cache) {
      const headers = new Headers(response.headers);
      headers.set("Cache-Control", `public, max-age=${maxAge}`);
      await this.#cache.put(
        this.#toRequest(key),
        new Response(response.clone().body, {
          status: response.status,
          statusText: response.statusText,
          headers,
        }),
      );
      return;
    }
    while (this.#memory.size >= this.#maxSize) {
      const firstKey = this.#memory.keys().next().value;
      if (firstKey) this.#memory.delete(firstKey);
    }
    this.#memory.set(key, {
      response: response.clone(),
      expires: Date.now() + maxAge * 1000,
    });
  }

  #toRequest(key: string) {
    return new Request(`https://cache.local/${encodeURIComponent(key)}`);
  }

  static generateKey(request: Request, params: Record<string, string>) {
    const url = new URL(request.url);
    // Include host and the (sorted) query string so distinct URLs don't collide
    // in the shared cache — omitting them serves one request's response for
    // another (cross-user data leak / cache poisoning) on query-scoped or
    // multi-domain routes.
    const sortedQuery = [...url.searchParams.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join("&");
    const sortedParams = Object.entries(params)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join("&");
    return `${url.host}${url.pathname}?${sortedQuery}|${sortedParams}`;
  }
}

export interface WithCacheOptions {
  /**
   * Schedule background work (Cloudflare `ExecutionContext.waitUntil`).
   * When provided, Cache API `put` does not block the response body — preserving
   * streaming TTFB. Without it, Cache API puts are fire-and-forget; in-memory
   * fallback still awaits (sync-cheap) for deterministic tests.
   */
  waitUntil?: (promise: Promise<unknown>) => void;
}

async function scheduleCachePut(
  cache: ResponseCache,
  key: string,
  response: Response,
  maxAge: number,
  waitUntil?: (promise: Promise<unknown>) => void,
) {
  const putPromise = cache.set(key, response, maxAge).catch((err) => {
    console.error("[solarflare] Cache put failed:", err);
  });

  if (waitUntil) {
    waitUntil(putPromise);
    return;
  }

  // Cache API put buffers the cloned stream — never await on the request path.
  if (typeof caches !== "undefined" && (caches as any).default) {
    void putPromise;
    return;
  }

  await putPromise;
}

/** Cache-aware request handler wrapper */
export async function withCache(
  request: Request,
  params: Record<string, string>,
  config: RouteCacheConfig,
  handler: () => Promise<Response>,
  cache: ResponseCache,
  options?: WithCacheOptions,
) {
  const hasAuth = request.headers.has("Authorization") || request.headers.has("Cookie");
  if (hasAuth && !config.cacheAuthenticated) {
    return handler();
  }

  const key = config.keyGenerator
    ? config.keyGenerator(request, params)
    : ResponseCache.generateKey(request, params);

  const cached = await cache.get(key);
  if (cached) {
    const headers = new Headers(cached.headers);
    headers.set("X-Cache", "HIT");
    return new Response(cached.body, {
      status: cached.status,
      statusText: cached.statusText,
      headers,
    });
  }

  const response = await handler();

  // Only cache successful responses. Cache API put consumes the cloned body to
  // completion — never await it on the request path (use waitUntil / fire-and-forget).
  // In-memory fallback is cheap and awaited so unit tests stay deterministic.
  if (response.ok && config.maxAge > 0) {
    await scheduleCachePut(cache, key, response, config.maxAge, options?.waitUntil);
  }

  // Add cache headers
  const headers = new Headers(response.headers);
  headers.set("Cache-Control", generateCacheControl(config, hasAuth));
  headers.set("X-Cache", "MISS");

  if (config.vary?.length) {
    headers.set("Vary", config.vary.join(", "));
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/**
 * Speculative cache lookup that does not need meta config up front.
 * On miss, runs handler which returns both the Response and optional cache config
 * derived from the rendered head — enabling a single SSR pass.
 */
export async function withDeferredCache(
  request: Request,
  params: Record<string, string>,
  handler: () => Promise<{ response: Response; cacheConfig?: RouteCacheConfig }>,
  cache: ResponseCache,
  options?: WithCacheOptions,
) {
  const hasAuth = request.headers.has("Authorization") || request.headers.has("Cookie");
  const key = ResponseCache.generateKey(request, params);

  // Authed requests skip shared cache unless the route opts in after render.
  if (!hasAuth) {
    const cached = await cache.get(key);
    if (cached) {
      const headers = new Headers(cached.headers);
      headers.set("X-Cache", "HIT");
      return new Response(cached.body, {
        status: cached.status,
        statusText: cached.statusText,
        headers,
      });
    }
  }

  const { response, cacheConfig } = await handler();

  if (!cacheConfig) {
    const headers = new Headers(response.headers);
    headers.set("X-Cache", "MISS");
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  }

  if (hasAuth && !cacheConfig.cacheAuthenticated) {
    const headers = new Headers(response.headers);
    headers.set("Cache-Control", generateCacheControl(cacheConfig, true));
    headers.set("X-Cache", "MISS");
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  }

  if (response.ok && cacheConfig.maxAge > 0) {
    await scheduleCachePut(cache, key, response, cacheConfig.maxAge, options?.waitUntil);
  }

  const headers = new Headers(response.headers);
  headers.set("Cache-Control", generateCacheControl(cacheConfig, hasAuth));
  headers.set("X-Cache", "MISS");
  if (cacheConfig.vary?.length) {
    headers.set("Vary", cacheConfig.vary.join(", "));
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
