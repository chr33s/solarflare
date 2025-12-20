import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import {
  generateStaticShell,
  createEarlyFlushStream,
  generateResourceHints,
  type StreamingShell,
} from "./early-flush.ts";

describe("generateStaticShell", () => {
  it("should generate shell with default options", () => {
    const shell = generateStaticShell({});

    assert.ok(shell.preHead.includes("<!DOCTYPE html>"));
    assert.ok(shell.preHead.includes('<html lang="en">'));
    assert.ok(shell.preHead.includes('charset="UTF-8"'));
    assert.ok(shell.preHead.includes("width=device-width, initial-scale=1"));
    assert.ok(shell.preBody.includes("</head>"));
    assert.ok(shell.preBody.includes("<body>"));
    assert.strictEqual(shell.headMarker, "<!--SF: HEAD-->");
    assert.strictEqual(shell.bodyMarker, "<!--SF: BODY-->");
  });

  it("should use custom language", () => {
    const shell = generateStaticShell({ lang: "es" });
    assert.ok(shell.preHead.includes('<html lang="es">'));
  });

  it("should use custom charset", () => {
    const shell = generateStaticShell({ charset: "ISO-8859-1" });
    assert.ok(shell.preHead.includes('charset="ISO-8859-1"'));
  });

  it("should use custom viewport", () => {
    const customViewport = "width=device-width, initial-scale=1, maximum-scale=5";
    const shell = generateStaticShell({ viewport: customViewport });
    assert.ok(shell.preHead.includes(`content="${customViewport}"`));
  });

  it("should support all options together", () => {
    const shell = generateStaticShell({
      lang: "fr",
      charset: "UTF-16",
      viewport: "width=500",
    });

    assert.ok(shell.preHead.includes('<html lang="fr">'));
    assert.ok(shell.preHead.includes('charset="UTF-16"'));
    assert.ok(shell.preHead.includes('content="width=500"'));
  });
});

describe("createEarlyFlushStream", () => {
  it("should create a readable stream", () => {
    const shell = generateStaticShell({});
    const contentStream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("<div>Content</div>"));
        controller.close();
      },
    });

    const stream = createEarlyFlushStream(shell, {
      contentStream,
      headTags: "",
      bodyTags: "",
    });

    assert.ok(stream instanceof ReadableStream);
  });

  it("should flush shell immediately", async () => {
    const shell = generateStaticShell({});
    const contentStream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("<div>Test</div>"));
        controller.close();
      },
    });

    const stream = createEarlyFlushStream(shell, {
      contentStream,
      headTags: "<title>Test</title>",
      bodyTags: '<script src="/app.js"></script>',
    });

    const reader = stream.getReader();
    const chunks: string[] = [];
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(decoder.decode(value));
    }

    const html = chunks.join("");

    // Should include doctype and html structure
    assert.ok(html.includes("<!DOCTYPE html>"));
    // Should include head tags
    assert.ok(html.includes("<title>Test</title>"));
    // Should include body content
    assert.ok(html.includes("<div>Test</div>"));
    // Should include body tags
    assert.ok(html.includes('<script src="/app.js"></script>'));
    // Should close properly
    assert.ok(html.includes("</body></html>"));
  });

  it("should include critical CSS in head", async () => {
    const shell = generateStaticShell({});
    const contentStream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.close();
      },
    });

    const stream = createEarlyFlushStream(shell, {
      contentStream,
      headTags: "",
      bodyTags: "",
      criticalCss: ".critical { color: red; }",
    });

    const reader = stream.getReader();
    const chunks: string[] = [];
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(decoder.decode(value));
    }

    const html = chunks.join("");
    assert.ok(html.includes("<style>.critical { color: red; }</style>"));
  });

  it("should include preload hints", async () => {
    const shell = generateStaticShell({});
    const contentStream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.close();
      },
    });

    const preloadHints = '<link rel="preload" href="/font.woff2" as="font">';

    const stream = createEarlyFlushStream(shell, {
      contentStream,
      headTags: "",
      bodyTags: "",
      preloadHints,
    });

    const reader = stream.getReader();
    const chunks: string[] = [];
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(decoder.decode(value));
    }

    const html = chunks.join("");
    assert.ok(html.includes(preloadHints));
  });
});

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

describe("StreamingShell type", () => {
  it("should satisfy StreamingShell interface", () => {
    const shell: StreamingShell = {
      preHead: "<!DOCTYPE html><html><head>",
      preBody: "</head><body>",
      headMarker: "<!--HEAD-->",
      bodyMarker: "<!--BODY-->",
    };

    assert.ok(typeof shell.preHead === "string");
    assert.ok(typeof shell.preBody === "string");
    assert.ok(typeof shell.headMarker === "string");
    assert.ok(typeof shell.bodyMarker === "string");
  });
});
