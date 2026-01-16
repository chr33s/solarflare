import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createProgram } from "./ast.ts";
import { generateModulesFile } from "./build.emit-manifests.ts";

describe("generateModulesFile", () => {
  it("generates module typings without errors", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "sf-modules-"));
    const appDir = join(rootDir, "src");
    await mkdir(appDir, { recursive: true });

    const routeFile = "index.server.ts";
    const routePath = join(appDir, routeFile);
    await writeFile(
      routePath,
      "export default function loader(request: Request) { return new Response('ok'); }\n",
    );

    const program = createProgram([routePath]);
    const result = generateModulesFile(program, [routeFile], [], null, appDir);

    assert.deepStrictEqual(result.errors, []);
    assert.ok(result.content.includes(routeFile));
  });
});
