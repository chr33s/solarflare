/** Static shell that can be sent before rendering. */
export interface StreamingShell {
  preHead: string;
  preBody: string;
  headMarker: string;
  bodyMarker: string;
}

/** Generates a static shell from layout analysis. */
export function generateStaticShell(options: {
  lang?: string;
  charset?: string;
  viewport?: string;
}) {
  const {
    lang = "en",
    charset = "UTF-8",
    viewport = "width=device-width, initial-scale=1",
  } = options;

  return {
    preHead: /* html */ `
    <!DOCTYPE html>
      <html lang="${lang}">
      <head>
        <meta charset="${charset}">
        <meta name="viewport" content="${viewport}">
    `,
    headMarker: "<!--SF: HEAD-->",
    preBody: /* html */ `
      </head>
      <body>
    `,
    bodyMarker: "<!--SF: BODY-->",
  };
}

/** Creates a streaming response with early flush. */
export function createEarlyFlushStream(
  shell: StreamingShell,
  options: {
    preloadHints?: string;
    contentStream: ReadableStream<Uint8Array>;
    headTags: string;
    bodyTags: string;
  },
) {
  const encoder = new TextEncoder();
  let contentReader: ReadableStreamDefaultReader<Uint8Array>;
  let phase: "shell" | "content" | "done" = "shell";

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const shellStart = [shell.preHead, options.preloadHints || ""].join("");

      controller.enqueue(encoder.encode(shellStart));

      controller.enqueue(encoder.encode(options.headTags));
      controller.enqueue(encoder.encode(shell.preBody));

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

/** Generates resource hints for critical assets. */
export function generateResourceHints(options: {
  scripts?: string[];
  stylesheets?: string[];
  preconnect?: string[];
  dnsPrefetch?: string[];
}) {
  const hints: string[] = [];

  for (const origin of options.preconnect ?? []) {
    hints.push(/* html */ `<link rel="preconnect" href="${origin}" crossorigin>`);
  }

  for (const origin of options.dnsPrefetch ?? []) {
    hints.push(/* html */ `<link rel="dns-prefetch" href="${origin}">`);
  }

  for (const href of options.stylesheets ?? []) {
    hints.push(/* html */ `<link rel="preload" href="${href}" as="style">`);
  }

  for (const href of options.scripts ?? []) {
    hints.push(/* html */ `<link rel="modulepreload" href="${href}">`);
  }

  return hints.join("\n");
}
