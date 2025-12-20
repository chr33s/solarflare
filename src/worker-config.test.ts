import { describe, it } from "node:test";
import { deepStrictEqual, strictEqual } from "node:assert";
import { parseMetaConfig, workerConfigMeta } from "./worker-config.ts";

describe("parseMetaConfig", () => {
  it("should return defaults for empty HTML", () => {
    const config = parseMetaConfig("");
    strictEqual(config.lang, "en");
    deepStrictEqual(config.preconnectOrigins, [
      "https://fonts.googleapis.com",
      "https://fonts.gstatic.com",
    ]);
    strictEqual(config.earlyFlush, false);
    strictEqual(config.criticalCss, false);
    strictEqual(config.cacheConfig, undefined);
  });

  it("should extract lang from html tag", () => {
    const html = '<html lang="de">';
    const config = parseMetaConfig(html);
    strictEqual(config.lang, "de");
  });

  it("should extract lang with double quotes", () => {
    const html = '<html class="no-js" lang="ja">';
    const config = parseMetaConfig(html);
    strictEqual(config.lang, "ja");
  });

  it("should extract preconnect origins", () => {
    const html =
      '<meta name="sf:preconnect" content="https://cdn.example.com,https://api.example.com">';
    const config = parseMetaConfig(html);
    deepStrictEqual(config.preconnectOrigins, [
      "https://cdn.example.com",
      "https://api.example.com",
    ]);
  });

  it("should handle reversed meta attribute order", () => {
    const html = '<meta content="https://fonts.bunny.net" name="sf:preconnect">';
    const config = parseMetaConfig(html);
    deepStrictEqual(config.preconnectOrigins, ["https://fonts.bunny.net"]);
  });

  it("should extract cache-max-age", () => {
    const html = '<meta name="sf:cache-max-age" content="300">';
    const config = parseMetaConfig(html);
    strictEqual(config.cacheConfig?.maxAge, 300);
    strictEqual(config.cacheConfig?.staleWhileRevalidate, undefined);
  });

  it("should extract cache-max-age with stale-while-revalidate", () => {
    const html = `
      <meta name="sf:cache-max-age" content="300">
      <meta name="sf:cache-swr" content="3600">
    `;
    const config = parseMetaConfig(html);
    strictEqual(config.cacheConfig?.maxAge, 300);
    strictEqual(config.cacheConfig?.staleWhileRevalidate, 3600);
  });

  it("should extract early-flush setting", () => {
    const html = '<meta name="sf:early-flush" content="true">';
    const config = parseMetaConfig(html);
    strictEqual(config.earlyFlush, true);
  });

  it("should extract early-flush false", () => {
    const html = '<meta name="sf:early-flush" content="false">';
    const config = parseMetaConfig(html);
    strictEqual(config.earlyFlush, false);
  });

  it("should extract critical-css setting", () => {
    const html = '<meta name="sf:critical-css" content="true">';
    const config = parseMetaConfig(html);
    strictEqual(config.criticalCss, true);
  });

  it("should parse complete configuration", () => {
    const html = `
      <html lang="fr">
      <head>
        <meta name="sf:preconnect" content="https://api.example.com">
        <meta name="sf:cache-max-age" content="600">
        <meta name="sf:cache-swr" content="7200">
        <meta name="sf:early-flush" content="true">
        <meta name="sf:critical-css" content="true">
      </head>
    `;
    const config = parseMetaConfig(html);
    strictEqual(config.lang, "fr");
    deepStrictEqual(config.preconnectOrigins, ["https://api.example.com"]);
    strictEqual(config.cacheConfig?.maxAge, 600);
    strictEqual(config.cacheConfig?.staleWhileRevalidate, 7200);
    strictEqual(config.earlyFlush, true);
    strictEqual(config.criticalCss, true);
  });

  it("should trim whitespace from preconnect origins", () => {
    const html = '<meta name="sf:preconnect" content=" https://a.com , https://b.com ">';
    const config = parseMetaConfig(html);
    deepStrictEqual(config.preconnectOrigins, ["https://a.com", "https://b.com"]);
  });

  it("should filter empty preconnect origins", () => {
    const html = '<meta name="sf:preconnect" content="https://a.com,,https://b.com,">';
    const config = parseMetaConfig(html);
    deepStrictEqual(config.preconnectOrigins, ["https://a.com", "https://b.com"]);
  });
});

describe("workerConfigMeta", () => {
  it("should return empty array for empty config", () => {
    const meta = workerConfigMeta({});
    deepStrictEqual(meta, []);
  });

  it("should generate preconnect meta", () => {
    const meta = workerConfigMeta({
      preconnect: ["https://cdn.example.com"],
    });
    deepStrictEqual(meta, [{ name: "sf:preconnect", content: "https://cdn.example.com" }]);
  });

  it("should generate cache meta tags", () => {
    const meta = workerConfigMeta({
      cacheMaxAge: 300,
      cacheSwr: 3600,
    });
    deepStrictEqual(meta, [
      { name: "sf:cache-max-age", content: "300" },
      { name: "sf:cache-swr", content: "3600" },
    ]);
  });

  it("should generate cache meta without swr", () => {
    const meta = workerConfigMeta({
      cacheMaxAge: 300,
    });
    deepStrictEqual(meta, [{ name: "sf:cache-max-age", content: "300" }]);
  });

  it("should generate early-flush meta", () => {
    const meta = workerConfigMeta({
      earlyFlush: true,
    });
    deepStrictEqual(meta, [{ name: "sf:early-flush", content: "true" }]);
  });

  it("should generate critical-css meta", () => {
    const meta = workerConfigMeta({
      criticalCss: true,
    });
    deepStrictEqual(meta, [{ name: "sf:critical-css", content: "true" }]);
  });

  it("should generate all meta tags", () => {
    const meta = workerConfigMeta({
      preconnect: ["https://api.example.com", "https://cdn.example.com"],
      cacheMaxAge: 600,
      cacheSwr: 7200,
      earlyFlush: true,
      criticalCss: true,
    });
    deepStrictEqual(meta, [
      { name: "sf:preconnect", content: "https://api.example.com,https://cdn.example.com" },
      { name: "sf:cache-max-age", content: "600" },
      { name: "sf:cache-swr", content: "7200" },
      { name: "sf:early-flush", content: "true" },
      { name: "sf:critical-css", content: "true" },
    ]);
  });

  it("should roundtrip through parseMetaConfig", () => {
    const original = {
      preconnect: ["https://cdn.example.com"],
      cacheMaxAge: 300,
      cacheSwr: 3600,
      earlyFlush: true,
      criticalCss: true,
    };
    const meta = workerConfigMeta(original);
    const html = meta.map((m) => `<meta name="${m.name}" content="${m.content}">`).join("\n");
    const parsed = parseMetaConfig(html);

    deepStrictEqual(parsed.preconnectOrigins, original.preconnect);
    strictEqual(parsed.cacheConfig?.maxAge, original.cacheMaxAge);
    strictEqual(parsed.cacheConfig?.staleWhileRevalidate, original.cacheSwr);
    strictEqual(parsed.earlyFlush, original.earlyFlush);
    strictEqual(parsed.criticalCss, original.criticalCss);
  });
});
