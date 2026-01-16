import { it } from "node:test";
import * as assert from "node:assert/strict";
import { buildServer } from "./build.bundle-server.ts";

it("exposes buildServer", () => {
  assert.strictEqual(typeof buildServer, "function");
});
