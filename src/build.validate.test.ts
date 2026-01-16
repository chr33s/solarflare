import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { generateRoutesTypeFile, validateRoutes } from "./build.validate.ts";

describe("generateRoutesTypeFile", () => {
  it("generates route type entries for client routes", () => {
    const result = generateRoutesTypeFile(["index.client.tsx", "blog/$slug.client.tsx"]);
    assert.ok(result.includes("'/'"));
    assert.ok(result.includes("'/blog/:slug'"));
    assert.ok(result.includes("slug: string"));
  });

  it("ignores server routes", () => {
    const result = generateRoutesTypeFile(["index.server.tsx", "api.server.ts"]);
    assert.ok(!result.includes("/api"));
  });
});

describe("validateRoutes", () => {
  it("returns true for valid modules", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "sf-validate-"));
    const appDir = join(rootDir, "src");
    await mkdir(appDir, { recursive: true });

    await writeFile(
      join(appDir, "index.client.tsx"),
      "export default function App() { return null; }\n",
    );
    await writeFile(
      join(appDir, "_layout.tsx"),
      "export default function Layout({ children }: { children: any }) { return children; }\n",
    );

    const valid = await validateRoutes(["index.client.tsx"], ["_layout.tsx"], appDir);
    assert.strictEqual(valid, true);
  });
});
