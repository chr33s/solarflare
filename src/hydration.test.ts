import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import {
  initHydrationCoordinator,
  cleanupHydrationCoordinator,
  isHydrationReady,
  serializeDataIsland,
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

describe("serializeDataIsland", () => {
  it("should serialize data to script tag", async () => {
    const data = { title: "Test" };
    const result = await serializeDataIsland("test-island", data);
    assert.ok(
      result.includes(
        '<script type="application/json" id="test-island" data-island="test-island">',
      ),
    );
    assert.ok(result.includes("</script>"));
  });

  it("should include serialized data", async () => {
    const data = { count: 42 };
    const result = await serializeDataIsland("counter-data", data);
    assert.ok(result.includes('data-island="counter-data"'));
  });

  it("should handle complex data types", async () => {
    const data = {
      string: "hello",
      number: 123,
      boolean: true,
      array: [1, 2, 3],
      nested: { a: "b" },
    };
    const result = await serializeDataIsland("complex", data);
    assert.ok(result.includes('data-island="complex"'));
  });
});
