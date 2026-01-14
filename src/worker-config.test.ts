import { describe, it } from "node:test";
import { deepStrictEqual, strictEqual } from "node:assert";
import {
  parseMetaConfig,
  workerConfigMeta,
  buildSpeculationRulesFromConfig,
} from "./worker-config.ts";

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
    deepStrictEqual(config.prefetch, []);
    deepStrictEqual(config.prerender, []);
    strictEqual(config.prefetchSelector, undefined);
    strictEqual(config.speculationEagerness, "moderate");
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

  it("should extract prefetch URLs", () => {
    const html = '<meta name="sf:prefetch" content="/about, /faq, /blog/*">';
    const config = parseMetaConfig(html);
    deepStrictEqual(config.prefetch, ["/about", "/faq", "/blog/*"]);
  });

  it("should extract prerender URLs", () => {
    const html = '<meta name="sf:prerender" content="/, /landing">';
    const config = parseMetaConfig(html);
    deepStrictEqual(config.prerender, ["/", "/landing"]);
  });

  it("should extract prefetch-selector", () => {
    const html = '<meta name="sf:prefetch-selector" content="a.nav-link">';
    const config = parseMetaConfig(html);
    strictEqual(config.prefetchSelector, "a.nav-link");
  });

  it("should extract speculation-eagerness", () => {
    const html = '<meta name="sf:speculation-eagerness" content="eager">';
    const config = parseMetaConfig(html);
    strictEqual(config.speculationEagerness, "eager");
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

  it("should generate prefetch meta", () => {
    const meta = workerConfigMeta({
      prefetch: ["/about", "/blog/*"],
    });
    deepStrictEqual(meta, [{ name: "sf:prefetch", content: "/about,/blog/*" }]);
  });

  it("should generate prerender meta", () => {
    const meta = workerConfigMeta({
      prerender: ["/", "/landing"],
    });
    deepStrictEqual(meta, [{ name: "sf:prerender", content: "/,/landing" }]);
  });

  it("should generate prefetch-selector meta", () => {
    const meta = workerConfigMeta({
      prefetchSelector: "a.prefetch",
    });
    deepStrictEqual(meta, [{ name: "sf:prefetch-selector", content: "a.prefetch" }]);
  });

  it("should generate speculation-eagerness meta when not default", () => {
    const meta = workerConfigMeta({
      speculationEagerness: "eager",
    });
    deepStrictEqual(meta, [{ name: "sf:speculation-eagerness", content: "eager" }]);
  });

  it("should not generate speculation-eagerness meta when moderate (default)", () => {
    const meta = workerConfigMeta({
      speculationEagerness: "moderate",
    });
    deepStrictEqual(meta, []);
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

describe("buildSpeculationRulesFromConfig", () => {
  it("should return null when no speculation rules configured", () => {
    const config = parseMetaConfig("");
    const rules = buildSpeculationRulesFromConfig(config);
    strictEqual(rules, null);
  });

  it("should build prefetch list rules for exact URLs", () => {
    const config = parseMetaConfig('<meta name="sf:prefetch" content="/about, /faq">');
    const rules = buildSpeculationRulesFromConfig(config);
    strictEqual(rules?.prefetch?.length, 1);
    strictEqual(rules?.prefetch?.[0].source, "list");
    deepStrictEqual((rules!.prefetch![0] as { urls: string[] }).urls, ["/about", "/faq"]);
  });

  it("should build prefetch document rules for patterns", () => {
    const config = parseMetaConfig('<meta name="sf:prefetch" content="/blog/*">');
    const rules = buildSpeculationRulesFromConfig(config);
    strictEqual(rules?.prefetch?.length, 1);
    strictEqual(rules?.prefetch?.[0].source, "document");
  });

  it("should build separate rules for URLs and patterns", () => {
    const config = parseMetaConfig('<meta name="sf:prefetch" content="/about, /blog/*">');
    const rules = buildSpeculationRulesFromConfig(config);
    strictEqual(rules?.prefetch?.length, 2);
  });

  it("should build prefetch selector rules", () => {
    const config = parseMetaConfig('<meta name="sf:prefetch-selector" content="a.nav">');
    const rules = buildSpeculationRulesFromConfig(config);
    strictEqual(rules?.prefetch?.length, 1);
    strictEqual(rules?.prefetch?.[0].source, "document");
    deepStrictEqual((rules!.prefetch![0] as { where: { selector_matches: string } }).where, {
      selector_matches: "a.nav",
    });
  });

  it("should build prerender list rules", () => {
    const config = parseMetaConfig('<meta name="sf:prerender" content="/, /landing">');
    const rules = buildSpeculationRulesFromConfig(config);
    strictEqual(rules?.prerender?.length, 1);
    strictEqual(rules?.prerender?.[0].source, "list");
    deepStrictEqual((rules!.prerender![0] as { urls: string[] }).urls, ["/", "/landing"]);
  });

  it("should apply eagerness setting", () => {
    const html = `
      <meta name="sf:prefetch" content="/about">
      <meta name="sf:speculation-eagerness" content="eager">
    `;
    const config = parseMetaConfig(html);
    const rules = buildSpeculationRulesFromConfig(config);
    strictEqual(rules?.prefetch?.[0].eagerness, "eager");
  });

  it("should build combined prefetch and prerender rules", () => {
    const html = `
      <meta name="sf:prefetch" content="/about, /blog/*">
      <meta name="sf:prerender" content="/">
      <meta name="sf:prefetch-selector" content="a.prefetch">
    `;
    const config = parseMetaConfig(html);
    const rules = buildSpeculationRulesFromConfig(config);
    strictEqual(rules?.prefetch?.length, 3); // list + document + selector
    strictEqual(rules?.prerender?.length, 1);
  });
});
