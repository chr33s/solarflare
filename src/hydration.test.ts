import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import {
  initHydrationCoordinator,
  cleanupHydrationCoordinator,
  isHydrationReady,
} from "./hydration.ts";

describe("hydration coordinator (no DOM)", () => {
  it("does not initialize when document is undefined", () => {
    const prevDocument = (globalThis as any).document;
    delete (globalThis as any).document;

    initHydrationCoordinator();
    assert.strictEqual(isHydrationReady(), false);

    cleanupHydrationCoordinator();
    assert.strictEqual(isHydrationReady(), false);

    if (prevDocument !== undefined) {
      (globalThis as any).document = prevDocument;
    }
  });
});
