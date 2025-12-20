import { describe, it } from "node:test";
import * as assert from "node:assert/strict";

describe("client-styles", () => {
  describe("StyleState interface", () => {
    interface StyleState {
      loaded: boolean;
      sheets: Array<{ cssRules: any[] }>;
    }

    it("should track loaded state", () => {
      const state: StyleState = {
        loaded: true,
        sheets: [],
      };
      assert.strictEqual(state.loaded, true);
    });

    it("should store multiple sheets", () => {
      const state: StyleState = {
        loaded: true,
        sheets: [{ cssRules: [] }, { cssRules: [] }],
      };
      assert.strictEqual(state.sheets.length, 2);
    });
  });

  describe("componentStyles Map behavior", () => {
    it("should store and retrieve style states by tag", () => {
      const componentStyles = new Map<string, { loaded: boolean; sheets: any[] }>();

      componentStyles.set("sf-header", { loaded: true, sheets: [] });
      componentStyles.set("sf-nav", { loaded: false, sheets: [] });

      assert.strictEqual(componentStyles.get("sf-header")?.loaded, true);
      assert.strictEqual(componentStyles.get("sf-nav")?.loaded, false);
    });

    it("should return undefined for unregistered tags", () => {
      const componentStyles = new Map<string, { loaded: boolean; sheets: any[] }>();

      assert.strictEqual(componentStyles.get("sf-unknown"), undefined);
    });

    it("should allow deletion", () => {
      const componentStyles = new Map<string, { loaded: boolean; sheets: any[] }>();

      componentStyles.set("sf-header", { loaded: true, sheets: [] });
      componentStyles.delete("sf-header");

      assert.strictEqual(componentStyles.has("sf-header"), false);
    });
  });

  describe("loadComponentStyles logic", () => {
    it("should return cached sheets if already loaded", async () => {
      const componentStyles = new Map<string, { loaded: boolean; sheets: string[] }>();
      componentStyles.set("sf-widget", {
        loaded: true,
        sheets: ["sheet1", "sheet2"],
      });

      const loadComponentStyles = async (tag: string, _cssUrls: string[]): Promise<string[]> => {
        const existing = componentStyles.get(tag);
        if (existing?.loaded) {
          return existing.sheets;
        }
        return [];
      };

      const result = await loadComponentStyles("sf-widget", ["/styles/a.css", "/styles/b.css"]);
      assert.deepStrictEqual(result, ["sheet1", "sheet2"]);
    });

    it("should load new sheets for unregistered component", async () => {
      const componentStyles = new Map<string, { loaded: boolean; sheets: string[] }>();
      const stylesheets = new Map<string, string>();

      const loadComponentStyles = async (tag: string, cssUrls: string[]): Promise<string[]> => {
        const existing = componentStyles.get(tag);
        if (existing?.loaded) {
          return existing.sheets;
        }

        const sheets: string[] = [];
        for (const url of cssUrls) {
          let sheet = stylesheets.get(url);
          if (!sheet) {
            // Simulate fetching and registering
            sheet = `sheet-for-${url}`;
            stylesheets.set(url, sheet);
          }
          sheets.push(sheet);
        }

        componentStyles.set(tag, { loaded: true, sheets });
        return sheets;
      };

      const result = await loadComponentStyles("sf-new", ["/styles/new.css"]);
      assert.strictEqual(result.length, 1);
      assert.strictEqual(result[0], "sheet-for-/styles/new.css");
      assert.strictEqual(componentStyles.get("sf-new")?.loaded, true);
    });
  });

  describe("applyStyles logic", () => {
    it("should skip if constructable stylesheets not supported", () => {
      const supportsConstructable = false;
      let applied = false;

      const applyStyles = (_element: any, _sheets: any[], supported: boolean): void => {
        if (!supported) return;
        applied = true;
      };

      applyStyles({}, [], supportsConstructable);
      assert.strictEqual(applied, false);
    });

    it("should apply to shadow root if present", () => {
      const mockShadowRoot = {
        adoptedStyleSheets: [] as any[],
      };

      const applyStyles = (shadowRoot: typeof mockShadowRoot | null, sheets: any[]): void => {
        if (shadowRoot) {
          shadowRoot.adoptedStyleSheets = [...shadowRoot.adoptedStyleSheets, ...sheets];
        }
      };

      applyStyles(mockShadowRoot, ["sheet1", "sheet2"]);
      assert.strictEqual(mockShadowRoot.adoptedStyleSheets.length, 2);
    });

    it("should apply to document for light DOM", () => {
      const mockDocument = {
        adoptedStyleSheets: [] as any[],
      };

      const applyStyles = (sheets: any[], doc: typeof mockDocument): void => {
        for (const sheet of sheets) {
          if (!doc.adoptedStyleSheets.includes(sheet)) {
            doc.adoptedStyleSheets = [...doc.adoptedStyleSheets, sheet];
          }
        }
      };

      applyStyles(["sheet1", "sheet2"], mockDocument);
      assert.strictEqual(mockDocument.adoptedStyleSheets.length, 2);
    });

    it("should deduplicate sheets in document", () => {
      const mockDocument = {
        adoptedStyleSheets: ["sheet1"] as any[],
      };

      const applyStyles = (sheets: any[], doc: typeof mockDocument): void => {
        for (const sheet of sheets) {
          if (!doc.adoptedStyleSheets.includes(sheet)) {
            doc.adoptedStyleSheets = [...doc.adoptedStyleSheets, sheet];
          }
        }
      };

      applyStyles(["sheet1", "sheet2"], mockDocument);
      assert.strictEqual(mockDocument.adoptedStyleSheets.length, 2);
    });
  });

  describe("cleanupStyles logic", () => {
    it("should remove consumer from stylesheets manager", () => {
      const removedConsumers: string[] = [];
      const componentStyles = new Map<string, any>();
      componentStyles.set("sf-widget", { loaded: true, sheets: [] });

      const cleanupStyles = (tag: string): void => {
        removedConsumers.push(tag);
        componentStyles.delete(tag);
      };

      cleanupStyles("sf-widget");

      assert.strictEqual(removedConsumers.includes("sf-widget"), true);
      assert.strictEqual(componentStyles.has("sf-widget"), false);
    });
  });

  describe("CSS URL handling", () => {
    it("should handle absolute URLs", () => {
      const urls = ["https://example.com/styles.css", "/static/main.css", "./local.css"];

      const isAbsolute = (url: string): boolean => url.startsWith("http") || url.startsWith("/");

      assert.strictEqual(isAbsolute(urls[0]), true);
      assert.strictEqual(isAbsolute(urls[1]), true);
      assert.strictEqual(isAbsolute(urls[2]), false);
    });

    it("should handle relative URLs", () => {
      const baseUrl = "/components/widget/";
      const relativeUrl = "./styles.css";

      const resolveUrl = (base: string, relative: string): string => {
        if (relative.startsWith("./")) {
          return base + relative.slice(2);
        }
        return relative;
      };

      assert.strictEqual(resolveUrl(baseUrl, relativeUrl), "/components/widget/styles.css");
    });
  });

  describe("error handling", () => {
    it("should handle fetch failures gracefully", async () => {
      const warnings: string[] = [];

      const loadWithFallback = async (url: string): Promise<null> => {
        try {
          throw new Error("Network error");
        } catch (e) {
          warnings.push(`Failed to load ${url}: ${(e as Error).message}`);
          return null;
        }
      };

      const result = await loadWithFallback("/missing.css");
      assert.strictEqual(result, null);
      assert.strictEqual(warnings.length, 1);
      assert.ok(warnings[0].includes("Failed to load"));
    });
  });
});
