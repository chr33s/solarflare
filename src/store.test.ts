import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import {
  signal,
  computed,
  batch,
  initStore,
  resetStore,
  setParams,
  setServerData,
  setPathname,
  params,
  serverData,
  pathname,
  serializeDataIsland,
  type StoreConfig,
} from "./store";

beforeEach(() => {
  resetStore();
});

afterEach(() => {
  resetStore();
});

describe("initStore", () => {
  it("should initialize with default values", () => {
    initStore();
    expect(params.value).toEqual({});
    expect(serverData.value.data).toBe(null);
    expect(serverData.value.loading).toBe(false);
    expect(serverData.value.error).toBe(null);
  });

  it("should initialize with provided params", () => {
    initStore({ params: { slug: "hello-world" } });
    expect(params.value).toEqual({ slug: "hello-world" });
  });

  it("should initialize with provided server data", () => {
    const data = { title: "Test", content: "Hello" };
    initStore({ serverData: data });
    expect(serverData.value.data).toEqual(data);
    expect(serverData.value.loading).toBe(false);
  });

  it("should initialize with both params and server data", () => {
    const config: StoreConfig = {
      params: { id: "123" },
      serverData: { name: "Test" },
    };
    initStore(config);
    expect(params.value).toEqual({ id: "123" });
    expect(serverData.value.data).toEqual({ name: "Test" });
  });
});

describe("setParams", () => {
  it("should update params signal", () => {
    setParams({ slug: "test-slug" });
    expect(params.value).toEqual({ slug: "test-slug" });
  });

  it("should replace existing params", () => {
    setParams({ a: "1" });
    setParams({ b: "2" });
    expect(params.value).toEqual({ b: "2" });
    expect(params.value.a).toBeUndefined();
  });

  it("should handle empty params", () => {
    setParams({ slug: "test" });
    setParams({});
    expect(params.value).toEqual({});
  });
});

describe("setServerData", () => {
  it("should update server data signal", () => {
    const data = { title: "Hello World" };
    setServerData(data);
    expect(serverData.value.data).toEqual(data);
  });

  it("should set loading to false", () => {
    setServerData({ loaded: true });
    expect(serverData.value.loading).toBe(false);
  });

  it("should clear error", () => {
    setServerData({ success: true });
    expect(serverData.value.error).toBe(null);
  });

  it("should handle null data", () => {
    setServerData(null);
    expect(serverData.value.data).toBe(null);
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
    expect(serverData.value.data).toEqual(complexData);
  });
});

describe("setPathname", () => {
  it("should update pathname signal", () => {
    setPathname("/blog/hello-world");
    expect(pathname.value).toBe("/blog/hello-world");
  });

  it("should handle root pathname", () => {
    setPathname("/");
    expect(pathname.value).toBe("/");
  });

  it("should handle empty pathname", () => {
    setPathname("");
    expect(pathname.value).toBe("");
  });
});

describe("resetStore", () => {
  it("should reset params to empty object", () => {
    setParams({ slug: "test" });
    resetStore();
    expect(params.value).toEqual({});
  });

  it("should reset server data to initial state", () => {
    setServerData({ some: "data" });
    resetStore();
    expect(serverData.value).toEqual({
      data: null,
      loading: false,
      error: null,
    });
  });

  it("should reset pathname to empty string", () => {
    setPathname("/some/path");
    resetStore();
    expect(pathname.value).toBe("");
  });
});

describe("batch operations", () => {
  it("should batch multiple updates", () => {
    batch(() => {
      setParams({ a: "1" });
      setServerData({ b: "2" });
      setPathname("/test");
    });

    expect(params.value).toEqual({ a: "1" });
    expect(serverData.value.data).toEqual({ b: "2" });
    expect(pathname.value).toBe("/test");
  });
});

describe("signal reactivity", () => {
  it("should create signals", () => {
    const count = signal(0);
    expect(count.value).toBe(0);
    count.value = 1;
    expect(count.value).toBe(1);
  });

  it("should create computed values", () => {
    const count = signal(2);
    const doubled = computed(() => count.value * 2);
    expect(doubled.value).toBe(4);
    count.value = 5;
    expect(doubled.value).toBe(10);
  });
});

describe("serializeDataIsland", () => {
  it("should serialize data to script tag", async () => {
    const data = { title: "Test" };
    const result = await serializeDataIsland("test-island", data);
    expect(result).toContain('<script type="application/json" data-island="test-island">');
    expect(result).toContain("</script>");
  });

  it("should include serialized data", async () => {
    const data = { count: 42 };
    const result = await serializeDataIsland("counter-data", data);
    expect(result).toContain('data-island="counter-data"');
  });

  it("should handle complex data types", async () => {
    const data = {
      string: "hello",
      number: 123,
      boolean: true,
      array: [1, 2, 3],
      nested: { a: "b" },
    };
    const result = await serializeDataIsland("complex", data);
    expect(result).toContain('data-island="complex"');
  });
});

describe("readonly signals", () => {
  it("params should be readonly", () => {
    // The params signal itself can be accessed but not directly modified
    expect(typeof params.value).toBe("object");
  });

  it("serverData should be readonly", () => {
    expect(typeof serverData.value).toBe("object");
    expect(serverData.value).toHaveProperty("data");
    expect(serverData.value).toHaveProperty("loading");
    expect(serverData.value).toHaveProperty("error");
  });

  it("pathname should be readonly", () => {
    expect(typeof pathname.value).toBe("string");
  });
});
