import { describe, it, beforeEach } from "node:test";
import * as assert from "node:assert/strict";
import {
  generateCacheControl,
  ResponseCache,
  withCache,
  DEFAULT_CACHE_CONFIGS,
  type RouteCacheConfig,
} from "./route-cache.ts";

describe("DEFAULT_CACHE_CONFIGS", () => {
  it("should have static config with long cache", () => {
    const staticConfig = DEFAULT_CACHE_CONFIGS.static;
    assert.strictEqual(staticConfig.maxAge, 3600); // 1 hour
    assert.strictEqual(staticConfig.staleWhileRevalidate, 86400); // 24 hours
  });

  it("should have dynamic config with short cache", () => {
    const dynamicConfig = DEFAULT_CACHE_CONFIGS.dynamic;
    assert.strictEqual(dynamicConfig.maxAge, 60); // 1 minute
    assert.strictEqual(dynamicConfig.staleWhileRevalidate, 300); // 5 minutes
  });

  it("should have private config with no cache", () => {
    const privateConfig = DEFAULT_CACHE_CONFIGS.private;
    assert.strictEqual(privateConfig.maxAge, 0);
    assert.strictEqual(privateConfig.cacheAuthenticated, false);
  });
});

describe("generateCacheControl", () => {
  it("should generate public cache-control for public content", () => {
    const config: RouteCacheConfig = { maxAge: 3600, cacheAuthenticated: true };
    const result = generateCacheControl(config, false);

    assert.ok(result.includes("public"));
    assert.ok(result.includes("max-age=3600"));
  });

  it("should generate private cache-control for authenticated users", () => {
    const config: RouteCacheConfig = { maxAge: 3600 };
    const result = generateCacheControl(config, true);

    assert.ok(result.includes("private"));
    assert.ok(result.includes("max-age=3600"));
  });

  it("should include stale-while-revalidate when specified", () => {
    const config: RouteCacheConfig = { maxAge: 60, staleWhileRevalidate: 300 };
    const result = generateCacheControl(config, false);

    assert.ok(result.includes("stale-while-revalidate=300"));
  });

  it("should use no-cache for zero maxAge", () => {
    const config: RouteCacheConfig = { maxAge: 0 };
    const result = generateCacheControl(config, false);

    assert.ok(result.includes("no-cache"));
    assert.ok(!result.includes("max-age=0"));
  });

  it("should be private when cacheAuthenticated is false", () => {
    const config: RouteCacheConfig = { maxAge: 3600, cacheAuthenticated: false };
    const result = generateCacheControl(config, false);

    assert.ok(result.includes("private"));
  });
});

describe("ResponseCache", () => {
  let cache: ResponseCache;

  beforeEach(() => {
    cache = new ResponseCache(10);
  });

  it("should store and retrieve responses", async () => {
    const response = new Response("Hello", { status: 200 });
    await cache.set("test-key", response, 60);

    const cached = await cache.get("test-key");
    assert.ok(cached);
    assert.strictEqual(cached.status, 200);
  });

  it("should return null for missing keys", async () => {
    const cached = await cache.get("nonexistent");
    assert.strictEqual(cached, null);
  });

  it("should clone responses on get", async () => {
    const response = new Response("Original body", { status: 200 });
    await cache.set("clone-test", response, 60);

    const cached1 = await cache.get("clone-test");
    const cached2 = await cache.get("clone-test");

    assert.ok(cached1);
    assert.ok(cached2);

    // Both should be readable (cloned)
    const body1 = await cached1.text();
    const body2 = await cached2.text();

    assert.strictEqual(body1, "Original body");
    assert.strictEqual(body2, "Original body");
  });

  it("should expire entries after maxAge", async () => {
    const response = new Response("Expired", { status: 200 });
    // Set with 0 second max age (immediately expired)
    await cache.set("expired-key", response, 0);

    // Wait a tiny bit for time to pass
    await new Promise((resolve) => setTimeout(resolve, 10));

    const cached = await cache.get("expired-key");
    assert.strictEqual(cached, null);
  });

  it("should evict oldest entries when at capacity", async () => {
    const smallCache = new ResponseCache(3);

    await smallCache.set("key1", new Response("1"), 60);
    await smallCache.set("key2", new Response("2"), 60);
    await smallCache.set("key3", new Response("3"), 60);
    await smallCache.set("key4", new Response("4"), 60); // Should evict key1

    assert.strictEqual(await smallCache.get("key1"), null);
    assert.ok(await smallCache.get("key4"));
  });

  it("should preserve response headers", async () => {
    const response = new Response("Test", {
      headers: { "X-Custom": "value", "Content-Type": "text/plain" },
    });
    await cache.set("headers-test", response, 60);

    const cached = await cache.get("headers-test");
    assert.ok(cached);
    assert.strictEqual(cached.headers.get("X-Custom"), "value");
    assert.strictEqual(cached.headers.get("Content-Type"), "text/plain");
  });

  it("should preserve response status", async () => {
    const response = new Response("Created", { status: 201, statusText: "Created" });
    await cache.set("status-test", response, 60);

    const cached = await cache.get("status-test");
    assert.ok(cached);
    assert.strictEqual(cached.status, 201);
    assert.strictEqual(cached.statusText, "Created");
  });
});

describe("ResponseCache.generateKey", () => {
  it("should generate key from pathname", () => {
    const request = new Request("http://localhost/blog/post-1");
    const key = ResponseCache.generateKey(request, {});

    assert.ok(key.includes("/blog/post-1"));
  });

  it("should include sorted params in key", () => {
    const request = new Request("http://localhost/blog");
    const key = ResponseCache.generateKey(request, { slug: "test", page: "1" });

    assert.ok(key.includes("page=1"));
    assert.ok(key.includes("slug=test"));
    // Should be sorted alphabetically
    assert.ok(key.indexOf("page=1") < key.indexOf("slug=test"));
  });

  it("should generate consistent keys for same inputs", () => {
    const request1 = new Request("http://localhost/test");
    const request2 = new Request("http://localhost/test");

    const key1 = ResponseCache.generateKey(request1, { a: "1", b: "2" });
    const key2 = ResponseCache.generateKey(request2, { b: "2", a: "1" });

    assert.strictEqual(key1, key2);
  });
});

describe("withCache", () => {
  let cache: ResponseCache;

  beforeEach(() => {
    cache = new ResponseCache(100);
  });

  it("should return cached response on cache hit", async () => {
    const config: RouteCacheConfig = { maxAge: 3600 };
    let handlerCalled = 0;

    const handler = async () => {
      handlerCalled++;
      return new Response("Fresh", { status: 200 });
    };

    const request = new Request("http://localhost/test");

    // First request - cache miss
    const response1 = await withCache(request, {}, config, handler, cache);
    assert.strictEqual(handlerCalled, 1);
    assert.strictEqual(response1.headers.get("X-Cache"), "MISS");

    // Second request - cache hit
    const response2 = await withCache(request, {}, config, handler, cache);
    assert.strictEqual(handlerCalled, 1); // Handler not called again
    assert.strictEqual(response2.headers.get("X-Cache"), "HIT");
  });

  it("should skip cache for authenticated requests when not allowed", async () => {
    const config: RouteCacheConfig = { maxAge: 3600, cacheAuthenticated: false };
    let handlerCalled = 0;

    const handler = async () => {
      handlerCalled++;
      return new Response("Auth response");
    };

    const request = new Request("http://localhost/test", {
      headers: { Authorization: "Bearer token" },
    });

    await withCache(request, {}, config, handler, cache);
    await withCache(request, {}, config, handler, cache);

    // Handler should be called both times (no caching)
    assert.strictEqual(handlerCalled, 2);
  });

  it("should skip cache for cookie-authenticated requests when not allowed", async () => {
    const config: RouteCacheConfig = { maxAge: 3600, cacheAuthenticated: false };
    let handlerCalled = 0;

    const handler = async () => {
      handlerCalled++;
      return new Response("Cookie response");
    };

    const request = new Request("http://localhost/test", {
      headers: { Cookie: "session=abc123" },
    });

    await withCache(request, {}, config, handler, cache);
    await withCache(request, {}, config, handler, cache);

    // Handler should be called both times (no caching)
    assert.strictEqual(handlerCalled, 2);
  });

  it("should use custom key generator when provided", async () => {
    const config: RouteCacheConfig = {
      maxAge: 3600,
      keyGenerator: (_req, params) => `custom:${params.id}`,
    };

    let handlerCalled = 0;
    const handler = async () => {
      handlerCalled++;
      return new Response("Custom key response");
    };

    const request = new Request("http://localhost/test");

    await withCache(request, { id: "123" }, config, handler, cache);
    await withCache(request, { id: "123" }, config, handler, cache);

    // Should use cache
    assert.strictEqual(handlerCalled, 1);
  });

  it("should add Cache-Control header to response", async () => {
    const config: RouteCacheConfig = { maxAge: 3600, staleWhileRevalidate: 86400 };
    const handler = async () => new Response("Test");

    const request = new Request("http://localhost/test");
    const response = await withCache(request, {}, config, handler, cache);

    const cacheControl = response.headers.get("Cache-Control");
    assert.ok(cacheControl);
    assert.ok(cacheControl.includes("max-age=3600"));
    assert.ok(cacheControl.includes("stale-while-revalidate=86400"));
  });

  it("should add Vary header when configured", async () => {
    const config: RouteCacheConfig = { maxAge: 3600, vary: ["Accept-Language", "Accept-Encoding"] };
    const handler = async () => new Response("Test");

    const request = new Request("http://localhost/test");
    const response = await withCache(request, {}, config, handler, cache);

    const varyHeader = response.headers.get("Vary");
    assert.ok(varyHeader);
    assert.ok(varyHeader.includes("Accept-Language"));
    assert.ok(varyHeader.includes("Accept-Encoding"));
  });

  it("should not cache error responses", async () => {
    const config: RouteCacheConfig = { maxAge: 3600 };
    let handlerCalled = 0;

    const handler = async () => {
      handlerCalled++;
      return new Response("Error", { status: 500 });
    };

    const request = new Request("http://localhost/test");

    await withCache(request, {}, config, handler, cache);
    await withCache(request, {}, config, handler, cache);

    // Handler should be called both times (error not cached)
    assert.strictEqual(handlerCalled, 2);
  });

  it("should not cache when maxAge is 0", async () => {
    const config: RouteCacheConfig = { maxAge: 0 };
    let handlerCalled = 0;

    const handler = async () => {
      handlerCalled++;
      return new Response("No cache");
    };

    const request = new Request("http://localhost/test");

    await withCache(request, {}, config, handler, cache);
    await withCache(request, {}, config, handler, cache);

    // Handler should be called both times
    assert.strictEqual(handlerCalled, 2);
  });
});

describe("RouteCacheConfig type", () => {
  it("should accept minimal config", () => {
    const config: RouteCacheConfig = { maxAge: 60 };
    assert.strictEqual(config.maxAge, 60);
  });

  it("should accept full config", () => {
    const config: RouteCacheConfig = {
      maxAge: 3600,
      staleWhileRevalidate: 86400,
      keyGenerator: (req, params) => `${req.url}:${JSON.stringify(params)}`,
      cacheAuthenticated: true,
      vary: ["Accept-Language"],
    };

    assert.strictEqual(config.maxAge, 3600);
    assert.strictEqual(config.staleWhileRevalidate, 86400);
    assert.ok(config.keyGenerator);
    assert.strictEqual(config.cacheAuthenticated, true);
    assert.deepStrictEqual(config.vary, ["Accept-Language"]);
  });
});
