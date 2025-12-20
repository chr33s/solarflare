/**
 * HMR support for Constructable Stylesheets.
 * Enables instant style updates without page reload.
 */

import { stylesheets } from "./stylesheets.ts";

/** CSS HMR update payload. */
export interface CssHmrUpdate {
  id: string;
  css: string;
  /** Specific rules that changed (for incremental updates) */
  changedRules?: Array<{
    selector: string;
    properties: string;
    action: "add" | "update" | "delete";
  }>;
}

/**
 * Handles CSS HMR updates.
 * Uses insertRule/deleteRule for granular updates when possible.
 */
export function handleCssHmrUpdate(update: CssHmrUpdate): void {
  const { id, css, changedRules } = update;

  // Try granular update first
  if (changedRules && changedRules.length < 10) {
    const success = applyGranularUpdates(id, changedRules);
    if (success) {
      console.log(`[HMR] Incrementally updated ${changedRules.length} rules in ${id}`);
      return;
    }
  }

  // Fall back to full replacement
  const updated = stylesheets.update(id, css);
  if (updated) {
    console.log(`[HMR] Replaced stylesheet:  ${id}`);
  }
}

/**
 * Applies granular rule updates using insertRule/deleteRule.
 * This is faster than replaceSync for small changes.
 */
function applyGranularUpdates(id: string, changes: CssHmrUpdate["changedRules"]): boolean {
  if (!changes) return false;

  const sheet = stylesheets.get(id);
  if (!sheet) return false;

  try {
    // Build a map of existing rules by selector
    const ruleMap = new Map<string, number>();
    for (let i = 0; i < sheet.cssRules.length; i++) {
      const rule = sheet.cssRules[i];
      if (rule instanceof CSSStyleRule) {
        ruleMap.set(rule.selectorText, i);
      }
    }

    // Process changes in reverse order to maintain indices
    const sortedChanges = [...changes].sort((a, b) => {
      const idxA = ruleMap.get(a.selector) ?? -1;
      const idxB = ruleMap.get(b.selector) ?? -1;
      return idxB - idxA; // Reverse order
    });

    for (const change of sortedChanges) {
      const existingIndex = ruleMap.get(change.selector);

      switch (change.action) {
        case "delete":
          if (existingIndex !== undefined) {
            sheet.deleteRule(existingIndex);
          }
          break;

        case "update":
          if (existingIndex !== undefined) {
            // Delete and re-insert at same position
            sheet.deleteRule(existingIndex);
            sheet.insertRule(`${change.selector} { ${change.properties} }`, existingIndex);
          }
          break;

        case "add":
          sheet.insertRule(`${change.selector} { ${change.properties} }`, sheet.cssRules.length);
          break;
      }
    }

    return true;
  } catch (e) {
    console.warn("[HMR] Granular update failed, falling back to full replace", e);
    return false;
  }
}

/**
 * Registers HMR handlers for CSS files.
 * @param hmr - HMR API instance from hmr-client
 */
export function setupCssHmr(hmr: {
  on: (event: string, cb: (data: unknown) => void) => void;
}): void {
  hmr.on("sf:css-update", (data) => {
    handleCssHmrUpdate(data as CssHmrUpdate);
  });

  // Handle full CSS file replacement
  hmr.on("sf:css-replace", (data) => {
    const { id, css } = data as { id: string; css: string };
    stylesheets.update(id, css);
    console.log(`[HMR] Full CSS replacement: ${id}`);
  });
}
