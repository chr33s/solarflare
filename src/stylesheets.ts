/** Feature detection for Constructable Stylesheets. */
export const supportsConstructableStylesheets = (): boolean => {
  if (typeof window === "undefined") return false;
  try {
    new CSSStyleSheet();
    return true;
  } catch {
    return false;
  }
};

/** Stylesheet entry with metadata. */
interface StylesheetEntry {
  sheet: CSSStyleSheet;
  source: string;
  hash: string;
  consumers: Set<string>;
  isGlobal: boolean;
}

/** Stylesheet manager for efficient CSS handling. */
class StylesheetManager {
  #sheets = new Map<string, StylesheetEntry>();
  #documentSheets: CSSStyleSheet[] = [];

  /** Registers a stylesheet with the manager. */
  register(
    id: string,
    css: string,
    options: { isGlobal?: boolean; consumer?: string } = {},
  ): CSSStyleSheet | null {
    if (!this.#isSupported()) {
      this.#injectStyleElement(id, css);
      return null;
    }

    const existing = this.#sheets.get(id);
    const hash = this.#hash(css);

    if (existing) {
      if (existing.hash !== hash) {
        existing.sheet.replaceSync(css);
        existing.source = css;
        existing.hash = hash;
      }
      if (options.consumer) {
        existing.consumers.add(options.consumer);
      }
      return existing.sheet;
    }

    const sheet = new CSSStyleSheet();
    sheet.replaceSync(css);

    const entry: StylesheetEntry = {
      sheet,
      source: css,
      hash,
      consumers: new Set(options.consumer ? [options.consumer] : []),
      isGlobal: options.isGlobal ?? false,
    };

    this.#sheets.set(id, entry);

    if (entry.isGlobal) {
      this.#adoptToDocument(sheet);
    }

    return sheet;
  }

  /** Gets a registered stylesheet. */
  get(id: string): CSSStyleSheet | null {
    return this.#sheets.get(id)?.sheet ?? null;
  }

  /** Gets all stylesheets for a route/consumer. */
  getForConsumer(consumer: string): CSSStyleSheet[] {
    const sheets: CSSStyleSheet[] = [];

    for (const entry of this.#sheets.values()) {
      if (entry.isGlobal || entry.consumers.has(consumer)) {
        sheets.push(entry.sheet);
      }
    }

    return sheets;
  }

  /** Updates a stylesheet with new CSS (for HMR). */
  update(id: string, css: string): boolean {
    const entry = this.#sheets.get(id);
    if (!entry) return false;

    const hash = this.#hash(css);
    if (entry.hash === hash) return false; // No change

    // For small changes, try incremental update
    if (this.#canIncrementalUpdate(entry.source, css)) {
      this.#incrementalUpdate(entry.sheet, entry.source, css);
    } else {
      // Full replace for larger changes
      entry.sheet.replaceSync(css);
    }

    entry.source = css;
    entry.hash = hash;

    return true;
  }

  /** Inserts a single rule into a stylesheet. */
  insertRule(id: string, rule: string, index?: number): number {
    const entry = this.#sheets.get(id);
    if (!entry) return -1;

    try {
      const insertIndex = index ?? entry.sheet.cssRules.length;
      return entry.sheet.insertRule(rule, insertIndex);
    } catch (e) {
      console.warn(`[stylesheets] Failed to insert rule: ${rule}`, e);
      return -1;
    }
  }

  /** Deletes a rule from a stylesheet. */
  deleteRule(id: string, index: number): boolean {
    const entry = this.#sheets.get(id);
    if (!entry) return false;

    try {
      entry.sheet.deleteRule(index);
      return true;
    } catch {
      return false;
    }
  }

  /** Adopts stylesheets to a Shadow Root. */
  adoptToShadowRoot(shadowRoot: ShadowRoot, stylesheetIds: string[]): void {
    if (!this.#isSupported()) return;

    const sheets = stylesheetIds
      .map((id) => this.#sheets.get(id)?.sheet)
      .filter((s): s is CSSStyleSheet => s !== null);

    // Include global sheets
    const globalSheets = [...this.#sheets.values()].filter((e) => e.isGlobal).map((e) => e.sheet);

    shadowRoot.adoptedStyleSheets = [...globalSheets, ...sheets];
  }

  /** Removes a consumer from all its stylesheets. */
  removeConsumer(consumer: string): void {
    for (const [id, entry] of this.#sheets.entries()) {
      entry.consumers.delete(consumer);

      // Clean up orphaned non-global stylesheets
      if (!entry.isGlobal && entry.consumers.size === 0) {
        this.#sheets.delete(id);
      }
    }
  }

  /** Clears all stylesheets. */
  clear(): void {
    this.#sheets.clear();
    if (this.#isSupported()) {
      document.adoptedStyleSheets = [];
    }
  }

  // ========== Private Methods ==========

  #adoptToDocument(sheet: CSSStyleSheet): void {
    if (!this.#documentSheets.includes(sheet)) {
      this.#documentSheets.push(sheet);
      document.adoptedStyleSheets = [...this.#documentSheets];
    }
  }

  #isSupported(): boolean {
    return supportsConstructableStylesheets();
  }

  #hash(css: string): string {
    let hash = 0;
    for (let i = 0; i < css.length; i++) {
      const char = css.charCodeAt(i);
      hash = ((hash << 5) - hash + char) | 0;
    }
    return hash.toString(36);
  }

  #canIncrementalUpdate(oldCss: string, newCss: string): boolean {
    // Only do incremental updates for small changes
    const sizeDiff = Math.abs(newCss.length - oldCss.length);
    return sizeDiff < 500;
  }

  #incrementalUpdate(sheet: CSSStyleSheet, _oldCss: string, newCss: string): void {
    // Simple diff:  find changed rules
    // In practice, you'd use a proper CSS parser for this
    // For now, fall back to replaceSync
    sheet.replaceSync(newCss);
  }

  #injectStyleElement(id: string, css: string): void {
    // Fallback for browsers without Constructable Stylesheets
    let style = document.getElementById(`sf-style-${id}`) as HTMLStyleElement;

    if (!style) {
      style = document.createElement("style");
      style.id = `sf-style-${id}`;
      document.head.appendChild(style);
    }

    style.textContent = css;
  }
}

/** Global stylesheet manager instance. */
export const stylesheets = new StylesheetManager();

// Export for testing
export { StylesheetManager };
