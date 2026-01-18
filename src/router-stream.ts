import diff from "./diff-dom-streaming.ts";
import type { HeadTag } from "./head.ts";

export interface PatchMetaMessage {
  type: "meta";
  head?: HeadTag[];
  htmlAttrs?: Record<string, string>;
  bodyAttrs?: Record<string, string>;
}

type PatchMessage = PatchMetaMessage | { type: "html"; chunk: string } | { type: "done" };

export interface ApplyPatchStreamOptions {
  useTransition: boolean;
  applyMeta: (meta: PatchMetaMessage) => void;
  onChunkProcessed?: () => void;
}

export async function applyPatchStream(response: Response, options: ApplyPatchStreamOptions) {
  if (!response.body) {
    throw new Error("Patch response is missing body");
  }

  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  let htmlController: ReadableStreamDefaultController<Uint8Array> | null = null;

  const htmlStream = new ReadableStream<Uint8Array>({
    start(controller) {
      htmlController = controller;
    },
    cancel() {
      htmlController = null;
    },
  });

  const consumeNdjson = async () => {
    const reader = response.body!.getReader();
    let buffer = "";
    let streamClosed = false;

    const closeStream = () => {
      if (streamClosed) return;
      streamClosed = true;
      htmlController?.close();
    };

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let newlineIndex = buffer.indexOf("\n");
        while (newlineIndex !== -1) {
          const line = buffer.slice(0, newlineIndex).trim();
          buffer = buffer.slice(newlineIndex + 1);
          if (line) {
            const msg = JSON.parse(line) as PatchMessage;

            if (msg.type === "meta") {
              options.applyMeta(msg);
            } else if (msg.type === "html") {
              htmlController?.enqueue(encoder.encode(msg.chunk));
            } else if (msg.type === "done") {
              closeStream();
              return;
            }
          }
          newlineIndex = buffer.indexOf("\n");
        }
      }

      buffer += decoder.decode();
      if (buffer.trim()) {
        const msg = JSON.parse(buffer) as PatchMessage;
        if (msg.type === "meta") {
          options.applyMeta(msg);
        } else if (msg.type === "html") {
          htmlController?.enqueue(encoder.encode(msg.chunk));
        }
      }
      closeStream();
    } catch (error) {
      htmlController?.error(error);
      throw error;
    }
  };

  const ndjsonPromise = consumeNdjson();

  await diff(document, htmlStream, {
    transition: options.useTransition,
    syncMutations: !options.useTransition,
    onChunkProcessed: options.onChunkProcessed,
  });
  await ndjsonPromise;
}
