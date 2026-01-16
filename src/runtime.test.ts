import { it } from "node:test";
import * as assert from "node:assert/strict";
import { getRuntime, peekRuntime, clearRuntime } from "./runtime.ts";

it("creates and clears runtime state", () => {
  clearRuntime();
  assert.strictEqual(peekRuntime(), undefined);

  const runtime = getRuntime();
  runtime.hmrData = { answer: 42 };

  const peeked = peekRuntime();
  assert.strictEqual(peeked, runtime);
  assert.deepStrictEqual(peeked?.hmrData, { answer: 42 });

  clearRuntime();
  assert.strictEqual(peekRuntime(), undefined);
});
