#!/usr/bin/env bun
/**
 * Solarflare Build Script
 * Auto-generates client and server entries, then builds both bundles
 */
import { Glob } from "bun";
import { watch } from "fs";
import { join } from "path";
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

// Resolve paths relative to project root (two levels up from src/framework/)
const ROOT_DIR = join(import.meta.dir, "../..");
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

/**
 * Safe unlink that ignores ENOENT errors (file doesn't exist)
 */
async function safeUnlink(path: string): Promise<void> {
  const file = Bun.file(path);
  if (await file.exists()) {
    await file.delete();
  }
}

/**
 * Safe rename (copy + delete) that ignores missing source files
 */
async function safeRename(src: string, dest: string): Promise<boolean> {
  const srcFile = Bun.file(src);
  if (!(await srcFile.exists())) {
    return false;
  }
  await Bun.write(dest, srcFile);
  await srcFile.delete();
  return true;
}

/**
 * Validate all route files and report errors/warnings using AST analysis
 */
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

/**
 * Extract Props property names from a TypeScript file using the type checker
 * Uses Parameters<typeof DefaultExport>[0] to infer props from any function signature
 */
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

/**
 * Generate typed routes file using AST-based path parsing
 */
function generateRoutesTypeFile(routeFiles: string[]): string {
  const clientRoutes = routeFiles.filter((f) => f.includes(".client."));

  const routeTypes = clientRoutes
    .map((file) => {
      const parsed = parsePath(file);
      const paramsType =
        parsed.params.length > 0
          ? `{ ${parsed.params.map((p) => `${p}: string`).join("; ")} }`
          : "Record<string, never>";
      return `  '${parsed.pattern}': { params: ${paramsType} }`;
    })
    .join("\n");

  return `/**
 * Auto-generated Route Types
 * Provides type-safe route definitions
 */

export interface Routes {
${routeTypes}
}

export type RoutePath = keyof Routes

export type RouteParams<T extends RoutePath> = Routes[T]['params']
`;
}

/**
 * Get component metadata for client entry generation
 */
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

/**
 * Generate a short hash from content for cache busting
 */
function generateHash(content: string): string {
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(content);
  return hasher.digest("hex").slice(0, 8);
}

/**
 * Generate chunk filename from file path
 * e.g., "blog/$slug.client.tsx" → "blog.slug.js"
 * Note: $ is removed to avoid URL encoding issues
 */
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

/**
 * Scan files in a directory matching a glob pattern
 */
async function scanFiles(pattern: string, dir: string = APP_DIR): Promise<string[]> {
  const glob = new Glob(pattern);
  const files: string[] = [];

  for await (const file of glob.scan(dir)) {
    files.push(file);
  }

  return files.sort();
}

/**
 * Find all route modules in the app directory
 */
async function findRouteModules(): Promise<string[]> {
  return scanFiles("**/*.{client,server}.{ts,tsx}");
}

/**
 * Find all layout files in the app directory
 */
async function findLayouts(): Promise<string[]> {
  return scanFiles("**/_layout.tsx");
}

/**
 * Find all client components in the app directory
 */
async function findClientComponents(): Promise<string[]> {
  return scanFiles("**/*.client.tsx");
}

/**
 * Extract CSS import paths from a TypeScript/TSX file
 */
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

/**
 * Generate virtual client entry for a single component (for chunked builds)
 * Includes router initialization and HMR support via wrapper pattern
 *
 * HMR Implementation:
 * - Uses wrapper component pattern to overcome customElements.define() limitation
 * - Wrapper holds mutable reference to actual component (CurrentComponent)
 * - Event listener triggers re-renders when component updates
 * - Note: import.meta.hot code is included but may be stripped during bundling
 * - Manual HMR testing: window.dispatchEvent(new CustomEvent('sf:hmr:TAG_NAME'))
 */
function generateChunkedClientEntry(meta: ComponentMeta): string {
  return `/**
 * Auto-generated Client Chunk: ${meta.chunk}
 * HMR-enabled wrapper for ${meta.tag}
 */
import { h } from 'preact'
import { useState, useEffect } from 'preact/hooks'
import register from 'preact-custom-element'
import { initRouter } from '../src/framework/client'
import BaseComponent from '../src/app/${meta.file}'

// Mutable reference for HMR - updated when module is hot-replaced
let CurrentComponent = BaseComponent

// HMR Support - allows component updates without re-registering custom element
if (import.meta.hot) {
  import.meta.hot.accept('../src/app/${meta.file}', (newModule) => {
    if (newModule?.default) {
      CurrentComponent = newModule.default
      console.log('[HMR] Updated <${meta.tag}>')
      // Notify all instances of this component to re-render
      window.dispatchEvent(new CustomEvent('sf:hmr:${meta.tag}'))
    }
  })
  
  import.meta.hot.dispose(() => {
    console.log('[HMR] Disposing <${meta.tag}>')
  })
}

// Initialize router once globally
function ensureRouter() {
  if (typeof window === 'undefined') return null
  
  // Use existing router if available
  if (window.__SF_ROUTER__) return window.__SF_ROUTER__
  
  // Create router from manifest (must be pre-loaded or inlined)
  if (window.__SF_ROUTES__) {
    window.__SF_ROUTER__ = initRouter(window.__SF_ROUTES__).start()
    return window.__SF_ROUTER__
  }
  
  return null
}

// HMR Wrapper Component - re-renders when CurrentComponent changes
function Component(props) {
  const [ready, setReady] = useState(!!window.__SF_ROUTER__)
  const [, forceUpdate] = useState(0)

  // Listen for HMR updates specific to this component
  useEffect(() => {
    const handler = () => forceUpdate(n => n + 1)
    window.addEventListener('sf:hmr:${meta.tag}', handler)
    return () => window.removeEventListener('sf:hmr:${meta.tag}', handler)
  }, [])

  // Router initialization
  useEffect(() => {
    if (ready) return
    
    // Load manifest and create router
    fetch('/routes.json')
      .then(res => res.json())
      .then(manifest => {
        window.__SF_ROUTES__ = manifest
        ensureRouter()
        setReady(true)
      })
      .catch(() => setReady(true)) // Render anyway on error
  }, [ready])

  // Render current (possibly HMR-updated) component
  return h(CurrentComponent, props)
}

// Register wrapper as web component (only happens once)
register(Component, '${meta.tag}', ${JSON.stringify(meta.props)}, { shadow: false })
`;
}

/**
 * Generate modules file using AST-based analysis
 * Delegates to generateTypedModulesFile from ast.ts for unified generation
 */
function generateModulesFile(
  program: ts.Program,
  routeFiles: string[],
  layoutFiles: string[],
): { content: string; errors: string[] } {
  const allFiles = [...layoutFiles, ...routeFiles];

  // Create module entries with parsed path info and validation
  const entries: ModuleEntry[] = allFiles.map((file) => ({
    path: file,
    parsed: parsePath(file),
    validation: validateModule(program, file, APP_DIR),
  }));

  // Use the unified generator from ast.ts
  return generateTypedModulesFile(entries);
}

/**
 * Chunk manifest mapping routes to their JS chunks and CSS
 */
interface ChunkManifest {
  chunks: Record<string, string>; // pattern -> chunk filename
  tags: Record<string, string>; // tag -> chunk filename
  styles: Record<string, string[]>; // pattern -> CSS filenames
}

/**
 * Build the client bundle with per-route code splitting
 */
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

  // Scan layouts for CSS imports and copy them to dist
  const layoutFiles = await findLayouts();
  const layoutCssMap: Record<string, string[]> = {}; // layout directory -> CSS files

  for (const layoutFile of layoutFiles) {
    const layoutPath = join(APP_DIR, layoutFile);
    const cssImports = await extractCssImports(layoutPath);

    if (cssImports.length > 0) {
      const cssOutputPaths: string[] = [];
      const layoutDir = layoutFile.split("/").slice(0, -1).join("/");

      for (const cssImport of cssImports) {
        // Resolve CSS path relative to layout file
        const cssSourcePath = join(APP_DIR, layoutDir, cssImport);

        // Generate output filename with hash
        const cssFileName = cssImport.replace("./", "");
        const cssContent = await Bun.file(cssSourcePath).text();
        const cssHash = generateHash(cssContent);
        const cssBase = cssFileName.replace(/\.css$/, "");
        const cssOutputName = `${cssBase}.${cssHash}.css`;

        // Copy CSS to dist
        if (await Bun.file(cssSourcePath).exists()) {
          const destPath = join(DIST_CLIENT, cssOutputName);
          await Bun.write(destPath, Bun.file(cssSourcePath));
          cssOutputPaths.push(`/${cssOutputName}`);
        }
      }

      if (cssOutputPaths.length > 0) {
        // Store by layout directory pattern (e.g., "/blog" or "/")
        const layoutPattern = layoutDir ? `/${layoutDir}` : "/";
        layoutCssMap[layoutPattern] = cssOutputPaths;
      }
    }
  }

  // Copy public assets with content hashes if directory exists
  if (await Bun.file(PUBLIC_DIR).exists()) {
    const publicFiles = await scanFiles("**/*", PUBLIC_DIR);
    for (const file of publicFiles) {
      const src = join(PUBLIC_DIR, file);

      // Generate hash for the asset
      const content = await Bun.file(src).arrayBuffer();
      const hash = generateHash(Buffer.from(content).toString());

      // Add hash to filename before extension
      const parts = file.split(".");
      const ext = parts.pop();
      const base = parts.join(".");
      const hashedName = ext ? `${base}.${hash}.${ext}` : `${base}.${hash}`;

      const dest = join(DIST_CLIENT, hashedName);
      await Bun.write(dest, Bun.file(src));
    }
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
    splitting: true,
    minify: process.env.NODE_ENV === "production",
  });

  if (!result.success) {
    console.error("❌ Client build failed:");
    for (const log of result.logs) {
      console.error(log);
    }
    process.exit(1);
  }

  // Build manifest mapping routes to their chunks
  const manifest: ChunkManifest = { chunks: {}, tags: {}, styles: {} };

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

  // Handle CSS outputs - rename them to match route names with hashes
  for (const output of result.outputs) {
    const outputPath = output.path;
    const outputName = outputPath.split("/").pop() || "";

    // Handle CSS files generated from imports
    if (outputName.endsWith(".css") && outputName.startsWith(".entry-")) {
      // Extract the route name and rename to a clean CSS name with hash
      const baseName = outputName.replace(".entry-", "").replace(".generated.css", "");
      const cssContent = await Bun.file(outputPath).text();
      const cssHash = generateHash(cssContent);
      const targetPath = join(DIST_CLIENT, `${baseName}.${cssHash}.css`);
      await safeRename(outputPath, targetPath);

      // Update manifest with the hashed CSS filename
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

  // Add layout CSS to manifest based on route patterns
  for (const meta of metas) {
    const routeStyles: string[] = [];

    // Check which layouts apply to this route and collect their CSS
    for (const [layoutPattern, cssFiles] of Object.entries(layoutCssMap)) {
      // A layout applies if the route pattern starts with the layout's directory
      if (layoutPattern === "/" || meta.parsed.pattern.startsWith(layoutPattern)) {
        routeStyles.push(...cssFiles);
      }
    }

    if (routeStyles.length > 0) {
      manifest.styles[meta.parsed.pattern] = routeStyles;
    }
  }

  // Write chunk manifest for the server
  await Bun.write(CHUNKS_PATH, JSON.stringify(manifest, null, 2));

  // Generate routes manifest for client-side router (client routes only for now)
  // Server routes will be added in buildServer phase
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

  // Return manifest for server to augment with server routes
  console.log(`   Generated ${metas.length} chunk(s)`);

  // Clean up temporary entry files
  for (const entryPath of entryPaths) {
    await safeUnlink(entryPath);
  }

  console.log("✅ Client build complete");

  return routesManifest;
}

/**
 * Build the server bundle
 */
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
  console.log(`   Found ${routeFiles.length} route(s) and ${layoutFiles.length} layout(s)`);

  // Validate routes and layouts
  console.log("🔎 Validating route types...");
  const valid = await validateRoutes(routeFiles, layoutFiles);
  if (!valid) {
    console.error("❌ Route validation failed");
    process.exit(1);
  }

  // Generate route types file to dist (exposed as virtual module solarflare:routes/types)
  const routesTypeContent = generateRoutesTypeFile(routeFiles);
  await Bun.write(ROUTES_TYPE_PATH, routesTypeContent);
  console.log("   Generated route types");

  // Create shared program for AST analysis of all modules
  const allModuleFiles = [
    ...routeFiles.map((f) => join(APP_DIR, f)),
    ...layoutFiles.map((f) => join(APP_DIR, f)),
  ];
  const moduleProgram = createProgram(allModuleFiles);

  // Generate modules file with AST-validated types
  console.log("🔬 Analyzing module exports via AST...");
  const { content: modulesContent, errors: moduleErrors } = generateModulesFile(
    moduleProgram,
    routeFiles,
    layoutFiles,
  );

  // Report any module analysis errors
  for (const error of moduleErrors) {
    console.error(`   ❌ ${error}`);
  }
  if (moduleErrors.length > 0) {
    console.error("❌ Module analysis failed");
    process.exit(1);
  }

  // Write generated modules file (imported by worker.tsx)
  await Bun.write(MODULES_PATH, modulesContent);

  console.log("📦 Building server bundle...");
  const result = await Bun.build({
    entrypoints: [join(APP_DIR, "index.ts")],
    outdir: DIST_SERVER,
    target: "bun",
    naming: "[dir]/index.[ext]",
    minify: process.env.NODE_ENV === "production",
    external: ["cloudflare:workers"],
  });

  if (!result.success) {
    console.error("❌ Server build failed:");
    for (const log of result.logs) {
      console.error(log);
    }
    process.exit(1);
  }

  // Add server routes to the manifest (routes that aren't already covered by client routes)
  const serverRoutes = routeFiles
    .filter((f) => f.includes(".server.") && !f.includes("/_"))
    .map((file) => {
      const parsed = parsePath(file);
      // Check if there's a matching client route
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

  // Combine client and server routes
  const combinedManifest = {
    routes: [...clientRoutesManifest.routes, ...serverRoutes],
  };

  // Write the combined routes manifest to client dist (for client-side router)
  await Bun.write(ROUTES_MANIFEST_PATH, JSON.stringify(combinedManifest, null, 2));

  console.log("✅ Server build complete");
}

/**
 * Main build function
 */
async function build() {
  const startTime = performance.now();

  console.log("\n⚡ Solarflare Build\n");

  const clientManifest = await buildClient();
  await buildServer(clientManifest);

  const duration = ((performance.now() - startTime) / 1000).toFixed(2);
  console.log(`\n🚀 Build completed in ${duration}s\n`);
}

// CLI entry point
const args = process.argv.slice(2);

/**
 * Watch mode - rebuilds on file changes, optionally starts dev server
 */
async function watchMode() {
  console.log("\n⚡ Solarflare Dev Mode\n");

  // Initial build
  try {
    await build();
  } catch (err) {
    console.error("❌ Initial build failed:", err);
  }

  // Start wrangler dev server as child process (after initial build)
  let wranglerProc: Bun.Subprocess | null = null;

  if (args.includes("--serve") || args.includes("-s")) {
    console.log("🌐 Starting wrangler dev server...\n");
    wranglerProc = Bun.spawn({
      cmd: ["bun", "wrangler", "dev"],
      stdout: "inherit",
      stderr: "inherit",
      stdin: "pipe", // Don't inherit stdin so we control SIGINT
      env: { ...process.env },
    });
  }

  console.log("\n👀 Watching for changes...\n");

  // Debounce timer and build lock
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

    // Skip generated files
    if (filename.endsWith(".generated.ts") || filename.endsWith(".generated.json")) {
      return;
    }

    // Clear existing timer
    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }

    // Set new debounced rebuild
    debounceTimer = setTimeout(() => {
      void doBuild(filename);
    }, DEBOUNCE_MS);
  });

  // Cleanup on exit
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

  // Keep process alive
  await new Promise(() => {});
}

if (args.includes("--watch") || args.includes("-w")) {
  void watchMode();
} else {
  void build();
}
