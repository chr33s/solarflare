import { describe, it, beforeEach, afterEach } from "node:test";
import * as assert from "node:assert/strict";
import { Deferred, Skeleton, SKELETON_CSS, type RenderPriority } from "./render-priority.ts";
import { h } from "preact";
import { render } from "preact-render-to-string";

describe("RenderPriority type", () => {
  it("should accept valid priority values", () => {
    const priorities: RenderPriority[] = ["critical", "high", "normal", "low", "idle"];
    assert.strictEqual(priorities.length, 5);
    assert.ok(priorities.includes("critical"));
    assert.ok(priorities.includes("high"));
    assert.ok(priorities.includes("normal"));
    assert.ok(priorities.includes("low"));
    assert.ok(priorities.includes("idle"));
  });
});

describe("Deferred", () => {
  // Mock server environment (typeof window === "undefined")
  const originalWindow = globalThis.window;

  beforeEach(() => {
    // Simulate server environment
    // @ts-expect-error - intentionally setting window to undefined
    delete globalThis.window;
  });

  afterEach(() => {
    // Restore window if it existed
    if (originalWindow !== undefined) {
      globalThis.window = originalWindow;
    }
  });

  it("should render with default priority", () => {
    const children = h("div", null, "Content");
    const result = Deferred({ children });

    // Should return a VNode
    assert.ok(result);
    assert.strictEqual(typeof result, "object");
  });

  it("should render with custom priority", () => {
    const children = h("div", null, "Content");
    const result = Deferred({ priority: "critical", children });

    const html = render(result);
    assert.ok(html.includes('data-priority="critical"'));
  });

  it("should render fallback content on server", () => {
    const children = h("div", null, "Main Content");
    const fallback = h("div", null, "Loading...");
    const result = Deferred({ children, fallback });

    const html = render(result);
    // Server should render the fallback initially
    assert.ok(html.includes("Loading..."));
  });

  it("should render sf-deferred element on server", () => {
    const children = h("div", null, "Content");
    const result = Deferred({ children });

    const html = render(result);
    assert.ok(html.includes("sf-deferred"));
    assert.ok(html.includes('style="display:contents;"'));
  });

  it("should include deferred marker template", () => {
    const children = h("div", null, "Content");
    const result = Deferred({ children });

    const html = render(result);
    assert.ok(html.includes("<template"));
    assert.ok(html.includes("data-sf-deferred"));
    assert.ok(html.includes("SF: DEFERRED:"));
  });

  it("should generate unique IDs", () => {
    const children1 = h("div", null, "Content 1");
    const children2 = h("div", null, "Content 2");

    const result1 = Deferred({ children: children1 });
    const result2 = Deferred({ children: children2 });

    const html1 = render(result1);
    const html2 = render(result2);

    // Extract IDs from the rendered HTML
    const idMatch1 = html1.match(/sf-deferred-([a-z0-9]+)/);
    const idMatch2 = html2.match(/sf-deferred-([a-z0-9]+)/);

    assert.ok(idMatch1);
    assert.ok(idMatch2);
    // IDs should be different
    assert.notStrictEqual(idMatch1[1], idMatch2[1]);
  });

  it("should render default loading state when no fallback", () => {
    const children = h("div", null, "Content");
    const result = Deferred({ children });

    const html = render(result);
    assert.ok(html.includes("sf-loading"));
  });
});

describe("Deferred on client", () => {
  const originalWindow = globalThis.window;

  beforeEach(() => {
    // Simulate client environment
    // @ts-expect-error - mocking window for test
    globalThis.window = {};
  });

  afterEach(() => {
    if (originalWindow !== undefined) {
      globalThis.window = originalWindow;
    } else {
      // @ts-expect-error - intentionally deleting window
      delete globalThis.window;
    }
  });

  it("should render children directly on client", () => {
    const children = h("div", { class: "client-content" }, "Client Content") as Parameters<
      typeof Deferred
    >[0]["children"];
    const result = Deferred({ children });

    // On client, should return the children directly
    const html = render(result);
    assert.ok(html.includes("client-content"));
    assert.ok(html.includes("Client Content"));
    // Should NOT include the server-side markers
    assert.ok(!html.includes("sf-deferred"));
  });
});

describe("Skeleton", () => {
  it("should render with default props", () => {
    const result = Skeleton({});
    const html = render(result);

    assert.ok(html.includes("sf-skeleton"));
    assert.ok(html.includes("width:100%"));
    assert.ok(html.includes("height:1em"));
  });

  it("should render with custom width and height", () => {
    const result = Skeleton({ width: "200px", height: "50px" });
    const html = render(result);

    assert.ok(html.includes("width:200px"));
    assert.ok(html.includes("height:50px"));
  });

  it("should render text variant with rounded corners", () => {
    const result = Skeleton({ variant: "text" });
    const html = render(result);

    assert.ok(html.includes("border-radius:4px"));
  });

  it("should render circle variant", () => {
    const result = Skeleton({ variant: "circle" });
    const html = render(result);

    assert.ok(html.includes("border-radius:50%"));
  });

  it("should render rect variant with no border radius", () => {
    const result = Skeleton({ variant: "rect" });
    const html = render(result);

    assert.ok(html.includes("border-radius:0"));
  });

  it("should render multiple skeleton items", () => {
    const result = Skeleton({ count: 3 });
    const html = render(result);

    // Should have 3 skeleton divs (using class attribute to count)
    const skeletonCount = (html.match(/class="sf-skeleton"/g) || []).length;
    assert.strictEqual(skeletonCount, 3);
  });

  it("should use correct background color", () => {
    const result = Skeleton({});
    const html = render(result);

    assert.ok(html.includes("background-color:#e0e0e0"));
  });

  it("should include animation style", () => {
    const result = Skeleton({});
    const html = render(result);

    assert.ok(html.includes("animation:sf-skeleton-pulse"));
  });
});

describe("SKELETON_CSS", () => {
  it("should define keyframes animation", () => {
    assert.ok(SKELETON_CSS.includes("@keyframes sf-skeleton-pulse"));
  });

  it("should define opacity animation", () => {
    assert.ok(SKELETON_CSS.includes("opacity:"));
    assert.ok(SKELETON_CSS.includes("0%"));
    assert.ok(SKELETON_CSS.includes("50%"));
    assert.ok(SKELETON_CSS.includes("100%"));
  });

  it("should define sf-loading class", () => {
    assert.ok(SKELETON_CSS.includes(".sf-loading") || SKELETON_CSS.includes(". sf-loading"));
  });
});
