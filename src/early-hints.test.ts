import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import {
  generateEarlyHintsHeader,
  collectEarlyHints,
  handleWithEarlyHints,
  type EarlyHint,
} from "./early-hints.ts";

describe("generateEarlyHintsHeader", () => {
  it("should generate empty string for no hints", () => {
    const result = generateEarlyHintsHeader([]);
    assert.strictEqual(result, "");
  });

  it("should generate simple preload hint", () => {
    const hints: EarlyHint[] = [{ href: "/styles.css", rel: "preload", as: "style" }];
    const result = generateEarlyHintsHeader(hints);

    assert.ok(result.includes("</styles.css>"));
    assert.ok(result.includes("rel=preload"));
    assert.ok(result.includes("as=style"));
  });

  it("should generate modulepreload hint", () => {
    const hints: EarlyHint[] = [{ href: "/app.js", rel: "modulepreload" }];
    const result = generateEarlyHintsHeader(hints);

    assert.ok(result.includes("</app.js>"));
    assert.ok(result.includes("rel=modulepreload"));
  });

  it("should generate preconnect hint with crossorigin", () => {
    const hints: EarlyHint[] = [
      { href: "https://fonts.googleapis.com", rel: "preconnect", crossorigin: "anonymous" },
    ];
    const result = generateEarlyHintsHeader(hints);

    assert.ok(result.includes("<https://fonts.googleapis.com>"));
    assert.ok(result.includes("rel=preconnect"));
    assert.ok(result.includes("crossorigin=anonymous"));
  });

  it("should generate dns-prefetch hint", () => {
    const hints: EarlyHint[] = [{ href: "https://api.example.com", rel: "dns-prefetch" }];
    const result = generateEarlyHintsHeader(hints);

    assert.ok(result.includes("<https://api.example.com>"));
    assert.ok(result.includes("rel=dns-prefetch"));
  });

  it("should include type when specified", () => {
    const hints: EarlyHint[] = [
      {
        href: "/font.woff2",
        rel: "preload",
        as: "font",
        crossorigin: "anonymous",
        type: "font/woff2",
      },
    ];
    const result = generateEarlyHintsHeader(hints);

    assert.ok(result.includes('type="font/woff2"'));
  });

  it("should join multiple hints with comma", () => {
    const hints: EarlyHint[] = [
      { href: "/styles.css", rel: "preload", as: "style" },
      { href: "/app.js", rel: "modulepreload" },
    ];
    const result = generateEarlyHintsHeader(hints);

    assert.ok(result.includes(", "));
    assert.ok(result.includes("</styles.css>"));
    assert.ok(result.includes("</app.js>"));
  });
});

describe("collectEarlyHints", () => {
  it("should return empty array for no options", () => {
    const hints = collectEarlyHints({});
    assert.deepStrictEqual(hints, []);
  });

  it("should collect preconnect origins", () => {
    const hints = collectEarlyHints({
      preconnectOrigins: ["https://fonts.googleapis.com", "https://api.example.com"],
    });

    assert.strictEqual(hints.length, 2);
    assert.strictEqual(hints[0].rel, "preconnect");
    assert.strictEqual(hints[0].href, "https://fonts.googleapis.com");
    assert.strictEqual(hints[0].crossorigin, "anonymous");
  });

  it("should collect font preloads", () => {
    const hints = collectEarlyHints({
      fonts: ["/fonts/roboto.woff2", "/fonts/icons.woff"],
    });

    assert.strictEqual(hints.length, 2);
    assert.strictEqual(hints[0].rel, "preload");
    assert.strictEqual(hints[0].as, "font");
    assert.strictEqual(hints[0].crossorigin, "anonymous");
  });

  it("should collect stylesheet preloads", () => {
    const hints = collectEarlyHints({
      stylesheets: ["/main.css", "/theme.css"],
    });

    assert.strictEqual(hints.length, 2);
    assert.strictEqual(hints[0].rel, "preload");
    assert.strictEqual(hints[0].as, "style");
  });

  it("should collect script modulepreload", () => {
    const hints = collectEarlyHints({
      scriptPath: "/app.js",
    });

    assert.strictEqual(hints.length, 1);
    assert.strictEqual(hints[0].rel, "modulepreload");
    assert.strictEqual(hints[0].href, "/app.js");
  });

  it("should order hints correctly (preconnect > fonts > stylesheets > scripts)", () => {
    const hints = collectEarlyHints({
      scriptPath: "/app.js",
      stylesheets: ["/main.css"],
      fonts: ["/font.woff2"],
      preconnectOrigins: ["https://cdn.example.com"],
    });

    assert.strictEqual(hints.length, 4);
    assert.strictEqual(hints[0].rel, "preconnect");
    assert.strictEqual(hints[1].as, "font");
    assert.strictEqual(hints[2].as, "style");
    assert.strictEqual(hints[3].rel, "modulepreload");
  });
});

describe("handleWithEarlyHints", () => {
  it("should add Link header to response", async () => {
    const mockHandler = async () => new Response("Hello", { status: 200 });
    const getHints = () => [{ href: "/app.js", rel: "modulepreload" } as EarlyHint];

    const request = new Request("http://localhost/");
    const response = await handleWithEarlyHints(request, mockHandler, getHints);

    assert.strictEqual(response.status, 200);
    const linkHeader = response.headers.get("Link");
    assert.ok(linkHeader);
    assert.ok(linkHeader.includes("</app.js>"));
    assert.ok(linkHeader.includes("rel=modulepreload"));
  });

  it("should preserve original response body", async () => {
    const mockHandler = async () => new Response("Original body", { status: 200 });
    const getHints = () => [{ href: "/app.js", rel: "modulepreload" } as EarlyHint];

    const request = new Request("http://localhost/");
    const response = await handleWithEarlyHints(request, mockHandler, getHints);

    const body = await response.text();
    assert.strictEqual(body, "Original body");
  });

  it("should preserve original response status", async () => {
    const mockHandler = async () => new Response("Created", { status: 201, statusText: "Created" });
    const getHints = () => [{ href: "/app.js", rel: "modulepreload" } as EarlyHint];

    const request = new Request("http://localhost/");
    const response = await handleWithEarlyHints(request, mockHandler, getHints);

    assert.strictEqual(response.status, 201);
    assert.strictEqual(response.statusText, "Created");
  });

  it("should preserve existing headers", async () => {
    const mockHandler = async () =>
      new Response("Test", {
        headers: { "X-Custom": "value", "Content-Type": "text/plain" },
      });
    const getHints = () => [{ href: "/app.js", rel: "modulepreload" } as EarlyHint];

    const request = new Request("http://localhost/");
    const response = await handleWithEarlyHints(request, mockHandler, getHints);

    assert.strictEqual(response.headers.get("X-Custom"), "value");
    assert.strictEqual(response.headers.get("Content-Type"), "text/plain");
    assert.ok(response.headers.get("Link"));
  });

  it("should not add Link header when no hints", async () => {
    const mockHandler = async () => new Response("Test");
    const getHints = () => [] as EarlyHint[];

    const request = new Request("http://localhost/");
    const response = await handleWithEarlyHints(request, mockHandler, getHints);

    assert.strictEqual(response.headers.get("Link"), null);
  });

  it("should pass URL to getHints function", async () => {
    const mockHandler = async () => new Response("Test");
    let receivedUrl: URL | undefined;

    const getHints = (url: URL) => {
      receivedUrl = url;
      return [];
    };

    const request = new Request("http://localhost/blog/post-1");
    await handleWithEarlyHints(request, mockHandler, getHints);

    assert.ok(receivedUrl);
    assert.strictEqual(receivedUrl.pathname, "/blog/post-1");
  });
});

describe("EarlyHint type", () => {
  it("should accept valid preload hint", () => {
    const hint: EarlyHint = {
      href: "/styles.css",
      rel: "preload",
      as: "style",
    };
    assert.strictEqual(hint.rel, "preload");
  });

  it("should accept valid modulepreload hint", () => {
    const hint: EarlyHint = {
      href: "/app.js",
      rel: "modulepreload",
    };
    assert.strictEqual(hint.rel, "modulepreload");
  });

  it("should accept valid preconnect hint", () => {
    const hint: EarlyHint = {
      href: "https://cdn.example.com",
      rel: "preconnect",
      crossorigin: "anonymous",
    };
    assert.strictEqual(hint.rel, "preconnect");
  });

  it("should accept valid dns-prefetch hint", () => {
    const hint: EarlyHint = {
      href: "https://analytics.example.com",
      rel: "dns-prefetch",
    };
    assert.strictEqual(hint.rel, "dns-prefetch");
  });

  it("should accept font preload with all attributes", () => {
    const hint: EarlyHint = {
      href: "/font.woff2",
      rel: "preload",
      as: "font",
      crossorigin: "anonymous",
      type: "font/woff2",
    };
    assert.strictEqual(hint.as, "font");
    assert.strictEqual(hint.type, "font/woff2");
  });
});
