import { createHash } from "node:crypto";
import { readFile, unlink, mkdir, writeFile, access } from "node:fs/promises";
import { dirname, join } from "node:path";
import ts from "typescript";
import { rolldown } from "rolldown";
import { replacePlugin } from "rolldown/plugins";
import { transform } from "lightningcss";
import { createProgram, getDefaultExportInfo } from "./ast.ts";
import { assetUrlPrefixPlugin } from "./build.bundle.ts";
import { parsePath } from "./paths.ts";
import { generateClientScript } from "./console-forward.ts";
import { createScanner } from "./build.scan.ts";
import { generateChunkedClientEntry, type ComponentMeta } from "./build.hmr-entry.ts";
import type { RoutesManifest, ChunkManifest } from "./manifest.ts";

export interface BuildArgs {
  production: boolean;
  debug: boolean;
  sourcemap: boolean;
  clean?: boolean;
  serve?: boolean;
  watch?: boolean;
  codemod?: boolean;
  dry?: boolean;
}

export interface BuildClientOptions {
  args: BuildArgs;
  rootDir: string;
  appDir: string;
  distDir: string;
  distClient: string;
  publicDir: string;
  chunksPath: string;
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function readText(path: string): Promise<string> {
  return readFile(path, "utf-8");
}

async function write(path: string, content: string): Promise<void> {
  await writeFile(path, content);
}

async function remove(path: string): Promise<void> {
  try {
    await unlink(path);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      throw err;
    }
  }
}

export function hash(content: string): string {
  return createHash("sha256").update(content).digest("hex").slice(0, 8);
}

export function normalizeAssetPath(path: string): string {
  return path.replace(/\//g, ".");
}

export function getChunkName(file: string, contentHash?: string): string {
  const base = file
    .replace(/\.client\.tsx?$/, "")
    .replace(/\//g, ".")
    .replace(/\$/g, "")
    .replace(/^index$/, "index");

  return contentHash ? `${base}-${contentHash}.js` : `${base}.js`;
}

function extractPropsFromProgram(program: ts.Program, filePath: string): string[] {
  const checker = program.getTypeChecker();
  const sourceFile = program.getSourceFile(filePath);
  if (!sourceFile) return [];

  const exportInfo = getDefaultExportInfo(checker, sourceFile);
  if (!exportInfo || exportInfo.signatures.length === 0) return [];

  const firstParam = exportInfo.signatures[0].getParameters()[0];
  if (!firstParam) return [];

  const paramType = checker.getTypeOfSymbolAtLocation(firstParam, sourceFile);
  const properties = paramType.getProperties();

  return properties.map((p) => p.getName());
}

async function getComponentMeta(
  program: ts.Program,
  appDir: string,
  file: string,
): Promise<ComponentMeta & { parsed: ReturnType<typeof parsePath>; hash?: string }> {
  const filePath = join(appDir, file);
  const props = extractPropsFromProgram(program, filePath);
  const parsed = parsePath(file);

  const content = await readText(filePath);
  const contentHash = hash(content);
  const chunk = getChunkName(file, contentHash);

  return { file, tag: parsed.tag, props, parsed, chunk, hash: contentHash };
}

export async function buildClient(options: BuildClientOptions): Promise<void> {
  const { args, rootDir, appDir, distDir, distClient, publicDir, chunksPath } = options;
  const distClientAssets = join(distClient, "assets");
  const scanner = createScanner({ rootDir, appDir });

  const cssAssetCache = new Map<string, string>();
  const cssOutputsByBase = new Map<string, string>();

  async function emitCssAsset(cssSourcePath: string): Promise<string | null> {
    if (!(await exists(cssSourcePath))) return null;

    const cached = cssAssetCache.get(cssSourcePath);
    if (cached) return cached;

    const cssRelativePath = cssSourcePath.replace(appDir + "/", "");
    const cssContent = transform({
      code: Buffer.from(await readText(cssSourcePath)),
      filename: cssSourcePath,
      minify: args.production,
    }).code.toString();

    const cssHash = hash(cssContent);
    const cssBase = normalizeAssetPath(cssRelativePath.replace(/\.css$/, ""));
    const cssOutputName = `${cssBase}-${cssHash}.css`;

    cssOutputsByBase.set(cssBase, cssOutputName);

    await mkdir(distClientAssets, { recursive: true });
    const destPath = join(distClientAssets, cssOutputName);
    await write(destPath, cssContent);

    const outputPath = `/assets/${cssOutputName}`;
    cssAssetCache.set(cssSourcePath, outputPath);
    return outputPath;
  }

  console.log("🔍 Scanning for client components...");
  const clientFiles = await scanner.findClientComponents();
  console.log(`   Found ${clientFiles.length} client component(s)`);

  const filePaths = clientFiles.map((f) => join(appDir, f));
  const program = createProgram(filePaths);

  const metas = await Promise.all(
    clientFiles.map((file) => getComponentMeta(program, appDir, file)),
  );

  const layoutFiles = await scanner.findLayouts();
  const layoutCssMap: Record<string, string[]> = {};
  const componentCssMap: Record<string, string[]> = {};

  for (const layoutFile of layoutFiles) {
    const layoutPath = join(appDir, layoutFile);
    const allCssImports = await scanner.extractAllCssImports(layoutPath);

    if (allCssImports.length > 0) {
      const cssOutputPaths: string[] = [];
      const layoutDir = layoutFile.split("/").slice(0, -1).join("/");

      for (const cssImport of allCssImports) {
        let cssSourcePath: string;
        if (cssImport.startsWith("./")) {
          cssSourcePath = join(appDir, cssImport.replace("./", ""));
        } else {
          cssSourcePath = join(appDir, layoutDir, cssImport);
        }

        const outputPath = await emitCssAsset(cssSourcePath);
        if (outputPath && !cssOutputPaths.includes(outputPath)) {
          cssOutputPaths.push(outputPath);
        }
      }

      if (cssOutputPaths.length > 0) {
        const layoutPattern = layoutDir ? `/${layoutDir}` : "/";
        if (!layoutCssMap[layoutPattern]) {
          layoutCssMap[layoutPattern] = [];
        }
        for (const path of cssOutputPaths) {
          if (!layoutCssMap[layoutPattern].includes(path)) {
            layoutCssMap[layoutPattern].push(path);
          }
        }
      }
    }
  }

  if (await exists(publicDir)) {
    const publicFiles = await scanner.scanFiles("**/*", publicDir);
    for (const file of publicFiles) {
      const src = join(publicDir, file);
      const dest = join(distClient, file);

      const destDir = dirname(dest);
      await mkdir(destDir, { recursive: true });

      const content = await readText(src);
      await write(dest, content);
    }
  }

  if (!args.production) {
    await mkdir(distClientAssets, { recursive: true });
    const consoleScript = generateClientScript();
    const consoleScriptPath = join(distClientAssets, "console-forward.js");
    await write(consoleScriptPath, consoleScript);
    console.log("   Generated console-forward.js (dev mode)");
  }

  const inlineRoutesManifest: RoutesManifest = {
    routes: metas.map((meta) => ({
      pattern: meta.parsed.pattern,
      tag: meta.tag,
      chunk: `/assets/${meta.chunk}`,
      styles: undefined,
      type: "client" as const,
      params: meta.parsed.params,
    })),
  };

  const entryPaths: string[] = [];
  const entryToMeta: Record<string, ComponentMeta & { parsed: ReturnType<typeof parsePath> }> = {};

  await mkdir(distDir, { recursive: true });

  for (const meta of metas) {
    const componentPath = join(appDir, meta.file);
    const componentCssImports = await scanner.extractAllCssImports(componentPath);

    const componentCssOutputPaths: string[] = [];
    const componentDir = meta.file.split("/").slice(0, -1).join("/");

    for (const cssImport of componentCssImports) {
      let cssSourcePath: string;
      if (cssImport.startsWith("./")) {
        cssSourcePath = join(appDir, cssImport.replace("./", ""));
      } else {
        cssSourcePath = join(appDir, componentDir, cssImport);
      }

      const outputPath = await emitCssAsset(cssSourcePath);
      if (outputPath && !componentCssOutputPaths.includes(outputPath)) {
        componentCssOutputPaths.push(outputPath);
      }
    }

    if (componentCssOutputPaths.length > 0) {
      const existing = componentCssMap[meta.parsed.pattern] ?? [];
      componentCssMap[meta.parsed.pattern] = [
        ...existing,
        ...componentCssOutputPaths.filter((path) => !existing.includes(path)),
      ];
    }

    const cssFiles: string[] = [];
    for (const cssImport of componentCssImports) {
      const cleanPath = cssImport.replace(/^\.\//, "");
      cssFiles.push(`../src/${cleanPath}`);
    }

    const entryContent = generateChunkedClientEntry(meta, inlineRoutesManifest, cssFiles, args);
    const entryPath = join(distDir, `.entry-${meta.chunk.replace(".js", "")}.generated.tsx`);
    await write(entryPath, entryContent);
    entryPaths.push(entryPath);
    entryToMeta[entryPath] = meta;
  }

  console.log("📦 Building client chunks...");

  await mkdir(distClient, { recursive: true });

  const input: Record<string, string> = {};
  for (const entryPath of entryPaths) {
    const meta = entryToMeta[entryPath];
    input[meta.chunk.replace(/\.js$/, "")] = entryPath;
  }

  const packageImports = await scanner.getPackageImports();

  const bundle = await rolldown({
    input,
    platform: "browser",
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
    plugins: [
      replacePlugin({
        "globalThis.__SF_DEV__": JSON.stringify(!args.production),
      }),
      {
        name: "raw-css-loader",
        resolveId(source: string, importer: string | undefined) {
          if (source.endsWith("?raw") && source.includes(".css")) {
            const realPath = source.replace(/\?raw$/, "");
            if (importer) {
              const importerDir = importer.split("/").slice(0, -1).join("/");
              return {
                id: join(importerDir, realPath) + "?raw",
                external: false,
              };
            }
            return { id: realPath + "?raw", external: false };
          }
          return null;
        },
        async load(id: string) {
          if (id.endsWith("?raw")) {
            const realPath = id.replace(/\?raw$/, "");
            try {
              const content = await readFile(realPath, "utf-8");
              return {
                code: /* tsx */ `export default ${JSON.stringify(content)};`,
                moduleType: "js",
              };
            } catch {
              console.warn(`[raw-css-loader] Could not load: ${realPath}`);
              return { code: `export default "";`, moduleType: "js" };
            }
          }
          return null;
        },
      },
      assetUrlPrefixPlugin,
    ],
    resolve: {
      alias: packageImports,
    },
    transform: {
      target: "es2020",
      jsx: {
        runtime: "automatic",
        development: !args.production,
      },
    },
  });

  await bundle.write({
    dir: distClientAssets,
    format: "esm",
    entryFileNames: "[name].js",
    minify: args.production,
    chunkFileNames: "[name]-[hash].js",
    assetFileNames: "[name]-[hash][extname]",
    codeSplitting: {
      minSize: 20000,
      groups: [
        {
          name: "vendor",
          test: /node_modules/,
        },
      ],
    },
    ...(args.sourcemap && { sourcemap: true }),
  });

  if (cssOutputsByBase.size > 0) {
    const emittedCss = new Set(cssOutputsByBase.values());
    const cssFiles = await scanner.scanFiles("**/*.css", distClientAssets);

    for (const cssFile of cssFiles) {
      const withoutExt = cssFile.replace(/\.css$/, "");
      const lastDot = withoutExt.lastIndexOf(".");
      if (lastDot === -1) continue;
      const base = withoutExt.slice(0, lastDot);
      const expected = cssOutputsByBase.get(base);
      if (expected && cssFile !== expected && !emittedCss.has(cssFile)) {
        await remove(join(distClientAssets, cssFile));
      }
    }
  }

  await bundle.close();

  if (args.production) {
    const cssFiles = await scanner.scanFiles("?(.)*.css", distClientAssets);
    for (const cssFile of cssFiles) {
      const cssPath = join(distClientAssets, cssFile);
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

  const manifest: ChunkManifest = {
    chunks: {},
    tags: {},
    styles: {},
    devScripts: args.production ? undefined : ["/assets/console-forward.js"],
  };

  for (const meta of metas) {
    manifest.chunks[meta.parsed.pattern] = `/assets/${meta.chunk}`;
    manifest.tags[meta.tag] = `/assets/${meta.chunk}`;
  }

  for (const meta of metas) {
    const routeStyles: string[] = [];

    for (const [layoutPattern, cssFiles] of Object.entries(layoutCssMap)) {
      if (layoutPattern === "/" || meta.parsed.pattern.startsWith(layoutPattern)) {
        routeStyles.push(...cssFiles);
      }
    }

    const componentStyles = componentCssMap[meta.parsed.pattern];
    if (componentStyles?.length) {
      routeStyles.push(...componentStyles);
    }

    if (routeStyles.length > 0) {
      manifest.styles[meta.parsed.pattern] = [...new Set(routeStyles)];
    }
  }

  await write(chunksPath, JSON.stringify(manifest, null, 2));

  console.log(`   Generated ${metas.length} chunk(s)`);

  for (const entryPath of entryPaths) {
    await remove(entryPath);
  }

  console.log("✅ Client build complete");
}
