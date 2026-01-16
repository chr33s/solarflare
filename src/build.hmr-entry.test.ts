import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { generateChunkedClientEntry } from "./build.hmr-entry.ts";

describe("generateChunkedClientEntry", () => {
  const meta = {
    file: "components/Widget.client.tsx",
    tag: "sf-widget",
    props: ["title"],
    chunk: "components.widget.js",
  };

  const routesManifest = {
    routes: [
      {
        pattern: "/",
        tag: "sf-widget",
        chunk: "/components.widget.js",
        styles: undefined,
        type: "client" as const,
        params: [],
      },
    ],
  };

  it("includes CSS imports and registration in dev mode", () => {
    const result = generateChunkedClientEntry(meta, routesManifest, ["./styles.css"], {
      production: false,
      debug: false,
    });

    assert.ok(result.includes("import css0 from './styles.css?raw'"));
    assert.ok(result.includes("registerInlineStyles"));
    assert.ok(result.includes("onCssUpdate: reloadAllStylesheets"));
  });

  it("omits CSS imports in production mode", () => {
    const result = generateChunkedClientEntry(meta, routesManifest, ["./styles.css"], {
      production: true,
      debug: false,
    });

    assert.ok(!result.includes("registerInlineStyles"));
    assert.ok(!result.includes("?raw"));
  });
});
