import { describe, it, beforeEach, afterEach } from "node:test";
import * as assert from "node:assert/strict";

import { handleCssHmrUpdate, setupCssHmr } from "./hmr.ts";
import { stylesheets } from "./stylesheets.ts";

class MockCSSStyleRule {
  selectorText: string;
  cssText: string;

  constructor(selectorText: string, cssText: string) {
    this.selectorText = selectorText;
    this.cssText = cssText;
  }
}

class MockCSSStyleSheet {
  cssRules: MockCSSStyleRule[] = [];

  replaceSync(css: string) {
    this.cssRules = parseCssRules(css);
  }

  insertRule(rule: string, index?: number) {
    const selector = (rule.match(/^([^{}]+)\s*\{/u)?.[1] ?? "").trim();
    const insertIndex = index ?? this.cssRules.length;
    this.cssRules.splice(insertIndex, 0, new MockCSSStyleRule(selector, rule));
    return insertIndex;
  }

  deleteRule(index: number) {
    this.cssRules.splice(index, 1);
  }
}

function parseCssRules(css: string) {
  const rules: MockCSSStyleRule[] = [];
  const ruleRegex = /([^{}]+)\s*\{([^}]*)\}/gu;
  let match: RegExpExecArray | null;

  while ((match = ruleRegex.exec(css)) !== null) {
    const selector = match[1]?.trim() ?? "";
    rules.push(new MockCSSStyleRule(selector, match[0]));
  }

  return rules;
}

function installMockDom() {
  const prevWindow = (globalThis as any).window;
  const prevDocument = (globalThis as any).document;
  const prevCSSStyleSheet = (globalThis as any).CSSStyleSheet;
  const prevCSSStyleRule = (globalThis as any).CSSStyleRule;

  (globalThis as any).window = {};
  (globalThis as any).CSSStyleSheet = MockCSSStyleSheet;
  (globalThis as any).CSSStyleRule = MockCSSStyleRule;
  (globalThis as any).document = {
    adoptedStyleSheets: [] as any[],
    head: { appendChild() {} },
    getElementById() {
      return null;
    },
    createElement() {
      return { id: "", textContent: "" };
    },
  };

  return () => {
    (globalThis as any).window = prevWindow;
    (globalThis as any).document = prevDocument;
    (globalThis as any).CSSStyleSheet = prevCSSStyleSheet;
    (globalThis as any).CSSStyleRule = prevCSSStyleRule;
  };
}

describe("hmr styles", () => {
  let restoreGlobals: (() => void) | undefined;

  beforeEach(() => {
    restoreGlobals?.();
    restoreGlobals = installMockDom();
    stylesheets.clear();
  });

  afterEach(() => {
    stylesheets.clear();
    restoreGlobals?.();
    restoreGlobals = undefined;
  });

  it("applies granular updates when possible", () => {
    const id = "/x.css";
    stylesheets.register(id, ".a { color: red; } .b { color: blue; }", {
      isGlobal: true,
    });

    handleCssHmrUpdate({
      id,
      css: ".a { color: green; } .c { padding: 1px; }",
      changedRules: [
        { selector: ".a", properties: "color: green", action: "update" },
        { selector: ".b", properties: "", action: "delete" },
        { selector: ".c", properties: "padding: 1px", action: "add" },
      ],
    });

    const sheet = stylesheets.get(id) as any;
    assert.ok(sheet);

    const selectors = sheet.cssRules.map((r: any) => r.selectorText);
    assert.deepStrictEqual(selectors.sort(), [".a", ".c"].sort());
    assert.ok(sheet.cssRules.find((r: any) => r.selectorText === ".a").cssText.includes("green"));
  });

  it("falls back to full replacement when granular update throws", () => {
    const id = "/y.css";
    stylesheets.register(id, ".a { color: red; }", { isGlobal: true });

    const prevRule = (globalThis as any).CSSStyleRule;
    delete (globalThis as any).CSSStyleRule;

    try {
      handleCssHmrUpdate({
        id,
        css: ".a { color: blue; }",
        changedRules: [{ selector: ".a", properties: "color: blue", action: "update" }],
      });
    } finally {
      (globalThis as any).CSSStyleRule = prevRule;
    }

    const sheet = stylesheets.get(id) as any;
    assert.ok(sheet);
    assert.strictEqual(sheet.cssRules.length, 1);
    assert.ok(sheet.cssRules[0].cssText.includes("blue"));
  });

  it("setupCssHmr wires both update and replace events", () => {
    const handlers = new Map<string, (data: unknown) => void>();
    setupCssHmr({
      on(event, cb) {
        handlers.set(event, cb);
      },
    });

    const id = "/wired.css";
    stylesheets.register(id, ".a { color: red; }", { isGlobal: true });

    handlers.get("sf:css-replace")?.({ id, css: ".a { color: blue; }" });
    let sheet: any = stylesheets.get(id);
    assert.ok(sheet.cssRules[0].cssText.includes("blue"));

    handlers.get("sf:css-update")?.({
      id,
      css: ".b { color: green; }",
      changedRules: [{ selector: ".b", properties: "color: green", action: "add" }],
    });

    sheet = stylesheets.get(id);
    assert.ok(sheet.cssRules.some((r: any) => r.selectorText === ".b"));
  });
});
