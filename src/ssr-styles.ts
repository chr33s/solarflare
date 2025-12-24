/** Generates inline script to preload stylesheets. */
export function generateStylePreloadScript(
  stylesheets: Array<{ id: string; css: string }>,
): string {
  if (stylesheets.length === 0) return "";

  // Serialize stylesheets for client
  const data = stylesheets.map(({ id, css }) => ({
    id,
    css: css.replace(/</g, "\\u003c").replace(/>/g, "\\u003e"),
  }));

  return /* tsx */ `
    <script type="application/json" id="sf-preloaded-styles">
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
    </script>
  `;
}

/** Retrieves preloaded stylesheets. */
export function getPreloadedStylesheet(id: string): CSSStyleSheet | null {
  if (typeof window === "undefined") return null;
  const preloaded = (window as any).__sfPreloadedStyles as Map<string, CSSStyleSheet> | undefined;
  return preloaded?.get(id) ?? null;
}

/** Hydrates preloaded stylesheets into the manager. */
export function hydratePreloadedStyles(_manager: {
  register: (id: string, css: string, opts?: any) => CSSStyleSheet | null;
}): void {
  if (typeof window === "undefined") return;

  const preloaded = (window as any).__sfPreloadedStyles as Map<string, CSSStyleSheet> | undefined;
  if (!preloaded) return;

  console.log(`[styles] Hydrated ${preloaded.size} preloaded stylesheets`);
}
