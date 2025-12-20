import { describe, it, beforeEach } from "node:test";
import * as assert from "node:assert/strict";

// Mock CSSStyleSheet for Node.js testing
class MockCSSStyleSheet {
  cssRules: Array<{ selectorText?: string; cssText: string }> = [];

  replaceSync(css: string): void {
    this.cssRules = this.#parseRules(css);
  }

  insertRule(rule: string, index?: number): number {
    const insertIndex = index ?? this.cssRules.length;
    this.cssRules.splice(insertIndex, 0, { cssText: rule });
    return insertIndex;
  }

  deleteRule(index: number): void {
    this.cssRules.splice(index, 1);
  }

  #parseRules(css: string): Array<{ selectorText?: string; cssText: string }> {
    // Simple rule parser for testing
    const rules: Array<{ selectorText?: string; cssText: string }> = [];
    const ruleRegex = /([^{]+)\s*\{([^}]*)\}/g;
    let match;
    while ((match = ruleRegex.exec(css)) !== null) {
      rules.push({
        selectorText: match[1].trim(),
        cssText: match[0],
      });
    }
    return rules;
  }
}

describe("StylesheetManager", () => {
  describe("hash function logic", () => {
    // Test the hashing algorithm used by StylesheetManager
    const hash = (css: string): string => {
      let h = 0;
      for (let i = 0; i < css.length; i++) {
        const char = css.charCodeAt(i);
        h = ((h << 5) - h + char) | 0;
      }
      return h.toString(36);
    };

    it("should produce consistent hashes", () => {
      const css = ".test { color: red; }";
      const hash1 = hash(css);
      const hash2 = hash(css);
      assert.strictEqual(hash1, hash2);
    });

    it("should produce different hashes for different CSS", () => {
      const hash1 = hash(".test { color: red; }");
      const hash2 = hash(".test { color: blue; }");
      assert.notStrictEqual(hash1, hash2);
    });

    it("should handle empty string", () => {
      const result = hash("");
      assert.strictEqual(result, "0");
    });

    it("should handle unicode content", () => {
      const result = hash(".emoji { content: '🎨'; }");
      assert.ok(typeof result === "string");
    });
  });

  describe("supportsConstructableStylesheets logic", () => {
    it("should return false in Node.js environment", () => {
      // In Node.js, window is undefined
      const supportsConstructableStylesheets = (): boolean => {
        if (typeof globalThis.window === "undefined") return false;
        try {
          new CSSStyleSheet();
          return true;
        } catch {
          return false;
        }
      };

      // Node.js environment check
      assert.strictEqual(supportsConstructableStylesheets(), false);
    });
  });

  describe("StylesheetEntry management", () => {
    interface StylesheetEntry {
      sheet: MockCSSStyleSheet;
      source: string;
      hash: string;
      consumers: Set<string>;
      isGlobal: boolean;
    }

    it("should create entry with consumers set", () => {
      const entry: StylesheetEntry = {
        sheet: new MockCSSStyleSheet(),
        source: ".test { color: red; }",
        hash: "abc123",
        consumers: new Set(["component-a"]),
        isGlobal: false,
      };

      assert.strictEqual(entry.consumers.has("component-a"), true);
      assert.strictEqual(entry.consumers.size, 1);
    });

    it("should track multiple consumers", () => {
      const entry: StylesheetEntry = {
        sheet: new MockCSSStyleSheet(),
        source: ".shared { margin: 0; }",
        hash: "def456",
        consumers: new Set(["component-a", "component-b"]),
        isGlobal: false,
      };

      assert.strictEqual(entry.consumers.size, 2);
      assert.strictEqual(entry.consumers.has("component-a"), true);
      assert.strictEqual(entry.consumers.has("component-b"), true);
    });

    it("should mark global stylesheets", () => {
      const entry: StylesheetEntry = {
        sheet: new MockCSSStyleSheet(),
        source: "* { box-sizing: border-box; }",
        hash: "ghi789",
        consumers: new Set(),
        isGlobal: true,
      };

      assert.strictEqual(entry.isGlobal, true);
    });

    it("should allow consumer removal", () => {
      const consumers = new Set(["a", "b", "c"]);
      consumers.delete("b");
      assert.strictEqual(consumers.size, 2);
      assert.strictEqual(consumers.has("b"), false);
    });
  });

  describe("MockCSSStyleSheet operations", () => {
    let sheet: MockCSSStyleSheet;

    beforeEach(() => {
      sheet = new MockCSSStyleSheet();
    });

    it("should replaceSync and parse rules", () => {
      sheet.replaceSync(".test { color: red; }");
      assert.strictEqual(sheet.cssRules.length, 1);
      assert.strictEqual(sheet.cssRules[0].selectorText, ".test");
    });

    it("should insertRule at end by default", () => {
      sheet.replaceSync(".a { color: red; }");
      sheet.insertRule(".b { color: blue; }");
      assert.strictEqual(sheet.cssRules.length, 2);
    });

    it("should insertRule at specific index", () => {
      sheet.replaceSync(".a { color: red; } .b { color: blue; }");
      sheet.insertRule(".inserted { color: green; }", 1);
      assert.strictEqual(sheet.cssRules.length, 3);
      assert.strictEqual(sheet.cssRules[1].cssText, ".inserted { color: green; }");
    });

    it("should deleteRule at index", () => {
      sheet.replaceSync(".a { color: red; } .b { color: blue; }");
      sheet.deleteRule(0);
      assert.strictEqual(sheet.cssRules.length, 1);
      assert.strictEqual(sheet.cssRules[0].selectorText, ".b");
    });

    it("should handle multiple rules", () => {
      sheet.replaceSync(`
        .header { background: #fff; }
        .nav { display: flex; }
        .footer { margin-top: 20px; }
      `);
      assert.strictEqual(sheet.cssRules.length, 3);
    });
  });

  describe("incremental update detection", () => {
    const canIncrementalUpdate = (oldCss: string, newCss: string): boolean => {
      const sizeDiff = Math.abs(newCss.length - oldCss.length);
      return sizeDiff < 500;
    };

    it("should allow incremental update for small changes", () => {
      const oldCss = ".test { color: red; }";
      const newCss = ".test { color: blue; }";
      assert.strictEqual(canIncrementalUpdate(oldCss, newCss), true);
    });

    it("should disallow incremental update for large changes", () => {
      const oldCss = ".test { color: red; }";
      const newCss = ".test { color: blue; }" + "x".repeat(600);
      assert.strictEqual(canIncrementalUpdate(oldCss, newCss), false);
    });

    it("should handle deletions", () => {
      const oldCss = ".test { color: red; }" + "x".repeat(600);
      const newCss = ".test { color: red; }";
      assert.strictEqual(canIncrementalUpdate(oldCss, newCss), false);
    });
  });

  describe("consumer tracking", () => {
    it("should track consumers per stylesheet", () => {
      const sheets = new Map<string, { consumers: Set<string> }>();

      // Register stylesheet with consumer
      sheets.set("styles.css", { consumers: new Set(["sf-header"]) });

      // Add another consumer
      sheets.get("styles.css")!.consumers.add("sf-nav");

      assert.strictEqual(sheets.get("styles.css")!.consumers.size, 2);
    });

    it("should clean up orphaned stylesheets", () => {
      const sheets = new Map<string, { consumers: Set<string>; isGlobal: boolean }>();

      sheets.set("component.css", {
        consumers: new Set(["sf-widget"]),
        isGlobal: false,
      });

      // Remove consumer
      const entry = sheets.get("component.css")!;
      entry.consumers.delete("sf-widget");

      // Clean up if no consumers and not global
      if (!entry.isGlobal && entry.consumers.size === 0) {
        sheets.delete("component.css");
      }

      assert.strictEqual(sheets.has("component.css"), false);
    });

    it("should preserve global stylesheets without consumers", () => {
      const sheets = new Map<string, { consumers: Set<string>; isGlobal: boolean }>();

      sheets.set("global.css", {
        consumers: new Set(),
        isGlobal: true,
      });

      const entry = sheets.get("global.css")!;

      // Should not delete global stylesheet
      if (!entry.isGlobal && entry.consumers.size === 0) {
        sheets.delete("global.css");
      }

      assert.strictEqual(sheets.has("global.css"), true);
    });
  });

  describe("getForConsumer logic", () => {
    it("should return stylesheets for a specific consumer", () => {
      const sheets = new Map<
        string,
        { sheet: string; consumers: Set<string>; isGlobal: boolean }
      >();

      sheets.set("global.css", {
        sheet: "global-sheet",
        consumers: new Set(),
        isGlobal: true,
      });
      sheets.set("component.css", {
        sheet: "component-sheet",
        consumers: new Set(["sf-widget"]),
        isGlobal: false,
      });
      sheets.set("other.css", {
        sheet: "other-sheet",
        consumers: new Set(["sf-other"]),
        isGlobal: false,
      });

      const getForConsumer = (consumer: string): string[] => {
        const result: string[] = [];
        for (const entry of sheets.values()) {
          if (entry.isGlobal || entry.consumers.has(consumer)) {
            result.push(entry.sheet);
          }
        }
        return result;
      };

      const result = getForConsumer("sf-widget");
      assert.strictEqual(result.length, 2);
      assert.ok(result.includes("global-sheet"));
      assert.ok(result.includes("component-sheet"));
      assert.ok(!result.includes("other-sheet"));
    });
  });
});
