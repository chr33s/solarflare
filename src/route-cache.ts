/** Cache configuration per route. */
export interface RouteCacheConfig {
  maxAge: number;
  staleWhileRevalidate?: number;
  keyGenerator?: (request: Request, params: Record<string, string>) => string;
  cacheAuthenticated?: boolean;
  vary?: string[];
}

/** Default cache configs by route type. */
export const DEFAULT_CACHE_CONFIGS: Record<string, RouteCacheConfig> = {
  static: {
    maxAge: 3600,
    staleWhileRevalidate: 86400,
  },
  dynamic: {
    maxAge: 60,
    staleWhileRevalidate: 300,
  },
  private: {
    maxAge: 0,
    cacheAuthenticated: false,
  },
};

/** Generates cache control header value. */
export function generateCacheControl(config: RouteCacheConfig, isPrivate: boolean) {
  const directives: string[] = [];

  if (isPrivate || !config.cacheAuthenticated) {
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
    const sortedParams = Object.entries(params)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join("&");
    return `${url.pathname}?${sortedParams}`;
  }
}

/** Cache-aware request handler wrapper */
export async function withCache(
  request: Request,
  params: Record<string, string>,
  config: RouteCacheConfig,
  handler: () => Promise<Response>,
  cache: ResponseCache,
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

  // Only cache successful responses
  if (response.ok && config.maxAge > 0) {
    await cache.set(key, response, config.maxAge);
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
