import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { glob } from "node:fs/promises";
import { rolldown } from "rolldown";
import { transform } from "lightningcss";
import { createProgram } from "./ast.ts";
import { createScanner } from "./build.scan.ts";
import { validateRoutes, generateRoutesTypeFile } from "./build.validate.ts";
import { generateModulesFile } from "./build.emit-manifests.ts";

export interface BuildArgs {
  production: boolean;
  sourcemap: boolean;
  debug?: boolean;
  clean?: boolean;
  serve?: boolean;
  watch?: boolean;
  codemod?: boolean;
  dry?: boolean;
}

export interface BuildServerOptions {
  args: BuildArgs;
  rootDir: string;
  appDir: string;
  distServer: string;
  modulesPath: string;
  chunksPath: string;
  routesTypePath: string;
}

async function readText(path: string): Promise<string> {
  return readFile(path, "utf-8");
}

async function write(path: string, content: string): Promise<void> {
  await import("node:fs/promises").then(({ writeFile }) => writeFile(path, content));
}

export async function buildServer(options: BuildServerOptions): Promise<void> {
  const { args, rootDir, appDir, distServer, modulesPath, chunksPath, routesTypePath } = options;
  const scanner = createScanner({ rootDir, appDir });

  console.log("🔍 Scanning for route modules...");
  const routeFiles = await scanner.findRouteModules();
  const layoutFiles = await scanner.findLayouts();
  const errorFile = await scanner.findErrorFile();
  console.log(
    `   Found ${routeFiles.length} route(s), ${layoutFiles.length} layout(s)${errorFile ? ", and error page" : ""}`,
  );

  console.log("🔎 Validating route types...");
  const valid = await validateRoutes(routeFiles, layoutFiles, appDir);
  if (!valid) {
    console.error("❌ Route validation failed");
    process.exit(1);
  }

  const routesTypeContent = generateRoutesTypeFile(routeFiles);
  await write(routesTypePath, routesTypeContent);
  console.log("   Generated route types");

  const allModuleFiles = [
    ...routeFiles.map((f) => join(appDir, f)),
    ...layoutFiles.map((f) => join(appDir, f)),
    ...(errorFile ? [join(appDir, errorFile)] : []),
  ];
  const moduleProgram = createProgram(allModuleFiles);

  console.log("🔬 Analyzing module exports via AST...");
  const { content: modulesContent, errors: moduleErrors } = generateModulesFile(
    moduleProgram,
    routeFiles,
    layoutFiles,
    errorFile,
    appDir,
  );

  for (const error of moduleErrors) {
    console.error(`   ❌ ${error}`);
  }
  if (moduleErrors.length > 0) {
    console.error("❌ Module analysis failed");
    process.exit(1);
  }

  await write(modulesPath, modulesContent);

  console.log("📦 Building server bundle...");

  await mkdir(distServer, { recursive: true });

  const packageImports = await scanner.getPackageImports();

  const bundle = await rolldown({
    input: join(appDir, "index.ts"),
    platform: "node",
    tsconfig: true,
    moduleTypes: {
      ".svg": "asset",
      ".png": "asset",
      ".jpg": "asset",
      ".jpeg": "asset",
      ".gif": "asset",
      ".webp": "asset",
      ".ico": "asset",
    },
    external: [
      "cloudflare:workers",
      "preact",
      "preact/hooks",
      "preact/compat",
      "preact/jsx-runtime",
      "preact/jsx-dev-runtime",
      "preact/debug",
      "@preact/signals",
      "@preact/signals-core",
      "@preact/signals-debug",
      "preact-render-to-string",
      "preact-render-to-string/stream",
      "preact-custom-element",
    ],
    resolve: {
      alias: {
        ...packageImports,
        ".modules.generated": modulesPath,
        ".chunks.generated.json": chunksPath,
      },
    },
    transform: {
      jsx: {
        runtime: "automatic",
        development: false,
      },
    },
  });

  await bundle.write({
    dir: distServer,
    format: "esm",
    inlineDynamicImports: true,
    entryFileNames: "index.js",
    minify: args.production,
    ...(args.sourcemap && { sourcemap: true }),
  });

  await bundle.close();

  if (args.production) {
    const cssFiles: string[] = [];
    for await (const file of glob("?(.)*.css", {
      cwd: distServer,
      withFileTypes: false,
    })) {
      cssFiles.push(file as string);
    }
    for (const cssFile of cssFiles) {
      const cssPath = join(distServer, cssFile);
      let cssContent = await readText(cssPath);
      const result = transform({
        code: Buffer.from(cssContent),
        filename: cssPath,
        minify: true,
      });
      const minified = result.code.toString();
      if (minified !== cssContent) {
        await write(cssPath, minified);
      }
    }
  }

  console.log("✅ Server build complete");
}
