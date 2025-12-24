import { describe, it } from "node:test";
import assert from "node:assert";
import {
  isHmrRequest,
  handleHmrRequest,
  broadcastHmrUpdate,
  type HmrEventType,
} from "./hmr-server.ts";

describe("isHmrRequest", () => {
  it("should return true for GET /_hmr request", () => {
    const request = new Request("http://localhost:8080/_hmr", {
      method: "GET",
    });
    assert.strictEqual(isHmrRequest(request), true);
  });

  it("should return false for POST /_hmr request", () => {
    const request = new Request("http://localhost:8080/_hmr", {
      method: "POST",
    });
    assert.strictEqual(isHmrRequest(request), false);
  });

  it("should return false for other paths", () => {
    const request = new Request("http://localhost:8080/other", {
      method: "GET",
    });
    assert.strictEqual(isHmrRequest(request), false);
  });

  it("should return false for regular page requests", () => {
    const request = new Request("http://localhost:8080/");
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
  it("should be a function", () => {
    assert.strictEqual(typeof handleHmrRequest, "function");
  });

  it("should return SSE response with correct headers", async () => {
    const response = handleHmrRequest();

    assert.strictEqual(response.headers.get("Content-Type"), "text/event-stream");
    assert.strictEqual(response.headers.get("Cache-Control"), "no-cache");
    assert.strictEqual(response.headers.get("Connection"), "keep-alive");

    // Cancel stream to stop the heartbeat interval
    await response.body?.cancel();
  });

  it("should return a readable stream body", async () => {
    const response = handleHmrRequest();
    assert.ok(response.body instanceof ReadableStream);

    // Cancel stream to stop the heartbeat interval
    await response.body?.cancel();
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
    const message = JSON.stringify({
      type,
      path: undefined,
      timestamp: Date.now(),
    });
    const parsed = JSON.parse(message);

    assert.strictEqual(parsed.type, type);
    assert.strictEqual(parsed.path, undefined);
  });
});
