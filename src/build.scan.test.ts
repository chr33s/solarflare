import { it } from "node:test";
import * as assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createScanner } from "./build.scan.ts";

it("scans layouts, errors, and client components", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "sf-scan-"));
  const appDir = join(rootDir, "src");
  await mkdir(appDir, { recursive: true });

  await writeFile(
    join(appDir, "index.client.tsx"),
    "export default function App() { return null; }\n",
  );
  await writeFile(
    join(appDir, "_layout.tsx"),
    "export default function Layout() { return null; }\n",
  );
  await writeFile(join(appDir, "_error.tsx"), "export default function Error() { return null; }\n");

  const scanner = createScanner({ rootDir, appDir });

  const clients = await scanner.findClientComponents();
  const layouts = await scanner.findLayouts();
  const errorFile = await scanner.findErrorFile();

  assert.deepStrictEqual(clients, ["index.client.tsx"]);
  assert.deepStrictEqual(layouts, ["_layout.tsx"]);
  assert.strictEqual(errorFile, "_error.tsx");
});

it("extracts CSS and resolves imports", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "sf-scan-"));
  const appDir = join(rootDir, "src");
  await mkdir(join(appDir, "components"), { recursive: true });
  await mkdir(join(appDir, "styles"), { recursive: true });

  await writeFile(
    join(rootDir, "package.json"),
    JSON.stringify({ imports: { "#app/*": "./src/*" } }),
  );

  await writeFile(
    join(appDir, "index.client.tsx"),
    "import './styles/base.css';\nimport { Widget } from './components/Widget';\nexport default function App() { return null; }\n",
  );
  await writeFile(
    join(appDir, "components/Widget.tsx"),
    "import './widget.css';\nexport function Widget() { return null; }\n",
  );

  const scanner = createScanner({ rootDir, appDir });

  const cssImports = await scanner.extractCssImports(join(appDir, "index.client.tsx"));
  assert.deepStrictEqual(cssImports, ["./styles/base.css"]);

  const resolvedRelative = await scanner.resolveImportPath(
    "./components/Widget",
    join(appDir, "index.client.tsx"),
  );
  const resolvedAlias = await scanner.resolveImportPath(
    "#app/components/Widget",
    join(appDir, "index.client.tsx"),
  );

  assert.strictEqual(resolvedRelative, join(appDir, "components/Widget.tsx"));
  assert.strictEqual(resolvedAlias, join(appDir, "components/Widget.tsx"));

  const allCss = await scanner.extractAllCssImports(join(appDir, "index.client.tsx"));
  assert.deepStrictEqual(allCss.sort(), ["./components/widget.css", "./styles/base.css"].sort());
});
