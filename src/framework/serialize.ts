/**
 * Solarflare Serialization
 * Abstraction layer over turbo-stream for encoding/decoding complex types
 * Supports: Date, Map, Set, RegExp, BigInt, Promises, ReadableStream, etc.
 */
import { encode, decode } from "turbo-stream";

/**
 * Serialize data to a string (non-streaming)
 * Collects the entire encoded stream into a single string.
 * Used for inline script injection during SSR hydration.
 *
 * Note: turbo-stream v3 encodes to ReadableStream<string> directly.
 */
export async function serializeToString(data: unknown): Promise<string> {
  const stream = encode(data);
  const reader = stream.getReader();
  const chunks: string[] = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    // turbo-stream v3 returns strings directly, no decoding needed
    chunks.push(value);
  }

  return chunks.join("");
}

/**
 * Parse serialized data from a string
 * Reconstructs complex types (Date, Map, Set, etc.) from turbo-stream format.
 *
 * Note: turbo-stream v3 expects ReadableStream<string> for decoding.
 */
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
 * Stream-aware serialization for deferred data
 * Returns a ReadableStream that can be piped directly.
 * Useful for streaming promises and async iterables.
 *
 * Note: turbo-stream v3 returns ReadableStream<string>.
 */
export function serializeStream(data: unknown): ReadableStream<string> {
  return encode(data);
}

/**
 * Decode a stream of serialized data
 * Handles streaming promises and async iterables natively.
 *
 * Note: turbo-stream v3 expects ReadableStream<string>.
 */
export async function decodeStream<T>(stream: ReadableStream<string>): Promise<T> {
  return (await decode(stream)) as T;
}
