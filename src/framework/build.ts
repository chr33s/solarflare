#!/usr/bin/env bun
/** Solarflare build script for client and server bundles. */
import { Glob } from "bun";
import { watch } from "fs";
import { join } from "path";
import { parseArgs } from "util";
import ts from "typescript";
import {
  createProgram,
  getDefaultExportInfo,
  validateModule,
  generateTypedModulesFile,
  type ModuleEntry,
  type ValidationResult,
} from "./ast";
import { parsePath } from "./paths";
import { generateClientScript } from "./console-forward";

// Resolve paths relative to project root (two levels up from src/framework/)
// Use process.cwd() for compiled binary, import.meta.dir for development
const ROOT_DIR = join(process.cwd());
const APP_DIR = join(ROOT_DIR, "src/app");
const DIST_DIR = join(ROOT_DIR, "dist");
const DIST_CLIENT = join(DIST_DIR, "client");
const DIST_SERVER = join(DIST_DIR, "server");
const PUBLIC_DIR = join(ROOT_DIR, "public");

// Generated file paths
const MODULES_PATH = join(DIST_DIR, ".modules.generated.ts");
const CHUNKS_PATH = join(DIST_DIR, ".chunks.generated.json");
const ROUTES_TYPE_PATH = join(DIST_DIR, "routes.d.ts");
const ROUTES_MANIFEST_PATH = join(DIST_CLIENT, "routes.json");

/** Safe unlink that ignores ENOENT errors. */
async function safeUnlink(path: string): Promise<void> {
  const file = Bun.file(path);
  if (await file.exists()) {
    await file.delete();
  }
}

/** Safe rename (copy + delete) that ignores missing source files. */
async function safeRename(src: string, dest: string): Promise<boolean> {
  const srcFile = Bun.file(src);
  if (!(await srcFile.exists())) {
    return false;
  }
  await Bun.write(dest, srcFile);
  await srcFile.delete();
  return true;
}

/** Auto-scaffolds missing template files. */
async function scaffoldTemplates(): Promise<void> {
  const templates: Record<string, string> = {
    "index.ts": `import worker from "#solarflare/worker";
export default { fetch: worker };
`,
    "_error.tsx": `export default function Error({ error }: { error: Error }) {
  return <div><h1>Error</h1><p>{error.message}</p></div>;
}
`,
    "_layout.tsx": `import type { VNode } from "preact";
import { Assets } from "../framework/server";

export default function Layout({ children }: { children: VNode }) {
  return <html><head><Assets /></head><body>{children}</body></html>;
}
`,
  };

  const rootTemplates: Record<string, string> = {
    "wrangler.json": `{
  "$schema": "./node_modules/wrangler/config-schema.json",
  "assets": { "directory": "./dist/client" },
  "dev": { "port": 8080 },
  "main": "./dist/server/index.js",
  "name": "solarflare"
}
`,
  };

  for (const [filename, content] of Object.entries(templates)) {
    const filepath = join(APP_DIR, filename);
    const file = Bun.file(filepath);
    if (!(await file.exists())) {
      await Bun.write(filepath, content);
    }
  }

  for (const [filename, content] of Object.entries(rootTemplates)) {
    const filepath = join(ROOT_DIR, filename);
    const file = Bun.file(filepath);
    if (!(await file.exists())) {
      await Bun.write(filepath, content);
    }
  }
}

/** Validates all route files using AST analysis. */
async function validateRoutes(routeFiles: string[], layoutFiles: string[]): Promise<boolean> {
  const allFiles = [
    ...routeFiles.map((f) => join(APP_DIR, f)),
    ...layoutFiles.map((f) => join(APP_DIR, f)),
  ];

  if (allFiles.length === 0) return true;

  const program = createProgram(allFiles);

  const results: ValidationResult[] = [];

  // Validate all files using the unified AST validator
  for (const file of [...routeFiles, ...layoutFiles]) {
    const result = validateModule(program, file, APP_DIR);
    results.push(result);
  }

  // Report results
  let hasErrors = false;
  for (const result of results) {
    for (const error of result.errors) {
      console.error(`   ❌ ${result.file}: ${error}`);
      hasErrors = true;
    }
    for (const warning of result.warnings) {
      console.warn(`   ⚠️  ${result.file}: ${warning}`);
    }
  }

  return !hasErrors;
}

/** Extracts props property names from a TypeScript file using the type checker. */
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

/** Generates typed routes file using AST-based path parsing. */
function generateRoutesTypeFile(routeFiles: string[]): string {
  const clientRoutes = routeFiles.filter((f) => f.includes(".client."));

  const routeTypes = clientRoutes
    .map((file) => {
      const parsed = parsePath(file);
      const paramsType =
        parsed.params.length > 0
          ? /* js */ `{ ${parsed.params.map((p) => `${p}: string`).join("; ")} }`
          : "Record<string, never>";
      return /* js */ `  '${parsed.pattern}': { params: ${paramsType} }`;
    })
    .join("\n");

  return /* ts */ `/**
 * Auto-generated Route Types
 * Provides type-safe route definitions
 */

export interface Routes {
${routeTypes}
}

export type RoutePath = keyof Routes;

export type RouteParams<T extends RoutePath> = Routes[T]['params'];
`;
}

/** Component metadata for client entry generation. */
interface ComponentMeta {
  file: string;
  tag: string;
  props: string[];
  parsed: ReturnType<typeof parsePath>;
  /** Chunk filename for this component (e.g., "blog.$slug.js") */
  chunk: string;
  /** Content hash for cache busting */
  hash?: string;
}

/** Generates a short hash from content for cache busting. */
function generateHash(content: string): string {
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(content);
  return hasher.digest("hex").slice(0, 8);
}

/** Normalizes asset path from nested directories to dot-separated. */
function normalizeAssetPath(path: string): string {
  return path.replace(/\//g, ".");
}

/** Generates chunk filename from file path. */
function getChunkName(file: string, hash?: string): string {
  const base = file
    .replace(/\.client\.tsx?$/, "")
    .replace(/\//g, ".")
    .replace(/\$/g, "") // Remove $ to avoid URL issues
    .replace(/^index$/, "index");

  return hash ? `${base}.${hash}.js` : `${base}.js`;
}

async function getComponentMeta(program: ts.Program, file: string): Promise<ComponentMeta> {
  const filePath = join(APP_DIR, file);
  const props = extractPropsFromProgram(program, filePath);
  const parsed = parsePath(file);

  // Generate hash from file content
  const content = await Bun.file(filePath).text();
  const hash = generateHash(content);
  const chunk = getChunkName(file, hash);

  return { file, tag: parsed.tag, props, parsed, chunk, hash };
}

/** Scans files in a directory matching a glob pattern. */
async function scanFiles(pattern: string, dir: string = APP_DIR): Promise<string[]> {
  const glob = new Glob(pattern);
  const files: string[] = [];

  for await (const file of glob.scan(dir)) {
    files.push(file);
  }

  return files.sort();
}

/** Finds all route modules in the app directory. */
async function findRouteModules(): Promise<string[]> {
  return scanFiles("**/*.{client,server}.{ts,tsx}");
}

/** Finds all layout files in the app directory. */
async function findLayouts(): Promise<string[]> {
  return scanFiles("**/_layout.tsx");
}

/** Finds the error file in the app directory. */
async function findErrorFile(): Promise<string | null> {
  const files = await scanFiles("_error.tsx");
  return files.length > 0 ? files[0] : null;
}

/** Finds all client components in the app directory. */
async function findClientComponents(): Promise<string[]> {
  return scanFiles("**/*.client.tsx");
}

/** Extracts CSS import paths from a TypeScript/TSX file. */
async function extractCssImports(filePath: string): Promise<string[]> {
  const content = await Bun.file(filePath).text();
  const cssImports: string[] = [];

  // Match import statements for .css files
  const importRegex = /import\s+['"](.+\.css)['"]|import\s+['"](.+\.css)['"]\s*;/g;
  let match;
  while ((match = importRegex.exec(content)) !== null) {
    const cssPath = match[1] || match[2];
    if (cssPath) {
      cssImports.push(cssPath);
    }
  }

  return cssImports;
}

/** Extracts component import paths from a TypeScript/TSX file. */
async function extractComponentImports(filePath: string): Promise<string[]> {
  const content = await Bun.file(filePath).text();
  const imports: string[] = [];

  // Match import statements for local .tsx/.ts files (starting with ./ or ../)
  // Also match #app/* and #solarflare/* aliases
  const importRegex = /import\s+(?:{[^}]+}|\w+)\s+from\s+['"]([^'"]+)['"]/g;
  let match;
  while ((match = importRegex.exec(content)) !== null) {
    const importPath = match[1];
    // Only follow local imports and app aliases, skip node_modules
    if (
      importPath.startsWith("./") ||
      importPath.startsWith("../") ||
      importPath.startsWith("#app/")
    ) {
      imports.push(importPath);
    }
  }

  return imports;
}

/** Resolves an import path to an absolute file path. */
async function resolveImportPath(importPath: string, fromFile: string): Promise<string | null> {
  const fromDir = fromFile.split("/").slice(0, -1).join("/");

  // Handle #app/* alias
  if (importPath.startsWith("#app/")) {
    const relativePath = importPath.replace("#app/", "");
    // Try .tsx, .ts, /index.tsx, /index.ts extensions
    const extensions = [".tsx", ".ts", "/index.tsx", "/index.ts"];
    for (const ext of extensions) {
      const fullPath = join(APP_DIR, relativePath + ext);
      if (await Bun.file(fullPath).exists()) {
        return fullPath;
      }
    }
    // Try without extension (might already have it)
    const fullPath = join(APP_DIR, relativePath);
    if (await Bun.file(fullPath).exists()) {
      return fullPath;
    }
    return null;
  }

  // Handle relative imports
  if (importPath.startsWith("./") || importPath.startsWith("../")) {
    const extensions = [".tsx", ".ts", "/index.tsx", "/index.ts", ""];
    for (const ext of extensions) {
      const fullPath = join(fromDir, importPath + ext);
      if (await Bun.file(fullPath).exists()) {
        return fullPath;
      }
    }
  }

  return null;
}

/** Recursively extracts all CSS imports from a file and its dependencies. */
async function extractAllCssImports(
  filePath: string,
  visited: Set<string> = new Set(),
): Promise<string[]> {
  // Avoid circular dependencies
  if (visited.has(filePath)) {
    return [];
  }
  visited.add(filePath);

  const allCss: string[] = [];
  const fileDir = filePath.split("/").slice(0, -1).join("/");

  // Get direct CSS imports
  const cssImports = await extractCssImports(filePath);
  for (const cssImport of cssImports) {
    // Resolve CSS path relative to the file
    const cssPath = join(fileDir, cssImport);
    // Convert to path relative to APP_DIR
    if (cssPath.startsWith(APP_DIR)) {
      allCss.push(cssPath.replace(APP_DIR + "/", "./"));
    } else {
      allCss.push(cssImport);
    }
  }

  // Get component imports and recursively extract their CSS
  const componentImports = await extractComponentImports(filePath);
  for (const importPath of componentImports) {
    const resolvedPath = await resolveImportPath(importPath, filePath);
    if (resolvedPath && (await Bun.file(resolvedPath).exists())) {
      const nestedCss = await extractAllCssImports(resolvedPath, visited);
      allCss.push(...nestedCss);
    }
  }

  return allCss;
}

/** Generates virtual client entry for a single component with HMR support. */
function generateChunkedClientEntry(meta: ComponentMeta): string {
  const debugImports = args.debug
    ? `import 'preact/debug'
import '@preact/signals-debug'
`
    : "";

  return /* js */ `/**
 * Auto-generated Client Chunk: ${meta.chunk}
 * HMR-enabled wrapper for ${meta.tag}
 */
${debugImports}import { h } from 'preact';
import { signal, useSignal, useSignalEffect } from '@preact/signals';
import register from 'preact-custom-element';
import { initRouter, initHydrationCoordinator, extractDataIsland } from '../src/framework/client';
import BaseComponent from '../src/app/${meta.file}';

// Initialize hydration coordinator for streaming SSR
initHydrationCoordinator();

// Mutable reference for HMR - updated when module is hot-replaced
let CurrentComponent = BaseComponent;

// Module-level signal for HMR updates (shared across all instances)
const hmrVersion = signal(0);

// HMR Support - allows component updates without re-registering custom element
if (import.meta.hot) {
  import.meta.hot.accept('../src/app/${meta.file}', (newModule) => {
    if (newModule?.default) {
      CurrentComponent = newModule.default;
      console.log('[HMR] Updated <${meta.tag}>');
      hmrVersion.value++;
    }
  })
  
  import.meta.hot.dispose(() => {
    console.log('[HMR] Disposing <${meta.tag}>')
  });
}

// Initialize router once globally
function ensureRouter() {
  if (typeof window === 'undefined') return null;
  if (window.__SF_ROUTER__) return window.__SF_ROUTER__;
  if (window.__SF_ROUTES__) {
    window.__SF_ROUTER__ = initRouter(window.__SF_ROUTES__).start();
    return window.__SF_ROUTER__;
  }
  return null;
}

// Fetch with retry for transient failures
async function fetchWithRetry(url, maxRetries = 3, baseDelay = 1000) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetch(url);
      if (res.ok || res.status < 500) return res;
    } catch (e) {
      if (attempt === maxRetries) throw e;
    }
    if (attempt < maxRetries) {
      await new Promise(r => setTimeout(r, baseDelay * Math.pow(2, attempt)));
    }
  }
  throw new Error('Fetch failed after retries');
}

// Load router manifest when browser is idle
let routerLoading = false;
function loadRouter() {
  if (routerLoading || window.__SF_ROUTER__) return;
  routerLoading = true;
  
  const doLoad = () => {
    fetchWithRetry('/routes.json', 2, 500)
      .then(res => res.json())
      .then(manifest => {
        window.__SF_ROUTES__ = manifest;
        ensureRouter();
      })
      .catch(() => {});
  }
  
  // Defer to idle time, fallback to setTimeout for Safari
  if ('requestIdleCallback' in window) {
    requestIdleCallback(doLoad, { timeout: 2000 });
  } else {
    setTimeout(doLoad, 1);
  }
}

/** @description HMR-enabled wrapper component with deferred data hydration. */
function Component(props) {
  const deferredProps = useSignal(null);
  const _ = hmrVersion.value;

  // Extract deferred data and set up event listeners
  useSignalEffect(() => {
    const el = document.querySelector('${meta.tag}');
    if (!el) return;
    
    // Function to extract deferred data from DOM
    const extractDeferred = () => {
      if (el._sfDeferred) {
        deferredProps.value = el._sfDeferred;
        delete el._sfDeferred;
      } else {
        extractDataIsland('${meta.tag}-deferred').then(data => {
          if (data) deferredProps.value = data;
        });
      }
    };
    
    // Extract on initial mount
    extractDeferred();
    
    // Listen for hydration events (from streaming SSR and navigation)
    const hydrateHandler = (e) => { deferredProps.value = e.detail };
    el.addEventListener('sf:hydrate', hydrateHandler);
    
    // Listen for navigation events to re-extract deferred data
    const navHandler = () => {
      // Use setTimeout to let DOM update complete before extracting
      setTimeout(extractDeferred, 0);
    };
    window.addEventListener('sf:navigate', navHandler);
    
    loadRouter();
    
    return () => {
      el.removeEventListener('sf:hydrate', hydrateHandler);
      window.removeEventListener('sf:navigate', navHandler);
    };
  });

  const cleanProps = {}
  for (const key in props) {
    if (props[key] !== 'undefined' && props[key] !== undefined) {
      cleanProps[key] = props[key];
    }
  }

  const finalProps = deferredProps.value 
    ? { ...cleanProps, ...deferredProps.value } 
    : cleanProps;

  return h(CurrentComponent, finalProps);
}

// Register wrapper as web component (only happens once)
register(Component, '${meta.tag}', ${JSON.stringify(meta.props)}, { shadow: false });
`;
}

/** Generates modules file using AST-based analysis. */
function generateModulesFile(
  program: ts.Program,
  routeFiles: string[],
  layoutFiles: string[],
  errorFile: string | null,
): { content: string; errors: string[] } {
  const allFiles = [...layoutFiles, ...routeFiles];

  if (errorFile) {
    allFiles.push(errorFile);
  }

  const entries: ModuleEntry[] = allFiles.map((file) => ({
    path: file,
    parsed: parsePath(file),
    validation: validateModule(program, file, APP_DIR),
  }));

  return generateTypedModulesFile(entries);
}

/** Chunk manifest mapping routes to their JS chunks and CSS. */
interface ChunkManifest {
  chunks: Record<string, string>;
  tags: Record<string, string>;
  styles: Record<string, string[]>;
  devScripts?: string[];
}

/** Builds the client bundle with per-route code splitting. */
async function buildClient() {
  console.log("🔍 Scanning for client components...");
  const clientFiles = await findClientComponents();
  console.log(`   Found ${clientFiles.length} client component(s)`);

  // Create shared program for type checking
  const filePaths = clientFiles.map((f) => join(APP_DIR, f));
  const program = createProgram(filePaths);

  // Get metadata for all components
  const metas = await Promise.all(clientFiles.map((file) => getComponentMeta(program, file)));

  // Copy static assets FIRST (before JS build triggers wrangler reload)
  // This ensures CSS/assets are available when browser refreshes

  // Scan layouts for CSS imports (recursively following component imports) and copy them to dist
  const layoutFiles = await findLayouts();
  const layoutCssMap: Record<string, string[]> = {}; // layout directory -> CSS files

  for (const layoutFile of layoutFiles) {
    const layoutPath = join(APP_DIR, layoutFile);
    const allCssImports = await extractAllCssImports(layoutPath);

    if (allCssImports.length > 0) {
      const cssOutputPaths: string[] = [];
      const layoutDir = layoutFile.split("/").slice(0, -1).join("/");

      for (const cssImport of allCssImports) {
        let cssSourcePath: string;
        if (cssImport.startsWith("./")) {
          cssSourcePath = join(APP_DIR, cssImport.replace("./", ""));
        } else {
          cssSourcePath = join(APP_DIR, layoutDir, cssImport);
        }

        if (!(await Bun.file(cssSourcePath).exists())) {
          continue;
        }

        const cssRelativePath = cssSourcePath.replace(APP_DIR + "/", "");
        const cssContent = await Bun.file(cssSourcePath).text();
        const cssHash = generateHash(cssContent);
        const cssBase = normalizeAssetPath(cssRelativePath.replace(/\.css$/, ""));
        const cssOutputName = `${cssBase}.${cssHash}.css`;

        const destPath = join(DIST_CLIENT, cssOutputName);
        await Bun.write(destPath, Bun.file(cssSourcePath));

        const outputPath = `/${cssOutputName}`;
        if (!cssOutputPaths.includes(outputPath)) {
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

  if (await Bun.file(PUBLIC_DIR).exists()) {
    const publicFiles = await scanFiles("**/*", PUBLIC_DIR);
    for (const file of publicFiles) {
      const src = join(PUBLIC_DIR, file);

      const content = await Bun.file(src).arrayBuffer();
      const hash = generateHash(Buffer.from(content).toString());

      const normalizedFile = normalizeAssetPath(file);
      const parts = normalizedFile.split(".");
      const ext = parts.pop();
      const base = parts.join(".");
      const hashedName = ext ? `${base}.${hash}.${ext}` : `${base}.${hash}`;

      const dest = join(DIST_CLIENT, hashedName);
      await Bun.write(dest, Bun.file(src));
    }
  }

  if (!args.production) {
    const consoleScript = generateClientScript();
    const consoleScriptPath = join(DIST_CLIENT, "console-forward.js");
    await Bun.write(consoleScriptPath, consoleScript);
    console.log("   Generated console-forward.js (dev mode)");
  }

  // Generate individual entry files for each component
  const entryPaths: string[] = [];
  const entryToMeta: Record<string, ComponentMeta> = {};

  for (const meta of metas) {
    const entryContent = generateChunkedClientEntry(meta);
    const entryPath = join(DIST_DIR, `.entry-${meta.chunk.replace(".js", "")}.generated.tsx`);
    await Bun.write(entryPath, entryContent);
    entryPaths.push(entryPath);
    entryToMeta[entryPath] = meta;
  }

  console.log("📦 Building client chunks...");
  const result = await Bun.build({
    entrypoints: entryPaths,
    outdir: DIST_CLIENT,
    target: "browser",
    splitting: false, // FIX: known issue with Bun's bundler { splitting: true, minify: true } shared chunks sometimes don't get minified properly.
    minify: args.production,
  });

  if (!result.success) {
    console.error("❌ Client build failed:");
    for (const log of result.logs) {
      console.error(log);
    }
    process.exit(1);
  }

  // Build manifest mapping routes to their chunks
  const manifest: ChunkManifest = {
    chunks: {},
    tags: {},
    styles: {},
    devScripts: args.production ? undefined : ["/console-forward.js"],
  };

  // Map entry paths to their output chunk names
  // Bun outputs entries as .entry-{name}.js when using splitting
  for (const output of result.outputs) {
    const outputPath = output.path;
    const outputName = outputPath.split("/").pop() || "";

    // Skip non-JS outputs (CSS, etc.) and shared chunks
    if (!outputName.endsWith(".js") || outputName.startsWith("chunk-")) {
      continue;
    }

    // Match output to our entry files
    for (const [entryPath, meta] of Object.entries(entryToMeta)) {
      // Extract the base name from entry path: .entry-index.generated.tsx -> index
      const entryBase = entryPath
        .split("/")
        .pop()!
        .replace(".generated.tsx", "")
        .replace(".entry-", "");

      // Check if this output corresponds to this entry
      // Bun names the output based on the entry file name
      if (outputName.includes(entryBase) || outputName === `.entry-${entryBase}.js`) {
        // Rename to the desired chunk name
        const targetPath = join(DIST_CLIENT, meta.chunk);
        if (outputPath !== targetPath) {
          await safeRename(outputPath, targetPath);
        }
        manifest.chunks[meta.parsed.pattern] = `/${meta.chunk}`;
        manifest.tags[meta.tag] = `/${meta.chunk}`;
        break;
      }
    }
  }

  for (const output of result.outputs) {
    const outputPath = output.path;
    const outputName = outputPath.split("/").pop() || "";

    if (outputName.endsWith(".css") && outputName.startsWith(".entry-")) {
      const baseName = outputName.replace(".entry-", "").replace(".generated.css", "");
      const cssContent = await Bun.file(outputPath).text();
      const cssHash = generateHash(cssContent);
      const targetPath = join(DIST_CLIENT, `${baseName}.${cssHash}.css`);
      await safeRename(outputPath, targetPath);

      for (const meta of metas) {
        const metaBase = getChunkName(meta.file).replace(/\.js$/, "");
        if (baseName === metaBase || baseName.includes(metaBase)) {
          if (!manifest.styles[meta.parsed.pattern]) {
            manifest.styles[meta.parsed.pattern] = [];
          }
          manifest.styles[meta.parsed.pattern].push(`/${baseName}.${cssHash}.css`);
        }
      }
    }
  }

  for (const meta of metas) {
    const routeStyles: string[] = [];

    for (const [layoutPattern, cssFiles] of Object.entries(layoutCssMap)) {
      if (layoutPattern === "/" || meta.parsed.pattern.startsWith(layoutPattern)) {
        routeStyles.push(...cssFiles);
      }
    }

    if (routeStyles.length > 0) {
      manifest.styles[meta.parsed.pattern] = routeStyles;
    }
  }

  await Bun.write(CHUNKS_PATH, JSON.stringify(manifest, null, 2));

  const routesManifest = {
    routes: metas.map((meta) => ({
      pattern: meta.parsed.pattern,
      tag: meta.tag,
      chunk: manifest.chunks[meta.parsed.pattern],
      styles: manifest.styles[meta.parsed.pattern],
      type: "client" as const,
      params: meta.parsed.params,
    })),
  };

  console.log(`   Generated ${metas.length} chunk(s)`);

  for (const entryPath of entryPaths) {
    await safeUnlink(entryPath);
  }

  console.log("✅ Client build complete");

  return routesManifest;
}

/** Builds the server bundle. */
async function buildServer(clientRoutesManifest: {
  routes: Array<{
    pattern: string;
    tag: string;
    chunk?: string;
    styles?: string[];
    type: "client";
    params: string[];
  }>;
}) {
  console.log("🔍 Scanning for route modules...");
  const routeFiles = await findRouteModules();
  const layoutFiles = await findLayouts();
  const errorFile = await findErrorFile();
  console.log(
    `   Found ${routeFiles.length} route(s), ${layoutFiles.length} layout(s)${errorFile ? ", and error page" : ""}`,
  );

  console.log("🔎 Validating route types...");
  const valid = await validateRoutes(routeFiles, layoutFiles);
  if (!valid) {
    console.error("❌ Route validation failed");
    process.exit(1);
  }

  const routesTypeContent = generateRoutesTypeFile(routeFiles);
  await Bun.write(ROUTES_TYPE_PATH, routesTypeContent);
  console.log("   Generated route types");

  const allModuleFiles = [
    ...routeFiles.map((f) => join(APP_DIR, f)),
    ...layoutFiles.map((f) => join(APP_DIR, f)),
    ...(errorFile ? [join(APP_DIR, errorFile)] : []),
  ];
  const moduleProgram = createProgram(allModuleFiles);

  console.log("🔬 Analyzing module exports via AST...");
  const { content: modulesContent, errors: moduleErrors } = generateModulesFile(
    moduleProgram,
    routeFiles,
    layoutFiles,
    errorFile,
  );

  for (const error of moduleErrors) {
    console.error(`   ❌ ${error}`);
  }
  if (moduleErrors.length > 0) {
    console.error("❌ Module analysis failed");
    process.exit(1);
  }

  await Bun.write(MODULES_PATH, modulesContent);

  console.log("📦 Building server bundle...");
  const result = await Bun.build({
    entrypoints: [join(APP_DIR, "index.ts")],
    outdir: DIST_SERVER,
    target: "bun",
    naming: "[dir]/index.[ext]",
    minify: args.production,
    external: ["cloudflare:workers"],
  });

  if (!result.success) {
    console.error("❌ Server build failed:");
    for (const log of result.logs) {
      console.error(log);
    }
    process.exit(1);
  }

  const serverRoutes = routeFiles
    .filter((f) => f.includes(".server.") && !f.includes("/_"))
    .map((file) => {
      const parsed = parsePath(file);
      const hasClientRoute = clientRoutesManifest.routes.some((r) => r.pattern === parsed.pattern);
      return { file, parsed, hasClientRoute };
    })
    .filter(({ hasClientRoute }) => !hasClientRoute)
    .map(({ parsed }) => ({
      pattern: parsed.pattern,
      tag: parsed.tag,
      type: "server" as const,
      params: parsed.params,
    }));

  const combinedManifest = {
    routes: [...clientRoutesManifest.routes, ...serverRoutes],
  };

  await Bun.write(ROUTES_MANIFEST_PATH, JSON.stringify(combinedManifest, null, 2));

  console.log("✅ Server build complete");
}

/** Cleans the dist directory. */
async function clean() {
  const { rm } = await import("fs/promises");
  try {
    await rm(DIST_DIR, { recursive: true, force: true });
    console.log("🧹 Cleaned dist directory");
  } catch {
    // Ignore errors if directory doesn't exist
  }
}

/** Main build function. */
async function build() {
  const startTime = performance.now();

  console.log("\n⚡ Solarflare Build\n");

  if (args.clean) {
    await clean();
  }

  await scaffoldTemplates();

  const clientManifest = await buildClient();
  await buildServer(clientManifest);

  const duration = ((performance.now() - startTime) / 1000).toFixed(2);
  console.log(`\n🚀 Build completed in ${duration}s\n`);
}

// CLI entry point
const { values: args } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    production: { type: "boolean", short: "p", default: process.env.NODE_ENV === "production" },
    serve: { type: "boolean", short: "s", default: false },
    watch: { type: "boolean", short: "w", default: false },
    clean: { type: "boolean", short: "c", default: false },
    debug: { type: "boolean", short: "d", default: false },
  },
});

/** Watch mode - rebuilds on file changes and optionally starts dev server. */
async function watchMode() {
  console.log("\n⚡ Solarflare Dev Mode\n");

  try {
    await build();
  } catch (err) {
    console.error("❌ Initial build failed:", err);
  }

  let wranglerProc: Bun.Subprocess | null = null;

  if (args.serve) {
    console.log("🌐 Starting wrangler dev server...\n");
    wranglerProc = Bun.spawn({
      cmd: ["bun", "wrangler", "dev"],
      stdout: "inherit",
      stderr: "inherit",
      stdin: "pipe",
      env: { ...process.env },
    });
  }

  console.log("\n👀 Watching for changes...\n");

  let debounceTimer: Timer | null = null;
  let isBuilding = false;
  let pendingBuild = false;
  const DEBOUNCE_MS = 150;

  async function doBuild(filename: string) {
    if (isBuilding) {
      pendingBuild = true;
      return;
    }

    isBuilding = true;
    console.log(`\n🔄 Change detected: ${filename}\n`);
    try {
      await build();
      console.log("\n👀 Watching for changes...\n");
    } catch (err) {
      console.error("❌ Build failed:", err);
      console.log("\n👀 Watching for changes...\n");
    } finally {
      isBuilding = false;
      if (pendingBuild) {
        pendingBuild = false;
        await doBuild("(queued changes)");
      }
    }
  }

  const watcher = watch(APP_DIR, { recursive: true }, (_event, filename) => {
    if (!filename) return;

    if (filename.endsWith(".generated.ts") || filename.endsWith(".generated.json")) {
      return;
    }

    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }

    debounceTimer = setTimeout(() => {
      void doBuild(filename);
    }, DEBOUNCE_MS);
  });

  let isExiting = false;
  process.on("SIGINT", () => {
    if (isExiting) return;
    isExiting = true;
    console.log("\n\n👋 Stopping dev server...\n");
    watcher.close();
    if (wranglerProc) {
      wranglerProc.kill("SIGTERM");
    }
    process.exit(0);
  });

  await new Promise(() => {});
}

if (args.watch) {
  void watchMode();
} else {
  void build();
}
