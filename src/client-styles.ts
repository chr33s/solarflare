/** Client-side style integration using Constructable Stylesheets. */

import { stylesheets, supportsConstructableStylesheets } from "./stylesheets.ts";

/** Style loading state for a component. */
interface StyleState {
  loaded: boolean;
  sheets: CSSStyleSheet[];
}

/** Component style states. */
const componentStyles = new Map<string, StyleState>();

/**
 * Loads and applies styles for a component.
 * Called during component registration/hydration.
 */
export async function loadComponentStyles(
  tag: string,
  cssUrls: string[],
): Promise<CSSStyleSheet[]> {
  // Check if already loaded
  const existing = componentStyles.get(tag);
  if (existing?.loaded) {
    return existing.sheets;
  }

  const sheets: CSSStyleSheet[] = [];

  for (const url of cssUrls) {
    // Check if stylesheet already registered
    let sheet = stylesheets.get(url);

    if (!sheet) {
      // Fetch and register the stylesheet
      try {
        const response = await fetch(url);
        const css = await response.text();
        sheet = stylesheets.register(url, css, { consumer: tag });
      } catch (e) {
        console.warn(`[styles] Failed to load ${url}:`, e);
        continue;
      }
    }

    if (sheet) {
      sheets.push(sheet);
    }
  }

  componentStyles.set(tag, { loaded: true, sheets });
  return sheets;
}

/**
 * Applies stylesheets to a custom element.
 * Uses adoptedStyleSheets for Shadow DOM, or document adoption for light DOM.
 */
export function applyStyles(element: HTMLElement, sheets: CSSStyleSheet[]): void {
  if (!supportsConstructableStylesheets()) {
    // Fallback handled by StylesheetManager
    return;
  }

  const shadowRoot = element.shadowRoot;

  if (shadowRoot) {
    // Shadow DOM:  use adoptedStyleSheets
    shadowRoot.adoptedStyleSheets = [...shadowRoot.adoptedStyleSheets, ...sheets];
  } else {
    // Light DOM: adopt to document (deduped by manager)
    for (const sheet of sheets) {
      if (!document.adoptedStyleSheets.includes(sheet)) {
        document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
      }
    }
  }
}

/**
 * Cleans up styles when a component is disconnected.
 */
export function cleanupStyles(tag: string): void {
  stylesheets.removeConsumer(tag);
  componentStyles.delete(tag);
}
