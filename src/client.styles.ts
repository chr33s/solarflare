import {
  safeAdoptStylesheets,
  stylesheets,
  supportsConstructableStylesheets,
} from "./stylesheets.ts";

/** Style loading state for a component. */
interface StyleState {
  loaded: boolean;
  sheets: CSSStyleSheet[];
}

/** Component style states. */
const componentStyles = new Map<string, StyleState>();

/** Loads and applies styles for a component. */
export async function loadComponentStyles(tag: string, cssUrls: string[]) {
  const existing = componentStyles.get(tag);
  if (existing?.loaded) {
    return existing.sheets;
  }

  const sheets: CSSStyleSheet[] = [];

  for (const url of cssUrls) {
    let sheet = stylesheets.get(url);

    if (!sheet) {
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

/** Applies stylesheets to a custom element. */
export function applyStyles(element: HTMLElement, sheets: CSSStyleSheet[]) {
  if (!supportsConstructableStylesheets()) {
    // Fallback handled by StylesheetManager
    return;
  }

  const shadowRoot = element.shadowRoot;

  if (shadowRoot) {
    safeAdoptStylesheets(shadowRoot, [...shadowRoot.adoptedStyleSheets, ...sheets]);
  } else {
    const toAdd = sheets.filter((s) => !document.adoptedStyleSheets.includes(s));
    if (toAdd.length) {
      safeAdoptStylesheets(document, [...document.adoptedStyleSheets, ...toAdd]);
    }
  }
}

/** Cleans up styles when a component is disconnected. */
export function cleanupStyles(tag: string) {
  stylesheets.removeConsumer(tag);
  componentStyles.delete(tag);
}
