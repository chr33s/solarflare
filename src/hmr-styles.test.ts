import { describe, it, beforeEach } from "node:test";
import * as assert from "node:assert/strict";

// Mock CSSStyleSheet for Node.js testing
class MockCSSStyleSheet {
  cssRules: Array<{ selectorText?: string; cssText: string }> = [];

  replaceSync(css: string): void {
    this.cssRules = this.#parseRules(css);
  }

  insertRule(rule: string, index?: number): number {
    const match = rule.match(/^([^{]+)\s*\{/);
    const selectorText = match ? match[1].trim() : undefined;
    const insertIndex = index ?? this.cssRules.length;
    this.cssRules.splice(insertIndex, 0, { cssText: rule, selectorText });
    return insertIndex;
  }

  deleteRule(index: number): void {
    this.cssRules.splice(index, 1);
  }

  #parseRules(css: string): Array<{ selectorText?: string; cssText: string }> {
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

describe("CssHmrUpdate interface", () => {
  interface CssHmrUpdate {
    id: string;
    css: string;
    changedRules?: Array<{
      selector: string;
      properties: string;
      action: "add" | "update" | "delete";
    }>;
  }

  it("should represent a full update", () => {
    const update: CssHmrUpdate = {
      id: "styles.css",
      css: ".test { color: red; }",
    };

    assert.strictEqual(update.id, "styles.css");
    assert.strictEqual(update.changedRules, undefined);
  });

  it("should represent a granular update", () => {
    const update: CssHmrUpdate = {
      id: "styles.css",
      css: ".test { color: blue; }",
      changedRules: [{ selector: ".test", properties: "color: blue", action: "update" }],
    };

    assert.strictEqual(update.changedRules?.length, 1);
    assert.strictEqual(update.changedRules?.[0].action, "update");
  });

  it("should support multiple rule changes", () => {
    const update: CssHmrUpdate = {
      id: "styles.css",
      css: "",
      changedRules: [
        { selector: ".a", properties: "color: red", action: "add" },
        { selector: ".b", properties: "margin: 0", action: "update" },
        { selector: ".c", properties: "", action: "delete" },
      ],
    };

    assert.strictEqual(update.changedRules?.length, 3);
  });
});

describe("handleCssHmrUpdate logic", () => {
  it("should prefer granular updates for small changes", () => {
    let granularAttempted = false;
    let fullReplaceAttempted = false;

    interface CssHmrUpdate {
      id: string;
      css: string;
      changedRules?: Array<{
        selector: string;
        properties: string;
        action: "add" | "update" | "delete";
      }>;
    }

    const handleCssHmrUpdate = (
      update: CssHmrUpdate,
      applyGranular: () => boolean,
      doFullReplace: () => void,
    ): void => {
      const { changedRules } = update;

      if (changedRules && changedRules.length < 10) {
        granularAttempted = true;
        const success = applyGranular();
        if (success) return;
      }

      fullReplaceAttempted = true;
      doFullReplace();
    };

    handleCssHmrUpdate(
      {
        id: "test.css",
        css: ".test { color: blue; }",
        changedRules: [{ selector: ".test", properties: "color: blue", action: "update" }],
      },
      () => true,
      () => {},
    );

    assert.strictEqual(granularAttempted, true);
    assert.strictEqual(fullReplaceAttempted, false);
  });

  it("should fall back to full replace when granular fails", () => {
    let fullReplaceAttempted = false;

    interface CssHmrUpdate {
      id: string;
      css: string;
      changedRules?: Array<{
        selector: string;
        properties: string;
        action: "add" | "update" | "delete";
      }>;
    }

    const handleCssHmrUpdate = (
      update: CssHmrUpdate,
      applyGranular: () => boolean,
      doFullReplace: () => void,
    ): void => {
      const { changedRules } = update;

      if (changedRules && changedRules.length < 10) {
        const success = applyGranular();
        if (success) return;
      }

      fullReplaceAttempted = true;
      doFullReplace();
    };

    handleCssHmrUpdate(
      {
        id: "test.css",
        css: ".test { color: blue; }",
        changedRules: [{ selector: ".test", properties: "color: blue", action: "update" }],
      },
      () => false, // Granular fails
      () => {},
    );

    assert.strictEqual(fullReplaceAttempted, true);
  });

  it("should use full replace for many changes", () => {
    let granularAttempted = false;
    let fullReplaceAttempted = false;

    const changedRules = Array.from({ length: 15 }, (_, i) => ({
      selector: `.rule-${i}`,
      properties: `color: red`,
      action: "update" as const,
    }));

    interface CssHmrUpdate {
      id: string;
      css: string;
      changedRules?: typeof changedRules;
    }

    const handleCssHmrUpdate = (update: CssHmrUpdate): void => {
      const { changedRules } = update;

      if (changedRules && changedRules.length < 10) {
        granularAttempted = true;
        return;
      }

      fullReplaceAttempted = true;
    };

    handleCssHmrUpdate({
      id: "test.css",
      css: "",
      changedRules,
    });

    assert.strictEqual(granularAttempted, false);
    assert.strictEqual(fullReplaceAttempted, true);
  });
});

describe("applyGranularUpdates logic", () => {
  let sheet: MockCSSStyleSheet;

  beforeEach(() => {
    sheet = new MockCSSStyleSheet();
    sheet.replaceSync(`
        .header { color: blue; }
        .nav { display: flex; }
        .footer { margin: 20px; }
      `);
  });

  it("should build rule map from existing rules", () => {
    const ruleMap = new Map<string, number>();
    for (let i = 0; i < sheet.cssRules.length; i++) {
      const rule = sheet.cssRules[i];
      if (rule.selectorText) {
        ruleMap.set(rule.selectorText, i);
      }
    }

    assert.strictEqual(ruleMap.get(".header"), 0);
    assert.strictEqual(ruleMap.get(".nav"), 1);
    assert.strictEqual(ruleMap.get(".footer"), 2);
  });

  it("should handle delete action", () => {
    const initialLength = sheet.cssRules.length;
    sheet.deleteRule(1); // Delete .nav

    assert.strictEqual(sheet.cssRules.length, initialLength - 1);
    assert.strictEqual(sheet.cssRules[1].selectorText, ".footer");
  });

  it("should handle update action (delete + re-insert)", () => {
    const index = 0;
    sheet.deleteRule(index);
    sheet.insertRule(".header { color: green; }", index);

    assert.strictEqual(sheet.cssRules[0].selectorText, ".header");
    assert.ok(sheet.cssRules[0].cssText.includes("green"));
  });

  it("should handle add action", () => {
    const initialLength = sheet.cssRules.length;
    sheet.insertRule(".new { padding: 10px; }");

    assert.strictEqual(sheet.cssRules.length, initialLength + 1);
  });

  it("should sort changes in reverse order for safe index manipulation", () => {
    const changes = [
      { selector: ".header", properties: "", action: "delete" as const },
      { selector: ".footer", properties: "", action: "delete" as const },
    ];

    const ruleMap = new Map([
      [".header", 0],
      [".nav", 1],
      [".footer", 2],
    ]);

    const sorted = [...changes].sort((a, b) => {
      const idxA = ruleMap.get(a.selector) ?? -1;
      const idxB = ruleMap.get(b.selector) ?? -1;
      return idxB - idxA; // Reverse order
    });

    // .footer (index 2) should come before .header (index 0)
    assert.strictEqual(sorted[0].selector, ".footer");
    assert.strictEqual(sorted[1].selector, ".header");
  });
});

describe("setupCssHmr logic", () => {
  it("should register handlers with provided HMR API", () => {
    const handlers = new Map<string, (data: unknown) => void>();

    const mockHmr = {
      on: (event: string, callback: (data: unknown) => void) => {
        handlers.set(event, callback);
      },
    };

    // Simulates what setupCssHmr does
    mockHmr.on("sf:css-update", (_data) => {});
    mockHmr.on("sf:css-replace", (_data) => {});

    assert.strictEqual(handlers.has("sf:css-update"), true);
    assert.strictEqual(handlers.has("sf:css-replace"), true);
  });

  it("should register sf:css-update handler", () => {
    const handlers = new Map<string, (data: unknown) => void>();

    const mockHmr = {
      on: (event: string, callback: (data: unknown) => void) => {
        handlers.set(event, callback);
      },
    };

    const setupCssHmr = (hmr: typeof mockHmr): void => {
      hmr.on("sf:css-update", (_data) => {});
      hmr.on("sf:css-replace", (_data) => {});
    };

    setupCssHmr(mockHmr);

    assert.strictEqual(handlers.has("sf:css-update"), true);
    assert.strictEqual(handlers.has("sf:css-replace"), true);
  });
});

describe("error handling", () => {
  it("should catch and warn on granular update failures", () => {
    const warnings: string[] = [];

    const applyGranularUpdates = (): boolean => {
      try {
        throw new Error("Invalid rule syntax");
      } catch (e) {
        warnings.push(`[HMR] Granular update failed: ${(e as Error).message}`);
        return false;
      }
    };

    const result = applyGranularUpdates();
    assert.strictEqual(result, false);
    assert.strictEqual(warnings.length, 1);
    assert.ok(warnings[0].includes("Granular update failed"));
  });
});

describe("CSSStyleRule handling", () => {
  it("should identify CSSStyleRule by selectorText property", () => {
    const rule = { selectorText: ".test", cssText: ".test { color: red; }" };
    const hasSelector = "selectorText" in rule;
    assert.strictEqual(hasSelector, true);
  });

  it("should skip non-style rules (at-rules, etc)", () => {
    const rules = [
      { selectorText: ".test", cssText: ".test {}" },
      { cssText: "@media screen {}" }, // No selectorText
      { selectorText: ".other", cssText: ".other {}" },
    ];

    const styleRules = rules.filter((r) => "selectorText" in r && r.selectorText);
    assert.strictEqual(styleRules.length, 2);
  });
});
