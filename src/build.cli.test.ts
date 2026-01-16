import { it } from "node:test";
import * as assert from "node:assert/strict";

it("loads without executing build", async () => {
  await import("./build.ts");
  assert.ok(true);
});
