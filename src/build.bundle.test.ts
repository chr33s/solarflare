import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { join } from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { loadUserConfig, mergeInputOptions, mergeOutputOptions } from "./build.bundle.ts";

describe("mergeInputOptions", () => {
  it("returns base when no user config", () => {
    const base = { input: "src/index.ts", plugins: [] };
    assert.deepStrictEqual(mergeInputOptions(base, undefined), base);
  });

  it("appends user plugins", () => {
    const basePlugin = { name: "base" };
    const userPlugin = { name: "user" };
    const result = mergeInputOptions({ plugins: [basePlugin] }, { plugins: [userPlugin] });
    assert.deepStrictEqual(result.plugins, [basePlugin, userPlugin]);
  });

  it("merges resolve.alias", () => {
    const result = mergeInputOptions(
      { resolve: { alias: { a: "1" } } },
      { resolve: { alias: { b: "2" } } },
    );
    assert.deepStrictEqual(result.resolve?.alias, { a: "1", b: "2" });
  });

  it("concatenates external arrays", () => {
    const result = mergeInputOptions({ external: ["a"] }, { external: ["b"] });
    assert.deepStrictEqual(result.external, ["a", "b"]);
  });

  it("does not pass output to input options", () => {
    const result = mergeInputOptions({ input: "src/index.ts" }, { output: { dir: "custom" } });
    assert.strictEqual("output" in result, false);
  });

  it("preserves user overrides for non-merge fields", () => {
    const result = mergeInputOptions(
      { platform: "node" as const, tsconfig: true },
      { tsconfig: "tsconfig.app.json" },
    );
    assert.strictEqual(result.platform, "node");
    assert.strictEqual(result.tsconfig, "tsconfig.app.json");
  });
});

describe("mergeOutputOptions", () => {
  it("returns base when no user config", () => {
    const base = { dir: "dist", format: "esm" as const };
    assert.deepStrictEqual(mergeOutputOptions(base, undefined), base);
  });

  it("returns base when user config has no output", () => {
    const base = { dir: "dist", format: "esm" as const };
    assert.deepStrictEqual(mergeOutputOptions(base, { input: "x" }), base);
  });

  it("merges user output overrides", () => {
    const result = mergeOutputOptions(
      { dir: "dist", format: "esm" as const },
      { output: { sourcemap: true } },
    );
    assert.strictEqual(result.dir, "dist");
    assert.strictEqual(result.format, "esm");
    assert.strictEqual(result.sourcemap, true);
  });

  it("handles array output (uses first)", () => {
    const result = mergeOutputOptions(
      { dir: "dist" },
      { output: [{ sourcemap: true }, { sourcemap: false }] },
    );
    assert.strictEqual(result.sourcemap, true);
  });
});

describe("loadUserConfig", () => {
  it("returns undefined when no config exists", async () => {
    const dir = await mkdtemp(join(tmpdir(), "sf-test-"));
    try {
      const result = await loadUserConfig(dir);
      assert.strictEqual(result, undefined);
    } finally {
      await rm(dir, { recursive: true });
    }
  });
});
