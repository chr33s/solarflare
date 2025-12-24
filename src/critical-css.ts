import { createHash } from "node:crypto";

/** Critical CSS cache entry. */
interface CriticalCssEntry {
  css: string;
  hash: string;
  timestamp: number;
}

/** In-memory cache for critical CSS (per route). */
const criticalCssCache = new Map<string, CriticalCssEntry>();

/** Max age for cached critical CSS (1 hour). */
const CACHE_MAX_AGE = 60 * 60 * 1000;

/** Extracts critical CSS for a route */
export async function extractCriticalCss(
  routePattern: string,
  cssFiles: string[],
  options: {
    readCss: (path: string) => Promise<string>;
    maxSize?: number;
    cache?: boolean;
  },
): Promise<string> {
  const cacheKey = routePattern;
  const maxSize = options.maxSize ?? 14 * 1024;

  if (options.cache !== false) {
    const cached = criticalCssCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_MAX_AGE) {
      return cached.css;
    }
  }

  const cssContents: string[] = [];
  let totalSize = 0;

  for (const file of cssFiles) {
    try {
      const content = await options.readCss(file);
      const minified = minifyCss(content);

      if (totalSize + minified.length > maxSize) {
        break;
      }

      cssContents.push(minified);
      totalSize += minified.length;
    } catch {}
  }

  const criticalCss = cssContents.join("\n");
  const hash = createHash("md5").update(criticalCss).digest("hex").slice(0, 8);

  if (options.cache !== false) {
    criticalCssCache.set(cacheKey, {
      css: criticalCss,
      hash,
      timestamp: Date.now(),
    });
  }

  return criticalCss;
}

/** Simple CSS minification for critical CSS */
function minifyCss(css: string): string {
  return css
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\s+/g, " ")
    .replace(/\s*([{}: ;,])\s*/g, "$1")
    .trim();
}

/** Generates a noscript fallback for CSS loading. */
export function generateCssFallback(stylesheets: string[]): string {
  const links = stylesheets
    .map((href) => /* html */ `<link rel="stylesheet" href="${href}">`)
    .join("");
  return /* html */ `<noscript>${links}</noscript>`;
}

/** Generates async CSS loading script without blocking render on non-critical CSS */
export function generateAsyncCssLoader(stylesheets: string[]): string {
  if (stylesheets.length === 0) return "";

  const hrefs = JSON.stringify(stylesheets);

  return /* html */ `
    <script>
      (function() {
        var ss=${hrefs};
        ss.forEach(function(h){
          var l=document.createElement('link');
          l.rel='stylesheet';l.href=h;
          document.head.appendChild(l);
        });
      })();
    </script>
  `;
}
