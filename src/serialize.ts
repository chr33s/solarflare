import { encode, decode } from "turbo-stream";

/** Serialize data to a string. */
export async function serializeToString(data: unknown): Promise<string> {
  const stream = encode(data);
  const reader = stream.getReader();
  const chunks: string[] = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }

  return chunks.join("");
}

/** Parse serialized data from a string. */
export async function parseFromString<T>(serialized: string): Promise<T> {
  const stream = new ReadableStream<string>({
    start(controller) {
      controller.enqueue(serialized);
      controller.close();
    },
  });
  return (await decode(stream)) as T;
}

/**
 * Safely stringify JSON for embedding in HTML script tags.
 * Escapes <, >, and & to prevent XSS.
 */
export function escapeJsonForHtml(obj: unknown): string {
  const json = JSON.stringify(obj);
  // Handle undefined (which JSON.stringify returns for functions/undefined)
  if (json === undefined) return "undefined";
  return json.replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026");
}
