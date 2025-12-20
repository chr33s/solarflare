/**
 * HTTP 103 Early Hints support for Cloudflare Workers.
 * Allows the browser to start loading resources before the full response.
 */

/** Resource to hint.  */
export interface EarlyHint {
  /** Resource URL */
  href: string;
  /** Resource type:  preload, preconnect, modulepreload */
  rel: "preload" | "preconnect" | "modulepreload" | "dns-prefetch";
  /** Resource type for preload */
  as?: "script" | "style" | "font" | "image" | "fetch";
  /** Crossorigin attribute */
  crossorigin?: "anonymous" | "use-credentials";
  /** MIME type */
  type?: string;
}

/**
 * Generates Link header value for 103 Early Hints.
 */
export function generateEarlyHintsHeader(hints: EarlyHint[]): string {
  return hints
    .map((hint) => {
      const parts = [`<${hint.href}>`, `rel=${hint.rel}`];

      if (hint.as) parts.push(`as=${hint.as}`);
      if (hint.crossorigin) parts.push(`crossorigin=${hint.crossorigin}`);
      if (hint.type) parts.push(`type="${hint.type}"`);

      return parts.join("; ");
    })
    .join(", ");
}

/**
 * Collects early hints for a route.
 */
export function collectEarlyHints(options: {
  scriptPath?: string;
  stylesheets?: string[];
  fonts?: string[];
  preconnectOrigins?: string[];
}): EarlyHint[] {
  const hints: EarlyHint[] = [];

  // Preconnect to external origins first (highest priority)
  for (const origin of options.preconnectOrigins ?? []) {
    hints.push({ href: origin, rel: "preconnect", crossorigin: "anonymous" });
  }

  // Preload fonts (high priority, render-blocking)
  for (const font of options.fonts ?? []) {
    hints.push({
      href: font,
      rel: "preload",
      as: "font",
      crossorigin: "anonymous",
      type: font.endsWith(". woff2") ? "font/woff2" : undefined,
    });
  }

  // Preload stylesheets
  for (const stylesheet of options.stylesheets ?? []) {
    hints.push({ href: stylesheet, rel: "preload", as: "style" });
  }

  // Modulepreload main script
  if (options.scriptPath) {
    hints.push({ href: options.scriptPath, rel: "modulepreload" });
  }

  return hints;
}

/**
 * Enhanced worker handler with 103 Early Hints support.
 * Note:  Cloudflare Workers support 103 via the `waitUntil` pattern.
 */
export async function handleWithEarlyHints(
  request: Request,
  handler: (request: Request) => Promise<Response>,
  getHints: (url: URL) => EarlyHint[],
): Promise<Response> {
  const url = new URL(request.url);
  const hints = getHints(url);

  // Get the actual response
  const response = await handler(request);

  // Add Link header for browsers that support it
  if (hints.length > 0) {
    const linkHeader = generateEarlyHintsHeader(hints);
    const newHeaders = new Headers(response.headers);
    newHeaders.set("Link", linkHeader);

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: newHeaders,
    });
  }

  return response;
}
