import { type RouteCacheConfig } from "./route-cache.ts";
import {
  type SpeculationEagerness,
  type SpeculationRules,
  createPrefetchListRule,
  createPrerenderListRule,
  createDocumentRule,
  createSelectorRule,
} from "./speculation-rules.ts";

/** Configuration extracted from meta tags. */
export interface WorkerMetaConfig {
  /** HTML lang attribute */
  lang: string;
  /** Origins to preconnect to */
  preconnectOrigins: string[];
  /** Cache configuration for this route */
  cacheConfig?: RouteCacheConfig;
  /** Enable early flush */
  earlyFlush: boolean;
  /** Enable critical CSS inlining */
  criticalCss: boolean;
  /** URLs/patterns to prefetch */
  prefetch: string[];
  /** URLs/patterns to prerender */
  prerender: string[];
  /** CSS selector for document-based prefetch rules */
  prefetchSelector?: string;
  /** Eagerness level for speculation rules */
  speculationEagerness: SpeculationEagerness;
}

/** Default configuration values. */
const DEFAULTS: WorkerMetaConfig = {
  lang: "en",
  preconnectOrigins: ["https://fonts.googleapis.com", "https://fonts.gstatic.com"],
  earlyFlush: false,
  criticalCss: false,
  prefetch: [],
  prerender: [],
  speculationEagerness: "moderate",
};

/** Parses worker configuration from HTML meta tags. */
export function parseMetaConfig(html: string): WorkerMetaConfig {
  const config: WorkerMetaConfig = { ...DEFAULTS };

  const langMatch = html.match(/<html[^>]*\slang=["']([^"']+)["']/i);
  if (langMatch) {
    config.lang = langMatch[1];
  }

  const matchMeta = (name: string): string | null => {
    const pattern1 = new RegExp(`<meta[^>]*name=["']${name}["'][^>]*content=["']([^"']+)["']`, "i");
    const pattern2 = new RegExp(`<meta[^>]*content=["']([^"']+)["'][^>]*name=["']${name}["']`, "i");
    const match = html.match(pattern1) ?? html.match(pattern2);
    return match ? match[1] : null;
  };

  const preconnect = matchMeta("sf:preconnect");
  if (preconnect) {
    config.preconnectOrigins = preconnect
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }

  const maxAge = matchMeta("sf:cache-max-age");
  const swr = matchMeta("sf:cache-swr");

  if (maxAge) {
    config.cacheConfig = {
      maxAge: parseInt(maxAge, 10),
      staleWhileRevalidate: swr ? parseInt(swr, 10) : undefined,
    };
  }

  const earlyFlush = matchMeta("sf:early-flush");
  if (earlyFlush) {
    config.earlyFlush = earlyFlush === "true";
  }

  const criticalCss = matchMeta("sf:critical-css");
  if (criticalCss) {
    config.criticalCss = criticalCss === "true";
  }

  const prefetch = matchMeta("sf:prefetch");
  if (prefetch) {
    config.prefetch = prefetch
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }

  const prerender = matchMeta("sf:prerender");
  if (prerender) {
    config.prerender = prerender
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }

  const prefetchSelector = matchMeta("sf:prefetch-selector");
  if (prefetchSelector) {
    config.prefetchSelector = prefetchSelector;
  }

  const eagerness = matchMeta("sf:speculation-eagerness");
  if (eagerness) {
    config.speculationEagerness = eagerness as SpeculationEagerness;
  }

  return config;
}

/**
 * Generates meta tags for worker configuration. Use with useHead() in _layout.tsx.
 *
 * @example
 * ```tsx
 * import { useHead } from "solarflare";
 * import { workerConfigMeta } from "solarflare/client";
 *
 * export default function BlogLayout({ children }) {
 *   useHead({
 *     meta: workerConfigMeta({
 *       cacheMaxAge: 300,
 *       cacheSwr: 3600,
 *     }),
 *   });
 *   return <>{children}</>;
 * }
 * ```
 */
export function workerConfigMeta(config: {
  preconnect?: string[];
  cacheMaxAge?: number;
  cacheSwr?: number;
  earlyFlush?: boolean;
  criticalCss?: boolean;
  prefetch?: string[];
  prerender?: string[];
  prefetchSelector?: string;
  speculationEagerness?: SpeculationEagerness;
}): Array<{ name: string; content: string }> {
  const meta: Array<{ name: string; content: string }> = [];

  if (config.preconnect?.length) {
    meta.push({ name: "sf:preconnect", content: config.preconnect.join(",") });
  }

  if (config.cacheMaxAge !== undefined) {
    meta.push({
      name: "sf:cache-max-age",
      content: String(config.cacheMaxAge),
    });
    if (config.cacheSwr !== undefined) {
      meta.push({ name: "sf:cache-swr", content: String(config.cacheSwr) });
    }
  }

  if (config.earlyFlush !== undefined) {
    meta.push({ name: "sf:early-flush", content: String(config.earlyFlush) });
  }

  if (config.criticalCss !== undefined) {
    meta.push({ name: "sf:critical-css", content: String(config.criticalCss) });
  }

  if (config.prefetch?.length) {
    meta.push({ name: "sf:prefetch", content: config.prefetch.join(",") });
  }

  if (config.prerender?.length) {
    meta.push({ name: "sf:prerender", content: config.prerender.join(",") });
  }

  if (config.prefetchSelector) {
    meta.push({
      name: "sf:prefetch-selector",
      content: config.prefetchSelector,
    });
  }

  if (config.speculationEagerness && config.speculationEagerness !== "moderate") {
    meta.push({
      name: "sf:speculation-eagerness",
      content: config.speculationEagerness,
    });
  }

  return meta;
}

/** Builds SpeculationRules from parsed meta config. Returns null if no rules configured. */
export function buildSpeculationRulesFromConfig(config: WorkerMetaConfig): SpeculationRules | null {
  const hasPrefetch = config.prefetch.length > 0 || config.prefetchSelector;
  const hasPrerender = config.prerender.length > 0;

  if (!hasPrefetch && !hasPrerender) return null;

  const rules: SpeculationRules = {};
  const eagerness = config.speculationEagerness;

  if (config.prefetch.length > 0 || config.prefetchSelector) {
    rules.prefetch = [];

    if (config.prefetch.length > 0) {
      // Separate URL patterns (contain *) from exact URLs
      const patterns = config.prefetch.filter((u) => u.includes("*"));
      const urls = config.prefetch.filter((u) => !u.includes("*"));

      if (urls.length > 0) {
        rules.prefetch.push(createPrefetchListRule(urls, { eagerness }));
      }
      if (patterns.length > 0) {
        rules.prefetch.push(createDocumentRule(patterns, { eagerness }));
      }
    }

    if (config.prefetchSelector) {
      rules.prefetch.push(createSelectorRule(config.prefetchSelector, { eagerness }));
    }
  }

  if (config.prerender.length > 0) {
    // Separate URL patterns (contain *) from exact URLs
    const patterns = config.prerender.filter((u) => u.includes("*"));
    const urls = config.prerender.filter((u) => !u.includes("*"));

    rules.prerender = [];

    if (urls.length > 0) {
      rules.prerender.push(createPrerenderListRule(urls, { eagerness }));
    }
    if (patterns.length > 0) {
      rules.prerender.push(createDocumentRule(patterns, { eagerness }));
    }
  }

  return rules;
}
