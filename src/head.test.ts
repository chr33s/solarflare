import { describe, it, beforeEach } from "node:test";
import * as assert from "node:assert/strict";
import {
  createHeadContext,
  getHeadContext,
  setHeadContext,
  resetHeadContext,
  useHead,
  dedupeKey,
  tagWeight,
  normalizeInputToTags,
  tagToHtml,
  Head,
  HEAD_MARKER,
  HeadOutlet,
  serializeHeadState,
  hydrateHeadState,
  type HeadTag,
} from "./head.ts";

describe("createHeadContext", () => {
  beforeEach(() => {
    setHeadContext(null);
  });

  it("should create a new head context", () => {
    const ctx = createHeadContext();
    assert.deepStrictEqual(ctx.entries, []);
    assert.deepStrictEqual(ctx.htmlAttrs, {});
    assert.deepStrictEqual(ctx.bodyAttrs, {});
  });

  it("should push head entries", () => {
    const ctx = createHeadContext();
    ctx.push({ title: "Test Title" });
    assert.strictEqual(ctx.entries.length, 1);
    assert.strictEqual(ctx.entries[0].input.title, "Test Title");
  });

  it("should return active entry with patch and dispose", () => {
    const ctx = createHeadContext();
    const entry = ctx.push({ title: "Initial" });

    assert.strictEqual(typeof entry.patch, "function");
    assert.strictEqual(typeof entry.dispose, "function");

    entry.patch({ title: "Updated" });
    assert.strictEqual(ctx.entries[0].input.title, "Updated");

    entry.dispose();
    assert.strictEqual(ctx.entries.length, 0);
  });

  it("should handle title template string", () => {
    const ctx = createHeadContext();
    ctx.push({ titleTemplate: "%s | My Site" });
    ctx.push({ title: "Home" });

    const tags = ctx.resolveTags();
    const titleTag = tags.find((t) => t.tag === "title");
    assert.strictEqual(titleTag?.textContent, "Home | My Site");
  });

  it("should handle title template function", () => {
    const ctx = createHeadContext();
    ctx.push({ titleTemplate: (title) => `${title} - Custom Site` });
    ctx.push({ title: "About" });

    const tags = ctx.resolveTags();
    const titleTag = tags.find((t) => t.tag === "title");
    assert.strictEqual(titleTag?.textContent, "About - Custom Site");
  });

  it("should merge htmlAttrs and bodyAttrs", () => {
    const ctx = createHeadContext();
    ctx.push({ htmlAttrs: { lang: "en" } });
    ctx.push({ htmlAttrs: { dir: "ltr" }, bodyAttrs: { class: "dark" } });

    assert.deepStrictEqual(ctx.htmlAttrs, { lang: "en", dir: "ltr" });
    assert.deepStrictEqual(ctx.bodyAttrs, { class: "dark" });
  });

  it("should reset context", () => {
    const ctx = createHeadContext();
    ctx.push({ title: "Test" });
    ctx.push({ htmlAttrs: { lang: "en" } });
    ctx.reset();

    assert.strictEqual(ctx.entries.length, 0);
    assert.deepStrictEqual(ctx.htmlAttrs, {});
  });
});

describe("dedupeKey", () => {
  it("should dedupe unique tags by name", () => {
    assert.strictEqual(dedupeKey({ tag: "title", props: {} }), "title");
    assert.strictEqual(dedupeKey({ tag: "base", props: {} }), "base");
  });

  it("should dedupe meta by name attribute", () => {
    const tag: HeadTag = { tag: "meta", props: { name: "description", content: "test" } };
    assert.strictEqual(dedupeKey(tag), "meta:description");
  });

  it("should dedupe meta by property attribute", () => {
    const tag: HeadTag = { tag: "meta", props: { property: "og:title", content: "test" } };
    assert.strictEqual(dedupeKey(tag), "meta:og:title");
  });

  it("should dedupe meta by http-equiv attribute", () => {
    const tag: HeadTag = { tag: "meta", props: { "http-equiv": "content-type", content: "test" } };
    assert.strictEqual(dedupeKey(tag), "meta:content-type");
  });

  it("should dedupe charset", () => {
    const tag: HeadTag = { tag: "meta", props: { charset: "utf-8" } };
    assert.strictEqual(dedupeKey(tag), "charset");
  });

  it("should dedupe canonical link", () => {
    const tag: HeadTag = { tag: "link", props: { rel: "canonical", href: "https://example.com" } };
    assert.strictEqual(dedupeKey(tag), "canonical");
  });

  it("should use manual key when provided", () => {
    const tag: HeadTag = { tag: "script", props: { src: "/app.js" }, key: "main-script" };
    assert.strictEqual(dedupeKey(tag), "script:key:main-script");
  });

  it("should dedupe by id for link tags", () => {
    const tag: HeadTag = { tag: "link", props: { id: "theme-styles", rel: "stylesheet" } };
    assert.strictEqual(dedupeKey(tag), "link:id:theme-styles");
  });
});

describe("tagWeight", () => {
  it("should give charset highest priority", () => {
    const tag: HeadTag = { tag: "meta", props: { charset: "utf-8" } };
    assert.strictEqual(tagWeight(tag), 1);
  });

  it("should give viewport high priority", () => {
    const tag: HeadTag = {
      tag: "meta",
      props: { name: "viewport", content: "width=device-width" },
    };
    assert.strictEqual(tagWeight(tag), 2);
  });

  it("should give preconnect early priority", () => {
    const tag: HeadTag = {
      tag: "link",
      props: { rel: "preconnect", href: "https://fonts.gstatic.com" },
    };
    assert.strictEqual(tagWeight(tag), 5);
  });

  it("should respect tagPriority number", () => {
    const tag: HeadTag = { tag: "meta", props: { name: "custom" }, tagPriority: 99 };
    assert.strictEqual(tagWeight(tag), 99);
  });

  it("should respect tagPriority critical", () => {
    const tag: HeadTag = { tag: "script", props: { src: "/critical.js" }, tagPriority: "critical" };
    assert.strictEqual(tagWeight(tag), -80);
  });

  it("should respect tagPriority low", () => {
    const tag: HeadTag = { tag: "script", props: { src: "/analytics.js" }, tagPriority: "low" };
    assert.strictEqual(tagWeight(tag), 50);
  });
});

describe("normalizeInputToTags", () => {
  it("should normalize title", () => {
    const tags = normalizeInputToTags({ title: "Hello World" });
    assert.strictEqual(tags.length, 1);
    assert.strictEqual(tags[0].tag, "title");
    assert.strictEqual(tags[0].textContent, "Hello World");
  });

  it("should normalize meta tags", () => {
    const tags = normalizeInputToTags({
      meta: [{ charset: "utf-8" }, { name: "description", content: "My site" }],
    });
    assert.strictEqual(tags.length, 2);
    assert.strictEqual(tags[0].tag, "meta");
    assert.strictEqual(tags[0].props.charset, "utf-8");
    assert.strictEqual(tags[1].props.name, "description");
  });

  it("should normalize link tags", () => {
    const tags = normalizeInputToTags({
      link: [
        { rel: "stylesheet", href: "/styles.css" },
        { rel: "icon", href: "/favicon.ico" },
      ],
    });
    assert.strictEqual(tags.length, 2);
    assert.strictEqual(tags[0].props.rel, "stylesheet");
    assert.strictEqual(tags[1].props.rel, "icon");
  });

  it("should normalize script tags with innerHTML", () => {
    const tags = normalizeInputToTags({
      script: [{ innerHTML: "console.log('hello')" }],
    });
    assert.strictEqual(tags.length, 1);
    assert.strictEqual(tags[0].textContent, "console.log('hello')");
  });

  it("should normalize base tag", () => {
    const tags = normalizeInputToTags({
      base: { href: "https://example.com", target: "_blank" },
    });
    assert.strictEqual(tags.length, 1);
    assert.strictEqual(tags[0].tag, "base");
    assert.strictEqual(tags[0].props.href, "https://example.com");
  });

  it("should preserve key on tags", () => {
    const tags = normalizeInputToTags({
      meta: [{ name: "custom", content: "value", key: "my-meta" }],
    });
    assert.strictEqual(tags[0].key, "my-meta");
  });
});

describe("tagToHtml", () => {
  it("should render self-closing meta tag", () => {
    const tag: HeadTag = { tag: "meta", props: { charset: "utf-8" } };
    assert.strictEqual(tagToHtml(tag), '<meta charset="utf-8">');
  });

  it("should render meta with name and content", () => {
    const tag: HeadTag = { tag: "meta", props: { name: "description", content: "My site" } };
    assert.strictEqual(tagToHtml(tag), '<meta name="description" content="My site">');
  });

  it("should render link tag", () => {
    const tag: HeadTag = { tag: "link", props: { rel: "stylesheet", href: "/styles.css" } };
    assert.strictEqual(tagToHtml(tag), '<link rel="stylesheet" href="/styles.css">');
  });

  it("should render title with content", () => {
    const tag: HeadTag = { tag: "title", props: {}, textContent: "Hello World" };
    assert.strictEqual(tagToHtml(tag), "<title>Hello World</title>");
  });

  it("should render script with innerHTML", () => {
    const tag: HeadTag = {
      tag: "script",
      props: { type: "application/json" },
      textContent: '{"key":"value"}',
    };
    assert.strictEqual(tagToHtml(tag), '<script type="application/json">{"key":"value"}</script>');
  });

  it("should handle boolean attributes", () => {
    const tag: HeadTag = { tag: "script", props: { src: "/app.js", async: true, defer: false } };
    assert.strictEqual(tagToHtml(tag), '<script src="/app.js" async></script>');
  });

  it("should escape HTML in attribute values", () => {
    const tag: HeadTag = {
      tag: "meta",
      props: { name: "test", content: 'Hello "World" & <Friends>' },
    };
    assert.strictEqual(
      tagToHtml(tag),
      '<meta name="test" content="Hello &quot;World&quot; &amp; &lt;Friends&gt;">',
    );
  });

  it("should escape HTML in title content", () => {
    const tag: HeadTag = { tag: "title", props: {}, textContent: "Hello <World>" };
    assert.strictEqual(tagToHtml(tag), "<title>Hello &lt;World&gt;</title>");
  });

  it("should not escape script/style content", () => {
    const tag: HeadTag = {
      tag: "script",
      props: {},
      textContent: "if (a < b) { console.log('yes'); }",
    };
    assert.strictEqual(tagToHtml(tag), "<script>if (a < b) { console.log('yes'); }</script>");
  });
});

describe("deduplication", () => {
  beforeEach(() => {
    setHeadContext(null);
  });

  it("should dedupe meta description (last wins)", () => {
    const ctx = createHeadContext();
    ctx.push({
      meta: [{ name: "description", content: "Site description" }],
    });
    ctx.push({
      meta: [{ name: "description", content: "Page description" }],
    });

    const tags = ctx.resolveTags();
    const descTags = tags.filter((t) => t.props.name === "description");
    assert.strictEqual(descTags.length, 1);
    assert.strictEqual(descTags[0].props.content, "Page description");
  });

  it("should dedupe title (last wins)", () => {
    const ctx = createHeadContext();
    ctx.push({ title: "Site Title" });
    ctx.push({ title: "Page Title" });

    const tags = ctx.resolveTags();
    const titleTags = tags.filter((t) => t.tag === "title");
    assert.strictEqual(titleTags.length, 1);
    assert.strictEqual(titleTags[0].textContent, "Page Title");
  });

  it("should dedupe charset (last wins)", () => {
    const ctx = createHeadContext();
    ctx.push({ meta: [{ charset: "utf-8" }] });
    ctx.push({ meta: [{ charset: "iso-8859-1" }] });

    const tags = ctx.resolveTags();
    const charsetTags = tags.filter((t) => t.props.charset);
    assert.strictEqual(charsetTags.length, 1);
    assert.strictEqual(charsetTags[0].props.charset, "iso-8859-1");
  });

  it("should dedupe canonical link (last wins)", () => {
    const ctx = createHeadContext();
    ctx.push({ link: [{ rel: "canonical", href: "https://old.com" }] });
    ctx.push({ link: [{ rel: "canonical", href: "https://new.com" }] });

    const tags = ctx.resolveTags();
    const canonicalTags = tags.filter((t) => t.props.rel === "canonical");
    assert.strictEqual(canonicalTags.length, 1);
    assert.strictEqual(canonicalTags[0].props.href, "https://new.com");
  });

  it("should allow multiple og:image with different keys", () => {
    const ctx = createHeadContext();
    ctx.push({
      meta: [
        { property: "og:image", content: "https://example.com/1.jpg", key: "og-image-1" },
        { property: "og:image", content: "https://example.com/2.jpg", key: "og-image-2" },
      ],
    });

    const tags = ctx.resolveTags();
    const ogImageTags = tags.filter((t) => t.props.property === "og:image");
    assert.strictEqual(ogImageTags.length, 2);
  });

  it("should dedupe og:title (structured property dedupes)", () => {
    const ctx = createHeadContext();
    ctx.push({ meta: [{ property: "og:title", content: "Old Title" }] });
    ctx.push({ meta: [{ property: "og:title", content: "New Title" }] });

    const tags = ctx.resolveTags();
    const ogTitleTags = tags.filter((t) => t.props.property === "og:title");
    assert.strictEqual(ogTitleTags.length, 1);
    assert.strictEqual(ogTitleTags[0].props.content, "New Title");
  });
});

describe("tag sorting", () => {
  beforeEach(() => {
    setHeadContext(null);
  });

  it("should sort charset before other meta", () => {
    const ctx = createHeadContext();
    ctx.push({
      meta: [
        { name: "description", content: "test" },
        { charset: "utf-8" },
        { name: "viewport", content: "width=device-width" },
      ],
    });

    const tags = ctx.resolveTags();
    assert.strictEqual(tags[0].props.charset, "utf-8");
    assert.strictEqual(tags[1].props.name, "viewport");
    assert.strictEqual(tags[2].props.name, "description");
  });

  it("should sort preconnect early", () => {
    const ctx = createHeadContext();
    ctx.push({
      link: [
        { rel: "stylesheet", href: "/styles.css" },
        { rel: "preconnect", href: "https://fonts.gstatic.com" },
      ],
    });

    const tags = ctx.resolveTags();
    assert.strictEqual(tags[0].props.rel, "preconnect");
    assert.strictEqual(tags[1].props.rel, "stylesheet");
  });
});

describe("useHead", () => {
  beforeEach(() => {
    setHeadContext(null);
  });

  it("should add head entry to context", () => {
    const ctx = createHeadContext();
    setHeadContext(ctx);

    useHead({ title: "Test Page" });

    assert.strictEqual(ctx.entries.length, 1);
    assert.strictEqual(ctx.entries[0].input.title, "Test Page");
  });

  it("should return active entry", () => {
    const ctx = createHeadContext();
    setHeadContext(ctx);

    const entry = useHead({ title: "Initial" });

    entry.patch({ title: "Updated" });
    assert.strictEqual(ctx.entries[0].input.title, "Updated");

    entry.dispose();
    assert.strictEqual(ctx.entries.length, 0);
  });
});

describe("renderToString", () => {
  beforeEach(() => {
    setHeadContext(null);
  });

  it("should render all head tags to HTML", () => {
    const ctx = createHeadContext();
    ctx.push({
      title: "My Page",
      meta: [{ charset: "utf-8" }, { name: "description", content: "My description" }],
      link: [{ rel: "stylesheet", href: "/styles.css" }],
    });

    const html = ctx.renderToString();
    assert.ok(html.includes('<meta charset="utf-8">'));
    assert.ok(html.includes("<title>My Page</title>"));
    assert.ok(html.includes('<meta name="description" content="My description">'));
    assert.ok(html.includes('<link rel="stylesheet" href="/styles.css">'));
  });

  it("should apply title template in render", () => {
    const ctx = createHeadContext();
    ctx.push({ titleTemplate: "%s | Site" });
    ctx.push({ title: "Home" });

    const html = ctx.renderToString();
    assert.ok(html.includes("<title>Home | Site</title>"));
  });
});

describe("Head (SSR marker)", () => {
  it("should render head marker", () => {
    const vnode = Head();
    assert.strictEqual(vnode.type, "solarflare-head");
    assert.strictEqual(vnode.props.dangerouslySetInnerHTML.__html, HEAD_MARKER);
  });
});

describe("HeadOutlet (deprecated alias)", () => {
  it("should render head marker", () => {
    const vnode = HeadOutlet();
    assert.strictEqual(vnode.type, "solarflare-head");
    assert.strictEqual(vnode.props.dangerouslySetInnerHTML.__html, HEAD_MARKER);
  });

  it("should be the same as Head", () => {
    assert.strictEqual(HeadOutlet, Head);
  });
});

describe("serialization and hydration", () => {
  beforeEach(() => {
    setHeadContext(null);
  });

  it("should serialize head state", () => {
    const ctx = createHeadContext();
    setHeadContext(ctx);

    ctx.push({ title: "Test", meta: [{ charset: "utf-8" }] });
    ctx.push({ htmlAttrs: { lang: "en" } });

    const serialized = serializeHeadState();
    const parsed = JSON.parse(serialized);

    assert.strictEqual(parsed.entries.length, 2);
    assert.deepStrictEqual(parsed.htmlAttrs, { lang: "en" });
  });

  it("should hydrate head state", () => {
    const ctx = createHeadContext();
    setHeadContext(ctx);

    const state = {
      entries: [
        { input: { title: "Hydrated Title" }, options: {} },
        { input: { meta: [{ name: "description", content: "Hydrated" }] }, options: {} },
      ],
      htmlAttrs: { lang: "de" },
      bodyAttrs: {},
    };

    hydrateHeadState(JSON.stringify(state));

    assert.strictEqual(ctx.entries.length, 2);
    assert.deepStrictEqual(ctx.htmlAttrs, { lang: "de" });
  });

  it("should handle invalid JSON gracefully", () => {
    const ctx = createHeadContext();
    setHeadContext(ctx);

    // Should not throw
    hydrateHeadState("invalid json {{{");
    assert.strictEqual(ctx.entries.length, 0);
  });
});

describe("global context management", () => {
  beforeEach(() => {
    setHeadContext(null);
  });

  it("should get or create global context", () => {
    const ctx1 = getHeadContext();
    const ctx2 = getHeadContext();
    assert.strictEqual(ctx1, ctx2);
  });

  it("should allow setting custom context", () => {
    const customCtx = createHeadContext();
    setHeadContext(customCtx);
    assert.strictEqual(getHeadContext(), customCtx);
  });

  it("should reset global context", () => {
    const ctx = getHeadContext();
    ctx.push({ title: "Test" });
    assert.strictEqual(ctx.entries.length, 1);

    resetHeadContext();
    assert.strictEqual(ctx.entries.length, 0);
  });
});

describe("installHeadHoisting", () => {
  beforeEach(() => {
    setHeadContext(null);
  });

  it("should export installHeadHoisting function", async () => {
    const { installHeadHoisting } = await import("./head.ts");
    assert.strictEqual(typeof installHeadHoisting, "function");
  });

  it("should export resetHeadElementTracking function", async () => {
    const { resetHeadElementTracking } = await import("./head.ts");
    assert.strictEqual(typeof resetHeadElementTracking, "function");
  });
});
