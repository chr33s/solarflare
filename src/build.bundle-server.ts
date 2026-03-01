import { mkdir, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { glob } from "node:fs/promises";
import { rolldown } from "rolldown";
import type { RolldownOptions } from "rolldown";
import { createProgram } from "./ast.ts";
import {
  assetUrlPrefixPlugin,
  type BuildArgs,
  cssStripPlugin,
  mergeInputOptions,
  mergeOutputOptions,
  moduleTypes,
} from "./build.bundle.ts";
import { createScanner } from "./build.scan.ts";
import { validateRoutes, generateRoutesTypeFile } from "./build.validate.ts";
import { generateModulesFile } from "./build.emit-manifests.ts";

export interface BuildServerOptions {
  args: BuildArgs;
  rootDir: string;
  appDir: string;
  distServer: string;
  modulesPath: string;
  chunksPath: string;
  routesTypePath: string;
  userConfig?: RolldownOptions;
}

export async function buildServer(options: BuildServerOptions) {
  const { args, rootDir, appDir, distServer, modulesPath, chunksPath, routesTypePath, userConfig } =
    options;
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
  await writeFile(routesTypePath, routesTypeContent);
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

  await writeFile(modulesPath, modulesContent);

  console.log("📦 Building server bundle...");

  await mkdir(distServer, { recursive: true });

  const packageImports = await scanner.getPackageImports();

  const bundle = await rolldown(
    mergeInputOptions(
      {
        input: join(appDir, "index.ts"),
        platform: "node",
        tsconfig: true,
        moduleTypes,
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
        plugins: [cssStripPlugin, assetUrlPrefixPlugin],
        transform: {
          jsx: {
            runtime: "automatic",
            development: false,
          },
        },
      },
      userConfig,
    ),
  );

  await bundle.write(
    mergeOutputOptions(
      {
        dir: distServer,
        format: "esm",
        codeSplitting: false,
        entryFileNames: "index.js",
        assetFileNames: "[name]-[hash][extname]",
        minify: args.production,
        ...(args.sourcemap && { sourcemap: true }),
      },
      userConfig,
    ),
  );

  await bundle.close();

  // Remove emitted assets from server bundle - they're served from dist/client/assets
  for await (const file of glob("*", { cwd: distServer, withFileTypes: false })) {
    if (file === "index.js" || file === "index.js.map") continue;
    await unlink(join(distServer, file as string));
  }

  console.log("✅ Server build complete");
}
