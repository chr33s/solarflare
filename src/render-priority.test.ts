import { describe, it } from "node:test";
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
  it("should render children directly", () => {
    const children = h("div", null, "Content");
    const result = Deferred({ children });
    const html = render(result);
    assert.ok(html.includes("Content"));
    assert.ok(!html.includes("sf-deferred"));
  });

  it("should render fallback when children are missing", () => {
    const fallback = h("div", null, "Loading...");
    const result = Deferred({ fallback });
    const html = render(result);
    assert.ok(html.includes("Loading..."));
  });

  it("should ignore priority (passthrough stub)", () => {
    const children = h("div", null, "Content");
    const result = Deferred({ priority: "critical", children });
    const html = render(result);
    assert.ok(!html.includes("data-priority"));
    assert.ok(html.includes("Content"));
  });
});

describe("Skeleton", () => {
  it("should render skeleton placeholders", () => {
    const html = render(Skeleton({ count: 2, variant: "text" }));
    assert.ok(html.includes("sf-skeleton"));
  });
});

describe("SKELETON_CSS", () => {
  it("should include pulse keyframes", () => {
    assert.ok(SKELETON_CSS.includes("sf-skeleton-pulse"));
  });
});
