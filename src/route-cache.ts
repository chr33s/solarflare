/** Route-level response caching for static/semi-static content. */

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
  // Static pages - long cache
  static: {
    maxAge: 3600, // 1 hour
    staleWhileRevalidate: 86400, // 24 hours
  },
  // Dynamic but public pages
  dynamic: {
    maxAge: 60, // 1 minute
    staleWhileRevalidate: 300, // 5 minutes
  },
  // User-specific pages - no shared cache
  private: {
    maxAge: 0,
    cacheAuthenticated: false,
  },
};

/**
 * Generates cache control header value.
 */
export function generateCacheControl(config: RouteCacheConfig, isPrivate: boolean): string {
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

/**
 * In-memory LRU cache for edge responses.
 * In production, use Cloudflare Cache API or KV.
 */
export class ResponseCache {
  #cache = new Map<string, { response: Response; expires: number }>();
  #maxSize: number;

  constructor(maxSize = 100) {
    this.#maxSize = maxSize;
  }

  /**
   * Gets a cached response if valid.
   */
  get(key: string): Response | null {
    const entry = this.#cache.get(key);
    if (!entry) return null;

    if (Date.now() > entry.expires) {
      this.#cache.delete(key);
      return null;
    }

    // Clone the response (body can only be read once)
    return entry.response.clone();
  }

  /**
   * Caches a response.
   */
  set(key: string, response: Response, maxAge: number): void {
    // Evict oldest entries if at capacity
    while (this.#cache.size >= this.#maxSize) {
      const firstKey = this.#cache.keys().next().value;
      if (firstKey) this.#cache.delete(firstKey);
    }

    this.#cache.set(key, {
      response: response.clone(),
      expires: Date.now() + maxAge * 1000,
    });
  }

  /**
   * Generates a cache key for a request.
   */
  static generateKey(request: Request, params: Record<string, string>): string {
    const url = new URL(request.url);
    // Include pathname and sorted params
    const sortedParams = Object.entries(params)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join("&");

    return `${url.pathname}? ${sortedParams}`;
  }
}

/**
 * Cache-aware request handler wrapper.
 */
export async function withCache(
  request: Request,
  params: Record<string, string>,
  config: RouteCacheConfig,
  handler: () => Promise<Response>,
  cache: ResponseCache,
): Promise<Response> {
  // Skip cache for authenticated requests if configured
  const hasAuth = request.headers.has("Authorization") || request.headers.has("Cookie");
  if (hasAuth && !config.cacheAuthenticated) {
    return handler();
  }

  // Generate cache key
  const key = config.keyGenerator
    ? config.keyGenerator(request, params)
    : ResponseCache.generateKey(request, params);

  // Try cache first
  const cached = cache.get(key);
  if (cached) {
    // Add cache hit header for debugging
    const headers = new Headers(cached.headers);
    headers.set("X-Cache", "HIT");
    return new Response(cached.body, {
      status: cached.status,
      statusText: cached.statusText,
      headers,
    });
  }

  // Generate fresh response
  const response = await handler();

  // Only cache successful responses
  if (response.ok && config.maxAge > 0) {
    cache.set(key, response, config.maxAge);
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
