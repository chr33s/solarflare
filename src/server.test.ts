import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import {
  parsePattern,
  createRouter,
  matchRoute,
  findLayoutHierarchy,
  findLayouts,
  generateAssetTags,
  type Route,
  type ModuleMap,
} from "./server.ts";

describe("parsePattern", () => {
  it("should parse static route", () => {
    const result = parsePattern("./about.server.tsx");
    assert.strictEqual(result.pathname, "/about");
    assert.strictEqual(result.isStatic, true);
    assert.deepStrictEqual(result.params, []);
  });

  it("should parse route with single param", () => {
    const result = parsePattern("./blog/$slug.server.tsx");
    assert.strictEqual(result.pathname, "/blog/:slug");
    assert.strictEqual(result.isStatic, false);
    assert.strictEqual(result.params.length, 1);
    assert.strictEqual(result.params[0].name, "slug");
  });

  it("should parse route with multiple params", () => {
    const result = parsePattern("./users/$userId/posts/$postId.server.tsx");
    assert.strictEqual(result.pathname, "/users/:userId/posts/:postId");
    assert.strictEqual(result.params.length, 2);
    assert.strictEqual(result.params[0].name, "userId");
    assert.strictEqual(result.params[1].name, "postId");
  });

  it("should parse index route", () => {
    const result = parsePattern("./index.server.tsx");
    assert.strictEqual(result.pathname, "/");
  });

  it("should parse nested index route", () => {
    const result = parsePattern("./blog/index.server.tsx");
    assert.strictEqual(result.pathname, "/blog");
  });

  it("should preserve original file path", () => {
    const path = "./custom/path.server.tsx";
    const result = parsePattern(path);
    assert.strictEqual(result.filePath, path);
  });

  it("should calculate specificity", () => {
    const staticRoute = parsePattern("./blog/featured.server.tsx");
    const dynamicRoute = parsePattern("./blog/$slug.server.tsx");
    assert.ok(staticRoute.specificity > dynamicRoute.specificity);
  });
});

describe("createRouter", () => {
  const mockModules: ModuleMap = {
    server: {
      "./index.server.tsx": async () => ({ default: () => {} }),
      "./blog/$slug.server.tsx": async () => ({ default: () => {} }),
      "./about.server.tsx": async () => ({ default: () => {} }),
    },
    client: {
      "./index.client.tsx": async () => ({ default: () => {} }),
      "./blog/$slug.client.tsx": async () => ({ default: () => {} }),
    },
    layout: {
      "./_layout.tsx": async () => ({ default: () => {} }),
    },
  };

  it("should create routes from module map", () => {
    const routes = createRouter(mockModules);
    assert.ok(routes.length > 0);
  });

  it("should exclude private files (underscore prefix)", () => {
    const routes = createRouter(mockModules);
    const privatePaths = routes.filter((r) => r.path.includes("/_"));
    assert.deepStrictEqual(privatePaths, []);
  });

  it("should sort routes by specificity", () => {
    const routes = createRouter(mockModules);
    // Static routes should come before dynamic routes
    const aboutIndex = routes.findIndex((r) => r.path.includes("about"));
    const slugIndex = routes.findIndex((r) => r.path.includes("$slug"));
    if (aboutIndex !== -1 && slugIndex !== -1) {
      assert.ok(aboutIndex < slugIndex);
    }
  });

  it("should set correct route types", () => {
    const routes = createRouter(mockModules);
    for (const route of routes) {
      if (route.path.includes(".server.")) {
        assert.strictEqual(route.type, "server");
      } else if (route.path.includes(".client.")) {
        assert.strictEqual(route.type, "client");
      }
    }
  });

  it("should create URLPattern for each route", () => {
    const routes = createRouter(mockModules);
    for (const route of routes) {
      assert.ok(route.pattern instanceof URLPattern);
    }
  });
});

describe("matchRoute", () => {
  const mockModules: ModuleMap = {
    server: {
      "./index.server.tsx": async () => ({ default: () => {} }),
      "./blog/$slug.server.tsx": async () => ({ default: () => {} }),
      "./about.server.tsx": async () => ({ default: () => {} }),
    },
    client: {},
    layout: {},
  };

  let routes: Route[];

  it("should match root route", () => {
    routes = createRouter(mockModules);
    const url = new URL("http://localhost/");
    const match = matchRoute(routes, url);
    assert.notStrictEqual(match, null);
    assert.strictEqual(match?.route.path, "./index.server.tsx");
  });

  it("should match static route", () => {
    routes = createRouter(mockModules);
    const url = new URL("http://localhost/about");
    const match = matchRoute(routes, url);
    assert.notStrictEqual(match, null);
    assert.strictEqual(match?.route.path, "./about.server.tsx");
  });

  it("should match dynamic route", () => {
    routes = createRouter(mockModules);
    const url = new URL("http://localhost/blog/hello-world");
    const match = matchRoute(routes, url);
    assert.notStrictEqual(match, null);
    assert.strictEqual(match?.params.slug, "hello-world");
  });

  it("should extract route params", () => {
    routes = createRouter(mockModules);
    const url = new URL("http://localhost/blog/my-post-123");
    const match = matchRoute(routes, url);
    assert.deepStrictEqual(match?.params, { slug: "my-post-123" });
  });

  it("should return null for unmatched routes", () => {
    routes = createRouter(mockModules);
    const url = new URL("http://localhost/nonexistent/path");
    const match = matchRoute(routes, url);
    assert.strictEqual(match, null);
  });

  it("should set complete flag for fully matched params", () => {
    routes = createRouter(mockModules);
    const url = new URL("http://localhost/blog/test");
    const match = matchRoute(routes, url);
    assert.strictEqual(match?.complete, true);
  });
});

describe("findLayoutHierarchy", () => {
  const mockLayoutModules: Record<string, () => Promise<{ default: unknown }>> = {
    "./_layout.tsx": async () => ({ default: () => {} }),
    "./blog/_layout.tsx": async () => ({ default: () => {} }),
    "./blog/posts/_layout.tsx": async () => ({ default: () => {} }),
  };

  it("should find root layout", () => {
    const result = findLayoutHierarchy("./index.server.tsx", mockLayoutModules);
    assert.strictEqual(
      result.layouts.some((l) => l.path === "./_layout.tsx"),
      true,
    );
  });

  it("should find nested layouts in order", () => {
    const result = findLayoutHierarchy("./blog/posts/featured.server.tsx", mockLayoutModules);
    assert.strictEqual(result.layouts.length, 3);
    assert.strictEqual(result.layouts[0].path, "./_layout.tsx");
    assert.strictEqual(result.layouts[1].path, "./blog/_layout.tsx");
    assert.strictEqual(result.layouts[2].path, "./blog/posts/_layout.tsx");
  });

  it("should set correct depth for each layout", () => {
    const result = findLayoutHierarchy("./blog/posts/featured.server.tsx", mockLayoutModules);
    assert.strictEqual(result.layouts[0].depth, 0);
    assert.strictEqual(result.layouts[1].depth, 1);
    assert.strictEqual(result.layouts[2].depth, 2);
  });

  it("should return empty layouts when none exist", () => {
    const result = findLayoutHierarchy("./standalone.server.tsx", {});
    assert.deepStrictEqual(result.layouts, []);
  });

  it("should include checked paths", () => {
    const result = findLayoutHierarchy("./blog/posts/test.server.tsx", mockLayoutModules);
    assert.ok(result.checkedPaths.includes("./_layout.tsx"));
    assert.ok(result.checkedPaths.includes("./blog/_layout.tsx"));
    assert.ok(result.checkedPaths.includes("./blog/posts/_layout.tsx"));
  });

  it("should include segments", () => {
    const result = findLayoutHierarchy("./blog/posts/test.server.tsx", mockLayoutModules);
    assert.deepStrictEqual(result.segments, ["blog", "posts"]);
  });
});

describe("findLayouts", () => {
  const mockModules: ModuleMap = {
    server: {},
    client: {},
    layout: {
      "./_layout.tsx": async () => ({ default: () => {} }),
      "./blog/_layout.tsx": async () => ({ default: () => {} }),
    },
  };

  it("should find layouts using module map", () => {
    const layouts = findLayouts("./blog/post.server.tsx", mockModules);
    assert.strictEqual(layouts.length, 2);
  });

  it("should return layouts in root-to-leaf order", () => {
    const layouts = findLayouts("./blog/post.server.tsx", mockModules);
    assert.ok(layouts[0].depth < layouts[1].depth);
  });
});

describe("generateAssetTags", () => {
  it("should generate script tag", () => {
    const result = generateAssetTags("/app.js");
    assert.ok(result.includes('<script type="module" src="/app.js" async></script>'));
  });

  it("should generate stylesheet links", () => {
    const result = generateAssetTags(undefined, ["/styles.css", "/theme.css"]);
    assert.ok(result.includes('<link rel="stylesheet" href="/styles.css">'));
    assert.ok(result.includes('<link rel="stylesheet" href="/theme.css">'));
  });

  it("should generate dev scripts", () => {
    const result = generateAssetTags(undefined, undefined, ["/dev.js"]);
    assert.ok(result.includes('<script src="/dev.js" async></script>'));
  });

  it("should generate all asset types together", () => {
    const result = generateAssetTags("/app.js", ["/styles.css"], ["/dev.js"]);
    assert.ok(result.includes('<link rel="stylesheet" href="/styles.css">'));
    assert.ok(result.includes('<script src="/dev.js" async></script>'));
    assert.ok(result.includes('<script type="module" src="/app.js" async></script>'));
  });

  it("should return empty string for no assets", () => {
    const result = generateAssetTags();
    assert.strictEqual(result, "");
  });

  it("should handle empty arrays", () => {
    const result = generateAssetTags(undefined, [], []);
    assert.strictEqual(result, "");
  });
});

describe("renderToStream with response metadata", () => {
  it("should set default status to 200", async () => {
    const { h } = await import("preact");
    const vnode = h("div", null, "test");
    const stream = await import("./server.ts").then((m) => m.renderToStream(vnode, {}));
    assert.strictEqual(stream.status, 200);
  });

  it("should set custom status from options", async () => {
    const { h } = await import("preact");
    const vnode = h("div", null, "test");
    const stream = await import("./server.ts").then((m) =>
      m.renderToStream(vnode, { _status: 201 }),
    );
    assert.strictEqual(stream.status, 201);
  });

  it("should set statusText from options", async () => {
    const { h } = await import("preact");
    const vnode = h("div", null, "test");
    const stream = await import("./server.ts").then((m) =>
      m.renderToStream(vnode, { _statusText: "Created" }),
    );
    assert.strictEqual(stream.statusText, "Created");
  });

  it("should set headers from options", async () => {
    const { h } = await import("preact");
    const vnode = h("div", null, "test");
    const customHeaders = { "X-Custom": "value", "Cache-Control": "no-cache" };
    const stream = await import("./server.ts").then((m) =>
      m.renderToStream(vnode, { _headers: customHeaders }),
    );
    assert.deepStrictEqual(stream.headers, customHeaders);
  });

  it("should handle 404 status", async () => {
    const { h } = await import("preact");
    const vnode = h("div", null, "Not Found");
    const stream = await import("./server.ts").then((m) =>
      m.renderToStream(vnode, { _status: 404, _statusText: "Not Found" }),
    );
    assert.strictEqual(stream.status, 404);
    assert.strictEqual(stream.statusText, "Not Found");
  });

  it("should handle 500 status", async () => {
    const { h } = await import("preact");
    const vnode = h("div", null, "Error");
    const stream = await import("./server.ts").then((m) =>
      m.renderToStream(vnode, { _status: 500, _statusText: "Internal Server Error" }),
    );
    assert.strictEqual(stream.status, 500);
    assert.strictEqual(stream.statusText, "Internal Server Error");
  });

  it("should combine all response metadata", async () => {
    const { h } = await import("preact");
    const vnode = h("div", null, "test");
    const customHeaders = {
      "X-Custom": "value",
      "Cache-Control": "max-age=3600",
    };
    const stream = await import("./server.ts").then((m) =>
      m.renderToStream(vnode, {
        _status: 201,
        _statusText: "Created",
        _headers: customHeaders,
      }),
    );
    assert.strictEqual(stream.status, 201);
    assert.strictEqual(stream.statusText, "Created");
    assert.deepStrictEqual(stream.headers, customHeaders);
  });

  it("should preserve status and headers with deferred data", async () => {
    const { h } = await import("preact");
    const vnode = h("div", null, "test");
    const customHeaders = { "X-Deferred": "true" };
    const deferredPromise = Promise.resolve("deferred");
    const stream = await import("./server.ts").then((m) =>
      m.renderToStream(vnode, {
        _status: 202,
        _statusText: "Accepted",
        _headers: customHeaders,
        deferred: { tag: "test-component", promises: { data: deferredPromise } },
      }),
    );
    assert.strictEqual(stream.status, 202);
    assert.strictEqual(stream.statusText, "Accepted");
    assert.deepStrictEqual(stream.headers, customHeaders);
  });

  it("should stream multiple deferred props independently", async () => {
    const { h } = await import("preact");
    const vnode = h("div", null, "test");

    // Use real delays to simulate production behavior
    const fast = new Promise((resolve) => setTimeout(() => resolve("FAST"), 50));
    const slow = new Promise((resolve) => setTimeout(() => resolve("SLOW"), 150));

    const stream = await import("./server.ts").then((m) =>
      m.renderToStream(vnode, {
        deferred: { tag: "test-component", promises: { fast, slow } },
      }),
    );

    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let seen = "";
    const timestamps: { fast?: number; slow?: number } = {};
    const start = Date.now();

    // Read until both data islands appear, recording when each is first seen
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        seen += decoder.decode(value, { stream: true });
        if (!timestamps.fast && seen.includes('data-island="test-component-deferred-fast')) {
          timestamps.fast = Date.now() - start;
        }
        if (!timestamps.slow && seen.includes('data-island="test-component-deferred-slow')) {
          timestamps.slow = Date.now() - start;
        }
      }
    }

    assert.ok(seen.includes('data-island="test-component-deferred-fast'));
    assert.ok(seen.includes('data-island="test-component-deferred-slow'));

    // Fast should arrive before slow (with some tolerance for timing)
    assert.ok(
      timestamps.fast! < timestamps.slow!,
      `Fast chunk (${timestamps.fast}ms) should arrive before slow chunk (${timestamps.slow}ms)`,
    );

    // Verify they arrived at different times (not batched)
    const timeDiff = timestamps.slow! - timestamps.fast!;
    assert.ok(
      timeDiff > 50,
      `Chunks should arrive ~100ms apart, but only ${timeDiff}ms difference`,
    );
  });
});
