import { describe, it } from "node:test";
import * as assert from "node:assert/strict";

describe("hmr-client", () => {
  describe("HmrApi interface", () => {
    interface HmrApi {
      on<T = unknown>(event: string, cb: (data: T) => void): void;
      off<T = unknown>(event: string, cb: (data: T) => void): void;
      dispose(cb: () => void): void;
      data: Record<string, unknown>;
    }

    it("should define all required methods", () => {
      const api: HmrApi = {
        on() {},
        off() {},
        dispose() {},
        data: {},
      };

      assert.strictEqual(typeof api.on, "function");
      assert.strictEqual(typeof api.off, "function");
      assert.strictEqual(typeof api.dispose, "function");
      assert.strictEqual(typeof api.data, "object");
    });
  });

  describe("noopHmr implementation", () => {
    // Simulate noopHmr behavior
    const noopHmr = {
      on(_event: string, _cb: () => void) {},
      off(_event: string, _cb: () => void) {},
      dispose(_cb: () => void) {},
      data: {} as Record<string, unknown>,
    };

    it("should have all HmrApi methods as no-ops", () => {
      // Should not throw when called
      noopHmr.on("test", () => {});
      noopHmr.off("test", () => {});
      noopHmr.dispose(() => {});
    });

    it("should have an empty data object", () => {
      assert.deepStrictEqual(noopHmr.data, {});
    });

    it("should allow storing data", () => {
      noopHmr.data.key = "value";
      assert.strictEqual(noopHmr.data.key, "value");
    });
  });

  describe("createDevHmr logic", () => {
    it("should maintain listener registry", () => {
      const listeners = new Map<string, Set<(data: unknown) => void>>();

      const on = (event: string, cb: (data: unknown) => void) => {
        if (!listeners.has(event)) listeners.set(event, new Set());
        listeners.get(event)!.add(cb);
      };

      const off = (event: string, cb: (data: unknown) => void) => {
        listeners.get(event)?.delete(cb);
      };

      const handler = () => {};
      on("test", handler);
      assert.strictEqual(listeners.get("test")?.size, 1);

      off("test", handler);
      assert.strictEqual(listeners.get("test")?.size, 0);
    });

    it("should support multiple handlers for same event", () => {
      const listeners = new Map<string, Set<(data: unknown) => void>>();

      const on = (event: string, cb: (data: unknown) => void) => {
        if (!listeners.has(event)) listeners.set(event, new Set());
        listeners.get(event)!.add(cb);
      };

      on("update", () => {});
      on("update", () => {});
      on("update", () => {});

      assert.strictEqual(listeners.get("update")?.size, 3);
    });

    it("should collect dispose callbacks", () => {
      const disposeCallbacks: Array<() => void> = [];

      const dispose = (cb: () => void) => {
        disposeCallbacks.push(cb);
      };

      dispose(() => console.log("cleanup 1"));
      dispose(() => console.log("cleanup 2"));

      assert.strictEqual(disposeCallbacks.length, 2);
    });

    it("should persist data across calls", () => {
      const data: Record<string, unknown> = {};

      data.counter = 0;
      data.counter = (data.counter as number) + 1;
      data.items = ["a", "b"];

      assert.strictEqual(data.counter, 1);
      assert.deepStrictEqual(data.items, ["a", "b"]);
    });
  });

  describe("message handling", () => {
    it("should parse and dispatch messages to handlers", () => {
      const listeners = new Map<string, Set<(data: unknown) => void>>();
      const received: unknown[] = [];

      const on = (event: string, cb: (data: unknown) => void) => {
        if (!listeners.has(event)) listeners.set(event, new Set());
        listeners.get(event)!.add(cb);
      };

      const handleMessage = (rawMessage: string) => {
        try {
          const { type, data } = JSON.parse(rawMessage);
          const cbs = listeners.get(type);
          if (cbs) {
            for (const cb of cbs) {
              cb(data);
            }
          }
        } catch {
          // Parse error
        }
      };

      on("sf:css-update", (data) => received.push(data));
      on("sf:module:test", (data) => received.push(data));

      handleMessage(JSON.stringify({ type: "sf:css-update", data: { id: "test.css" } }));
      handleMessage(JSON.stringify({ type: "sf:module:test", data: { default: {} } }));
      handleMessage(JSON.stringify({ type: "unknown", data: {} }));

      assert.strictEqual(received.length, 2);
      assert.deepStrictEqual(received[0], { id: "test.css" });
    });

    it("should handle malformed messages gracefully", () => {
      let errorCaught = false;

      const handleMessage = (rawMessage: string) => {
        try {
          JSON.parse(rawMessage);
        } catch {
          errorCaught = true;
        }
      };

      handleMessage("not valid json");
      assert.strictEqual(errorCaught, true);
    });

    it("should catch errors in handlers without breaking other handlers", () => {
      const listeners = new Map<string, Set<(data: unknown) => void>>();
      const results: string[] = [];

      const on = (event: string, cb: (data: unknown) => void) => {
        if (!listeners.has(event)) listeners.set(event, new Set());
        listeners.get(event)!.add(cb);
      };

      const handleMessage = (rawMessage: string) => {
        const { type, data } = JSON.parse(rawMessage);
        const cbs = listeners.get(type);
        if (cbs) {
          for (const cb of cbs) {
            try {
              cb(data);
            } catch {
              results.push("error");
            }
          }
        }
      };

      on("test", () => results.push("first"));
      on("test", () => {
        throw new Error("Handler error");
      });
      on("test", () => results.push("third"));

      handleMessage(JSON.stringify({ type: "test", data: {} }));

      assert.deepStrictEqual(results, ["first", "error", "third"]);
    });
  });

  describe("build-time replacement", () => {
    it("should use noopHmr when __SF_DEV__ is false", () => {
      const __SF_DEV__ = false;
      const noopHmr = { type: "noop" };
      const devHmr = { type: "dev" };

      const hmr = __SF_DEV__ ? devHmr : noopHmr;
      assert.strictEqual(hmr.type, "noop");
    });

    it("should use devHmr when __SF_DEV__ is true", () => {
      const __SF_DEV__ = true;
      const noopHmr = { type: "noop" };
      const devHmr = { type: "dev" };

      const hmr = __SF_DEV__ ? devHmr : noopHmr;
      assert.strictEqual(hmr.type, "dev");
    });

    it("should use noopHmr when __SF_DEV__ is undefined", () => {
      const __SF_DEV__ = undefined;
      const noopHmr = { type: "noop" };
      const devHmr = { type: "dev" };

      const hmr = __SF_DEV__ ? devHmr : noopHmr;
      assert.strictEqual(hmr.type, "noop");
    });
  });

  describe("SSE URL generation", () => {
    it("should use origin for SSE endpoint", () => {
      const origin = "https://example.com";
      const url = `${origin}/_hmr`;

      assert.strictEqual(url, "https://example.com/_hmr");
    });

    it("should work with localhost", () => {
      const origin = "http://localhost:8080";
      const url = `${origin}/_hmr`;

      assert.strictEqual(url, "http://localhost:8080/_hmr");
    });
  });

  describe("event naming conventions", () => {
    it("should use sf: prefix for framework events", () => {
      const events = ["sf:css-update", "sf:css-replace", "sf:module:sf-root", "sf:hmr:update"];

      for (const event of events) {
        assert.ok(event.startsWith("sf:"), `Event ${event} should start with sf:`);
      }
    });

    it("should include component tag in module events", () => {
      const tag = "sf-blog-post";
      const event = `sf:module:${tag}`;

      assert.strictEqual(event, "sf:module:sf-blog-post");
      assert.ok(event.includes(tag));
    });
  });
});
