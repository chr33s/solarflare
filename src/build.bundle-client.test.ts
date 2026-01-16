import { it } from "node:test";
import * as assert from "node:assert/strict";
import { hash, normalizeAssetPath, getChunkName } from "./build.bundle-client.ts";

it("hash should return 8 hex characters", () => {
  const hashValue = hash("test content");
  assert.strictEqual(hashValue.length, 8);
  assert.ok(/^[0-9a-f]+$/.test(hashValue));
});

it("hash should be stable for identical content", () => {
  const hash1 = hash("same");
  const hash2 = hash("same");
  assert.strictEqual(hash1, hash2);
});

it("normalizeAssetPath should replace slashes", () => {
  assert.strictEqual(normalizeAssetPath("blog/posts/featured"), "blog.posts.featured");
});

it("getChunkName should strip extensions and params", () => {
  assert.strictEqual(getChunkName("blog/$slug.client.tsx"), "blog.slug.js");
});

it("getChunkName should include hash when provided", () => {
  assert.strictEqual(getChunkName("index.client.tsx", "abc12345"), "index.abc12345.js");
});
