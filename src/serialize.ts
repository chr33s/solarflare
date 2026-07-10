import { encode, decode } from "turbo-stream";

/** Serialize data to a string. */
export async function serializeToString(data: unknown) {
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
export async function parseFromString<T>(serialized: string) {
  const stream = new ReadableStream<string>({
    start(controller) {
      controller.enqueue(serialized);
      controller.close();
    },
  });
  return (await decode(stream)) as T;
}

/**
 * Escapes a string for safe embedding inside an HTML <script> element.
 *
 * Neutralizes the `</script>` breakout sequence (via `<`/`>`) and `<!--`, and
 * escapes U+2028/U+2029 which terminate string literals in inline (non-JSON)
 * script contexts pre-ES2019. The replacements use JSON `\uXXXX` escapes, so the
 * result still round-trips through `JSON.parse`/turbo-stream `decode` because
 * these characters only ever occur inside quoted string values.
 */
const LINE_SEPARATOR = String.fromCharCode(0x2028);
const PARAGRAPH_SEPARATOR = String.fromCharCode(0x2029);

export function escapeScriptText(text: string) {
  return text
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .split(LINE_SEPARATOR)
    .join("\\u2028")
    .split(PARAGRAPH_SEPARATOR)
    .join("\\u2029");
}

/** Fast, stable djb2-style string hash rendered in base36 (for content dedupe keys). */
export function hashString(str: string) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  return hash.toString(36);
}

/**
 * Safely stringify JSON for embedding in HTML script tags.
 * Escapes <, >, &, and U+2028/U+2029 to prevent XSS and inline-script breakage.
 * Returns "undefined" when JSON.stringify returns undefined.
 */
export function escapeJsonForHtml(obj: unknown) {
  const json = JSON.stringify(obj);
  if (json === undefined) return "undefined";
  return escapeScriptText(json);
}
