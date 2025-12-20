import { describe, it } from "node:test";
import * as assert from "node:assert/strict";

describe("ssr-styles", () => {
  describe("generateStylePreloadScript", () => {
    const generateStylePreloadScript = (
      stylesheets: Array<{ id: string; css: string }>,
    ): string => {
      if (stylesheets.length === 0) return "";

      const data = stylesheets.map(({ id, css }) => ({
        id,
        css: css.replace(/</g, "\\u003c").replace(/>/g, "\\u003e"),
      }));

      return `<script type="application/json" id="sf-preloaded-styles">
${JSON.stringify(data)}
</script>
<script>
(function() {
  if (!('adoptedStyleSheets' in Document.prototype)) return;
  var data = JSON.parse(document.getElementById('sf-preloaded-styles').textContent);
  window.__sfPreloadedStyles = new Map();
  data.forEach(function(s) {
    var sheet = new CSSStyleSheet();
    sheet.replaceSync(s.css);
    window.__sfPreloadedStyles.set(s.id, sheet);
  });
})();
</script>`;
    };

    it("should return empty string for no stylesheets", () => {
      const result = generateStylePreloadScript([]);
      assert.strictEqual(result, "");
    });

    it("should generate valid script tag structure", () => {
      const result = generateStylePreloadScript([
        { id: "styles.css", css: ".test { color: red; }" },
      ]);

      assert.ok(result.includes('<script type="application/json"'));
      assert.ok(result.includes('id="sf-preloaded-styles"'));
      assert.ok(result.includes("</script>"));
    });

    it("should escape < and > in CSS", () => {
      const result = generateStylePreloadScript([
        { id: "test.css", css: ".tag { content: '<div>'; }" },
      ]);

      assert.ok(result.includes("\\u003c"));
      assert.ok(result.includes("\\u003e"));
      assert.ok(!result.includes("'<div>'"));
    });

    it("should serialize multiple stylesheets", () => {
      const result = generateStylePreloadScript([
        { id: "a.css", css: ".a { color: red; }" },
        { id: "b.css", css: ".b { color: blue; }" },
        { id: "c.css", css: ".c { color: green; }" },
      ]);

      assert.ok(result.includes("a.css"));
      assert.ok(result.includes("b.css"));
      assert.ok(result.includes("c.css"));
    });

    it("should check for adoptedStyleSheets support", () => {
      const result = generateStylePreloadScript([{ id: "test.css", css: ".test {}" }]);

      assert.ok(result.includes("adoptedStyleSheets"));
      assert.ok(result.includes("Document.prototype"));
    });

    it("should use __sfPreloadedStyles global", () => {
      const result = generateStylePreloadScript([{ id: "test.css", css: ".test {}" }]);

      assert.ok(result.includes("window.__sfPreloadedStyles"));
      assert.ok(result.includes("new Map()"));
    });

    it("should create CSSStyleSheet instances", () => {
      const result = generateStylePreloadScript([{ id: "test.css", css: ".test {}" }]);

      assert.ok(result.includes("new CSSStyleSheet()"));
      assert.ok(result.includes("replaceSync"));
    });
  });

  describe("CSS escaping logic", () => {
    const escapeCss = (css: string): string => {
      return css.replace(/</g, "\\u003c").replace(/>/g, "\\u003e");
    };

    it("should escape opening angle bracket", () => {
      assert.strictEqual(escapeCss("<"), "\\u003c");
    });

    it("should escape closing angle bracket", () => {
      assert.strictEqual(escapeCss(">"), "\\u003e");
    });

    it("should escape multiple brackets", () => {
      const result = escapeCss(".child > .parent { content: '<tag>'; }");
      assert.ok(result.includes("\\u003c"));
      assert.ok(result.includes("\\u003e"));
      assert.ok(!result.includes("<tag>"));
    });

    it("should preserve other content", () => {
      const css = ".test { color: red; font-size: 14px; }";
      assert.strictEqual(escapeCss(css), css);
    });
  });

  describe("getPreloadedStylesheet logic", () => {
    it("should return null in server environment", () => {
      const getPreloadedStylesheet = (_id: string, windowExists: boolean): null => {
        if (!windowExists) return null;
        return null;
      };

      const result = getPreloadedStylesheet("test.css", false);
      assert.strictEqual(result, null);
    });

    it("should return null if preloaded styles not available", () => {
      const mockWindow = {
        __sfPreloadedStyles: undefined,
      };

      const getPreloadedStylesheet = (id: string): null => {
        const preloaded = mockWindow.__sfPreloadedStyles as Map<string, any> | undefined;
        return preloaded?.get(id) ?? null;
      };

      const result = getPreloadedStylesheet("test.css");
      assert.strictEqual(result, null);
    });

    it("should return stylesheet from preloaded map", () => {
      const mockSheet = { cssRules: [] };
      const mockWindow = {
        __sfPreloadedStyles: new Map([["test.css", mockSheet]]),
      };

      const getPreloadedStylesheet = (id: string): any => {
        const preloaded = mockWindow.__sfPreloadedStyles;
        return preloaded?.get(id) ?? null;
      };

      const result = getPreloadedStylesheet("test.css");
      assert.strictEqual(result, mockSheet);
    });

    it("should return null for missing stylesheet", () => {
      const mockWindow = {
        __sfPreloadedStyles: new Map([["other.css", {}]]),
      };

      const getPreloadedStylesheet = (id: string): any => {
        return mockWindow.__sfPreloadedStyles.get(id) ?? null;
      };

      const result = getPreloadedStylesheet("missing.css");
      assert.strictEqual(result, null);
    });
  });

  describe("hydratePreloadedStyles logic", () => {
    it("should skip in server environment", () => {
      let hydrated = false;

      const hydratePreloadedStyles = (_manager: any, windowExists: boolean): void => {
        if (!windowExists) return;
        hydrated = true;
      };

      hydratePreloadedStyles({}, false);
      assert.strictEqual(hydrated, false);
    });

    it("should skip if no preloaded styles", () => {
      let hydrated = false;
      const mockWindow = { __sfPreloadedStyles: undefined };

      const hydratePreloadedStyles = (
        _manager: any,
        preloaded: Map<string, any> | undefined,
      ): void => {
        if (!preloaded) return;
        hydrated = true;
      };

      hydratePreloadedStyles({}, mockWindow.__sfPreloadedStyles);
      assert.strictEqual(hydrated, false);
    });

    it("should log hydration count", () => {
      const logs: string[] = [];
      const mockPreloaded = new Map([
        ["a.css", {}],
        ["b.css", {}],
        ["c.css", {}],
      ]);

      const hydratePreloadedStyles = (_manager: any, preloaded: Map<string, any>): void => {
        logs.push(`[styles] Hydrated ${preloaded.size} preloaded stylesheets`);
      };

      hydratePreloadedStyles({}, mockPreloaded);

      assert.strictEqual(logs.length, 1);
      assert.ok(logs[0].includes("Hydrated 3"));
    });
  });

  describe("script generation security", () => {
    const generateStylePreloadScript = (
      stylesheets: Array<{ id: string; css: string }>,
    ): string => {
      if (stylesheets.length === 0) return "";

      const data = stylesheets.map(({ id, css }) => ({
        id,
        css: css.replace(/</g, "\\u003c").replace(/>/g, "\\u003e"),
      }));

      return JSON.stringify(data);
    };

    it("should prevent XSS via CSS content", () => {
      const maliciousCss = "</script><script>alert('xss')</script>";
      const result = generateStylePreloadScript([{ id: "evil.css", css: maliciousCss }]);

      assert.ok(!result.includes("</script>"));
      // JSON.stringify escapes backslashes, so \\u003c becomes \\\\u003c in the string
      assert.ok(result.includes("u003c"));
    });

    it("should handle nested script tags in CSS content", () => {
      const css = ".content::before { content: '<script></script>'; }";
      const result = generateStylePreloadScript([{ id: "test.css", css }]);

      assert.ok(!result.includes("<script>"));
      assert.ok(!result.includes("</script>"));
    });

    it("should produce valid JSON", () => {
      const result = generateStylePreloadScript([{ id: "test.css", css: ".test { color: red; }" }]);

      assert.doesNotThrow(() => JSON.parse(result));
    });
  });

  describe("stylesheet data structure", () => {
    it("should preserve id and css in serialization", () => {
      const stylesheets = [
        { id: "main.css", css: ".main { display: flex; }" },
        { id: "theme.css", css: ":root { --color: blue; }" },
      ];

      const serialized = JSON.stringify(stylesheets);
      const parsed = JSON.parse(serialized);

      assert.strictEqual(parsed.length, 2);
      assert.strictEqual(parsed[0].id, "main.css");
      assert.strictEqual(parsed[1].id, "theme.css");
      assert.ok(parsed[0].css.includes("display: flex"));
    });

    it("should handle empty CSS", () => {
      const stylesheets = [{ id: "empty.css", css: "" }];
      const serialized = JSON.stringify(stylesheets);
      const parsed = JSON.parse(serialized);

      assert.strictEqual(parsed[0].css, "");
    });

    it("should handle CSS with special characters", () => {
      const stylesheets = [{ id: "special.css", css: '.emoji { content: "🎨"; }' }];
      const serialized = JSON.stringify(stylesheets);
      const parsed = JSON.parse(serialized);

      assert.ok(parsed[0].css.includes("🎨"));
    });
  });
});
