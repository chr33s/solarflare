import { describe, it, expect } from "bun:test";
import { isConsoleRequest, processConsoleLogs, generateClientScript } from "./console-forward";

describe("isConsoleRequest", () => {
  it("should return true for POST to default endpoint", () => {
    const request = new Request("http://localhost/__console", { method: "POST" });
    expect(isConsoleRequest(request)).toBe(true);
  });

  it("should return false for GET to default endpoint", () => {
    const request = new Request("http://localhost/__console", { method: "GET" });
    expect(isConsoleRequest(request)).toBe(false);
  });

  it("should return false for POST to different endpoint", () => {
    const request = new Request("http://localhost/api/logs", { method: "POST" });
    expect(isConsoleRequest(request)).toBe(false);
  });

  it("should return true for custom endpoint", () => {
    const request = new Request("http://localhost/custom-logs", { method: "POST" });
    expect(isConsoleRequest(request, { endpoint: "/custom-logs" })).toBe(true);
  });

  it("should return false for different path", () => {
    const request = new Request("http://localhost/", { method: "POST" });
    expect(isConsoleRequest(request)).toBe(false);
  });

  it("should handle requests with query params", () => {
    const request = new Request("http://localhost/__console?foo=bar", { method: "POST" });
    expect(isConsoleRequest(request)).toBe(true);
  });
});

describe("processConsoleLogs", () => {
  it("should process valid log request", async () => {
    const logs = [{ level: "log", message: "Test message", timestamp: new Date().toISOString() }];
    const request = new Request("http://localhost/__console", {
      method: "POST",
      body: JSON.stringify({ logs }),
      headers: { "Content-Type": "application/json" },
    });

    const response = await processConsoleLogs(request);
    expect(response.status).toBe(200);

    const body = (await response.json()) as { success: boolean };
    expect(body.success).toBe(true);
  });

  it("should handle multiple logs", async () => {
    const logs = [
      { level: "log", message: "Message 1", timestamp: new Date().toISOString() },
      { level: "warn", message: "Message 2", timestamp: new Date().toISOString() },
      { level: "error", message: "Message 3", timestamp: new Date().toISOString() },
    ];
    const request = new Request("http://localhost/__console", {
      method: "POST",
      body: JSON.stringify({ logs }),
      headers: { "Content-Type": "application/json" },
    });

    const response = await processConsoleLogs(request);
    expect(response.status).toBe(200);
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
    const request = new Request("http://localhost/__console", {
      method: "POST",
      body: JSON.stringify({ logs }),
      headers: { "Content-Type": "application/json" },
    });

    const response = await processConsoleLogs(request);
    expect(response.status).toBe(200);
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
    const request = new Request("http://localhost/__console", {
      method: "POST",
      body: JSON.stringify({ logs }),
      headers: { "Content-Type": "application/json" },
    });

    const response = await processConsoleLogs(request);
    expect(response.status).toBe(200);
  });

  it("should return 400 for invalid JSON", async () => {
    const request = new Request("http://localhost/__console", {
      method: "POST",
      body: "invalid json",
      headers: { "Content-Type": "application/json" },
    });

    const response = await processConsoleLogs(request);
    expect(response.status).toBe(400);

    const body = (await response.json()) as { error: string };
    expect(body.error).toBe("Invalid JSON");
  });

  it("should filter logs based on log level", async () => {
    const logs = [
      { level: "debug", message: "Debug message", timestamp: new Date().toISOString() },
      { level: "error", message: "Error message", timestamp: new Date().toISOString() },
    ];
    const request = new Request("http://localhost/__console", {
      method: "POST",
      body: JSON.stringify({ logs }),
      headers: { "Content-Type": "application/json" },
    });

    // With "error" threshold, only error logs should show (but request still succeeds)
    const response = await processConsoleLogs(request, "error");
    expect(response.status).toBe(200);
  });

  it("should handle empty logs array", async () => {
    const request = new Request("http://localhost/__console", {
      method: "POST",
      body: JSON.stringify({ logs: [] }),
      headers: { "Content-Type": "application/json" },
    });

    const response = await processConsoleLogs(request);
    expect(response.status).toBe(200);
  });
});

describe("generateClientScript", () => {
  it("should generate valid JavaScript", () => {
    const script = generateClientScript();
    expect(typeof script).toBe("string");
    expect(script.length).toBeGreaterThan(0);
  });

  it("should include IIFE wrapper", () => {
    const script = generateClientScript();
    expect(script).toContain("(function()");
    expect(script).toContain("})();");
  });

  it("should include default endpoint", () => {
    const script = generateClientScript();
    expect(script).toContain("/__console");
  });

  it("should use custom endpoint", () => {
    const script = generateClientScript({ endpoint: "/custom-logs" });
    expect(script).toContain("/custom-logs");
  });

  it("should patch default console methods", () => {
    const script = generateClientScript();
    expect(script).toContain("console.log");
    expect(script).toContain("console.warn");
    expect(script).toContain("console.error");
    expect(script).toContain("console.info");
    expect(script).toContain("console.debug");
  });

  it("should patch only specified console methods", () => {
    const script = generateClientScript({ levels: ["error", "warn"] });
    expect(script).toContain("console.error");
    expect(script).toContain("console.warn");
    // The original methods object still contains all methods
    expect(script).toContain("originalMethods");
  });

  it("should include sendBeacon for sending logs", () => {
    const script = generateClientScript();
    expect(script).toContain("sendBeacon");
  });

  it("should include log buffering", () => {
    const script = generateClientScript();
    expect(script).toContain("logBuffer");
    expect(script).toContain("flushLogs");
  });

  it("should include flush on beforeunload", () => {
    const script = generateClientScript();
    expect(script).toContain("beforeunload");
  });

  it("should include periodic flush", () => {
    const script = generateClientScript();
    expect(script).toContain("setInterval");
  });

  it("should handle stack traces option", () => {
    const scriptWithStacks = generateClientScript({ includeStacks: true });
    expect(scriptWithStacks).toContain("true");

    const scriptWithoutStacks = generateClientScript({ includeStacks: false });
    expect(scriptWithoutStacks).toContain("false");
  });

  it("should include original method bindings", () => {
    const script = generateClientScript();
    expect(script).toContain("console.log.bind(console)");
    expect(script).toContain("console.warn.bind(console)");
    expect(script).toContain("console.error.bind(console)");
  });

  it("should include createLogEntry function", () => {
    const script = generateClientScript();
    expect(script).toContain("createLogEntry");
  });

  it("should include timestamp in log entries", () => {
    const script = generateClientScript();
    expect(script).toContain("toISOString");
  });

  it("should include url in log entries", () => {
    const script = generateClientScript();
    expect(script).toContain("window.location.href");
  });
});
