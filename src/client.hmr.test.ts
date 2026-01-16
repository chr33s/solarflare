import { describe, it, afterEach } from "node:test";
import * as assert from "node:assert/strict";

function importWithFreshCache(relPath: string): Promise<any> {
  const href = new URL(relPath, import.meta.url).href;
  return import(`${href}?t=${Math.random()}`);
}

describe("client.hmr", () => {
  const prevDev = (globalThis as any).__SF_DEV__;
  const prevEventSource = (globalThis as any).EventSource;
  const prevLocation = (globalThis as any).location;

  afterEach(() => {
    (globalThis as any).__SF_DEV__ = prevDev;
    (globalThis as any).EventSource = prevEventSource;
    (globalThis as any).location = prevLocation;
  });

  it("exports a no-op client by default", async () => {
    delete (globalThis as any).__SF_DEV__;
    const { hmr } = await importWithFreshCache("./client.hmr.ts");

    assert.strictEqual(typeof hmr.on, "function");
    assert.strictEqual(typeof hmr.off, "function");
    assert.strictEqual(typeof hmr.dispose, "function");
    assert.strictEqual(typeof hmr.data, "object");

    hmr.on("sf:test", () => {});
    hmr.off("sf:test", () => {});
    hmr.dispose(() => {});

    hmr.data.answer = 42;
    assert.strictEqual(hmr.data.answer, 42);
  });

  it("dispatches parsed SSE messages in dev mode", async () => {
    (globalThis as any).__SF_DEV__ = true;
    (globalThis as any).location = { origin: "http://localhost:1234" };

    const instances: any[] = [];
    class MockEventSource {
      url: string;
      onopen: null | (() => void) = null;
      onmessage: null | ((e: { data: string }) => void) = null;
      onerror: null | (() => void) = null;

      constructor(url: string) {
        this.url = url;
        instances.push(this);
      }
    }

    (globalThis as any).EventSource = MockEventSource;

    const { hmr } = await importWithFreshCache("./client.hmr.ts");
    assert.strictEqual(instances.length, 1);
    assert.strictEqual(instances[0].url, "http://localhost:1234/_hmr");

    const received: any[] = [];
    const handler = (payload: any) => received.push(payload);
    hmr.on("sf:css-update", handler);

    instances[0].onmessage?.({
      data: JSON.stringify({
        type: "sf:css-update",
        id: "x.css",
        css: ".a { color: red; }",
      }),
    });

    assert.deepStrictEqual(received, [{ id: "x.css", css: ".a { color: red; }" }]);
    hmr.off("sf:css-update", handler);
  });

  it("isolates handler errors so other handlers still run", async () => {
    (globalThis as any).__SF_DEV__ = true;
    (globalThis as any).location = { origin: "http://localhost:1234" };

    const instances: any[] = [];
    class MockEventSource {
      url: string;
      onmessage: null | ((e: { data: string }) => void) = null;
      constructor(url: string) {
        this.url = url;
        instances.push(this);
      }
    }

    (globalThis as any).EventSource = MockEventSource;
    const { hmr } = await importWithFreshCache("./client.hmr.ts");

    const ran: string[] = [];
    hmr.on("sf:test", () => {
      ran.push("first");
    });
    hmr.on("sf:test", () => {
      throw new Error("boom");
    });
    hmr.on("sf:test", () => {
      ran.push("third");
    });

    instances[0].onmessage?.({
      data: JSON.stringify({ type: "sf:test", ok: true }),
    });
    assert.deepStrictEqual(ran, ["first", "third"]);
  });
});
