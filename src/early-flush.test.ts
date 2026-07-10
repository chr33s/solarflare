import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { generateResourceHints } from "./early-flush.ts";

describe("generateResourceHints", () => {
  it("should generate empty string for no options", () => {
    const result = generateResourceHints({});
    assert.strictEqual(result, "");
  });

  it("should generate preconnect hints", () => {
    const result = generateResourceHints({
      preconnect: ["https://fonts.googleapis.com", "https://api.example.com"],
    });

    assert.ok(result.includes('rel="preconnect"'));
    assert.ok(result.includes('href="https://fonts.googleapis.com"'));
    assert.ok(result.includes('href="https://api.example.com"'));
    assert.ok(result.includes("crossorigin"));
  });

  it("should generate dns-prefetch hints", () => {
    const result = generateResourceHints({
      dnsPrefetch: ["https://analytics.example.com"],
    });

    assert.ok(result.includes('rel="dns-prefetch"'));
    assert.ok(result.includes('href="https://analytics.example.com"'));
  });

  it("should generate stylesheet preload hints", () => {
    const result = generateResourceHints({
      stylesheets: ["/styles/main.css", "/styles/theme.css"],
    });

    assert.ok(result.includes('rel="preload"'));
    assert.ok(result.includes('as="style"'));
    assert.ok(result.includes('href="/styles/main.css"'));
    assert.ok(result.includes('href="/styles/theme.css"'));
  });

  it("should generate modulepreload hints for scripts", () => {
    const result = generateResourceHints({
      scripts: ["/app.js", "/vendor.js"],
    });

    assert.ok(result.includes('rel="modulepreload"'));
    assert.ok(result.includes('href="/app.js"'));
    assert.ok(result.includes('href="/vendor.js"'));
  });

  it("should combine all hint types", () => {
    const result = generateResourceHints({
      preconnect: ["https://cdn.example.com"],
      dnsPrefetch: ["https://tracking.example.com"],
      stylesheets: ["/main.css"],
      scripts: ["/app.js"],
    });

    assert.ok(result.includes('rel="preconnect"'));
    assert.ok(result.includes('rel="dns-prefetch"'));
    assert.ok(result.includes('rel="preload"'));
    assert.ok(result.includes('rel="modulepreload"'));
  });

  it("should output hints in correct order (preconnect first)", () => {
    const result = generateResourceHints({
      scripts: ["/app.js"],
      preconnect: ["https://cdn.example.com"],
    });

    const preconnectIndex = result.indexOf("preconnect");
    const modulepreloadIndex = result.indexOf("modulepreload");

    // Preconnect should come before modulepreload
    assert.ok(preconnectIndex < modulepreloadIndex);
  });
});
