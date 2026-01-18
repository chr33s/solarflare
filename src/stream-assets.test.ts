import { describe, it } from "node:test";
import * as assert from "node:assert/strict";

import { generateAssetTags } from "./stream-assets.ts";

describe("generateAssetTags", () => {
  it("should generate script tag", () => {
    const result = generateAssetTags("/app.js");
    assert.ok(result.includes('<script type="module" src="/app.js" async></script>'));
  });

  it("should generate stylesheet links", () => {
    const result = generateAssetTags(undefined, ["/styles.css", "/theme.css"]);
    assert.ok(result.includes('<link rel="stylesheet" href="/styles.css">'));
    assert.ok(result.includes('<link rel="stylesheet" href="/theme.css">'));
  });

  it("should generate dev scripts", () => {
    const result = generateAssetTags(undefined, undefined, ["/dev.js"]);
    assert.ok(result.includes('<script src="/dev.js" async></script>'));
  });

  it("should generate all asset types together", () => {
    const result = generateAssetTags("/app.js", ["/styles.css"], ["/dev.js"]);
    assert.ok(result.includes('<link rel="stylesheet" href="/styles.css">'));
    assert.ok(result.includes('<script src="/dev.js" async></script>'));
    assert.ok(result.includes('<script type="module" src="/app.js" async></script>'));
  });

  it("should return empty string for no assets", () => {
    const result = generateAssetTags();
    assert.strictEqual(result, "");
  });

  it("should handle empty arrays", () => {
    const result = generateAssetTags(undefined, [], []);
    assert.strictEqual(result, "");
  });
});
