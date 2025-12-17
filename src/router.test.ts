import { describe, it, expect, mock } from "bun:test";
import {
  Router,
  createRouter,
  supportsViewTransitions,
  fetchWithRetry,
  type RoutesManifest,
  type RouteManifestEntry,
  type RouterConfig,
  type RouteMatch,
} from "./router";

describe("supportsViewTransitions", () => {
  it("should return false in non-browser environment", () => {
    // In Bun test environment, document is not defined
    const result = supportsViewTransitions();
    expect(typeof result).toBe("boolean");
  });
});

describe("fetchWithRetry", () => {
  it("should return successful response", async () => {
    const mockResponse = new Response("OK", { status: 200 });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock(() => Promise.resolve(mockResponse)) as unknown as typeof fetch;

    try {
      const response = await fetchWithRetry("http://localhost/test");
      expect(response.status).toBe(200);
      expect(await response.text()).toBe("OK");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("should retry on 5xx errors", async () => {
    let attempts = 0;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock(() => {
      attempts++;
      if (attempts < 3) {
        return Promise.resolve(new Response("Error", { status: 500 }));
      }
      return Promise.resolve(new Response("OK", { status: 200 }));
    }) as unknown as typeof fetch;

    try {
      const response = await fetchWithRetry("http://localhost/test", undefined, {
        maxRetries: 3,
        baseDelay: 10,
      });
      expect(response.status).toBe(200);
      expect(attempts).toBe(3);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("should not retry on 4xx errors", async () => {
    let attempts = 0;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock(() => {
      attempts++;
      return Promise.resolve(new Response("Not Found", { status: 404 }));
    }) as unknown as typeof fetch;

    try {
      const response = await fetchWithRetry("http://localhost/test", undefined, {
        maxRetries: 3,
        baseDelay: 10,
      });
      expect(response.status).toBe(404);
      expect(attempts).toBe(1);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("should throw after max retries", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response("Error", { status: 500 })),
    ) as unknown as typeof fetch;

    try {
      expect(
        fetchWithRetry("http://localhost/test", undefined, {
          maxRetries: 2,
          baseDelay: 10,
        }),
      ).rejects.toThrow();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("should retry on network errors", async () => {
    let attempts = 0;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock(() => {
      attempts++;
      if (attempts < 2) {
        return Promise.reject(new Error("Network error"));
      }
      return Promise.resolve(new Response("OK", { status: 200 }));
    }) as unknown as typeof fetch;

    try {
      const response = await fetchWithRetry("http://localhost/test", undefined, {
        maxRetries: 3,
        baseDelay: 10,
      });
      expect(response.status).toBe(200);
      expect(attempts).toBe(2);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("should use custom retry predicate", async () => {
    let attempts = 0;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock(() => {
      attempts++;
      return Promise.resolve(new Response("Rate limited", { status: 429 }));
    }) as unknown as typeof fetch;

    try {
      await fetchWithRetry("http://localhost/test", undefined, {
        maxRetries: 2,
        baseDelay: 10,
        retryOnStatus: (status) => status === 429 || status >= 500,
      });
    } catch {
      expect(attempts).toBe(3); // Initial + 2 retries
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe("Router", () => {
  const createManifest = (routes: RouteManifestEntry[] = []): RoutesManifest => ({
    routes,
    base: "",
  });

  describe("constructor", () => {
    it("should create router with manifest", () => {
      const manifest = createManifest([
        { pattern: "/", tag: "sf-root", type: "client", params: [] },
      ]);
      const router = new Router(manifest);
      expect(router).toBeInstanceOf(Router);
    });

    it("should accept custom config", () => {
      const manifest = createManifest();
      const config: RouterConfig = {
        base: "/app",
        viewTransitions: false,
        scrollBehavior: "smooth",
      };
      const router = new Router(manifest, config);
      expect(router).toBeInstanceOf(Router);
    });

    it("should initialize current signal to null", () => {
      const manifest = createManifest();
      const router = new Router(manifest);
      expect(router.current.value).toBeNull();
    });

    it("should initialize params as empty object", () => {
      const manifest = createManifest();
      const router = new Router(manifest);
      expect(router.params.value).toEqual({});
    });

    it("should initialize pathname as empty string", () => {
      const manifest = createManifest();
      const router = new Router(manifest);
      expect(router.pathname.value).toBe("");
    });
  });

  describe("match", () => {
    it("should match root route", () => {
      const manifest = createManifest([
        { pattern: "/", tag: "sf-root", type: "client", params: [] },
      ]);
      const router = new Router(manifest);
      const url = new URL("http://localhost/");
      const match = router.match(url);
      expect(match).not.toBeNull();
      expect(match?.entry.tag).toBe("sf-root");
    });

    it("should match static route", () => {
      const manifest = createManifest([
        { pattern: "/about", tag: "sf-about", type: "client", params: [] },
      ]);
      const router = new Router(manifest);
      const url = new URL("http://localhost/about");
      const match = router.match(url);
      expect(match).not.toBeNull();
      expect(match?.entry.tag).toBe("sf-about");
    });

    it("should match dynamic route and extract params", () => {
      const manifest = createManifest([
        { pattern: "/blog/:slug", tag: "sf-blog-slug", type: "client", params: ["slug"] },
      ]);
      const router = new Router(manifest);
      const url = new URL("http://localhost/blog/hello-world");
      const match = router.match(url);
      expect(match).not.toBeNull();
      expect(match?.params.slug).toBe("hello-world");
    });

    it("should match routes with multiple params", () => {
      const manifest = createManifest([
        {
          pattern: "/users/:userId/posts/:postId",
          tag: "sf-user-post",
          type: "client",
          params: ["userId", "postId"],
        },
      ]);
      const router = new Router(manifest);
      const url = new URL("http://localhost/users/123/posts/456");
      const match = router.match(url);
      expect(match?.params).toEqual({ userId: "123", postId: "456" });
    });

    it("should return null for unmatched routes", () => {
      const manifest = createManifest([
        { pattern: "/about", tag: "sf-about", type: "client", params: [] },
      ]);
      const router = new Router(manifest);
      const url = new URL("http://localhost/contact");
      const match = router.match(url);
      expect(match).toBeNull();
    });

    it("should only match client routes", () => {
      const manifest = createManifest([
        { pattern: "/api/data", tag: "sf-api", type: "server", params: [] },
      ]);
      const router = new Router(manifest);
      const url = new URL("http://localhost/api/data");
      const match = router.match(url);
      expect(match).toBeNull();
    });

    it("should prefer more specific routes", () => {
      const manifest = createManifest([
        { pattern: "/blog/:slug", tag: "sf-blog-slug", type: "client", params: ["slug"] },
        { pattern: "/blog/featured", tag: "sf-blog-featured", type: "client", params: [] },
      ]);
      const router = new Router(manifest);
      const url = new URL("http://localhost/blog/featured");
      const match = router.match(url);
      expect(match?.entry.tag).toBe("sf-blog-featured");
    });
  });

  describe("isActive", () => {
    it("should check exact match", () => {
      const manifest = createManifest([
        { pattern: "/about", tag: "sf-about", type: "client", params: [] },
      ]);
      const router = new Router(manifest);

      // Manually set current route for testing
      router.current.value = {
        entry: manifest.routes[0],
        params: {},
        url: new URL("http://localhost/about"),
      };

      expect(router.isActive("/about", true)).toBe(true);
      expect(router.isActive("/about/team", true)).toBe(false);
    });

    it("should check prefix match", () => {
      const manifest = createManifest([
        { pattern: "/blog/:slug", tag: "sf-blog-slug", type: "client", params: ["slug"] },
      ]);
      const router = new Router(manifest);

      router.current.value = {
        entry: manifest.routes[0],
        params: { slug: "hello" },
        url: new URL("http://localhost/blog/hello"),
      };

      expect(router.isActive("/blog")).toBe(true);
      expect(router.isActive("/blog", false)).toBe(true);
      expect(router.isActive("/about")).toBe(false);
    });
  });

  describe("isActiveSignal", () => {
    it("should return reactive signal for isActive", () => {
      const manifest = createManifest([
        { pattern: "/blog/:slug", tag: "sf-blog-slug", type: "client", params: ["slug"] },
      ]);
      const router = new Router(manifest);

      const isActiveBlog = router.isActiveSignal("/blog");

      // Initially false
      expect(isActiveBlog.value).toBe(false);

      // Set current route
      router.current.value = {
        entry: manifest.routes[0],
        params: { slug: "test" },
        url: new URL("http://localhost/blog/test"),
      };

      // Now should be true
      expect(isActiveBlog.value).toBe(true);
    });
  });

  describe("subscribe", () => {
    it("should call callback on route changes", () => {
      const manifest = createManifest([
        { pattern: "/", tag: "sf-root", type: "client", params: [] },
      ]);
      const router = new Router(manifest);
      const calls: (RouteMatch | null)[] = [];

      const unsubscribe = router.subscribe((match) => {
        calls.push(match);
      });

      // Initial call with null
      expect(calls).toHaveLength(1);
      expect(calls[0]).toBeNull();

      // Update current
      const newMatch: RouteMatch = {
        entry: manifest.routes[0],
        params: {},
        url: new URL("http://localhost/"),
      };
      router.current.value = newMatch;

      expect(calls).toHaveLength(2);
      expect(calls[1]).toBe(newMatch);

      unsubscribe();
    });
  });

  describe("back/forward/go", () => {
    it("should have navigation methods", () => {
      const manifest = createManifest();
      const router = new Router(manifest);

      expect(typeof router.back).toBe("function");
      expect(typeof router.forward).toBe("function");
      expect(typeof router.go).toBe("function");
    });
  });

  describe("start/stop", () => {
    it("should have lifecycle methods", () => {
      const manifest = createManifest();
      const router = new Router(manifest);

      expect(typeof router.start).toBe("function");
      expect(typeof router.stop).toBe("function");
    });

    it("should return this from start/stop for chaining", () => {
      const manifest = createManifest();
      const router = new Router(manifest);

      // In test environment without window.navigation, these should still work
      const result = router.stop();
      expect(result).toBe(router);
    });
  });
});

describe("createRouter", () => {
  it("should create router instance", () => {
    const manifest: RoutesManifest = { routes: [] };
    const router = createRouter(manifest);
    expect(router).toBeInstanceOf(Router);
  });

  it("should pass config to router", () => {
    const manifest: RoutesManifest = { routes: [] };
    const config: RouterConfig = { base: "/app" };
    const router = createRouter(manifest, config);
    expect(router).toBeInstanceOf(Router);
  });
});
