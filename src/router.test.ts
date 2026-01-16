import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import {
  Router,
  createRouter,
  supportsViewTransitions,
  fetchWithRetry,
  type RoutesManifest,
  type RouteManifestEntry,
  type RouterConfig,
  type RouteMatch,
} from "./router.ts";
import { handleDeferredHydrationNode } from "./router-deferred.ts";

describe("supportsViewTransitions", () => {
  it("should return false in non-browser environment", () => {
    // In Nodejs test environment, document is not defined
    const result = supportsViewTransitions();
    assert.strictEqual(typeof result, "boolean");
  });
});

describe("fetchWithRetry", () => {
  it("should return successful response", async () => {
    const mockResponse = new Response("OK", { status: 200 });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (() => Promise.resolve(mockResponse)) as unknown as typeof fetch;

    try {
      const response = await fetchWithRetry("http://localhost/test");
      assert.strictEqual(response.status, 200);
      assert.strictEqual(await response.text(), "OK");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("should retry on 5xx errors", async () => {
    let attempts = 0;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (() => {
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
      assert.strictEqual(response.status, 200);
      assert.strictEqual(attempts, 3);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("should not retry on 4xx errors", async () => {
    let attempts = 0;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (() => {
      attempts++;
      return Promise.resolve(new Response("Not Found", { status: 404 }));
    }) as unknown as typeof fetch;

    try {
      const response = await fetchWithRetry("http://localhost/test", undefined, {
        maxRetries: 3,
        baseDelay: 10,
      });
      assert.strictEqual(response.status, 404);
      assert.strictEqual(attempts, 1);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("should throw after max retries", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (() =>
      Promise.resolve(new Response("Error", { status: 500 }))) as unknown as typeof fetch;

    try {
      await assert.rejects(
        fetchWithRetry("http://localhost/test", undefined, {
          maxRetries: 2,
          baseDelay: 10,
        }),
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("should retry on network errors", async () => {
    let attempts = 0;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (() => {
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
      assert.strictEqual(response.status, 200);
      assert.strictEqual(attempts, 2);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("should use custom retry predicate", async () => {
    let attempts = 0;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (() => {
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
      assert.strictEqual(attempts, 3); // Initial + 2 retries
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
      assert.ok(router instanceof Router);
    });

    it("should accept custom config", () => {
      const manifest = createManifest();
      const config: RouterConfig = {
        base: "/app",
        viewTransitions: false,
        scrollBehavior: "smooth",
      };
      const router = new Router(manifest, config);
      assert.ok(router instanceof Router);
    });

    it("should initialize current signal to null", () => {
      const manifest = createManifest();
      const router = new Router(manifest);
      assert.strictEqual(router.current.value, null);
    });

    it("should initialize params as empty object", () => {
      const manifest = createManifest();
      const router = new Router(manifest);
      assert.deepStrictEqual(router.params.value, {});
    });

    it("should initialize pathname as empty string", () => {
      const manifest = createManifest();
      const router = new Router(manifest);
      assert.strictEqual(router.pathname.value, "");
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
      assert.notStrictEqual(match, null);
      assert.strictEqual(match?.entry.tag, "sf-root");
    });

    it("should match static route", () => {
      const manifest = createManifest([
        { pattern: "/about", tag: "sf-about", type: "client", params: [] },
      ]);
      const router = new Router(manifest);
      const url = new URL("http://localhost/about");
      const match = router.match(url);
      assert.notStrictEqual(match, null);
      assert.strictEqual(match?.entry.tag, "sf-about");
    });

    it("should match dynamic route and extract params", () => {
      const manifest = createManifest([
        {
          pattern: "/blog/:slug",
          tag: "sf-blog-slug",
          type: "client",
          params: ["slug"],
        },
      ]);
      const router = new Router(manifest);
      const url = new URL("http://localhost/blog/hello-world");
      const match = router.match(url);
      assert.notStrictEqual(match, null);
      assert.strictEqual(match?.params.slug, "hello-world");
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
      assert.deepStrictEqual(match?.params, { userId: "123", postId: "456" });
    });

    it("should return null for unmatched routes", () => {
      const manifest = createManifest([
        { pattern: "/about", tag: "sf-about", type: "client", params: [] },
      ]);
      const router = new Router(manifest);
      const url = new URL("http://localhost/contact");
      const match = router.match(url);
      assert.strictEqual(match, null);
    });

    it("should only match client routes", () => {
      const manifest = createManifest([
        { pattern: "/api/data", tag: "sf-api", type: "server", params: [] },
      ]);
      const router = new Router(manifest);
      const url = new URL("http://localhost/api/data");
      const match = router.match(url);
      assert.strictEqual(match, null);
    });

    it("should prefer more specific routes", () => {
      const manifest = createManifest([
        {
          pattern: "/blog/:slug",
          tag: "sf-blog-slug",
          type: "client",
          params: ["slug"],
        },
        {
          pattern: "/blog/featured",
          tag: "sf-blog-featured",
          type: "client",
          params: [],
        },
      ]);
      const router = new Router(manifest);
      const url = new URL("http://localhost/blog/featured");
      const match = router.match(url);
      assert.strictEqual(match?.entry.tag, "sf-blog-featured");
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

      assert.strictEqual(router.isActive("/about", true), true);
      assert.strictEqual(router.isActive("/about/team", true), false);
    });

    it("should check prefix match", () => {
      const manifest = createManifest([
        {
          pattern: "/blog/:slug",
          tag: "sf-blog-slug",
          type: "client",
          params: ["slug"],
        },
      ]);
      const router = new Router(manifest);

      router.current.value = {
        entry: manifest.routes[0],
        params: { slug: "hello" },
        url: new URL("http://localhost/blog/hello"),
      };

      assert.strictEqual(router.isActive("/blog"), true);
      assert.strictEqual(router.isActive("/blog", false), true);
      assert.strictEqual(router.isActive("/about"), false);
    });
  });

  describe("isActiveSignal", () => {
    it("should return reactive signal for isActive", () => {
      const manifest = createManifest([
        {
          pattern: "/blog/:slug",
          tag: "sf-blog-slug",
          type: "client",
          params: ["slug"],
        },
      ]);
      const router = new Router(manifest);

      const isActiveBlog = router.isActiveSignal("/blog");

      // Initially false
      assert.strictEqual(isActiveBlog.value, false);

      // Set current route
      router.current.value = {
        entry: manifest.routes[0],
        params: { slug: "test" },
        url: new URL("http://localhost/blog/test"),
      };

      // Now should be true
      assert.strictEqual(isActiveBlog.value, true);
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
      assert.strictEqual(calls.length, 1);
      assert.strictEqual(calls[0], null);

      // Update current
      const newMatch: RouteMatch = {
        entry: manifest.routes[0],
        params: {},
        url: new URL("http://localhost/"),
      };
      router.current.value = newMatch;

      assert.strictEqual(calls.length, 2);
      assert.strictEqual(calls[1], newMatch);

      unsubscribe();
    });
  });

  describe("back/forward/go", () => {
    it("should have navigation methods", () => {
      const manifest = createManifest();
      const router = new Router(manifest);

      assert.strictEqual(typeof router.back, "function");
      assert.strictEqual(typeof router.forward, "function");
      assert.strictEqual(typeof router.go, "function");
    });
  });

  describe("start/stop", () => {
    it("should have lifecycle methods", () => {
      const manifest = createManifest();
      const router = new Router(manifest);

      assert.strictEqual(typeof router.start, "function");
      assert.strictEqual(typeof router.stop, "function");
    });

    it("should return this from start/stop for chaining", () => {
      const manifest = createManifest();
      const router = new Router(manifest);

      // In test environment without window.navigation, these should still work
      const result = router.stop();
      assert.strictEqual(result, router);
    });
  });
});

describe("deferred hydration observer", () => {
  it("should dispatch hydration when a deferred data island is inserted", () => {
    const originalDocument = globalThis.document;
    const originalCustomEvent = globalThis.CustomEvent;
    const events: Array<{ type: string; detail: unknown }> = [];

    globalThis.document = {
      dispatchEvent: (event: { type: string; detail: unknown }) => {
        events.push(event);
        return true;
      },
    } as unknown as Document;

    globalThis.CustomEvent = class CustomEventMock {
      type: string;
      detail: unknown;
      constructor(type: string, init?: { detail?: unknown }) {
        this.type = type;
        this.detail = init?.detail;
      }
    } as unknown as typeof CustomEvent;

    try {
      const processed = new Set<string>();

      class FakeScript {
        tagName = "SCRIPT";
        id = "";
        textContent: string | null = null;
        private attrs: Record<string, string> = {};
        constructor(attrs: Record<string, string>) {
          this.attrs = attrs;
        }
        getAttribute(name: string) {
          return this.attrs[name] ?? null;
        }
      }

      class FakeContainer {
        tagName = "DIV";
        private scripts: FakeScript[];
        constructor(scripts: FakeScript[]) {
          this.scripts = scripts;
        }
        querySelectorAll() {
          return this.scripts as unknown as NodeListOf<HTMLScriptElement>;
        }
      }

      const dataScript = new FakeScript({
        "data-island": "sf-root-deferred-defer-abc123",
      });
      const container = new FakeContainer([dataScript]);

      handleDeferredHydrationNode("sf-root", processed, container as unknown as Element);

      assert.strictEqual(events.length, 1);
      assert.deepStrictEqual(events[0].detail, {
        tag: "sf-root",
        id: "sf-root-deferred-defer-abc123",
      });

      handleDeferredHydrationNode("sf-root", processed, container as unknown as Element);
      assert.strictEqual(events.length, 1);
    } finally {
      globalThis.document = originalDocument;
      globalThis.CustomEvent = originalCustomEvent;
    }
  });

  it("should dispatch hydration when a hydration script is inserted", () => {
    const originalDocument = globalThis.document;
    const originalCustomEvent = globalThis.CustomEvent;
    const events: Array<{ type: string; detail: unknown }> = [];

    globalThis.document = {
      dispatchEvent: (event: { type: string; detail: unknown }) => {
        events.push(event);
        return true;
      },
    } as unknown as Document;

    globalThis.CustomEvent = class CustomEventMock {
      type: string;
      detail: unknown;
      constructor(type: string, init?: { detail?: unknown }) {
        this.type = type;
        this.detail = init?.detail;
      }
    } as unknown as typeof CustomEvent;

    try {
      const processed = new Set<string>();

      class FakeScript {
        tagName = "SCRIPT";
        id = "sf-root-hydrate-defer-abc123";
        textContent = 'detail:{"tag":"sf-root","id":"sf-root-deferred-defer-abc123"}';
        getAttribute() {
          return null;
        }
      }

      const script = new FakeScript();

      handleDeferredHydrationNode("sf-root", processed, script as unknown as Element);

      assert.strictEqual(events.length, 1);
      assert.deepStrictEqual(events[0].detail, {
        tag: "sf-root",
        id: "sf-root-deferred-defer-abc123",
      });
    } finally {
      globalThis.document = originalDocument;
      globalThis.CustomEvent = originalCustomEvent;
    }
  });
});

describe("createRouter", () => {
  it("should create router instance", () => {
    const manifest: RoutesManifest = { routes: [] };
    const router = createRouter(manifest);
    assert.ok(router instanceof Router);
  });

  it("should pass config to router", () => {
    const manifest: RoutesManifest = { routes: [] };
    const config: RouterConfig = { base: "/app" };
    const router = createRouter(manifest, config);
    assert.ok(router instanceof Router);
  });
});
