import diff from "./diff-dom-streaming.ts";
import type { HeadTag } from "./head.ts";
import { decode } from "turbo-stream";

export interface PatchMeta {
  outlet?: string;
  head?: HeadTag[];
  htmlAttrs?: Record<string, string>;
  bodyAttrs?: Record<string, string>;
}

/** Decoded patch payload from turbo-stream. */
interface PatchPayload {
  meta: PatchMeta;
  html: AsyncIterable<string>;
}

export interface ApplyPatchStreamOptions {
  useTransition: boolean;
  applyMeta: (meta: PatchMeta) => void;
  onChunkProcessed?: () => void;
}

export async function applyPatchStream(response: Response, options: ApplyPatchStreamOptions) {
  if (!response.body) {
    throw new Error("Patch response is missing body");
  }

  const encoder = new TextEncoder();
  let controller: ReadableStreamDefaultController<Uint8Array> | undefined;

  const htmlStream = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
    },
  });

  // Decode turbo-stream payload: { meta, html: AsyncIterable<string> }
  const stringStream = response.body.pipeThrough(new TextDecoderStream());
  const payload = (await decode(stringStream)) as PatchPayload;

  // Apply meta immediately
  options.applyMeta(payload.meta);

  // Consume html async iterable, forwarding chunks to diff-dom-streaming
  const consumeHtml = (async () => {
    try {
      for await (const chunk of payload.html) {
        controller?.enqueue(encoder.encode(chunk));
      }
    } catch (err) {
      controller?.error(err as Error);
      throw err;
    } finally {
      controller?.close();
    }
  })();

  await diff(document, htmlStream, {
    transition: options.useTransition,
    syncMutations: !options.useTransition,
    onChunkProcessed: options.onChunkProcessed,
  });
  await consumeHtml;
}
