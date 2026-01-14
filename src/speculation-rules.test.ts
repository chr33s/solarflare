import { describe, it, beforeEach, mock } from "node:test";
import * as assert from "node:assert/strict";
import {
  supportsSpeculationRules,
  injectSpeculationRules,
  clearSpeculationRules,
  createPrefetchListRule,
  createPrerenderListRule,
  createDocumentRule,
  createSelectorRule,
  buildRouteSpeculationRules,
  renderSpeculationRulesTag,
  type SpeculationRules,
} from "./speculation-rules.ts";

describe("supportsSpeculationRules", () => {
  it("should return false when HTMLScriptElement is undefined", () => {
    const original = globalThis.HTMLScriptElement;
    // @ts-expect-error testing undefined case
    globalThis.HTMLScriptElement = undefined;

    assert.strictEqual(supportsSpeculationRules(), false);

    globalThis.HTMLScriptElement = original;
  });

  it("should return false when supports method is not available", () => {
    const original = globalThis.HTMLScriptElement;
    // @ts-expect-error testing missing supports
    globalThis.HTMLScriptElement = {};

    assert.strictEqual(supportsSpeculationRules(), false);

    globalThis.HTMLScriptElement = original;
  });

  it("should return true when speculationrules is supported", () => {
    const original = globalThis.HTMLScriptElement;
    // @ts-expect-error testing mock
    globalThis.HTMLScriptElement = {
      supports: (type: string) => type === "speculationrules",
    };

    assert.strictEqual(supportsSpeculationRules(), true);

    globalThis.HTMLScriptElement = original;
  });
});

describe("injectSpeculationRules", () => {
  let mockHead: { appendChild: ReturnType<typeof mock.fn> };
  let mockScript: { type: string; textContent: string };

  beforeEach(() => {
    mockScript = { type: "", textContent: "" };
    mockHead = { appendChild: mock.fn() };

    Object.defineProperty(globalThis, "document", {
      value: {
        createElement: () => mockScript,
        head: mockHead,
      },
      writable: true,
      configurable: true,
    });
  });

  it("should return null when document is undefined", () => {
    // @ts-expect-error testing undefined case
    globalThis.document = undefined;

    const result = injectSpeculationRules({ prefetch: [] });
    assert.strictEqual(result, null);
  });

  it("should create script with type speculationrules", () => {
    const rules: SpeculationRules = {
      prefetch: [{ source: "list", urls: ["/page1", "/page2"] }],
    };

    injectSpeculationRules(rules);

    assert.strictEqual(mockScript.type, "speculationrules");
    assert.strictEqual(mockScript.textContent, JSON.stringify(rules));
    assert.strictEqual(mockHead.appendChild.mock.calls.length, 1);
  });

  it("should handle complex rules object", () => {
    const rules: SpeculationRules = {
      prefetch: [
        { source: "list", urls: ["/about", "/contact"], eagerness: "moderate" },
        { source: "document", where: { href_matches: "/blog/*" } },
      ],
      prerender: [{ source: "list", urls: ["/home"], eagerness: "immediate" }],
    };

    injectSpeculationRules(rules);

    assert.strictEqual(mockScript.textContent, JSON.stringify(rules));
  });
});

describe("clearSpeculationRules", () => {
  it("should do nothing when document is undefined", () => {
    // @ts-expect-error testing undefined case
    globalThis.document = undefined;

    // Should not throw
    clearSpeculationRules();
  });

  it("should remove all speculationrules scripts", () => {
    const mockRemove = mock.fn();
    const mockScripts = [{ remove: mockRemove }, { remove: mockRemove }];

    Object.defineProperty(globalThis, "document", {
      value: {
        querySelectorAll: (selector: string) => {
          assert.strictEqual(selector, 'script[type="speculationrules"]');
          return mockScripts;
        },
      },
      writable: true,
      configurable: true,
    });

    clearSpeculationRules();

    assert.strictEqual(mockRemove.mock.calls.length, 2);
  });
});

describe("createPrefetchListRule", () => {
  it("should create a list rule with default options", () => {
    const rule = createPrefetchListRule(["/page1", "/page2"]);

    assert.deepStrictEqual(rule, {
      source: "list",
      urls: ["/page1", "/page2"],
    });
  });

  it("should create a list rule with custom options", () => {
    const rule = createPrefetchListRule(["/page1"], {
      eagerness: "eager",
      referrer_policy: "no-referrer",
    });

    assert.deepStrictEqual(rule, {
      source: "list",
      urls: ["/page1"],
      eagerness: "eager",
      referrer_policy: "no-referrer",
    });
  });
});

describe("createPrerenderListRule", () => {
  it("should create a prerender list rule", () => {
    const rule = createPrerenderListRule(["/home"], { eagerness: "immediate" });

    assert.deepStrictEqual(rule, {
      source: "list",
      urls: ["/home"],
      eagerness: "immediate",
    });
  });
});

describe("createDocumentRule", () => {
  it("should create a document rule with single pattern", () => {
    const rule = createDocumentRule("/blog/*");

    assert.deepStrictEqual(rule, {
      source: "document",
      where: { href_matches: "/blog/*" },
    });
  });

  it("should create a document rule with multiple patterns", () => {
    const rule = createDocumentRule(["/blog/*", "/news/*"], { eagerness: "moderate" });

    assert.deepStrictEqual(rule, {
      source: "document",
      where: { href_matches: ["/blog/*", "/news/*"] },
      eagerness: "moderate",
    });
  });
});

describe("createSelectorRule", () => {
  it("should create a selector-based document rule", () => {
    const rule = createSelectorRule("a.prefetch", { eagerness: "conservative" });

    assert.deepStrictEqual(rule, {
      source: "document",
      where: { selector_matches: "a.prefetch" },
      eagerness: "conservative",
    });
  });
});

describe("buildRouteSpeculationRules", () => {
  it("should return empty object for no routes", () => {
    const rules = buildRouteSpeculationRules([]);
    assert.deepStrictEqual(rules, {});
  });

  it("should skip dynamic routes with params", () => {
    const rules = buildRouteSpeculationRules([
      { pattern: "/users/:id" },
      { pattern: "/posts/*" },
      { pattern: "/about" },
    ]);

    assert.deepStrictEqual(rules, {
      prefetch: [{ source: "list", urls: ["/about"], eagerness: "moderate" }],
    });
  });

  it("should separate prefetch and prerender routes", () => {
    const rules = buildRouteSpeculationRules([
      { pattern: "/", prerender: true },
      { pattern: "/about" },
      { pattern: "/contact", prerender: true },
    ]);

    assert.deepStrictEqual(rules, {
      prefetch: [{ source: "list", urls: ["/about"], eagerness: "moderate" }],
      prerender: [{ source: "list", urls: ["/", "/contact"], eagerness: "moderate" }],
    });
  });

  it("should apply base path", () => {
    const rules = buildRouteSpeculationRules(
      [{ pattern: "/about" }, { pattern: "/contact" }],
      "/app",
    );

    assert.deepStrictEqual(rules, {
      prefetch: [{ source: "list", urls: ["/app/about", "/app/contact"], eagerness: "moderate" }],
    });
  });

  it("should handle all prerender routes", () => {
    const rules = buildRouteSpeculationRules([
      { pattern: "/home", prerender: true },
      { pattern: "/landing", prerender: true },
    ]);

    assert.deepStrictEqual(rules, {
      prerender: [{ source: "list", urls: ["/home", "/landing"], eagerness: "moderate" }],
    });
  });
});

describe("renderSpeculationRulesTag", () => {
  it("should render valid script tag", () => {
    const rules: SpeculationRules = {
      prefetch: [{ source: "list", urls: ["/about"] }],
    };

    const html = renderSpeculationRulesTag(rules);

    assert.strictEqual(
      html,
      `<script type="speculationrules">{"prefetch":[{"source":"list","urls":["/about"]}]}</script>`,
    );
  });

  it("should render empty rules", () => {
    const html = renderSpeculationRulesTag({});
    assert.strictEqual(html, '<script type="speculationrules">{}</script>');
  });

  it("should render complex rules", () => {
    const rules: SpeculationRules = {
      prefetch: [{ source: "document", where: { href_matches: "/blog/*" }, eagerness: "moderate" }],
      prerender: [{ source: "list", urls: ["/"], eagerness: "immediate" }],
    };

    const html = renderSpeculationRulesTag(rules);

    assert.ok(html.includes('type="speculationrules"'));
    assert.ok(html.includes('"prefetch"'));
    assert.ok(html.includes('"prerender"'));

    // Verify it's valid JSON inside
    const jsonStr = html.replace(/<script[^>]*>/, "").replace("</script>", "");
    const parsed = JSON.parse(jsonStr);
    assert.deepStrictEqual(parsed, rules);
  });
});
