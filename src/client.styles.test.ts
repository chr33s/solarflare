import { describe, it, beforeEach, afterEach } from "node:test";
import * as assert from "node:assert/strict";

import { applyStyles, cleanupStyles, loadComponentStyles } from "./client.styles.ts";

class MockCSSStyleSheet {
  cssRules: unknown[] = [];
  replaceSync(_css: string) {}
}

function installMockDom(options: { supported: boolean }) {
  const prevWindow = (globalThis as any).window;
  const prevDocument = (globalThis as any).document;
  const prevCSSStyleSheet = (globalThis as any).CSSStyleSheet;
  const prevFetch = (globalThis as any).fetch;

  const elementsById = new Map<string, any>();

  (globalThis as any).document = {
    adoptedStyleSheets: [] as any[],
    head: {
      appendChild(el: any) {
        if (el?.id) elementsById.set(el.id, el);
      },
    },
    createElement(tag: string) {
      return { tagName: tag.toUpperCase(), id: "", textContent: "" };
    },
    getElementById(id: string) {
      return elementsById.get(id) ?? null;
    },
  };

  if (options.supported) {
    (globalThis as any).window = {};
    (globalThis as any).CSSStyleSheet = MockCSSStyleSheet;
  } else {
    delete (globalThis as any).window;
    delete (globalThis as any).CSSStyleSheet;
  }

  return () => {
    (globalThis as any).window = prevWindow;
    (globalThis as any).document = prevDocument;
    (globalThis as any).CSSStyleSheet = prevCSSStyleSheet;
    (globalThis as any).fetch = prevFetch;
  };
}

let restoreGlobals: (() => void) | undefined;

afterEach(() => {
  restoreGlobals?.();
  restoreGlobals = undefined;
});

it("loadComponentStyles caches per tag (no double fetch)", async () => {
  restoreGlobals = installMockDom({ supported: false });

  let fetchCalls = 0;
  (globalThis as any).fetch = async (_url: string) => {
    fetchCalls++;
    return new Response(".a { color: red; }");
  };

  const tag = "sf-widget-cache";
  const urls = ["/component.css"];
  const sheets1 = await loadComponentStyles(tag, urls);
  const sheets2 = await loadComponentStyles(tag, urls);

  assert.deepStrictEqual(sheets1, []);
  assert.deepStrictEqual(sheets2, []);
  assert.strictEqual(fetchCalls, 1);

  cleanupStyles(tag);
});

it("cleanupStyles clears per-tag cache (fetch happens again)", async () => {
  restoreGlobals = installMockDom({ supported: false });

  let fetchCalls = 0;
  (globalThis as any).fetch = async (_url: string) => {
    fetchCalls++;
    return new Response(".a { color: red; }");
  };

  const tag = "sf-widget-cleanup";
  const urls = ["/component.css"];
  await loadComponentStyles(tag, urls);
  cleanupStyles(tag);
  await loadComponentStyles(tag, urls);

  assert.strictEqual(fetchCalls, 2);

  cleanupStyles(tag);
});

describe("applyStyles", () => {
  beforeEach(() => {
    restoreGlobals?.();
    restoreGlobals = installMockDom({ supported: true });
  });

  it("applies to shadowRoot when present", () => {
    const sheet1 = new (globalThis as any).CSSStyleSheet();
    const sheet2 = new (globalThis as any).CSSStyleSheet();
    const element = {
      shadowRoot: {
        adoptedStyleSheets: [] as any[],
      },
    } as unknown as HTMLElement;

    applyStyles(element, [sheet1, sheet2]);
    assert.deepStrictEqual((element.shadowRoot as any).adoptedStyleSheets, [sheet1, sheet2]);
  });

  it("applies to document for light DOM, de-duplicating sheets", () => {
    const sheet1 = new (globalThis as any).CSSStyleSheet();
    const sheet2 = new (globalThis as any).CSSStyleSheet();

    (globalThis as any).document.adoptedStyleSheets = [sheet1];
    const element = { shadowRoot: null } as unknown as HTMLElement;

    applyStyles(element, [sheet1, sheet2]);
    assert.deepStrictEqual((globalThis as any).document.adoptedStyleSheets, [sheet1, sheet2]);
  });
});
