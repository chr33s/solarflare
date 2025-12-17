import { describe, it, expect, beforeEach } from "bun:test";
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
} from "./head";

describe("createHeadContext", () => {
  beforeEach(() => {
    setHeadContext(null);
  });

  it("should create a new head context", () => {
    const ctx = createHeadContext();
    expect(ctx.entries).toEqual([]);
    expect(ctx.htmlAttrs).toEqual({});
    expect(ctx.bodyAttrs).toEqual({});
  });

  it("should push head entries", () => {
    const ctx = createHeadContext();
    ctx.push({ title: "Test Title" });
    expect(ctx.entries.length).toBe(1);
    expect(ctx.entries[0].input.title).toBe("Test Title");
  });

  it("should return active entry with patch and dispose", () => {
    const ctx = createHeadContext();
    const entry = ctx.push({ title: "Initial" });

    expect(typeof entry.patch).toBe("function");
    expect(typeof entry.dispose).toBe("function");

    entry.patch({ title: "Updated" });
    expect(ctx.entries[0].input.title).toBe("Updated");

    entry.dispose();
    expect(ctx.entries.length).toBe(0);
  });

  it("should handle title template string", () => {
    const ctx = createHeadContext();
    ctx.push({ titleTemplate: "%s | My Site" });
    ctx.push({ title: "Home" });

    const tags = ctx.resolveTags();
    const titleTag = tags.find((t) => t.tag === "title");
    expect(titleTag?.textContent).toBe("Home | My Site");
  });

  it("should handle title template function", () => {
    const ctx = createHeadContext();
    ctx.push({ titleTemplate: (title) => `${title} - Custom Site` });
    ctx.push({ title: "About" });

    const tags = ctx.resolveTags();
    const titleTag = tags.find((t) => t.tag === "title");
    expect(titleTag?.textContent).toBe("About - Custom Site");
  });

  it("should merge htmlAttrs and bodyAttrs", () => {
    const ctx = createHeadContext();
    ctx.push({ htmlAttrs: { lang: "en" } });
    ctx.push({ htmlAttrs: { dir: "ltr" }, bodyAttrs: { class: "dark" } });

    expect(ctx.htmlAttrs).toEqual({ lang: "en", dir: "ltr" });
    expect(ctx.bodyAttrs).toEqual({ class: "dark" });
  });

  it("should reset context", () => {
    const ctx = createHeadContext();
    ctx.push({ title: "Test" });
    ctx.push({ htmlAttrs: { lang: "en" } });
    ctx.reset();

    expect(ctx.entries.length).toBe(0);
    expect(ctx.htmlAttrs).toEqual({});
  });
});

describe("dedupeKey", () => {
  it("should dedupe unique tags by name", () => {
    expect(dedupeKey({ tag: "title", props: {} })).toBe("title");
    expect(dedupeKey({ tag: "base", props: {} })).toBe("base");
  });

  it("should dedupe meta by name attribute", () => {
    const tag: HeadTag = { tag: "meta", props: { name: "description", content: "test" } };
    expect(dedupeKey(tag)).toBe("meta:description");
  });

  it("should dedupe meta by property attribute", () => {
    const tag: HeadTag = { tag: "meta", props: { property: "og:title", content: "test" } };
    expect(dedupeKey(tag)).toBe("meta:og:title");
  });

  it("should dedupe meta by http-equiv attribute", () => {
    const tag: HeadTag = { tag: "meta", props: { "http-equiv": "content-type", content: "test" } };
    expect(dedupeKey(tag)).toBe("meta:content-type");
  });

  it("should dedupe charset", () => {
    const tag: HeadTag = { tag: "meta", props: { charset: "utf-8" } };
    expect(dedupeKey(tag)).toBe("charset");
  });

  it("should dedupe canonical link", () => {
    const tag: HeadTag = { tag: "link", props: { rel: "canonical", href: "https://example.com" } };
    expect(dedupeKey(tag)).toBe("canonical");
  });

  it("should use manual key when provided", () => {
    const tag: HeadTag = { tag: "script", props: { src: "/app.js" }, key: "main-script" };
    expect(dedupeKey(tag)).toBe("script:key:main-script");
  });

  it("should dedupe by id for link tags", () => {
    const tag: HeadTag = { tag: "link", props: { id: "theme-styles", rel: "stylesheet" } };
    expect(dedupeKey(tag)).toBe("link:id:theme-styles");
  });
});

describe("tagWeight", () => {
  it("should give charset highest priority", () => {
    const tag: HeadTag = { tag: "meta", props: { charset: "utf-8" } };
    expect(tagWeight(tag)).toBe(1);
  });

  it("should give viewport high priority", () => {
    const tag: HeadTag = {
      tag: "meta",
      props: { name: "viewport", content: "width=device-width" },
    };
    expect(tagWeight(tag)).toBe(2);
  });

  it("should give preconnect early priority", () => {
    const tag: HeadTag = {
      tag: "link",
      props: { rel: "preconnect", href: "https://fonts.gstatic.com" },
    };
    expect(tagWeight(tag)).toBe(5);
  });

  it("should respect tagPriority number", () => {
    const tag: HeadTag = { tag: "meta", props: { name: "custom" }, tagPriority: 99 };
    expect(tagWeight(tag)).toBe(99);
  });

  it("should respect tagPriority critical", () => {
    const tag: HeadTag = { tag: "script", props: { src: "/critical.js" }, tagPriority: "critical" };
    expect(tagWeight(tag)).toBe(-80);
  });

  it("should respect tagPriority low", () => {
    const tag: HeadTag = { tag: "script", props: { src: "/analytics.js" }, tagPriority: "low" };
    expect(tagWeight(tag)).toBe(50);
  });
});

describe("normalizeInputToTags", () => {
  it("should normalize title", () => {
    const tags = normalizeInputToTags({ title: "Hello World" });
    expect(tags).toHaveLength(1);
    expect(tags[0].tag).toBe("title");
    expect(tags[0].textContent).toBe("Hello World");
  });

  it("should normalize meta tags", () => {
    const tags = normalizeInputToTags({
      meta: [{ charset: "utf-8" }, { name: "description", content: "My site" }],
    });
    expect(tags).toHaveLength(2);
    expect(tags[0].tag).toBe("meta");
    expect(tags[0].props.charset).toBe("utf-8");
    expect(tags[1].props.name).toBe("description");
  });

  it("should normalize link tags", () => {
    const tags = normalizeInputToTags({
      link: [
        { rel: "stylesheet", href: "/styles.css" },
        { rel: "icon", href: "/favicon.ico" },
      ],
    });
    expect(tags).toHaveLength(2);
    expect(tags[0].props.rel).toBe("stylesheet");
    expect(tags[1].props.rel).toBe("icon");
  });

  it("should normalize script tags with innerHTML", () => {
    const tags = normalizeInputToTags({
      script: [{ innerHTML: "console.log('hello')" }],
    });
    expect(tags).toHaveLength(1);
    expect(tags[0].textContent).toBe("console.log('hello')");
  });

  it("should normalize base tag", () => {
    const tags = normalizeInputToTags({
      base: { href: "https://example.com", target: "_blank" },
    });
    expect(tags).toHaveLength(1);
    expect(tags[0].tag).toBe("base");
    expect(tags[0].props.href).toBe("https://example.com");
  });

  it("should preserve key on tags", () => {
    const tags = normalizeInputToTags({
      meta: [{ name: "custom", content: "value", key: "my-meta" }],
    });
    expect(tags[0].key).toBe("my-meta");
  });
});

describe("tagToHtml", () => {
  it("should render self-closing meta tag", () => {
    const tag: HeadTag = { tag: "meta", props: { charset: "utf-8" } };
    expect(tagToHtml(tag)).toBe('<meta charset="utf-8">');
  });

  it("should render meta with name and content", () => {
    const tag: HeadTag = { tag: "meta", props: { name: "description", content: "My site" } };
    expect(tagToHtml(tag)).toBe('<meta name="description" content="My site">');
  });

  it("should render link tag", () => {
    const tag: HeadTag = { tag: "link", props: { rel: "stylesheet", href: "/styles.css" } };
    expect(tagToHtml(tag)).toBe('<link rel="stylesheet" href="/styles.css">');
  });

  it("should render title with content", () => {
    const tag: HeadTag = { tag: "title", props: {}, textContent: "Hello World" };
    expect(tagToHtml(tag)).toBe("<title>Hello World</title>");
  });

  it("should render script with innerHTML", () => {
    const tag: HeadTag = {
      tag: "script",
      props: { type: "application/json" },
      textContent: '{"key":"value"}',
    };
    expect(tagToHtml(tag)).toBe('<script type="application/json">{"key":"value"}</script>');
  });

  it("should handle boolean attributes", () => {
    const tag: HeadTag = { tag: "script", props: { src: "/app.js", async: true, defer: false } };
    expect(tagToHtml(tag)).toBe('<script src="/app.js" async></script>');
  });

  it("should escape HTML in attribute values", () => {
    const tag: HeadTag = {
      tag: "meta",
      props: { name: "test", content: 'Hello "World" & <Friends>' },
    };
    expect(tagToHtml(tag)).toBe(
      '<meta name="test" content="Hello &quot;World&quot; &amp; &lt;Friends&gt;">',
    );
  });

  it("should escape HTML in title content", () => {
    const tag: HeadTag = { tag: "title", props: {}, textContent: "Hello <World>" };
    expect(tagToHtml(tag)).toBe("<title>Hello &lt;World&gt;</title>");
  });

  it("should not escape script/style content", () => {
    const tag: HeadTag = {
      tag: "script",
      props: {},
      textContent: "if (a < b) { console.log('yes'); }",
    };
    expect(tagToHtml(tag)).toBe("<script>if (a < b) { console.log('yes'); }</script>");
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
    expect(descTags).toHaveLength(1);
    expect(descTags[0].props.content).toBe("Page description");
  });

  it("should dedupe title (last wins)", () => {
    const ctx = createHeadContext();
    ctx.push({ title: "Site Title" });
    ctx.push({ title: "Page Title" });

    const tags = ctx.resolveTags();
    const titleTags = tags.filter((t) => t.tag === "title");
    expect(titleTags).toHaveLength(1);
    expect(titleTags[0].textContent).toBe("Page Title");
  });

  it("should dedupe charset (last wins)", () => {
    const ctx = createHeadContext();
    ctx.push({ meta: [{ charset: "utf-8" }] });
    ctx.push({ meta: [{ charset: "iso-8859-1" }] });

    const tags = ctx.resolveTags();
    const charsetTags = tags.filter((t) => t.props.charset);
    expect(charsetTags).toHaveLength(1);
    expect(charsetTags[0].props.charset).toBe("iso-8859-1");
  });

  it("should dedupe canonical link (last wins)", () => {
    const ctx = createHeadContext();
    ctx.push({ link: [{ rel: "canonical", href: "https://old.com" }] });
    ctx.push({ link: [{ rel: "canonical", href: "https://new.com" }] });

    const tags = ctx.resolveTags();
    const canonicalTags = tags.filter((t) => t.props.rel === "canonical");
    expect(canonicalTags).toHaveLength(1);
    expect(canonicalTags[0].props.href).toBe("https://new.com");
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
    expect(ogImageTags).toHaveLength(2);
  });

  it("should dedupe og:title (structured property dedupes)", () => {
    const ctx = createHeadContext();
    ctx.push({ meta: [{ property: "og:title", content: "Old Title" }] });
    ctx.push({ meta: [{ property: "og:title", content: "New Title" }] });

    const tags = ctx.resolveTags();
    const ogTitleTags = tags.filter((t) => t.props.property === "og:title");
    expect(ogTitleTags).toHaveLength(1);
    expect(ogTitleTags[0].props.content).toBe("New Title");
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
    expect(tags[0].props.charset).toBe("utf-8");
    expect(tags[1].props.name).toBe("viewport");
    expect(tags[2].props.name).toBe("description");
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
    expect(tags[0].props.rel).toBe("preconnect");
    expect(tags[1].props.rel).toBe("stylesheet");
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

    expect(ctx.entries).toHaveLength(1);
    expect(ctx.entries[0].input.title).toBe("Test Page");
  });

  it("should return active entry", () => {
    const ctx = createHeadContext();
    setHeadContext(ctx);

    const entry = useHead({ title: "Initial" });

    entry.patch({ title: "Updated" });
    expect(ctx.entries[0].input.title).toBe("Updated");

    entry.dispose();
    expect(ctx.entries).toHaveLength(0);
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
    expect(html).toContain('<meta charset="utf-8">');
    expect(html).toContain("<title>My Page</title>");
    expect(html).toContain('<meta name="description" content="My description">');
    expect(html).toContain('<link rel="stylesheet" href="/styles.css">');
  });

  it("should apply title template in render", () => {
    const ctx = createHeadContext();
    ctx.push({ titleTemplate: "%s | Site" });
    ctx.push({ title: "Home" });

    const html = ctx.renderToString();
    expect(html).toContain("<title>Home | Site</title>");
  });
});

describe("Head (SSR marker)", () => {
  it("should render head marker", () => {
    const vnode = Head();
    expect(vnode.type).toBe("solarflare-head");
    expect(vnode.props.dangerouslySetInnerHTML.__html).toBe(HEAD_MARKER);
  });
});

describe("HeadOutlet (deprecated alias)", () => {
  it("should render head marker", () => {
    const vnode = HeadOutlet();
    expect(vnode.type).toBe("solarflare-head");
    expect(vnode.props.dangerouslySetInnerHTML.__html).toBe(HEAD_MARKER);
  });

  it("should be the same as Head", () => {
    expect(HeadOutlet).toBe(Head);
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

    expect(parsed.entries).toHaveLength(2);
    expect(parsed.htmlAttrs).toEqual({ lang: "en" });
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

    expect(ctx.entries).toHaveLength(2);
    expect(ctx.htmlAttrs).toEqual({ lang: "de" });
  });

  it("should handle invalid JSON gracefully", () => {
    const ctx = createHeadContext();
    setHeadContext(ctx);

    // Should not throw
    hydrateHeadState("invalid json {{{");
    expect(ctx.entries).toHaveLength(0);
  });
});

describe("global context management", () => {
  beforeEach(() => {
    setHeadContext(null);
  });

  it("should get or create global context", () => {
    const ctx1 = getHeadContext();
    const ctx2 = getHeadContext();
    expect(ctx1).toBe(ctx2);
  });

  it("should allow setting custom context", () => {
    const customCtx = createHeadContext();
    setHeadContext(customCtx);
    expect(getHeadContext()).toBe(customCtx);
  });

  it("should reset global context", () => {
    const ctx = getHeadContext();
    ctx.push({ title: "Test" });
    expect(ctx.entries).toHaveLength(1);

    resetHeadContext();
    expect(ctx.entries).toHaveLength(0);
  });
});

describe("installHeadHoisting", () => {
  beforeEach(() => {
    setHeadContext(null);
  });

  it("should export installHeadHoisting function", async () => {
    const { installHeadHoisting } = await import("./head");
    expect(typeof installHeadHoisting).toBe("function");
  });

  it("should export resetHeadElementTracking function", async () => {
    const { resetHeadElementTracking } = await import("./head");
    expect(typeof resetHeadElementTracking).toBe("function");
  });
});
