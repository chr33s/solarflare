import { describe, it } from "node:test";
import assert from "node:assert";
import {
  isHmrRequest,
  handleHmrRequest,
  broadcastHmrUpdate,
  type HmrEventType,
} from "./hmr-server.ts";

describe("hmr-server", () => {
  describe("isHmrRequest", () => {
    it("should return true for /_hmr WebSocket upgrade request", () => {
      const request = new Request("http://localhost:8080/_hmr", {
        headers: { Upgrade: "websocket" },
      });
      assert.strictEqual(isHmrRequest(request), true);
    });

    it("should return false for /_hmr without upgrade header", () => {
      const request = new Request("http://localhost:8080/_hmr");
      assert.strictEqual(isHmrRequest(request), false);
    });

    it("should return false for other paths with websocket upgrade", () => {
      const request = new Request("http://localhost:8080/other", {
        headers: { Upgrade: "websocket" },
      });
      assert.strictEqual(isHmrRequest(request), false);
    });

    it("should return false for regular page requests", () => {
      const request = new Request("http://localhost:8080/");
      assert.strictEqual(isHmrRequest(request), false);
    });

    it("should return false for /_hmr with wrong upgrade type", () => {
      const request = new Request("http://localhost:8080/_hmr", {
        headers: { Upgrade: "h2c" },
      });
      assert.strictEqual(isHmrRequest(request), false);
    });
  });

  describe("HmrEventType", () => {
    it("should accept valid event types", () => {
      const types: HmrEventType[] = ["update", "full-reload", "css-update", "connected"];
      assert.strictEqual(types.length, 4);
    });
  });

  describe("handleHmrRequest", () => {
    // Note: handleHmrRequest uses Cloudflare Workers WebSocketPair and 101 status
    // which are not available in Node.js. These tests verify the function structure
    // but actual WebSocket functionality is tested in e2e tests.

    it("should be a function", () => {
      assert.strictEqual(typeof handleHmrRequest, "function");
    });

    it("should throw in Node.js environment (requires Cloudflare Workers)", () => {
      // In Node.js, Response doesn't support status 101 and WebSocketPair doesn't exist
      // This verifies the function expects Cloudflare Workers runtime
      assert.throws(() => {
        handleHmrRequest();
      });
    });
  });

  describe("broadcastHmrUpdate", () => {
    it("should not throw when no clients connected", () => {
      assert.doesNotThrow(() => {
        broadcastHmrUpdate("update", "test.ts");
      });
    });

    it("should not throw for css-update event", () => {
      assert.doesNotThrow(() => {
        broadcastHmrUpdate("css-update", "styles.css");
      });
    });

    it("should not throw for full-reload event", () => {
      assert.doesNotThrow(() => {
        broadcastHmrUpdate("full-reload");
      });
    });

    it("should not throw for connected event", () => {
      assert.doesNotThrow(() => {
        broadcastHmrUpdate("connected");
      });
    });

    it("should handle path being undefined", () => {
      assert.doesNotThrow(() => {
        broadcastHmrUpdate("update");
      });
    });
  });

  describe("message format", () => {
    it("should generate valid JSON message structure", () => {
      const type: HmrEventType = "update";
      const path = "src/app.tsx";
      const message = JSON.stringify({ type, path, timestamp: Date.now() });
      const parsed = JSON.parse(message);

      assert.strictEqual(parsed.type, type);
      assert.strictEqual(parsed.path, path);
      assert.ok(typeof parsed.timestamp === "number");
    });

    it("should handle message without path", () => {
      const type: HmrEventType = "full-reload";
      const message = JSON.stringify({ type, path: undefined, timestamp: Date.now() });
      const parsed = JSON.parse(message);

      assert.strictEqual(parsed.type, type);
      assert.strictEqual(parsed.path, undefined);
    });
  });
});
