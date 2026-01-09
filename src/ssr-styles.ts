import { peekRuntime } from "./runtime.ts";
import { escapeJsonForHtml } from "./serialize.ts";

/** Generates inline script to preload stylesheets. */
export function generateStylePreloadScript(
  stylesheets: Array<{ id: string; css: string }>,
): string {
  if (stylesheets.length === 0) return "";

  return /* tsx */ `
    <script type="application/json" id="sf-preloaded-styles">
      ${escapeJsonForHtml(stylesheets)}
    </script>
    <script>
      (function() {
        if (!('adoptedStyleSheets' in Document.prototype)) return;
        var data = JSON.parse(document.getElementById('sf-preloaded-styles').textContent);
        var g = globalThis.__solarflare__ = globalThis.__solarflare__ || {};
        g.preloadedStyles = new Map();
        data.forEach(function(s) {
          var sheet = new CSSStyleSheet();
          sheet.replaceSync(s.css);
          g.preloadedStyles.set(s.id, sheet);
        });
      })();
    </script>
  `;
}

/** Retrieves preloaded stylesheets. */
export function getPreloadedStylesheet(id: string): CSSStyleSheet | null {
  const runtime = peekRuntime();
  return runtime?.preloadedStyles?.get(id) ?? null;
}

/** Hydrates preloaded stylesheets into the manager. */
export function hydratePreloadedStyles(_manager: {
  register: (id: string, css: string, opts?: any) => CSSStyleSheet | null;
}): void {
  const preloaded = peekRuntime()?.preloadedStyles;
  if (!preloaded) return;

  console.log(`[styles] Hydrated ${preloaded.size} preloaded stylesheets`);
}
