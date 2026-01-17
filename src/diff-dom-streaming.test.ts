import { describe, it, beforeEach, afterEach, before, after } from "node:test";
import assert from "node:assert";
import { chromium, firefox, webkit, type Browser, type Page } from "playwright";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { transformSync } from "esbuild";

// Transpile diff-dom-streaming.ts for browser execution
const diffSource = readFileSync(join(import.meta.dirname, "diff-dom-streaming.ts"), "utf-8");
const diffCode = transformSync(
  diffSource.replace(/^\/\/ src:.*$/m, "").replace(/^export default /m, ""),
  { loader: "ts", target: "es2022" },
).code;

const normalize = (t: string) => t.replace(/\s*\n\s*/g, "").replaceAll("'", '"');

interface TestDiffOptions {
  oldHTMLString: string;
  newHTMLStringChunks: string[];
  useForEachStreamNode?: boolean;
  slowChunks?: boolean;
  transition?: boolean;
  ignoreId?: boolean;
  registerWC?: boolean;
  onNextNode?: string;
}

let browser: Browser;
let page: Page;

async function testDiff({
  oldHTMLString,
  newHTMLStringChunks,
  useForEachStreamNode = false,
  slowChunks = false,
  transition = false,
  ignoreId = false,
  registerWC = false,
  onNextNode,
}: TestDiffOptions) {
  await page.setContent(normalize(oldHTMLString));
  const [mutations, streamNodes, transitionApplied, logs] = await page.evaluate(
    async ([
      diffCode,
      newHTMLStringChunks,
      useForEachStreamNode,
      slowChunks,
      transition,
      ignoreId,
      registerWC,
      onNextNode,
    ]) => {
      // oxlint-disable-next-line no-eval
      eval(diffCode as string);
      const encoder = new TextEncoder();
      const readable = new ReadableStream({
        start: async (controller) => {
          for (const chunk of newHTMLStringChunks as string[]) {
            if (slowChunks) await new Promise((resolve) => setTimeout(resolve, 100));
            controller.enqueue(encoder.encode(chunk));
          }
          controller.close();
        },
      });
      const allMutations: any[] = [];
      const observer = new MutationObserver((mutations) => {
        allMutations.push(
          ...mutations.map((mutation, mutationIndex) => ({
            type: mutation.type,
            addedNodes: Array.from(mutation.addedNodes).map((node, index) => ({
              nodeName: node.nodeName,
              nodeValue: node.nodeValue,
              keepsExistingNodeReference: node.isSameNode(
                mutations[mutationIndex - 1]?.removedNodes?.[index],
              ),
            })),
            removedNodes: Array.from(mutation.removedNodes).map((node) => ({
              nodeName: node.nodeName,
              nodeValue: node.nodeValue,
            })),
            attributeName: mutation.attributeName,
            tagName: (mutation.target as Element).tagName,
            outerHTML: (mutation.target as Element).outerHTML,
            oldValue: mutation.oldValue,
          })),
        );
      });

      observer.observe(document.documentElement, {
        childList: true,
        attributes: true,
        subtree: true,
        attributeOldValue: true,
        characterData: true,
        characterDataOldValue: true,
      });

      const streamNodes: any[] = [];

      const forEachStreamNode = useForEachStreamNode
        ? (node: Node) => {
            streamNodes.push({
              nodeName: node.nodeName,
              nodeValue: node.nodeValue,
            });
          }
        : // oxlint-disable-next-line no-eval
          eval(onNextNode as string);

      if (registerWC) {
        class TestWC extends HTMLElement {
          connectedCallback() {
            this.setAttribute("data-connected", "true");
          }
        }
        if (!customElements.get("test-wc")) {
          customElements.define("test-wc", TestWC);
        }
      }

      // @ts-expect-error - diff is defined via eval
      await diff(document.documentElement!, readable, {
        onNextNode: forEachStreamNode,
        transition: transition as boolean,
        shouldIgnoreNode(node: Node | null) {
          if (!ignoreId) return false;
          return (node as Element)?.id === "ignore";
        },
      });

      // Wait for batched mutations to flush (they're scheduled via requestAnimationFrame)
      await new Promise((resolve) => requestAnimationFrame(resolve));

      // @ts-expect-error - lastDiffTransition may be set
      const transitionApplied = !!window.lastDiffTransition;

      observer.disconnect();

      return [allMutations, streamNodes, transitionApplied, (window as any).logs];
    },
    [
      diffCode,
      newHTMLStringChunks,
      useForEachStreamNode,
      slowChunks,
      transition,
      ignoreId,
      registerWC,
      onNextNode,
    ],
  );

  return [
    (await page.content()).replace(/\s*\n\s*/g, "").replaceAll("'", '"'),
    mutations,
    streamNodes,
    transitionApplied,
    logs,
  ];
}

describe("chromium", () => {
  before(async () => {
    browser = await chromium.launch();
  });

  beforeEach(async () => {
    page = await browser.newPage();
  });

  afterEach(async () => {
    await page.close();
  });

  after(async () => {
    await browser.close();
  });

  it("should not do any DOM modification", async () => {
    const [newHTML, mutations] = await testDiff({
      oldHTMLString: `
        <div>
          <h1>hello world</h1>
        </div>
      `,
      newHTMLStringChunks: ["<div>", "<h1>hello world</h1>", "</div>"],
    });
    assert.strictEqual(
      newHTML,
      normalize(`
        <html>
          <head></head>
          <body>
            <div>
              <h1>hello world</h1>
            </div>
          </body>
        </html>
      `),
    );
    assert.strictEqual(mutations.length, 0);
  });

  it("should replace only the body content", async () => {
    const [newHTML, mutations] = await testDiff({
      oldHTMLString: `
        <html>
          <head></head>
          <body>
            <div>hello world</div>
          </body>
        </html>
      `,
      newHTMLStringChunks: ["something else"],
    });
    assert.strictEqual(
      newHTML,
      normalize(`
        <html>
          <head></head>
          <body>
            something else
          </body>
        </html>
      `),
    );
    assert.strictEqual(mutations.length, 1);
    assert.strictEqual(mutations[0].type, "childList");
    assert.strictEqual(mutations[0].addedNodes[0].nodeName, "#text");
    assert.strictEqual(mutations[0].addedNodes[0].nodeValue, "something else");
  });

  it("should update only one element of the body", async () => {
    const [newHTML, mutations] = await testDiff({
      oldHTMLString: `
        <html>
          <head></head>
          <body>
            <h1>TEST</h1>
            <div id="test">Old Node Content</div>
          </body>
        </html>
      `,
      newHTMLStringChunks: ["<h1>TEST</h1>", '<div id="test">', "New Node Content", "</div>"],
    });
    assert.strictEqual(
      newHTML,
      normalize(`
        <html>
          <head></head>
          <body>
            <h1>TEST</h1>
            <div id="test">New Node Content</div>
          </body>
        </html>
      `),
    );
    assert.strictEqual(mutations.length, 1);
    assert.strictEqual(mutations[0].type, "characterData");
    assert.strictEqual(mutations[0].oldValue, "Old Node Content");
  });

  it("should diff attributes", async () => {
    const [newHTML, mutations] = await testDiff({
      oldHTMLString: `<div></div>`,
      newHTMLStringChunks: ['<div a="1" b="2">', "</div>"],
    });
    assert.strictEqual(
      newHTML,
      normalize(`
        <html>
          <head></head>
          <body>
            <div b="2" a="1"></div>
          </body>
        </html>
      `),
    );
    assert.strictEqual(mutations.length, 2);
    assert.strictEqual(mutations[0].type, "attributes");
    assert.strictEqual(mutations[0].attributeName, "b");
    assert.strictEqual(mutations[1].attributeName, "a");
  });

  it("should diff nodeValue", async () => {
    const [newHTML, mutations] = await testDiff({
      oldHTMLString: `
        <div>
          text a
          text b
        </div>
      `,
      newHTMLStringChunks: ["<div>", "text a", "text c", "</div>"],
    });
    assert.strictEqual(
      newHTML,
      normalize(`
        <html>
          <head></head>
          <body>
            <div>
              text a
              text c
            </div>
          </body>
        </html>
      `),
    );
    assert.strictEqual(mutations.length, 1);
    assert.strictEqual(mutations[0].type, "characterData");
  });

  it("should diff children", async () => {
    const [newHTML, mutations] = await testDiff({
      oldHTMLString: `
        <div>
          <a href="link">hello</a>
          <b>text</b>
          <i>text2</i>
        </div>
      `,
      newHTMLStringChunks: ["<div>", '<a href="link2">hello2</a>', "<i>text1</i>", "</div>"],
    });
    assert.strictEqual(
      newHTML,
      normalize(`
        <html>
          <head></head>
          <body>
            <div>
              <a href="link2">hello2</a>
              <i>text1</i>
            </div>
          </body>
        </html>
      `),
    );
    assert.ok(mutations.length > 0);
    // Verify characterData mutation for text change
    const charDataMutation = mutations.find((m: MutationRecord) => m.type === "characterData");
    assert.ok(charDataMutation);
  });

  it("should diff children (id)", async () => {
    const [newHTML, mutations] = await testDiff({
      oldHTMLString: `
        <div>
          <b>text</b>
          <i id="test">text2</i>
        </div>
      `,
      newHTMLStringChunks: ["<div>", '<i id="test">text1</i>', "</div>"],
    });
    assert.strictEqual(
      newHTML,
      normalize(`
        <html>
          <head></head>
          <body>
            <div>
              <i id="test">text1</i>
            </div>
          </body>
        </html>
      `),
    );
    assert.ok(mutations.length > 0);
  });

  it("should diff children (key) move by deleting", async () => {
    const [newHTML] = await testDiff({
      oldHTMLString: `
        <div>
          <a href="link">hello</a>
          <b>text</b>
          <i key="test">text2</i>
        </div>
      `,
      newHTMLStringChunks: [
        "<div>",
        '<a href="link2">hello2</a>',
        '<i key="test">text1</i>',
        "</div>",
      ],
    });
    assert.strictEqual(
      newHTML,
      normalize(`
        <html>
          <head></head>
          <body>
            <div>
              <a href="link2">hello2</a>
              <i key="test">text1</i>
            </div>
          </body>
        </html>
      `),
    );
  });

  it("should diff children (key) move by shuffling", async () => {
    const [newHTML] = await testDiff({
      oldHTMLString: `
        <div>
          <a href="link">hello</a>
          <b key="test1">text</b>
          <i key="test2">text2</i>
        </div>
      `,
      newHTMLStringChunks: [
        "<div>",
        '<a href="link">hello</a>',
        '<i key="test2">text2</i>',
        '<b key="test1">text</b>',
        "</div>",
      ],
    });
    assert.strictEqual(
      newHTML,
      normalize(`
        <html>
          <head></head>
          <body>
            <div>
              <a href="link">hello</a>
              <i key="test2">text2</i>
              <b key="test1">text</b>
            </div>
          </body>
        </html>
      `),
    );
  });

  it("should diff children (key) remove", async () => {
    const [newHTML] = await testDiff({
      oldHTMLString: `
        <div>
          <a href="link">hello</a>
          <b>text</b>
          <i key="test">text2</i>
        </div>
      `,
      newHTMLStringChunks: ["<div>", '<a href="link2">hello2</a>', "</div>"],
    });
    assert.strictEqual(
      newHTML,
      normalize(`
        <html>
          <head></head>
          <body>
            <div>
              <a href="link2">hello2</a>
            </div>
          </body>
        </html>
      `),
    );
  });

  it("should diff children (key) insert new node", async () => {
    const [newHTML] = await testDiff({
      oldHTMLString: `
        <div>
          <a href="link">hello</a>
          <i key="test">text2</i>
        </div>
      `,
      newHTMLStringChunks: [
        "<div>",
        '<a href="link2">hello2</a>',
        "<b>test</b>",
        '<i key="test">text2</i>',
        "</div>",
      ],
    });
    assert.strictEqual(
      newHTML,
      normalize(`
        <html>
          <head></head>
          <body>
            <div>
              <a href="link2">hello2</a>
              <b>test</b>
              <i key="test">text2</i>
            </div>
          </body>
        </html>
      `),
    );
  });

  it("should only replace the lang attribute of the HTML tag", async () => {
    const [newHTML, mutations] = await testDiff({
      oldHTMLString: `
        <html lang="en">
          <head></head>
          <body>
            <div>hello world</div>
          </body>
        </html>
      `,
      newHTMLStringChunks: [
        '<html lang="es">',
        "<head></head>",
        "<body>",
        "<div>hello world</div>",
        "</body>",
        "</html>",
      ],
    });
    assert.strictEqual(
      newHTML,
      normalize(`
        <html lang="es">
          <head></head>
          <body>
            <div>hello world</div>
          </body>
        </html>
      `),
    );
    assert.strictEqual(mutations.length, 1);
    assert.strictEqual(mutations[0].type, "attributes");
    assert.strictEqual(mutations[0].attributeName, "lang");
    assert.strictEqual(mutations[0].oldValue, "en");
  });

  it("should only update the title content inside head", async () => {
    const [newHTML, mutations] = await testDiff({
      oldHTMLString: `
        <html>
          <head>
            <title>Old Title</title>
          </head>
          <body>
            <div>hello world</div>
          </body>
        </html>
      `,
      newHTMLStringChunks: [
        "<html>",
        "<head>",
        "<title>New Title</title>",
        "</head>",
        "<body>",
        "<div>hello world</div>",
        "</body>",
        "</html>",
      ],
    });
    assert.strictEqual(
      newHTML,
      normalize(`
        <html>
          <head>
            <title>New Title</title>
          </head>
          <body>
            <div>hello world</div>
          </body>
        </html>
      `),
    );
    assert.strictEqual(mutations.length, 1);
    assert.strictEqual(mutations[0].type, "characterData");
    assert.strictEqual(mutations[0].oldValue, "Old Title");
  });

  it("should change data-attribute", async () => {
    const [newHTML, mutations] = await testDiff({
      oldHTMLString: `<div data-attribute="abc">foo</div>`,
      newHTMLStringChunks: ['<div data-attribute="efg">', "foo", "</div>"],
    });
    assert.strictEqual(
      newHTML,
      normalize(`
        <html>
          <head></head>
          <body>
            <div data-attribute="efg">foo</div>
          </body>
        </html>
      `),
    );
    assert.strictEqual(mutations.length, 1);
    assert.strictEqual(mutations[0].type, "attributes");
    assert.strictEqual(mutations[0].attributeName, "data-attribute");
    assert.strictEqual(mutations[0].oldValue, "abc");
  });

  it("should update only the path of an SVG element", async () => {
    const [newHTML, mutations] = await testDiff({
      oldHTMLString: `
        <svg>
          <path d="M 10 10 L 20 20"></path>
        </svg>
      `,
      newHTMLStringChunks: ["<svg>", '<path d="M 20 20 L 30 30"></path>', "</svg>"],
    });
    assert.strictEqual(
      newHTML,
      normalize(`
        <html>
          <head></head>
          <body>
            <svg>
              <path d="M 20 20 L 30 30"></path>
            </svg>
          </body>
        </html>
      `),
    );
    assert.strictEqual(mutations.length, 1);
    assert.strictEqual(mutations[0].type, "attributes");
    assert.strictEqual(mutations[0].attributeName, "d");
  });

  it("should diff children (data-checksum)", async () => {
    const [newHTML] = await testDiff({
      oldHTMLString: `
        <div>
          <div class="a" data-checksum="abc">initial</div>
        </div>
      `,
      newHTMLStringChunks: ["<div>", '<div class="b" data-checksum="efg">final</div>', "</div>"],
    });
    assert.strictEqual(
      newHTML,
      normalize(`
        <html>
          <head></head>
          <body>
            <div>
              <div class="b" data-checksum="efg">final</div>
            </div>
          </body>
        </html>
      `),
    );
  });

  it("should diff between an entire document and documentElement", async () => {
    const [newHTML, mutations] = await testDiff({
      oldHTMLString: `
        <!DOCTYPE html>
        <html>
          <head></head>
          <body>hello foo</body>
        </html>
      `,
      newHTMLStringChunks: ["<html>", "<head></head>", "<body>hello bar</body>", "</html>"],
    });
    assert.strictEqual(
      newHTML,
      normalize(`
        <!DOCTYPE html>
        <html>
          <head></head>
          <body>
            hello bar
          </body>
        </html>
      `),
    );
    assert.strictEqual(mutations.length, 1);
    assert.strictEqual(mutations[0].type, "characterData");
    assert.strictEqual(mutations[0].oldValue, "hello foo");
  });

  it("should diff between entire documents", async () => {
    const [newHTML, mutations] = await testDiff({
      oldHTMLString: `
        <!DOCTYPE html>
        <html>
          <head></head>
          <body>hello foo</body>
        </html>
      `,
      newHTMLStringChunks: [
        "<!DOCTYPE html>",
        "<html>",
        "<head></head>",
        "<body>hello bar</body>",
        "</html>",
      ],
    });
    assert.strictEqual(
      newHTML,
      normalize(`
        <!DOCTYPE html>
        <html>
          <head></head>
          <body>
            hello bar
          </body>
        </html>
      `),
    );
    assert.strictEqual(mutations.length, 1);
    assert.strictEqual(mutations[0].type, "characterData");
  });

  it("should not modify if same node with different way to close tag", async () => {
    const [newHTML, mutations] = await testDiff({
      oldHTMLString: `
        <div>
          <div></div>
        </div>
      `,
      newHTMLStringChunks: ["<div>", "<div />", "</div>"],
    });
    assert.strictEqual(
      newHTML,
      normalize(`
        <html>
          <head></head>
          <body>
            <div>
              <div></div>
            </div>
          </body>
        </html>
      `),
    );
    assert.strictEqual(mutations.length, 0);
  });

  it("should diff and patch html strings with special chars", async () => {
    const [newHTML, mutations] = await testDiff({
      oldHTMLString: `
        <div>
          <div>hello world</div>
        </div>
      `,
      newHTMLStringChunks: ["<div>", "<div>hello & world</div>", "</div>"],
    });
    assert.strictEqual(
      newHTML,
      normalize(`
        <html>
          <head></head>
          <body>
            <div>
              <div>hello &amp; world</div>
            </div>
          </body>
        </html>
      `),
    );
    assert.strictEqual(mutations.length, 1);
    assert.strictEqual(mutations[0].type, "characterData");
    assert.strictEqual(mutations[0].oldValue, "hello world");
  });

  it("should analyze all stream nodes using forEachStreamNode", async () => {
    const [, , streamNodes] = await testDiff({
      oldHTMLString: `
        <div>
          <div>hello world</div>
        </div>
      `,
      newHTMLStringChunks: ["<div>", "<div>hello & world</div>", "</div>"],
      useForEachStreamNode: true,
    });

    assert.strictEqual(streamNodes.length, 5);
    assert.strictEqual(streamNodes[0].nodeName, "HEAD");
    assert.strictEqual(streamNodes[1].nodeName, "BODY");
    assert.strictEqual(streamNodes[2].nodeName, "DIV");
    assert.strictEqual(streamNodes[3].nodeName, "DIV");
    assert.strictEqual(streamNodes[4].nodeName, "#text");
    assert.strictEqual(streamNodes[4].nodeValue, "hello & world");
  });

  it("should diff with slow chunks", async () => {
    const [newHTML, mutations] = await testDiff({
      oldHTMLString: `
        <html>
          <head></head>
          <body>
            <div>foo</div>
            <div>bar</div>
            <div>baz</div>
          </body>
        </html>
      `,
      newHTMLStringChunks: [
        "<html>",
        "<head></head>",
        "<body>",
        "<div>baz</div>",
        "<div>foo</div>",
        "<div>bar</div>",
        "</body>",
        "</html>",
      ],
      slowChunks: true,
    });
    assert.strictEqual(
      newHTML,
      normalize(`
        <html>
          <head></head>
          <body>
            <div>baz</div>
            <div>foo</div>
            <div>bar</div>
          </body>
        </html>
      `),
    );
    // Should have characterData mutations for the text changes
    const charDataMutations = mutations.filter((m: MutationRecord) => m.type === "characterData");
    assert.strictEqual(charDataMutations.length, 3);
  });

  it("should replace a div to template tag with content", async () => {
    const [newHTML] = await testDiff({
      oldHTMLString: `
        <html>
          <head></head>
          <body>
            <div>foo</div>
          </body>
        </html>
      `,
      newHTMLStringChunks: [
        "<html>",
        "<head></head>",
        "<body>",
        '<template id="U:1"><div>bar</div></template>',
        "</body>",
        "</html>",
      ],
    });
    assert.strictEqual(
      newHTML,
      normalize(`
        <html>
          <head></head>
          <body>
            <template id="U:1">
              <div>bar</div>
            </template>
          </body>
        </html>
      `),
    );
  });

  it("should not add data-action attribute after diff", async () => {
    const [newHTML, mutations] = await testDiff({
      oldHTMLString: `<div>foo</div>`,
      newHTMLStringChunks: ['<div data-action="foo">foo</div>'],
    });
    assert.strictEqual(
      newHTML,
      normalize(`
        <html>
          <head></head>
          <body>
            <div>foo</div>
          </body>
        </html>
      `),
    );
    assert.strictEqual(mutations.length, 0);
  });

  it("should change BODY content but keep old attributes", async () => {
    const [newHTML] = await testDiff({
      oldHTMLString: `
        <html>
          <head></head>
          <body data-theme="dark">
            <div>foo</div>
          </body>
        </html>
      `,
      newHTMLStringChunks: ["<html><head></head><body><div>bar</div></body></html>"],
    });
    assert.strictEqual(
      newHTML,
      normalize(`
        <html>
          <head></head>
          <body data-theme="dark">
            <div>bar</div>
          </body>
        </html>
      `),
    );
  });

  it("should options.shouldIgnoreNode work", async () => {
    const [newHTML] = await testDiff({
      oldHTMLString: `
        <div>
          <div>foo</div>
          <div id="ignore">bar</div>
        </div>
      `,
      newHTMLStringChunks: [
        "<html>",
        "<head></head>",
        "<body>",
        "<div>bar</div>",
        "<div id='ignore'>bazz!</div>",
        "</body>",
        "</html>",
      ],
      ignoreId: true,
    });
    assert.strictEqual(
      newHTML,
      normalize(`
        <html>
          <head></head>
          <body>
            <div>bar</div>
          </body>
        </html>
      `),
    );
  });

  it("should add WC that modifies DOM on connect", async () => {
    const [newHTML] = await testDiff({
      oldHTMLString: `<div>foo</div>`,
      newHTMLStringChunks: ["<test-wc>foo</test-wc>"],
      registerWC: true,
    });
    assert.strictEqual(
      newHTML,
      normalize(`
        <html>
          <head></head>
          <body>
            <test-wc data-connected="true">foo</test-wc>
          </body>
        </html>
      `),
    );
  });

  it("should add WC that modifies DOM on connect (old with key)", async () => {
    const [newHTML] = await testDiff({
      oldHTMLString: `<div key="old">foo</div>`,
      newHTMLStringChunks: ["<test-wc>foo</test-wc>"],
      registerWC: true,
    });
    assert.strictEqual(
      newHTML,
      normalize(`
        <html>
          <head></head>
          <body>
            <test-wc data-connected="true">foo</test-wc>
          </body>
        </html>
      `),
    );
  });

  it("should diff children (key) with xhtml namespaceURI", async () => {
    const [newHTML] = await testDiff({
      oldHTMLString: `
        <div xmlns="http://www.w3.org/1999/xhtml">
          <a href="link">hello</a>
          <b>text</b>
          <i key="test">text2</i>
        </div>
      `,
      newHTMLStringChunks: [
        '<div xmlns="http://www.w3.org/1999/xhtml">',
        '<a href="link2">hello2</a>',
        '<i key="test">text1</i>',
        "</div>",
      ],
    });
    assert.strictEqual(
      newHTML,
      normalize(`
        <html>
          <head></head>
          <body>
            <div xmlns="http://www.w3.org/1999/xhtml">
              <a href="link2">hello2</a>
              <i key="test">text1</i>
            </div>
          </body>
        </html>
      `),
    );
  });

  it("should diff children (key) move (custom attribute)", async () => {
    const [newHTML] = await testDiff({
      oldHTMLString: `
        <div>
          <a href="link">hello</a>
          <b key="test1">text</b>
          <i key="test2">text2</i>
        </div>
      `,
      newHTMLStringChunks: [
        "<div>",
        '<a href="link">hello</a>',
        '<i key="test2">text2</i>',
        '<b key="test1">text</b>',
        "</div>",
      ],
    });
    assert.strictEqual(
      newHTML,
      normalize(`
        <html>
          <head></head>
          <body>
            <div>
              <a href="link">hello</a>
              <i key="test2">text2</i>
              <b key="test1">text</b>
            </div>
          </body>
        </html>
      `),
    );
  });

  it("should diff with body without div wrapper and with div wrapper", async () => {
    const [newHTML] = await testDiff({
      oldHTMLString: `
        <html>
          <head></head>
          <body>
            <script id="foo">(()=>{})();</script>
            <div class="flex flex-col items-center justify-center px-6 py-16">
              This will be a landingpage. But you can go to the admin for now <a href="/en/admin">login page</a>
            </div>
            <error-dialog skipssr=""></error-dialog>
          </body>
        </html>
      `,
      newHTMLStringChunks: [
        "<html>",
        "<head></head>",
        "<body>",
        "<div>",
        "<script id='foo'>(()=>{})();</script>",
        "<div class='flex flex-col items-center justify-center px-6 py-16'>",
        "This will be a Admin Page. But you can go to the admin for now <a href='/en'>home page</a>",
        "</div>",
        "</div>",
        '<error-dialog skipssr=""></error-dialog>',
        "</body>",
        "</html>",
      ],
    });
    assert.strictEqual(
      newHTML,
      normalize(`
        <html>
          <head></head>
          <body>
            <div>
              <script id="foo">(()=>{})();</script>
              <div class="flex flex-col items-center justify-center px-6 py-16">
                This will be a Admin Page. But you can go to the admin for now <a href="/en">home page</a>
              </div>
            </div>
            <error-dialog skipssr=""></error-dialog>
          </body>
        </html>
      `),
    );
  });
});

describe("firefox", () => {
  before(async () => {
    browser = await firefox.launch();
  });

  beforeEach(async () => {
    page = await browser.newPage();
  });

  afterEach(async () => {
    await page.close();
  });

  after(async () => {
    await browser.close();
  });

  it("should not do any DOM modification", async () => {
    const [newHTML, mutations] = await testDiff({
      oldHTMLString: `<div><h1>hello world</h1></div>`,
      newHTMLStringChunks: ["<div>", "<h1>hello world</h1>", "</div>"],
    });
    assert.strictEqual(
      newHTML,
      normalize(`
        <html>
          <head></head>
          <body>
            <div>
              <h1>hello world</h1>
            </div>
          </body>
        </html>
      `),
    );
    assert.strictEqual(mutations.length, 0);
  });

  it("should diff attributes", async () => {
    const [newHTML, mutations] = await testDiff({
      oldHTMLString: `<div></div>`,
      newHTMLStringChunks: ['<div a="1" b="2">', "</div>"],
    });
    assert.strictEqual(
      newHTML,
      normalize(`
        <html>
          <head></head>
          <body>
            <div b="2" a="1"></div>
          </body>
        </html>
      `),
    );
    assert.strictEqual(mutations.length, 2);
  });

  it("should diff children (key) remove", async () => {
    const [newHTML] = await testDiff({
      oldHTMLString: `
        <div>
          <a href="link">hello</a>
          <b>text</b>
          <i key="test">text2</i>
        </div>
      `,
      newHTMLStringChunks: ["<div>", '<a href="link2">hello2</a>', "</div>"],
    });
    assert.strictEqual(
      newHTML,
      normalize(`
        <html>
          <head></head>
          <body>
            <div>
              <a href="link2">hello2</a>
            </div>
          </body>
        </html>
      `),
    );
  });
});

describe("webkit", () => {
  before(async () => {
    browser = await webkit.launch();
  });

  beforeEach(async () => {
    page = await browser.newPage();
  });

  afterEach(async () => {
    await page.close();
  });

  after(async () => {
    await browser.close();
  });

  it("should not do any DOM modification", async () => {
    const [newHTML, mutations] = await testDiff({
      oldHTMLString: `<div><h1>hello world</h1></div>`,
      newHTMLStringChunks: ["<div>", "<h1>hello world</h1>", "</div>"],
    });
    assert.strictEqual(
      newHTML,
      normalize(`
        <html>
          <head></head>
          <body>
            <div>
              <h1>hello world</h1>
            </div>
          </body>
        </html>
      `),
    );
    assert.strictEqual(mutations.length, 0);
  });

  it("should diff attributes", async () => {
    const [newHTML, mutations] = await testDiff({
      oldHTMLString: `<div></div>`,
      newHTMLStringChunks: ['<div a="1" b="2">', "</div>"],
    });
    assert.strictEqual(
      newHTML,
      normalize(`
        <html>
          <head></head>
          <body>
            <div b="2" a="1"></div>
          </body>
        </html>
      `),
    );
    assert.strictEqual(mutations.length, 2);
  });

  it("should diff children (key) remove", async () => {
    const [newHTML] = await testDiff({
      oldHTMLString: `
        <div>
          <a href="link">hello</a>
          <b>text</b>
          <i key="test">text2</i>
        </div>
      `,
      newHTMLStringChunks: ["<div>", '<a href="link2">hello2</a>', "</div>"],
    });
    assert.strictEqual(
      newHTML,
      normalize(`
        <html>
          <head></head>
          <body>
            <div>
              <a href="link2">hello2</a>
            </div>
          </body>
        </html>
      `),
    );
  });
});
