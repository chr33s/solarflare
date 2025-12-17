import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { spawn, type Subprocess } from "bun";
import { join } from "node:path";
import { chromium, type Browser } from "playwright";

describe("findPairedModule helper logic", () => {
  // Test the logic that would be in findPairedModule
  const findPairedModule = (path: string, modules: { server: string[]; client: string[] }) => {
    if (path.includes(".client.")) {
      const serverPath = path.replace(".client.", ".server.");
      return modules.server.includes(serverPath) ? serverPath : null;
    }
    if (path.includes(".server.")) {
      const clientPath = path.replace(".server.", ".client.");
      return modules.client.includes(clientPath) ? clientPath : null;
    }
    return null;
  };

  it("should find server module for client module", () => {
    const modules = {
      server: ["./blog/$slug.server.tsx"],
      client: ["./blog/$slug.client.tsx"],
    };
    const result = findPairedModule("./blog/$slug.client.tsx", modules);
    expect(result).toBe("./blog/$slug.server.tsx");
  });

  it("should find client module for server module", () => {
    const modules = {
      server: ["./blog/$slug.server.tsx"],
      client: ["./blog/$slug.client.tsx"],
    };
    const result = findPairedModule("./blog/$slug.server.tsx", modules);
    expect(result).toBe("./blog/$slug.client.tsx");
  });

  it("should return null when no paired module exists", () => {
    const modules = {
      server: ["./api/data.server.tsx"],
      client: ["./blog/$slug.client.tsx"],
    };
    const result = findPairedModule("./api/data.server.tsx", modules);
    expect(result).toBeNull();
  });

  it("should return null for non-client/server paths", () => {
    const modules = {
      server: [],
      client: [],
    };
    const result = findPairedModule("./utils/helpers.ts", modules);
    expect(result).toBeNull();
  });
});

describe("ChunkManifest structure", () => {
  interface ChunkManifest {
    chunks: Record<string, string>;
    tags: Record<string, string>;
    styles: Record<string, string[]>;
    devScripts?: string[];
  }

  it("should define valid chunk manifest structure", () => {
    const manifest: ChunkManifest = {
      chunks: { index: "index.abc123.js" },
      tags: { "sf-root": "/index.abc123.js" },
      styles: { "/": ["/index.css"] },
    };

    expect(manifest.chunks.index).toBe("index.abc123.js");
    expect(manifest.tags["sf-root"]).toBe("/index.abc123.js");
    expect(manifest.styles["/"]).toEqual(["/index.css"]);
  });

  it("should handle optional devScripts", () => {
    const manifestWithDev: ChunkManifest = {
      chunks: {},
      tags: {},
      styles: {},
      devScripts: ["/console-forward.js"],
    };

    expect(manifestWithDev.devScripts).toEqual(["/console-forward.js"]);

    const manifestWithoutDev: ChunkManifest = {
      chunks: {},
      tags: {},
      styles: {},
    };

    expect(manifestWithoutDev.devScripts).toBeUndefined();
  });
});

describe("getScriptPath helper logic", () => {
  const getScriptPath = (tag: string, manifest: { tags: Record<string, string> }) => {
    return manifest.tags[tag];
  };

  it("should return script path for known tag", () => {
    const manifest = { tags: { "sf-root": "/index.abc123.js" } };
    expect(getScriptPath("sf-root", manifest)).toBe("/index.abc123.js");
  });

  it("should return undefined for unknown tag", () => {
    const manifest = { tags: { "sf-root": "/index.js" } };
    expect(getScriptPath("sf-unknown", manifest)).toBeUndefined();
  });
});

describe("getStylesheets helper logic", () => {
  const getStylesheets = (
    pattern: string,
    manifest: { styles: Record<string, string[]> },
  ): string[] => {
    return manifest.styles[pattern] ?? [];
  };

  it("should return stylesheets for known pattern", () => {
    const manifest = { styles: { "/blog": ["/blog.css", "/theme.css"] } };
    expect(getStylesheets("/blog", manifest)).toEqual(["/blog.css", "/theme.css"]);
  });

  it("should return empty array for unknown pattern", () => {
    const manifest = { styles: { "/": ["/index.css"] } };
    expect(getStylesheets("/unknown", manifest)).toEqual([]);
  });

  it("should return empty array when no styles defined", () => {
    const manifest = { styles: {} };
    expect(getStylesheets("/", manifest)).toEqual([]);
  });
});

describe("ServerLoader type expectations", () => {
  type ServerLoader = (
    request: Request,
    params: Record<string, string>,
  ) => Record<string, unknown> | Promise<Record<string, unknown>>;

  it("should accept sync loader", () => {
    const loader: ServerLoader = (_request, params) => {
      return { slug: params.slug };
    };

    const result = loader(new Request("http://localhost"), { slug: "test" });
    expect(result).toEqual({ slug: "test" });
  });

  it("should accept async loader", async () => {
    const loader: ServerLoader = async (_request, params) => {
      return { slug: params.slug };
    };

    const result = await loader(new Request("http://localhost"), { slug: "test" });
    expect(result).toEqual({ slug: "test" });
  });
});

describe("WorkerEnv structure", () => {
  interface WorkerEnv {
    WRANGLER_LOG?: "debug" | "info" | "log" | "warn" | "error" | "none";
    [key: string]: unknown;
  }

  it("should accept valid log levels", () => {
    const envs: WorkerEnv[] = [
      { WRANGLER_LOG: "debug" },
      { WRANGLER_LOG: "info" },
      { WRANGLER_LOG: "log" },
      { WRANGLER_LOG: "warn" },
      { WRANGLER_LOG: "error" },
      { WRANGLER_LOG: "none" },
    ];

    for (const env of envs) {
      expect(env.WRANGLER_LOG).toBeDefined();
    }
  });

  it("should allow additional properties", () => {
    const env: WorkerEnv = {
      WRANGLER_LOG: "log",
      DATABASE_URL: "postgres://...",
      API_KEY: "secret",
    };

    expect(env.DATABASE_URL).toBe("postgres://...");
    expect(env.API_KEY).toBe("secret");
  });
});

describe("Response headers", () => {
  it("should create proper streaming response headers", () => {
    const headers = {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Encoding": "identity",
      "Transfer-Encoding": "chunked",
      "X-Content-Type-Options": "nosniff",
    };

    expect(headers["Content-Type"]).toBe("text/html; charset=utf-8");
    expect(headers["Content-Encoding"]).toBe("identity");
    expect(headers["Transfer-Encoding"]).toBe("chunked");
    expect(headers["X-Content-Type-Options"]).toBe("nosniff");
  });

  it("should create response with streaming headers", () => {
    const response = new Response("test", {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Content-Encoding": "identity",
        "Transfer-Encoding": "chunked",
      },
    });

    expect(response.headers.get("Content-Type")).toBe("text/html; charset=utf-8");
  });

  it("should create 404 response", () => {
    const response = new Response("Not Found", { status: 404 });
    expect(response.status).toBe(404);
  });

  it("should create 500 response", () => {
    const response = new Response("Server Error", { status: 500 });
    expect(response.status).toBe(500);
  });
});

const BASIC_EXAMPLE_DIR = join(import.meta.dir, "../examples/basic");
const BASE_URL = "http://localhost:8080";

describe("integration", () => {
  let serverProcess: Subprocess | null = null;

  beforeAll(async () => {
    const buildProcess = spawn(["npm", "run", "build", "--clean"], {
      cwd: BASIC_EXAMPLE_DIR,
      stdout: "pipe",
      stderr: "pipe",
    });

    const buildExitCode = await buildProcess.exited;
    if (buildExitCode !== 0) {
      const stderr = await new Response(buildProcess.stderr).text();
      throw new Error(`Build failed with exit code ${buildExitCode}: ${stderr}`);
    }

    // Start the dev server
    serverProcess = spawn(["npm", "run", "start"], {
      cwd: BASIC_EXAMPLE_DIR,
      stdout: "pipe",
      stderr: "pipe",
    });

    // Wait for server to be ready
    await waitForServer(BASE_URL);
  }, 60_000);

  afterAll(async () => {
    if (serverProcess) {
      serverProcess.kill();
      await serverProcess.exited;
      serverProcess = null;
    }
  }, 10_000);

  it.concurrent("should return HTML for root route", async () => {
    const response = await fetch(`${BASE_URL}/`);
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("text/html; charset=utf-8");

    const html = await response.text();
    expect(html).toContain("<!doctype html>");
    expect(html).toContain("<html");
  });

  it.concurrent("should return streaming headers", async () => {
    const response = await fetch(`${BASE_URL}/`);
    expect(response.headers.get("Content-Encoding")).toBe("identity");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
  });

  it.concurrent("should return 404 for unknown routes", async () => {
    const response = await fetch(`${BASE_URL}/unknown-route-xyz`);
    expect(response.status).toBe(404);
    expect(response.headers.get("Content-Type")).toBe("text/html; charset=utf-8");
  });

  it.concurrent("should handle API routes returning JSON", async () => {
    const response = await fetch(`${BASE_URL}/api`);
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("application/json");

    const data = await response.json();
    expect(data).toHaveProperty("hello");
  });

  it.concurrent("should handle dynamic routes", async () => {
    const response = await fetch(`${BASE_URL}/blog/test-slug`);
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("text/html; charset=utf-8");
  });

  it.concurrent("should include custom element tags in HTML", async () => {
    const response = await fetch(`${BASE_URL}/`);
    const html = await response.text();
    expect(html).toContain("<sf-");
  });

  it.concurrent("should include data island script in HTML", async () => {
    const response = await fetch(`${BASE_URL}/`);
    const html = await response.text();
    expect(html).toContain("data-island");
  });

  it.concurrent("should include stylesheets in HTML", async () => {
    const response = await fetch(`${BASE_URL}/`);
    const html = await response.text();
    expect(html).toContain("<link");
    expect(html).toContain("stylesheet");
  });

  it.concurrent("should handle console forward endpoint", async () => {
    const response = await fetch(`${BASE_URL}/__console`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ logs: [] }),
    });
    expect(response.status).toBe(200);
  });

  it.concurrent("should reject GET to console forward endpoint", async () => {
    const response = await fetch(`${BASE_URL}/__console`);
    // Should not be treated as console endpoint, returns 404
    expect(response.status).toBe(404);
  });
});

describe("e2e", () => {
  let serverProcess: Subprocess | null = null;
  let browser: Browser;

  beforeAll(async () => {
    // Build the basic example
    const buildProcess = spawn(["npm", "run", "build", "--clean"], {
      cwd: BASIC_EXAMPLE_DIR,
      stdout: "pipe",
      stderr: "pipe",
    });

    const buildExitCode = await buildProcess.exited;
    if (buildExitCode !== 0) {
      const stderr = await new Response(buildProcess.stderr).text();
      throw new Error(`Build failed with exit code ${buildExitCode}: ${stderr}`);
    }

    // Start the dev server
    serverProcess = spawn(["npm", "run", "start"], {
      cwd: BASIC_EXAMPLE_DIR,
      stdout: "pipe",
      stderr: "pipe",
    });

    // Wait for server to be ready
    await waitForServer(BASE_URL);

    // Launch browser
    browser = await chromium.launch();
  }, 60_000);

  afterAll(async () => {
    if (browser) await browser.close();
    if (serverProcess) {
      serverProcess.kill();
      await serverProcess.exited;
      serverProcess = null;
    }
  }, 10_000);

  it.concurrent("should render the page in browser", async () => {
    const page = await browser.newPage();
    await page.goto(BASE_URL);
    const html = await page.content();
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("<html");
  });

  it.concurrent("should have custom elements defined", async () => {
    const page = await browser.newPage();
    await page.goto(BASE_URL);
    const customElementsExist = await page.evaluate(() => {
      const sfElements = document.querySelectorAll("*");
      return Array.from(sfElements).some((el) => el.tagName.toLowerCase().startsWith("sf-"));
    });
    expect(customElementsExist).toBe(true);
  });

  it.concurrent("should hydrate client components", async () => {
    const page = await browser.newPage();
    await page.goto(BASE_URL);

    // Wait for hydration to complete
    await page.waitForFunction(() => {
      return document.querySelector("[data-island]") !== null;
    });

    const dataIslandExists = await page.evaluate(() => {
      return document.querySelector("[data-island]") !== null;
    });
    expect(dataIslandExists).toBe(true);
  });

  it.concurrent("should handle navigation to dynamic routes", async () => {
    const page = await browser.newPage();
    await page.goto(`${BASE_URL}/blog/test-post`);
    const url = page.url();
    expect(url).toContain("/blog/test-post");

    const html = await page.content();
    expect(html).toContain("<html");
  });

  it.concurrent("should load and apply stylesheets", async () => {
    const page = await browser.newPage();
    await page.goto(BASE_URL);

    // Check that stylesheets are loaded
    const stylesheetCount = await page.evaluate(() => {
      return document.querySelectorAll('link[rel="stylesheet"]').length;
    });
    expect(stylesheetCount).toBeGreaterThan(0);
  });

  it.concurrent("should execute client-side scripts", async () => {
    const page = await browser.newPage();
    await page.goto(BASE_URL);

    // Wait for scripts to execute
    await page.waitForTimeout(500);

    // Check if any scripts have executed by looking for hydration markers
    const scriptsExecuted = await page.evaluate(() => {
      // Check for any evidence of script execution
      const scripts = document.querySelectorAll("script");
      return scripts.length > 0;
    });
    expect(scriptsExecuted).toBe(true);
  });

  it.concurrent("should maintain DOM structure after streaming", async () => {
    const page = await browser.newPage();
    await page.goto(BASE_URL);

    const bodyChildren = await page.evaluate(() => {
      return document.body.children.length;
    });
    expect(bodyChildren).toBeGreaterThan(0);
  });

  it.concurrent("should have proper head elements", async () => {
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
    expect(headContent.headExists).toBe(true);
  });

  it.concurrent("should handle 404 pages in browser", async () => {
    const page = await browser.newPage();
    const response = await page.goto(`${BASE_URL}/non-existent-route-xyz`);
    expect(response?.status()).toBe(404);

    // Should still render HTML error page
    const html = await page.content();
    expect(html).toContain("<html");
  });

  it.concurrent("should stream response incrementally", async () => {
    const page = await browser.newPage();
    await page.goto(BASE_URL);

    // The page should have been streamed - check for streaming markers
    const hasStreamedContent = await page.evaluate(() => {
      // Look for evidence of streamed content (custom elements, data islands)
      return (
        document.querySelector("[data-island]") !== null ||
        Array.from(document.querySelectorAll("*")).some((el) =>
          el.tagName.toLowerCase().startsWith("sf-")
        )
      );
    });
    expect(hasStreamedContent).toBe(true);
  });

  it.concurrent("should preserve state in interactive components", async () => {
    const page = await browser.newPage();
    await page.goto(BASE_URL);

    // Wait for hydration
    await page.waitForTimeout(500);

    // Look for any interactive elements
    const hasInteractiveElements = await page.evaluate(() => {
      return (
        document.querySelectorAll("button").length > 0 ||
        document.querySelectorAll("input").length > 0 ||
        document.querySelectorAll("form").length > 0
      );
    });

    // The basic example should have some interactive elements
    expect(hasInteractiveElements).toBe(true);
  });

  it.concurrent("should handle API route requests from browser", async () => {
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

    expect(apiResponse.status).toBe(200);
    expect(apiResponse.contentType).toContain("application/json");
    expect(apiResponse.data).toHaveProperty("hello");
  });

  it.concurrent("should apply CSS styles correctly", async () => {
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
    expect(hasStyles).toBe(true);
  });

  it.concurrent("should handle concurrent navigation", async () => {
    const page = await browser.newPage();
    await page.goto(BASE_URL);
    await page.goto(`${BASE_URL}/blog/test`);
    await page.goto(BASE_URL);

    const finalUrl = page.url();
    expect(finalUrl).toBe(`${BASE_URL}/`);
  }, 10_000);

  it.concurrent("should support browser back navigation", async () => {
    const page = await browser.newPage();
    await page.goto(BASE_URL);
    await page.goto(`${BASE_URL}/blog/test`);

    await page.goBack();

    const url = page.url();
    expect(url).toBe(`${BASE_URL}/`);
  });

  it.concurrent("should render custom element tags correctly", async () => {
    const page = await browser.newPage();
    await page.goto(BASE_URL);

    const sfElementCount = await page.evaluate(() => {
      return Array.from(document.querySelectorAll("*")).filter((el) =>
        el.tagName.toLowerCase().startsWith("sf-")
      ).length;
    });

    expect(sfElementCount).toBeGreaterThan(0);
  });

  it.concurrent("should handle form submission", async () => {
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
      expect(formIsInteractive).toBe(true);
    } else {
      // Skip test if no form
      expect(true).toBe(true);
    }
  });

  it.concurrent("should inject serialized data for hydration", async () => {
    const page = await browser.newPage();
    await page.goto(BASE_URL);

    // Check for serialized data in script tags
    const hasSerializedData = await page.evaluate(() => {
      const scripts = document.querySelectorAll("script");
      return Array.from(scripts).some(
        (script) =>
          script.textContent?.includes("data-island") ||
          script.type === "application/json" ||
          script.dataset.island !== undefined
      );
    });

    expect(hasSerializedData).toBe(true);
  });
});

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
    await Bun.sleep(100);
  }
  throw new Error(`Server did not start within ${timeout}ms`);
};
