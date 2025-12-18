import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { isConsoleRequest, processConsoleLogs, generateClientScript } from "./console-forward.ts";

describe("isConsoleRequest", () => {
  it("should return true for POST to default endpoint", () => {
    const request = new Request("http://localhost/_console", { method: "POST" });
    assert.strictEqual(isConsoleRequest(request), true);
  });

  it("should return false for GET to default endpoint", () => {
    const request = new Request("http://localhost/_console", { method: "GET" });
    assert.strictEqual(isConsoleRequest(request), false);
  });

  it("should return false for POST to different endpoint", () => {
    const request = new Request("http://localhost/api/logs", { method: "POST" });
    assert.strictEqual(isConsoleRequest(request), false);
  });

  it("should return true for custom endpoint", () => {
    const request = new Request("http://localhost/custom-logs", { method: "POST" });
    assert.strictEqual(isConsoleRequest(request, { endpoint: "/custom-logs" }), true);
  });

  it("should return false for different path", () => {
    const request = new Request("http://localhost/", { method: "POST" });
    assert.strictEqual(isConsoleRequest(request), false);
  });

  it("should handle requests with query params", () => {
    const request = new Request("http://localhost/_console?foo=bar", { method: "POST" });
    assert.strictEqual(isConsoleRequest(request), true);
  });
});

describe("processConsoleLogs", () => {
  it("should process valid log request", async () => {
    const logs = [{ level: "log", message: "Test message", timestamp: new Date().toISOString() }];
    const request = new Request("http://localhost/_console", {
      method: "POST",
      body: JSON.stringify({ logs }),
      headers: { "Content-Type": "application/json" },
    });

    const response = await processConsoleLogs(request);
    assert.strictEqual(response.status, 200);

    const body = (await response.json()) as { success: boolean };
    assert.strictEqual(body.success, true);
  });

  it("should handle multiple logs", async () => {
    const logs = [
      { level: "log", message: "Message 1", timestamp: new Date().toISOString() },
      { level: "warn", message: "Message 2", timestamp: new Date().toISOString() },
      { level: "error", message: "Message 3", timestamp: new Date().toISOString() },
    ];
    const request = new Request("http://localhost/_console", {
      method: "POST",
      body: JSON.stringify({ logs }),
      headers: { "Content-Type": "application/json" },
    });

    const response = await processConsoleLogs(request);
    assert.strictEqual(response.status, 200);
  });

  it("should handle logs with stack traces", async () => {
    const logs = [
      {
        level: "error",
        message: "Error occurred",
        timestamp: new Date().toISOString(),
        stacks: ["at Function.test (file.js:10:5)", "at main (file.js:20:3)"],
      },
    ];
    const request = new Request("http://localhost/_console", {
      method: "POST",
      body: JSON.stringify({ logs }),
      headers: { "Content-Type": "application/json" },
    });

    const response = await processConsoleLogs(request);
    assert.strictEqual(response.status, 200);
  });

  it("should handle logs with extra data", async () => {
    const logs = [
      {
        level: "log",
        message: "Object logged",
        timestamp: new Date().toISOString(),
        extra: [{ foo: "bar" }],
      },
    ];
    const request = new Request("http://localhost/_console", {
      method: "POST",
      body: JSON.stringify({ logs }),
      headers: { "Content-Type": "application/json" },
    });

    const response = await processConsoleLogs(request);
    assert.strictEqual(response.status, 200);
  });

  it("should return 400 for invalid JSON", async () => {
    const request = new Request("http://localhost/_console", {
      method: "POST",
      body: "invalid json",
      headers: { "Content-Type": "application/json" },
    });

    const response = await processConsoleLogs(request);
    assert.strictEqual(response.status, 400);

    const body = (await response.json()) as { error: string };
    assert.strictEqual(body.error, "Invalid JSON");
  });

  it("should filter logs based on log level", async () => {
    const logs = [
      { level: "debug", message: "Debug message", timestamp: new Date().toISOString() },
      { level: "error", message: "Error message", timestamp: new Date().toISOString() },
    ];
    const request = new Request("http://localhost/_console", {
      method: "POST",
      body: JSON.stringify({ logs }),
      headers: { "Content-Type": "application/json" },
    });

    // With "error" threshold, only error logs should show (but request still succeeds)
    const response = await processConsoleLogs(request, "error");
    assert.strictEqual(response.status, 200);
  });

  it("should handle empty logs array", async () => {
    const request = new Request("http://localhost/_console", {
      method: "POST",
      body: JSON.stringify({ logs: [] }),
      headers: { "Content-Type": "application/json" },
    });

    const response = await processConsoleLogs(request);
    assert.strictEqual(response.status, 200);
  });
});

describe("generateClientScript", () => {
  it("should generate valid JavaScript", () => {
    const script = generateClientScript();
    assert.strictEqual(typeof script, "string");
    assert.ok(script.length > 0);
  });

  it("should include IIFE wrapper", () => {
    const script = generateClientScript();
    assert.ok(script.includes("(function()"));
    assert.ok(script.includes("})();"));
  });

  it("should include default endpoint", () => {
    const script = generateClientScript();
    assert.ok(script.includes("/_console"));
  });

  it("should use custom endpoint", () => {
    const script = generateClientScript({ endpoint: "/custom-logs" });
    assert.ok(script.includes("/custom-logs"));
  });

  it("should patch default console methods", () => {
    const script = generateClientScript();
    assert.ok(script.includes("console.log"));
    assert.ok(script.includes("console.warn"));
    assert.ok(script.includes("console.error"));
    assert.ok(script.includes("console.info"));
    assert.ok(script.includes("console.debug"));
  });

  it("should patch only specified console methods", () => {
    const script = generateClientScript({ levels: ["error", "warn"] });
    assert.ok(script.includes("console.error"));
    assert.ok(script.includes("console.warn"));
    // The original methods object still contains all methods
    assert.ok(script.includes("originalMethods"));
  });

  it("should include sendBeacon for sending logs", () => {
    const script = generateClientScript();
    assert.ok(script.includes("sendBeacon"));
  });

  it("should include log buffering", () => {
    const script = generateClientScript();
    assert.ok(script.includes("logBuffer"));
    assert.ok(script.includes("flushLogs"));
  });

  it("should include flush on beforeunload", () => {
    const script = generateClientScript();
    assert.ok(script.includes("beforeunload"));
  });

  it("should include periodic flush", () => {
    const script = generateClientScript();
    assert.ok(script.includes("setInterval"));
  });

  it("should handle stack traces option", () => {
    const scriptWithStacks = generateClientScript({ includeStacks: true });
    assert.ok(scriptWithStacks.includes("true"));

    const scriptWithoutStacks = generateClientScript({ includeStacks: false });
    assert.ok(scriptWithoutStacks.includes("false"));
  });

  it("should include original method bindings", () => {
    const script = generateClientScript();
    assert.ok(script.includes("console.log.bind(console)"));
    assert.ok(script.includes("console.warn.bind(console)"));
    assert.ok(script.includes("console.error.bind(console)"));
  });

  it("should include createLogEntry function", () => {
    const script = generateClientScript();
    assert.ok(script.includes("createLogEntry"));
  });

  it("should include timestamp in log entries", () => {
    const script = generateClientScript();
    assert.ok(script.includes("toISOString"));
  });

  it("should include url in log entries", () => {
    const script = generateClientScript();
    assert.ok(script.includes("window.location.href"));
  });
});
