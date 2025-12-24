import { type RouteCacheConfig } from "./route-cache.ts";

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
}

/** Default configuration values. */
const DEFAULTS: WorkerMetaConfig = {
  lang: "en",
  preconnectOrigins: ["https://fonts.googleapis.com", "https://fonts.gstatic.com"],
  earlyFlush: false,
  criticalCss: false,
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

  return config;
}

/**
 * Generates meta tags for worker configuration. Use with useHead() in _layout.tsx.
 *
 * @example
 * ```tsx
 * import { useHead } from "solarflare";
 * import { workerConfigMeta } from "solarflare/worker-config";
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

  return meta;
}
