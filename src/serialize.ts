/** Abstraction layer over turbo-stream for encoding/decoding complex types. */
import { encode, decode } from "turbo-stream";

/** Serializes data to a string (non-streaming). */
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

/** Parses serialized data from a string. */
export async function parseFromString<T>(serialized: string): Promise<T> {
  const stream = new ReadableStream<string>({
    start(controller) {
      controller.enqueue(serialized);
      controller.close();
    },
  });
  return (await decode(stream)) as T;
}
