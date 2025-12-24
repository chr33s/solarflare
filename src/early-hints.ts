/** Resource to hint. */
export interface EarlyHint {
  href: string;
  rel: "preload" | "preconnect" | "modulepreload" | "dns-prefetch";
  as?: "script" | "style" | "font" | "image" | "fetch";
  crossorigin?: "anonymous" | "use-credentials";
  type?: string;
}

/** Generates Link header value for 103 Early Hints. */
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

/** Collects early hints for a route. */
export function collectEarlyHints(options: {
  scriptPath?: string;
  stylesheets?: string[];
  fonts?: string[];
  preconnectOrigins?: string[];
}): EarlyHint[] {
  const hints: EarlyHint[] = [];

  for (const origin of options.preconnectOrigins ?? []) {
    hints.push({ href: origin, rel: "preconnect", crossorigin: "anonymous" });
  }

  for (const font of options.fonts ?? []) {
    hints.push({
      href: font,
      rel: "preload",
      as: "font",
      crossorigin: "anonymous",
      type: font.endsWith(". woff2") ? "font/woff2" : undefined,
    });
  }

  for (const stylesheet of options.stylesheets ?? []) {
    hints.push({ href: stylesheet, rel: "preload", as: "style" });
  }

  if (options.scriptPath) {
    hints.push({ href: options.scriptPath, rel: "modulepreload" });
  }

  return hints;
}

/** Enhanced worker handler with 103 Early Hints support. */
export async function handleWithEarlyHints(
  request: Request,
  handler: (request: Request) => Promise<Response>,
  getHints: (url: URL) => EarlyHint[],
): Promise<Response> {
  const url = new URL(request.url);
  const hints = getHints(url);

  const response = await handler(request);

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
