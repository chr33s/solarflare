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
  let allLoaded = true;

  for (const url of cssUrls) {
    let sheet = stylesheets.get(url);

    if (!sheet) {
      try {
        const response = await fetch(url);
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        const css = await response.text();
        sheet = stylesheets.register(url, css, { consumer: tag });
      } catch (e) {
        console.warn(`[styles] Failed to load ${url}:`, e);
        allLoaded = false;
        continue;
      }
    }

    if (sheet) {
      sheets.push(sheet);
    }
    // A null sheet after a successful fetch means constructable sheets are
    // unsupported — still treat the URL as loaded so we don't refetch forever.
  }

  // Only mark loaded when every required URL fetch succeeded.
  componentStyles.set(tag, { loaded: allLoaded, sheets });
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
    const toAdd = sheets.filter((s) => !shadowRoot.adoptedStyleSheets.includes(s));
    if (toAdd.length) {
      safeAdoptStylesheets(shadowRoot, [...shadowRoot.adoptedStyleSheets, ...toAdd]);
    }
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
