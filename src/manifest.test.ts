import { describe, it } from "node:test";
import * as assert from "node:assert/strict";

describe("module", () => {
  it("loads without runtime exports", async () => {
    const mod = await import("./manifest.ts");
    assert.deepStrictEqual(Object.keys(mod), []);
  });
});
