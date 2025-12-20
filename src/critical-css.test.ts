import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { extractCriticalCss, generateCssFallback, generateAsyncCssLoader } from "./critical-css.ts";

describe("extractCriticalCss", () => {
  it("should concatenate and minify CSS from multiple files", async () => {
    const mockCss: Record<string, string> = {
      "/layout.css": `
        /* Layout styles */
        .container {
          max-width: 1200px;
          margin: 0 auto;
        }
      `,
      "/index.css": `
        .hero {
          padding: 20px;
        }
      `,
    };

    const result = await extractCriticalCss("/", ["/layout.css", "/index.css"], {
      readCss: async (path) => mockCss[path] ?? "",
      cache: false,
    });

    // Should be minified (no comments, collapsed whitespace)
    assert.ok(!result.includes("/*"));
    assert.ok(!result.includes("Layout styles"));
    // Should contain the actual CSS rules
    assert.ok(result.includes(".container"));
    assert.ok(result.includes(".hero"));
  });

  it("should respect maxSize limit", async () => {
    const largeCss = ".large { " + "a".repeat(10000) + " }";
    const mockCss: Record<string, string> = {
      "/large.css": largeCss,
      "/small.css": ".small { color: red; }",
    };

    const result = await extractCriticalCss("/", ["/large.css", "/small.css"], {
      readCss: async (path) => mockCss[path] ?? "",
      maxSize: 100, // Very small limit
      cache: false,
    });

    // Should only include content up to the limit
    assert.ok(result.length <= 100);
  });

  it("should use cached result on subsequent calls", async () => {
    let readCount = 0;
    const mockCss: Record<string, string> = {
      "/cached.css": ".cached { display: block; }",
    };

    const options = {
      readCss: async (path: string) => {
        readCount++;
        return mockCss[path] ?? "";
      },
      cache: true,
    };

    // First call - should read
    await extractCriticalCss("/cached-route", ["/cached.css"], options);
    const firstReadCount = readCount;

    // Second call - should use cache
    await extractCriticalCss("/cached-route", ["/cached.css"], options);

    // Read count should not have increased
    assert.strictEqual(readCount, firstReadCount);
  });

  it("should skip files that cannot be read", async () => {
    const mockCss: Record<string, string> = {
      "/valid.css": ".valid { color: blue; }",
    };

    const result = await extractCriticalCss("/error-route", ["/nonexistent.css", "/valid.css"], {
      readCss: async (path) => {
        if (!mockCss[path]) throw new Error("File not found");
        return mockCss[path];
      },
      cache: false,
    });

    // Should still include the valid file
    assert.ok(result.includes(".valid"));
  });

  it("should return empty string when all files fail", async () => {
    const result = await extractCriticalCss("/empty-route", ["/nonexistent.css"], {
      readCss: async () => {
        throw new Error("File not found");
      },
      cache: false,
    });

    assert.strictEqual(result, "");
  });

  it("should minify CSS properly", async () => {
    const verboseCss = `
      /* Comment to remove */
      .selector {
        color:   red;
        margin:  10px   20px;
      }
    `;

    const result = await extractCriticalCss("/minify-route", ["/test.css"], {
      readCss: async () => verboseCss,
      cache: false,
    });

    // Should not contain comments
    assert.ok(!result.includes("/*"));
    assert.ok(!result.includes("Comment"));
    // Should have collapsed whitespace
    assert.ok(!result.includes("  "));
  });
});

describe("generateCssFallback", () => {
  it("should generate noscript with link tags", () => {
    const stylesheets = ["/styles/main.css", "/styles/theme.css"];
    const result = generateCssFallback(stylesheets);

    assert.ok(result.includes("<noscript>"));
    assert.ok(result.includes("</noscript>"));
    assert.ok(result.includes('href="/styles/main.css"'));
    assert.ok(result.includes('href="/styles/theme.css"'));
    assert.ok(result.includes('rel="stylesheet"'));
  });

  it("should return empty noscript for empty array", () => {
    const result = generateCssFallback([]);
    assert.strictEqual(result, "<noscript></noscript>");
  });

  it("should handle single stylesheet", () => {
    const result = generateCssFallback(["/single.css"]);
    assert.ok(result.includes('href="/single.css"'));
    // Should only have one link tag
    assert.strictEqual((result.match(/<link/g) || []).length, 1);
  });
});

describe("generateAsyncCssLoader", () => {
  it("should generate script for async CSS loading", () => {
    const stylesheets = ["/async/styles.css", "/async/theme.css"];
    const result = generateAsyncCssLoader(stylesheets);

    assert.ok(result.includes("<script>"));
    assert.ok(result.includes("</script>"));
    assert.ok(result.includes("/async/styles.css"));
    assert.ok(result.includes("/async/theme.css"));
    assert.ok(result.includes("stylesheet"));
  });

  it("should return empty string for empty array", () => {
    const result = generateAsyncCssLoader([]);
    assert.strictEqual(result, "");
  });

  it("should create link elements dynamically", () => {
    const result = generateAsyncCssLoader(["/test.css"]);
    assert.ok(result.includes("createElement"));
    assert.ok(result.includes("appendChild"));
  });
});
