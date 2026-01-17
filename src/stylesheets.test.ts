import { describe, it, beforeEach, afterEach } from "node:test";
import * as assert from "node:assert/strict";

import { StylesheetManager, supportsConstructableStylesheets } from "./stylesheets.ts";

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

function installMockDom(options: { supported: boolean }) {
  const prevWindow = (globalThis as any).window;
  const prevDocument = (globalThis as any).document;
  const prevCSSStyleSheet = (globalThis as any).CSSStyleSheet;
  const prevCSSStyleRule = (globalThis as any).CSSStyleRule;

  const elementsById = new Map<string, any>();
  const headChildren: any[] = [];

  (globalThis as any).document = {
    adoptedStyleSheets: [] as any[],
    head: {
      appendChild(el: any) {
        headChildren.push(el);
      },
    },
    createElement(tag: string) {
      return { tagName: tag.toUpperCase(), id: "", textContent: "" };
    },
    getElementById(id: string) {
      return elementsById.get(id) ?? null;
    },
    __getHeadChildren() {
      return headChildren;
    },
    __upsertById(el: any) {
      if (el?.id) elementsById.set(el.id, el);
    },
  };

  if (options.supported) {
    (globalThis as any).window = {};
    (globalThis as any).CSSStyleSheet = MockCSSStyleSheet;
    (globalThis as any).CSSStyleRule = MockCSSStyleRule;
  } else {
    delete (globalThis as any).window;
    delete (globalThis as any).CSSStyleSheet;
    delete (globalThis as any).CSSStyleRule;
  }

  const documentAny = (globalThis as any).document;
  const originalAppendChild = documentAny.head.appendChild;
  documentAny.head.appendChild = (el: any) => {
    documentAny.__upsertById(el);
    return originalAppendChild.call(documentAny.head, el);
  };

  return () => {
    (globalThis as any).window = prevWindow;
    (globalThis as any).document = prevDocument;
    (globalThis as any).CSSStyleSheet = prevCSSStyleSheet;
    (globalThis as any).CSSStyleRule = prevCSSStyleRule;
  };
}

let restoreGlobals: (() => void) | undefined;

afterEach(() => {
  restoreGlobals?.();
  restoreGlobals = undefined;
});

it("supportsConstructableStylesheets is false without window", () => {
  restoreGlobals = installMockDom({ supported: false });
  assert.strictEqual(supportsConstructableStylesheets(), false);
});

it("supportsConstructableStylesheets is true when CSSStyleSheet is available", () => {
  restoreGlobals = installMockDom({ supported: true });
  assert.strictEqual(supportsConstructableStylesheets(), true);
});

describe("StylesheetManager", () => {
  beforeEach(() => {
    restoreGlobals?.();
    restoreGlobals = installMockDom({ supported: true });
  });

  it("registers global and consumer sheets, and returns them for consumer", () => {
    const manager = new StylesheetManager();

    const globalSheet = manager.register("/global.css", "html { color: black; }", {
      isGlobal: true,
    });
    assert.ok(globalSheet);
    assert.strictEqual((globalThis as any).document.adoptedStyleSheets.length, 1);

    const componentSheet = manager.register("/widget.css", ".widget { color: red; }", {
      consumer: "sf-widget",
    });
    assert.ok(componentSheet);

    const forWidget = manager.getForConsumer("sf-widget");
    assert.deepStrictEqual(forWidget, [globalSheet!, componentSheet!]);
  });

  it("removeConsumer deletes orphaned non-global sheets", () => {
    const manager = new StylesheetManager();
    manager.register("/global.css", "* { box-sizing: border-box; }", {
      isGlobal: true,
    });
    manager.register("/only-widget.css", ".x { color: red; }", {
      consumer: "sf-widget",
    });

    assert.ok(manager.get("/only-widget.css"));
    manager.removeConsumer("sf-widget");
    assert.strictEqual(manager.get("/only-widget.css"), null);
    assert.ok(manager.get("/global.css"));
  });

  it("update returns true when css changes, false when unchanged", () => {
    const manager = new StylesheetManager();
    manager.register("/a.css", ".a { color: red; }", { consumer: "sf-a" });

    assert.strictEqual(manager.update("/a.css", ".a { color: red; }"), false);
    assert.strictEqual(manager.update("/a.css", ".a { color: blue; }"), true);
  });

  it("insertRule and deleteRule mutate the sheet", () => {
    const manager = new StylesheetManager();
    const sheet = manager.register("/rules.css", ".a { color: red; }", {
      consumer: "sf-a",
    });
    assert.ok(sheet);
    assert.strictEqual(sheet!.cssRules.length, 1);

    const idx = manager.insertRule("/rules.css", ".b { color: blue; }");
    assert.strictEqual(idx, 1);
    assert.strictEqual(sheet!.cssRules.length, 2);

    assert.strictEqual(manager.deleteRule("/rules.css", 0), true);
    assert.strictEqual(sheet!.cssRules.length, 1);
    assert.strictEqual((sheet!.cssRules[0] as any).selectorText, ".b");
  });
});

it("falls back to <style> injection when unsupported", () => {
  restoreGlobals = installMockDom({ supported: false });
  const manager = new StylesheetManager();

  const result = manager.register("fallback", ".a { color: red; }");
  assert.strictEqual(result, null);

  const doc: any = (globalThis as any).document;
  const injected = doc.getElementById("sf-style-fallback");
  assert.ok(injected);
  assert.strictEqual(injected.textContent, ".a { color: red; }");

  manager.register("fallback", ".a { color: blue; }");
  const injected2 = doc.getElementById("sf-style-fallback");
  assert.strictEqual(injected2, injected);
  assert.strictEqual(injected2.textContent, ".a { color: blue; }");
});
