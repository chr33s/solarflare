/**
 * Early flush streaming - sends static shell HTML before rendering begins.
 * This dramatically improves TTFB by sending bytes immediately.
 */

/** Static shell that can be sent before any rendering.  */
export interface StreamingShell {
  /** HTML before the <head> content */
  preHead: string;
  /** HTML after head, before body content */
  preBody: string;
  /** Placeholder marker for dynamic head content */
  headMarker: string;
  /** Placeholder marker for body content */
  bodyMarker: string;
}

/**
 * Generates a static shell from layout analysis.
 * This shell can be cached and reused across requests.
 */
export function generateStaticShell(options: {
  lang?: string;
  charset?: string;
  viewport?: string;
}): StreamingShell {
  const {
    lang = "en",
    charset = "UTF-8",
    viewport = "width=device-width, initial-scale=1",
  } = options;

  return {
    preHead: /* html */ `<!DOCTYPE html>
<html lang="${lang}">
<head>
<meta charset="${charset}">
<meta name="viewport" content="${viewport}">`,
    headMarker: "<!--SF: HEAD-->",
    preBody: `
</head>
<body>`,
    bodyMarker: "<!--SF: BODY-->",
  };
}

/**
 * Creates a streaming response that flushes the shell immediately.
 * Content is injected at markers as it becomes available.
 */
export function createEarlyFlushStream(
  shell: StreamingShell,
  options: {
    /** Critical CSS to inline in head */
    criticalCss?: string;
    /** Preload hints to add immediately */
    preloadHints?: string;
    /** Content stream from SSR */
    contentStream: ReadableStream<Uint8Array>;
    /** Head tags to inject */
    headTags: string;
    /** Script/style tags to inject at body end */
    bodyTags: string;
  },
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let contentReader: ReadableStreamDefaultReader<Uint8Array>;
  let phase: "shell" | "content" | "done" = "shell";

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      // Phase 1: Flush shell immediately (< 1ms)
      const shellStart = [
        shell.preHead,
        options.preloadHints || "",
        options.criticalCss ? `<style>${options.criticalCss}</style>` : "",
      ].join("");

      controller.enqueue(encoder.encode(shellStart));

      // Flush head tags
      controller.enqueue(encoder.encode(options.headTags));
      controller.enqueue(encoder.encode(shell.preBody));

      // Phase 2: Stream body content
      phase = "content";
      contentReader = options.contentStream.getReader();
    },

    async pull(controller) {
      if (phase === "done") {
        controller.close();
        return;
      }

      try {
        const { done, value } = await contentReader.read();

        if (done) {
          // Append body tags and close
          controller.enqueue(encoder.encode(options.bodyTags));
          controller.enqueue(encoder.encode("</body></html>"));
          phase = "done";
          controller.close();
          return;
        }

        controller.enqueue(value);
      } catch (error) {
        controller.error(error);
      }
    },

    cancel() {
      void contentReader?.cancel();
    },
  });
}

/**
 * Generates resource hints for critical assets.
 * These should be sent as early as possible.
 */
export function generateResourceHints(options: {
  scripts?: string[];
  stylesheets?: string[];
  preconnect?: string[];
  dnsPrefetch?: string[];
}): string {
  const hints: string[] = [];

  // Preconnect to critical origins (fonts, APIs, etc.)
  for (const origin of options.preconnect ?? []) {
    hints.push(/* html */ `<link rel="preconnect" href="${origin}" crossorigin>`);
  }

  // DNS prefetch for less critical origins
  for (const origin of options.dnsPrefetch ?? []) {
    hints.push(/* html */ `<link rel="dns-prefetch" href="${origin}">`);
  }

  // Preload critical stylesheets
  for (const href of options.stylesheets ?? []) {
    hints.push(/* html */ `<link rel="preload" href="${href}" as="style">`);
  }

  // Modulepreload for critical JS
  for (const href of options.scripts ?? []) {
    hints.push(/* html */ `<link rel="modulepreload" href="${href}">`);
  }

  return hints.join("\n");
}
