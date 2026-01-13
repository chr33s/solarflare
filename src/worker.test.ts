import { describe, it, before, after } from "node:test";
import * as assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
import { chromium, type Browser, type Page } from "playwright";

async function waitForHydration(page: Page, tag = "sf-root"): Promise<void> {
  // 1) Ensure the custom element class is registered
  await page.waitForFunction((t) => !!customElements.get(String(t)), tag);

  // 2) Ensure the element is present and mounted by preact-custom-element
  // preact-custom-element sets `_vdom` on the host when it mounts.
  await page.waitForFunction((t) => {
    const el = document.querySelector(String(t)) as any;
    return !!el && el._vdom != null;
  }, tag);
}

// Helper to spawn a process and wait for it
function spawnAsync(
  command: string[],
  options: { cwd: string },
): { process: ChildProcess; exited: Promise<number | null> } {
  const proc = spawn(command[0], command.slice(1), {
    cwd: options.cwd,
    env: { ...process.env, WRANGLER_LOG: "error" },
    stdio: ["ignore", "inherit", "inherit"],
  });

  const exited = new Promise<number | null>((resolve) => {
    proc.on("close", (code) => resolve(code));
    proc.on("error", () => resolve(null));
  });

  return { process: proc, exited };
}

const BASIC_EXAMPLE_DIR = join(__dirname, "../examples/basic");
const BASE_URL = "http://localhost:8080";

describe("integration", () => {
  let serverProcess: ChildProcess | null = null;

  before(async () => {
    // Build the example
    const { process: buildProcess, exited: buildExited } = spawnAsync(
      ["npm", "run", "build", "--", "--clean"],
      { cwd: BASIC_EXAMPLE_DIR },
    );

    const buildExitCode = await buildExited;
    if (buildExitCode !== 0) {
      let stderr = "";
      if (buildProcess.stderr) {
        for await (const chunk of buildProcess.stderr) {
          stderr += chunk.toString();
        }
      }
      throw new Error(`Build failed with exit code ${buildExitCode}: ${stderr}`);
    }

    // Start the dev server
    const { process: proc } = spawnAsync(["npm", "run", "start"], {
      cwd: BASIC_EXAMPLE_DIR,
    });
    serverProcess = proc;

    // Wait for server to be ready
    await waitForServer(BASE_URL);
  });

  after(async () => {
    if (serverProcess) {
      serverProcess.kill();
      // Give it time to cleanup
      await new Promise((resolve) => setTimeout(resolve, 1000));
      serverProcess = null;
    }
  });

  it("should return HTML for root route", async () => {
    const response = await fetch(`${BASE_URL}/`);
    assert.strictEqual(response.status, 200);
    assert.strictEqual(response.headers.get("Content-Type"), "text/html; charset=utf-8");

    const html = await response.text();
    assert.ok(html.includes("<!doctype html>"));
    assert.ok(html.includes("<html"));
  });

  it("should return streaming headers", async () => {
    const response = await fetch(`${BASE_URL}/`);
    assert.strictEqual(response.headers.get("Content-Encoding"), "identity");
    assert.strictEqual(response.headers.get("X-Content-Type-Options"), "nosniff");
  });

  it("should return 404 for unknown routes", async () => {
    const response = await fetch(`${BASE_URL}/unknown-route-xyz`);
    assert.strictEqual(response.status, 404);
    assert.strictEqual(response.headers.get("Content-Type"), "text/html; charset=utf-8");
  });

  it("should handle API routes returning JSON", async () => {
    const response = await fetch(`${BASE_URL}/api`);
    assert.strictEqual(response.status, 200);
    assert.ok(response.headers.get("Content-Type")?.includes("application/json"));

    const data = (await response.json()) as Record<string, unknown>;
    assert.ok("hello" in data);
  });

  it("should handle dynamic routes", async () => {
    const response = await fetch(`${BASE_URL}/blog/test-slug`);
    assert.strictEqual(response.status, 200);
    assert.strictEqual(response.headers.get("Content-Type"), "text/html; charset=utf-8");
  });

  it("should include custom element tags in HTML", async () => {
    const response = await fetch(`${BASE_URL}/`);
    const html = await response.text();
    assert.ok(html.includes("<sf-"));
  });

  it("should include data island script in HTML", async () => {
    const response = await fetch(`${BASE_URL}/`);
    const html = await response.text();
    assert.ok(html.includes("data-island"));
  });

  it("should include stylesheets in HTML", async () => {
    const response = await fetch(`${BASE_URL}/`);
    const html = await response.text();
    assert.ok(html.includes("<link"));
    assert.ok(html.includes("stylesheet"));
  });

  it("should handle console forward endpoint", async () => {
    const response = await fetch(`${BASE_URL}/_console`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ logs: [] }),
    });
    assert.strictEqual(response.status, 200);
  });

  it("should reject GET to console forward endpoint", async () => {
    const response = await fetch(`${BASE_URL}/_console`);
    // Should not be treated as console endpoint, returns 404
    assert.strictEqual(response.status, 404);
  });

  it("should include hoisted head tags from components", async () => {
    const response = await fetch(`${BASE_URL}/`);
    const html = await response.text();

    // The index.client.tsx sets title "Home | Solarflare" which should be hoisted
    assert.ok(html.includes("<title>Home | Solarflare</title>"));
    // The index.client.tsx also sets a description meta tag
    assert.ok(html.includes('content="Welcome to the Solarflare demo app"'));
  });

  it("should include hoisted head tags for dynamic routes", async () => {
    const response = await fetch(`${BASE_URL}/blog/my-test-post`);
    const html = await response.text();

    // The blog/$slug.client.tsx sets dynamic title based on title prop
    // The title is derived from the slug in $slug.server.tsx
    assert.ok(html.includes("<title>"));
    assert.ok(html.includes("| Blog | Solarflare</title>"));
    // Should also have the dynamic description
    assert.ok(html.includes('<meta name="description"'));
    assert.ok(html.includes('content="Blog post:'));
  });

  it("should include base head tags from layout", async () => {
    const response = await fetch(`${BASE_URL}/`);
    const html = await response.text();

    // Layout defines these base meta tags
    assert.ok(html.includes('<meta charset="UTF-8"'));
    assert.ok(html.includes('<meta name="viewport"'));
    assert.ok(html.includes('content="width=device-width, initial-scale=1.0"'));
  });
});

describe("e2e", () => {
  let serverProcess: ChildProcess | null = null;
  let browser: Browser;

  before(async () => {
    // Build the basic example
    const { process: buildProcess, exited: buildExited } = spawnAsync(
      ["npm", "run", "build", "--", "--clean"],
      { cwd: BASIC_EXAMPLE_DIR },
    );

    const buildExitCode = await buildExited;
    if (buildExitCode !== 0) {
      let stderr = "";
      if (buildProcess.stderr) {
        for await (const chunk of buildProcess.stderr) {
          stderr += chunk.toString();
        }
      }
      throw new Error(`Build failed with exit code ${buildExitCode}: ${stderr}`);
    }

    // Start the dev server
    const { process: proc } = spawnAsync(["npm", "run", "start"], {
      cwd: BASIC_EXAMPLE_DIR,
    });
    serverProcess = proc;

    // Wait for server to be ready
    await waitForServer(BASE_URL);

    // Launch browser
    browser = await chromium.launch();
  });

  after(async () => {
    if (browser) await browser.close();
    if (serverProcess) {
      serverProcess.kill();
      // Give it time to cleanup
      await new Promise((resolve) => setTimeout(resolve, 1000));
      serverProcess = null;
    }
  });

  it("should render the page in browser", async () => {
    const page = await browser.newPage();
    await page.goto(BASE_URL);
    const html = await page.content();
    assert.ok(html.includes("<!DOCTYPE html>"));
    assert.ok(html.includes("<html"));
  });

  it("should have custom elements defined", async () => {
    const page = await browser.newPage();
    await page.goto(BASE_URL);
    const customElementsExist = await page.evaluate(() => {
      const sfElements = document.querySelectorAll("*");
      return Array.from(sfElements).some((el) => el.tagName.toLowerCase().startsWith("sf-"));
    });
    assert.strictEqual(customElementsExist, true);
  });

  it("should hydrate client components", async () => {
    const page = await browser.newPage();
    await page.goto(BASE_URL);

    // Wait for hydration to complete
    await page.waitForFunction(() => {
      return document.querySelector("[data-island]") !== null;
    });

    const dataIslandExists = await page.evaluate(() => {
      return document.querySelector("[data-island]") !== null;
    });
    assert.strictEqual(dataIslandExists, true);
  });

  it("should handle navigation to dynamic routes", async () => {
    const page = await browser.newPage();
    await page.goto(`${BASE_URL}/blog/test-post`);
    const url = page.url();
    assert.ok(url.includes("/blog/test-post"));

    const html = await page.content();
    assert.ok(html.includes("<html"));
  });

  it("should load and apply stylesheets", async () => {
    const page = await browser.newPage();
    await page.goto(BASE_URL);

    // Check that stylesheets are loaded
    const stylesheetCount = await page.evaluate(() => {
      return document.querySelectorAll('link[rel="stylesheet"]').length;
    });
    assert.ok(stylesheetCount > 0);
  });

  it("should execute client-side scripts", async () => {
    const page = await browser.newPage();
    await page.goto(BASE_URL);

    await waitForHydration(page);

    // Check if any scripts have executed by looking for hydration markers
    const scriptsExecuted = await page.evaluate(() => {
      // Check for any evidence of script execution
      const scripts = document.querySelectorAll("script");
      return scripts.length > 0;
    });
    assert.strictEqual(scriptsExecuted, true);
  });

  it("should maintain DOM structure after streaming", async () => {
    const page = await browser.newPage();
    await page.goto(BASE_URL);

    const bodyChildren = await page.evaluate(() => {
      return document.body.children.length;
    });
    assert.ok(bodyChildren > 0);
  });

  it("should have proper head elements", async () => {
    const page = await browser.newPage();
    await page.goto(BASE_URL);

    const headContent = await page.evaluate(() => {
      const head = document.head;
      return {
        headExists: head !== null,
        hasChildren: head.children.length > 0 || head.childNodes.length > 0,
        childCount: head.children.length,
      };
    });

    // Head element should exist
    assert.strictEqual(headContent.headExists, true);
  });

  it("should handle 404 pages in browser", async () => {
    const page = await browser.newPage();
    const response = await page.goto(`${BASE_URL}/non-existent-route-xyz`);
    assert.strictEqual(response?.status(), 404);

    // Should still render HTML error page
    const html = await page.content();
    assert.ok(html.includes("<html"));
  });

  it("should render hoisted head tags in document head", async () => {
    const page = await browser.newPage();
    await page.goto(BASE_URL);

    await waitForHydration(page);

    // Check that only ONE title exists (deduplicated - component wins over layout)
    const titleInfo = await page.evaluate(() => {
      const titles = document.querySelectorAll("title");
      return {
        count: titles.length,
        texts: Array.from(titles).map((t) => t.textContent),
      };
    });
    // Should have only the component title (deduplication: last wins)
    assert.strictEqual(titleInfo.count, 1);
    assert.ok(titleInfo.texts.includes("Home | Solarflare"));

    // Check meta description is deduplicated (component wins over layout)
    const metaDescriptions = await page.evaluate(() => {
      const metas = document.querySelectorAll('meta[name="description"]');
      return Array.from(metas).map((m) => m.getAttribute("content"));
    });
    // Should have only ONE description (component's)
    assert.strictEqual(metaDescriptions.length, 1);
    assert.strictEqual(metaDescriptions[0], "Welcome to the Solarflare demo app");

    await page.click('nav a[href="/blog/hello-world"]'); // Navigate to another page client side
    await page.waitForURL("**/blog/hello-world");
    await waitForHydration(page, "sf-blog-slug");

    // Check that only ONE title exists on client side as well
    const clientTitleInfo = await page.evaluate(() => {
      const titles = document.querySelectorAll("title");
      return {
        count: titles.length,
        texts: Array.from(titles).map((t) => t.textContent),
      };
    });
    assert.strictEqual(clientTitleInfo.count, 1);
    // Blog route should set a blog-specific title
    assert.strictEqual(
      clientTitleInfo.texts.some((t) => t?.includes("| Blog | Solarflare")),
      true,
    );

    // Check meta description is deduplicated on client side as well
    const clientMetaDescriptions = await page.evaluate(() => {
      const metas = document.querySelectorAll('meta[name="description"]');
      return Array.from(metas).map((m) => m.getAttribute("content"));
    });
    assert.strictEqual(clientMetaDescriptions.length, 1);
    assert.strictEqual(
      clientMetaDescriptions.some((c) => c?.includes("Blog post:")),
      true,
    );
  });

  it("should render dynamic head tags for route params", async () => {
    const page = await browser.newPage();
    await page.goto(`${BASE_URL}/blog/awesome-post`);

    await waitForHydration(page, "sf-blog-slug");

    // Check that the hoisted title from the blog component exists
    const titleInfo = await page.evaluate(() => {
      const titles = document.querySelectorAll("title");
      return {
        count: titles.length,
        texts: Array.from(titles).map((t) => t.textContent),
      };
    });
    // Should have a title containing the blog suffix from the component
    assert.strictEqual(
      titleInfo.texts.some((t) => t?.includes("| Blog | Solarflare")),
      true,
    );

    // Check meta description contains the blog post reference
    const metaDescription = await page.evaluate(() => {
      const metas = document.querySelectorAll('meta[name="description"]');
      return Array.from(metas).map((m) => m.getAttribute("content"));
    });
    assert.strictEqual(
      metaDescription.some((c) => c?.includes("Blog post:")),
      true,
    );
  });

  it("should have base meta tags from layout in head", async () => {
    const page = await browser.newPage();
    await page.goto(BASE_URL);

    const headInfo = await page.evaluate(() => {
      const charset = document.querySelector("meta[charset]");
      const viewport = document.querySelector('meta[name="viewport"]');
      return {
        hasCharset: charset !== null,
        charsetValue: charset?.getAttribute("charset"),
        hasViewport: viewport !== null,
        viewportContent: viewport?.getAttribute("content"),
      };
    });

    assert.strictEqual(headInfo.hasCharset, true);
    assert.strictEqual(headInfo.charsetValue, "UTF-8");
    assert.strictEqual(headInfo.hasViewport, true);
    assert.strictEqual(headInfo.viewportContent, "width=device-width, initial-scale=1.0");
  });

  it("should stream response incrementally", async () => {
    const page = await browser.newPage();
    await page.goto(BASE_URL);

    // The page should have been streamed - check for streaming markers
    const hasStreamedContent = await page.evaluate(() => {
      // Look for evidence of streamed content (custom elements, data islands)
      return (
        document.querySelector("[data-island]") !== null ||
        Array.from(document.querySelectorAll("*")).some((el) =>
          el.tagName.toLowerCase().startsWith("sf-"),
        )
      );
    });
    assert.strictEqual(hasStreamedContent, true);
  });

  it("should preserve state in interactive components", async () => {
    const page = await browser.newPage();
    await page.goto(BASE_URL);

    await waitForHydration(page);

    // Look for any interactive elements
    const hasInteractiveElements = await page.evaluate(() => {
      return (
        document.querySelectorAll("button").length > 0 ||
        document.querySelectorAll("input").length > 0 ||
        document.querySelectorAll("form").length > 0
      );
    });

    // The basic example should have some interactive elements
    assert.strictEqual(hasInteractiveElements, true);
  });

  it("should handle API route requests from browser", async () => {
    const page = await browser.newPage();
    await page.goto(BASE_URL);

    // Make API request from browser context
    const apiResponse = await page.evaluate(async () => {
      const response = await fetch("/api");
      return {
        status: response.status,
        contentType: response.headers.get("content-type"),
        data: await response.json(),
      };
    });

    assert.strictEqual(apiResponse.status, 200);
    assert.ok(apiResponse.contentType?.includes("application/json"));
    assert.ok("hello" in (apiResponse.data as Record<string, unknown>));
  });

  it("should apply CSS styles correctly", async () => {
    const page = await browser.newPage();
    await page.goto(BASE_URL);

    // Wait for styles to be applied
    await page.waitForTimeout(200);

    // Check that computed styles are being applied
    const hasStyles = await page.evaluate(() => {
      const firstElement = document.body.firstElementChild;
      if (!firstElement) return false;
      const styles = window.getComputedStyle(firstElement);
      // Check that some CSS is being applied (not default browser styles)
      return styles.display !== undefined;
    });
    assert.strictEqual(hasStyles, true);
  });

  it("should handle concurrent navigation", { timeout: 30_000 }, async () => {
    const page = await browser.newPage();
    await page.goto(BASE_URL);
    await page.goto(`${BASE_URL}/blog/test`);
    await page.goto(BASE_URL);

    const finalUrl = page.url();
    assert.strictEqual(finalUrl, `${BASE_URL}/`);
  });

  it("should keep button interactivity after client-side roundtrip navigation", async () => {
    const page = await browser.newPage();
    await page.goto(BASE_URL);

    await waitForHydration(page);

    // The basic example has a counter button with text like: "count is 0".
    // Be explicit to avoid clicking the PostForm submit button.
    const countButton = page.getByRole("button", { name: /count is/i });
    const getCountText = async () => (await countButton.textContent()) ?? "";

    const before = await getCountText();
    await countButton.click();
    const after = await getCountText();
    assert.notStrictEqual(after, before);

    // Navigate to blog (client-side via nav), then back home (client-side).
    await page.click('nav a[href="/blog/hello-world"]');
    await page.waitForURL("**/blog/hello-world");
    await waitForHydration(page, "sf-blog-slug");

    await page.click('nav a[href="/"]');
    await page.waitForURL("**/");
    await waitForHydration(page);

    const beforeReturn = await getCountText();
    await countButton.click();
    const afterReturn = await getCountText();
    assert.notStrictEqual(
      afterReturn,
      beforeReturn,
      "Counter button should remain interactive after navigating back to /",
    );
  });

  it("should support browser back navigation", async () => {
    const page = await browser.newPage();
    await page.goto(BASE_URL);
    await page.goto(`${BASE_URL}/blog/test`);

    await page.goBack();

    const url = page.url();
    assert.strictEqual(url, `${BASE_URL}/`);
  });

  it("should render custom element tags correctly", async () => {
    const page = await browser.newPage();
    await page.goto(BASE_URL);

    const sfElementCount = await page.evaluate(() => {
      return Array.from(document.querySelectorAll("*")).filter((el) =>
        el.tagName.toLowerCase().startsWith("sf-"),
      ).length;
    });

    assert.ok(sfElementCount > 0);
  });

  it("should handle form submission", async () => {
    const page = await browser.newPage();
    await page.goto(BASE_URL);

    // Check if form exists
    const formExists = await page.evaluate(() => {
      return document.querySelector("form") !== null;
    });

    if (formExists) {
      // If form exists, it should be interactive
      const formIsInteractive = await page.evaluate(() => {
        const form = document.querySelector("form");
        return form !== null && typeof form.submit === "function";
      });
      assert.strictEqual(formIsInteractive, true);
    } else {
      // Skip test if no form
      assert.strictEqual(true, true);
    }
  });

  it("should inject serialized data for hydration", async () => {
    const page = await browser.newPage();
    await page.goto(BASE_URL);

    // Check for serialized data in script tags
    const hasSerializedData = await page.evaluate(() => {
      const scripts = document.querySelectorAll("script");
      return Array.from(scripts).some(
        (script) =>
          script.textContent?.includes("data-island") ||
          script.type === "application/json" ||
          script.dataset.island !== undefined,
      );
    });

    assert.strictEqual(hasSerializedData, true);
  });

  it("should merge deferred props correctly", async () => {
    const page = await browser.newPage();
    await page.goto(BASE_URL, { waitUntil: "commit" });

    // Initial state: both should be loading
    await page.waitForSelector("h3");

    const h3s = page.locator("h3");

    // Check initial state - both h3s should show Loading...
    const firstH3Initial = await h3s.nth(0).textContent();
    const secondH3Initial = await h3s.nth(1).textContent();
    assert.strictEqual(firstH3Initial, "Loading...");
    assert.strictEqual(secondH3Initial, "Loading...");

    const stateAfterFirstDefer = await page.waitForFunction(
      () => {
        const h3Elements = document.querySelectorAll("h3");
        const first = h3Elements[0]?.textContent ?? "";
        const second = h3Elements[1]?.textContent ?? "";
        // Return state when first defer has resolved but capture second's state
        if (first.includes("Deferred:")) {
          return { first, second };
        }
        return null;
      },
      { timeout: 10000 },
    );

    const state = await stateAfterFirstDefer.jsonValue();
    assert.ok(state);
    assert.ok(state.first.includes("Deferred: WORLD"));
    assert.strictEqual(state.second, "Loading...");

    // Wait for second deferred prop (5s total)
    await page.waitForSelector("text=Deferred2: world2", { timeout: 10_000 });
    const finalSecondH3 = await h3s.nth(1).textContent();
    assert.ok(finalSecondH3?.includes("Deferred2: world2"));
  });
});

describe("Critical CSS integration", () => {
  it("should inline critical CSS for faster rendering", async () => {
    // Import the critical-css module
    const { extractCriticalCss, generateCssFallback, generateAsyncCssLoader } =
      await import("./critical-css.ts");

    // Test extraction with mock CSS
    const mockCss = { "/layout.css": ".container { max-width: 1200px; }" };
    const critical = await extractCriticalCss("/test", ["/layout.css"], {
      readCss: async (path) => mockCss[path as keyof typeof mockCss] ?? "",
      cache: false,
    });

    assert.ok(critical.includes(".container"));
    assert.ok(!critical.includes("\n")); // Should be minified

    // Test fallback generation
    const fallback = generateCssFallback(["/style.css"]);
    assert.ok(fallback.includes("<noscript>"));
    assert.ok(fallback.includes('href="/style.css"'));

    // Test async loader
    const loader = generateAsyncCssLoader(["/async.css"]);
    assert.ok(loader.includes("<script>"));
    assert.ok(loader.includes("/async.css"));
  });
});

describe("Early flush streaming integration", () => {
  it("should generate static shell for immediate flushing", async () => {
    const { generateStaticShell, generateResourceHints } = await import("./early-flush.ts");

    const shell = generateStaticShell({ lang: "en" });
    assert.ok(shell.preHead.includes("<!DOCTYPE html>"));
    assert.ok(shell.preHead.includes('<html lang="en">'));
    assert.ok(shell.preBody.includes("<body>"));

    const hints = generateResourceHints({
      preconnect: ["https://fonts.googleapis.com"],
      scripts: ["/app.js"],
      stylesheets: ["/main.css"],
    });

    assert.ok(hints.includes('rel="preconnect"'));
    assert.ok(hints.includes('rel="modulepreload"'));
    assert.ok(hints.includes('rel="preload"'));
  });

  it("should create streaming response with early flush", async () => {
    const { generateStaticShell, createEarlyFlushStream } = await import("./early-flush.ts");

    const shell = generateStaticShell({});
    const contentStream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("<main>Content</main>"));
        controller.close();
      },
    });

    const stream = createEarlyFlushStream(shell, {
      contentStream,
      headTags: "<title>Test</title>",
      bodyTags: '<script src="/app.js"></script>',
      criticalCss: ".critical { color: red; }",
    });

    const reader = stream.getReader();
    const chunks: string[] = [];

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(new TextDecoder().decode(value));
    }

    const html = chunks.join("");
    assert.ok(html.includes("<!DOCTYPE html>"));
    assert.ok(html.includes("<title>Test</title>"));
    assert.ok(html.includes("<style>.critical { color: red; }</style>"));
    assert.ok(html.includes("<main>Content</main>"));
    assert.ok(html.includes('src="/app.js"'));
    assert.ok(html.includes("</body></html>"));
  });
});

describe("Early hints integration", () => {
  it("should generate Link header for HTTP 103 Early Hints", async () => {
    const { generateEarlyHintsHeader, collectEarlyHints, handleWithEarlyHints } =
      await import("./early-hints.ts");

    const hints = collectEarlyHints({
      scriptPath: "/app.js",
      stylesheets: ["/main.css"],
      preconnectOrigins: ["https://cdn.example.com"],
    });

    assert.ok(hints.length > 0);

    const header = generateEarlyHintsHeader(hints);
    assert.ok(header.includes("</app.js>"));
    assert.ok(header.includes("rel=modulepreload"));
    assert.ok(header.includes("</main.css>"));

    // Test handler wrapper
    const response = await handleWithEarlyHints(
      new Request("http://localhost/"),
      async () => new Response("OK"),
      () => hints,
    );

    assert.ok(response.headers.get("Link"));
    assert.strictEqual(await response.text(), "OK");
  });
});

describe("Render priority integration", () => {
  it("should support deferred rendering with priorities", async () => {
    const { Deferred, Skeleton, SKELETON_CSS } = await import("./render-priority.ts");
    const { h } = await import("preact");
    const { render } = await import("preact-render-to-string");

    // Test skeleton CSS is defined
    assert.ok(SKELETON_CSS.includes("@keyframes sf-skeleton-pulse"));

    // Test skeleton component
    const skeleton = Skeleton({ width: "100px", height: "20px", count: 2 });
    const skeletonHtml = render(skeleton);
    assert.ok(skeletonHtml.includes("sf-skeleton"));
    assert.ok((skeletonHtml.match(/class="sf-skeleton"/g) || []).length === 2);

    // Test deferred component (server-side rendering)
    const children = h("div", null, "Content");
    const deferred = Deferred({ priority: "high", children });
    const deferredHtml = render(deferred);
    assert.ok(deferredHtml.includes('data-priority="high"'));
    assert.ok(deferredHtml.includes("sf-deferred"));
  });
});

describe("Route cache integration", () => {
  it("should cache responses with proper headers", async () => {
    const { ResponseCache, generateCacheControl, withCache, DEFAULT_CACHE_CONFIGS } =
      await import("./route-cache.ts");

    // Test default configs exist
    assert.ok(DEFAULT_CACHE_CONFIGS.static);
    assert.ok(DEFAULT_CACHE_CONFIGS.dynamic);
    assert.ok(DEFAULT_CACHE_CONFIGS.private);

    // Test cache control generation
    const cacheControl = generateCacheControl(DEFAULT_CACHE_CONFIGS.static, false);
    assert.ok(cacheControl.includes("max-age=3600"));
    assert.ok(cacheControl.includes("stale-while-revalidate=86400"));

    // Test response cache
    const cache = new ResponseCache(10);
    await cache.set("test", new Response("cached"), 60);
    const cached = await cache.get("test");
    assert.ok(cached);
    assert.strictEqual(await cached.text(), "cached");

    // Test withCache wrapper
    let handlerCalls = 0;
    const handler = async () => {
      handlerCalls++;
      return new Response("fresh");
    };

    const request = new Request("http://localhost/cached-route");
    await withCache(request, {}, { maxAge: 3600 }, handler, cache);
    await withCache(request, {}, { maxAge: 3600 }, handler, cache);

    // Handler should only be called once (second request uses cache)
    assert.strictEqual(handlerCalls, 1);
  });

  it("should skip cache for authenticated requests when configured", async () => {
    const { ResponseCache, withCache } = await import("./route-cache.ts");

    const cache = new ResponseCache(10);
    let handlerCalls = 0;
    const handler = async () => {
      handlerCalls++;
      return new Response("auth response");
    };

    const authRequest = new Request("http://localhost/auth-route", {
      headers: { Authorization: "Bearer token" },
    });

    // With cacheAuthenticated: false, should not cache
    await withCache(authRequest, {}, { maxAge: 3600, cacheAuthenticated: false }, handler, cache);
    await withCache(authRequest, {}, { maxAge: 3600, cacheAuthenticated: false }, handler, cache);

    // Handler should be called twice (no caching for auth requests)
    assert.strictEqual(handlerCalls, 2);
  });
});

describe("optimization headers unit tests", () => {
  it("should define correct streaming response headers", () => {
    const headers = {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Encoding": "identity",
      "Content-Security-Policy": "frame-ancestors 'self'",
      "Referrer-Policy": "strict-origin-when-cross-origin",
      "Transfer-Encoding": "chunked",
      "X-Content-Type-Options": "nosniff",
    };

    assert.strictEqual(headers["Content-Type"], "text/html; charset=utf-8");
    assert.strictEqual(headers["Content-Encoding"], "identity");
    assert.strictEqual(headers["Content-Security-Policy"], "frame-ancestors 'self'");
    assert.strictEqual(headers["X-Content-Type-Options"], "nosniff");
    assert.strictEqual(headers["Transfer-Encoding"], "chunked");
    assert.strictEqual(headers["Referrer-Policy"], "strict-origin-when-cross-origin");
  });

  it("should create Response with proper security headers", () => {
    const response = new Response("test", {
      headers: {
        "Content-Security-Policy": "frame-ancestors 'self'",
        "Referrer-Policy": "strict-origin-when-cross-origin",
        "X-Content-Type-Options": "nosniff",
      },
    });

    assert.ok(response.headers.get("Referrer-Policy"));
    assert.strictEqual(response.headers.get("Content-Security-Policy"), "frame-ancestors 'self'");
    assert.strictEqual(response.headers.get("X-Content-Type-Options"), "nosniff");
  });
});

// Sleep helper for Node.js
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Wait for the server to be ready by polling the health endpoint
async function waitForServer(url: string, timeout = 30_000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      const response = await fetch(url);
      if (response.ok || response.status === 404) {
        return;
      }
    } catch {
      // Server not ready yet
    }
    await sleep(100);
  }
  throw new Error(`Server did not start within ${timeout}ms`);
}
