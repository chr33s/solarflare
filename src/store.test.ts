import { describe, it, beforeEach, afterEach } from "node:test";
import * as assert from "node:assert/strict";
import { signal, computed, batch } from "@preact/signals";
import {
  initStore,
  resetStore,
  setParams,
  setServerData,
  setPathname,
  params,
  serverData,
  pathname,
  type StoreConfig,
} from "./store.ts";

beforeEach(() => {
  resetStore();
});

afterEach(() => {
  resetStore();
});

describe("initStore", () => {
  it("should initialize with default values", () => {
    initStore();
    assert.deepStrictEqual(params.value, {});
    assert.strictEqual(serverData.value.data, null);
    assert.strictEqual(serverData.value.loading, false);
    assert.strictEqual(serverData.value.error, null);
  });

  it("should initialize with provided params", () => {
    initStore({ params: { slug: "hello-world" } });
    assert.deepStrictEqual(params.value, { slug: "hello-world" });
  });

  it("should initialize with provided server data", () => {
    const data = { title: "Test", content: "Hello" };
    initStore({ serverData: data });
    assert.deepStrictEqual(serverData.value.data, data);
    assert.strictEqual(serverData.value.loading, false);
  });

  it("should initialize with both params and server data", () => {
    const config: StoreConfig = {
      params: { id: "123" },
      serverData: { name: "Test" },
    };
    initStore(config);
    assert.deepStrictEqual(params.value, { id: "123" });
    assert.deepStrictEqual(serverData.value.data, { name: "Test" });
  });
});

describe("setParams", () => {
  it("should update params signal", () => {
    setParams({ slug: "test-slug" });
    assert.deepStrictEqual(params.value, { slug: "test-slug" });
  });

  it("should replace existing params", () => {
    setParams({ a: "1" });
    setParams({ b: "2" });
    assert.deepStrictEqual(params.value, { b: "2" });
    assert.strictEqual((params.value as Record<string, string>).a, undefined);
  });

  it("should handle empty params", () => {
    setParams({ slug: "test" });
    setParams({});
    assert.deepStrictEqual(params.value, {});
  });
});

describe("setServerData", () => {
  it("should update server data signal", () => {
    const data = { title: "Hello World" };
    setServerData(data);
    assert.deepStrictEqual(serverData.value.data, data);
  });

  it("should set loading to false", () => {
    setServerData({ loaded: true });
    assert.strictEqual(serverData.value.loading, false);
  });

  it("should clear error", () => {
    setServerData({ success: true });
    assert.strictEqual(serverData.value.error, null);
  });

  it("should handle null data", () => {
    setServerData(null);
    assert.strictEqual(serverData.value.data, null);
  });

  it("should handle complex data structures", () => {
    const complexData = {
      posts: [
        { id: 1, title: "Post 1" },
        { id: 2, title: "Post 2" },
      ],
      meta: { total: 2, page: 1 },
    };
    setServerData(complexData);
    assert.deepStrictEqual(serverData.value.data, complexData);
  });
});

describe("setPathname", () => {
  it("should update pathname signal", () => {
    setPathname("/blog/hello-world");
    assert.strictEqual(pathname.value, "/blog/hello-world");
  });

  it("should handle root pathname", () => {
    setPathname("/");
    assert.strictEqual(pathname.value, "/");
  });

  it("should handle empty pathname", () => {
    setPathname("");
    assert.strictEqual(pathname.value, "");
  });
});

describe("resetStore", () => {
  it("should reset params to empty object", () => {
    setParams({ slug: "test" });
    resetStore();
    assert.deepStrictEqual(params.value, {});
  });

  it("should reset server data to initial state", () => {
    setServerData({ some: "data" });
    resetStore();
    assert.deepStrictEqual(serverData.value, {
      data: null,
      loading: false,
      error: null,
    });
  });

  it("should reset pathname to empty string", () => {
    setPathname("/some/path");
    resetStore();
    assert.strictEqual(pathname.value, "");
  });
});

describe("batch operations", () => {
  it("should batch multiple updates", () => {
    batch(() => {
      setParams({ a: "1" });
      setServerData({ b: "2" });
      setPathname("/test");
    });

    assert.deepStrictEqual(params.value, { a: "1" });
    assert.deepStrictEqual(serverData.value.data, { b: "2" });
    assert.strictEqual(pathname.value, "/test");
  });
});

describe("signal reactivity", () => {
  it("should create signals", () => {
    const count = signal(0);
    assert.strictEqual(count.value, 0);
    count.value = 1;
    assert.strictEqual(count.value, 1);
  });

  it("should create computed values", () => {
    const count = signal(2);
    const doubled = computed(() => count.value * 2);
    assert.strictEqual(doubled.value, 4);
    count.value = 5;
    assert.strictEqual(doubled.value, 10);
  });
});

describe("readonly signals", () => {
  it("params should be readonly", () => {
    // The params signal itself can be accessed but not directly modified
    assert.strictEqual(typeof params.value, "object");
  });

  it("serverData should be readonly", () => {
    assert.strictEqual(typeof serverData.value, "object");
    assert.ok("data" in serverData.value);
    assert.ok("loading" in serverData.value);
    assert.ok("error" in serverData.value);
  });

  it("pathname should be readonly", () => {
    assert.strictEqual(typeof pathname.value, "string");
  });
});
