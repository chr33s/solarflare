#!/usr/bin/env node
import { createHash } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { watch } from "node:fs";
import { access, glob, mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { argv, env } from "node:process";
import { parseArgs } from "node:util";
import ts from "typescript";
import { rolldown } from "rolldown";
import { transform } from "lightningcss";
import {
  createProgram,
  getDefaultExportInfo,
  validateModule,
  generateTypedModulesFile,
  type ModuleEntry,
  type ValidationResult,
} from "./ast.ts";
import { parsePath } from "./paths.ts";
import { generateClientScript } from "./console-forward.ts";

// Node.js file system helpers
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

function hash(content: string): string {
  return createHash("sha256").update(content).digest("hex").slice(0, 8);
}

async function scanFiles(pattern: string, cwd: string): Promise<string[]> {
  const files: string[] = [];
  for await (const file of glob(pattern, { cwd, withFileTypes: false })) {
    files.push(file as string);
  }
  return files.sort();
}

// Resolve paths relative to current working directory (where solarflare is invoked)
// e.g. running from ./examples/basic will use ./examples/basic/src and ./examples/basic/dist
const ROOT_DIR = process.cwd();
const APP_DIR = join(ROOT_DIR, "src");
const DIST_DIR = join(ROOT_DIR, "dist");
const DIST_CLIENT = join(DIST_DIR, "client");
const DIST_SERVER = join(DIST_DIR, "server");
const PUBLIC_DIR = join(ROOT_DIR, "public");

// Generated file paths
const MODULES_PATH = join(DIST_DIR, ".modules.generated.ts");
const CHUNKS_PATH = join(DIST_DIR, ".chunks.generated.json");
const ROUTES_TYPE_PATH = join(DIST_DIR, "routes.d.ts");

// CLI entry point - parse args early so they're available
const { values: args } = parseArgs({
  args: argv.slice(2),
  options: {
    production: {
      type: "boolean",
      short: "p",
      default: env.NODE_ENV === "production",
    },
    serve: { type: "boolean", short: "s", default: false },
    watch: { type: "boolean", short: "w", default: false },
    clean: { type: "boolean", short: "c", default: false },
    debug: { type: "boolean", short: "d", default: false },
    sourcemap: { type: "boolean", default: false },
  },
});

/**
 * Auto-scaffolds missing template files.
 * @returns Promise that resolves when scaffolding completes
 */
async function scaffoldTemplates(): Promise<void> {
  const templates: Record<string, string> = {
    "index.ts": `import worker from "@chr33s/solarflare/worker";
export default { fetch: worker };
`,
    "_error.tsx": `export default function Error({ error }: { error: Error }) {
  return <div><h1>Error</h1><p>{error.message}</p></div>;
}
`,
    "_layout.tsx": `import type { VNode } from "preact";
import { Assets } from "@chr33s/solarflare/server";

export default function Layout({ children }: { children: VNode }) {
  return <html><head><Assets /></head><body>{children}</body></html>;
}
`,
  };

  const rootTemplates: Record<string, string> = {
    "wrangler.json": `{
  "assets": { "directory": "./dist/client" },
  "compatibility_date": "2025-12-10",
  "compatibility_flags": ["nodejs_compat"],
  "dev": { "port": 8080 },
  "main": "./dist/server/index.js",
  "name": "solarflare"
}
`,
    "tsconfig.json": `{
  "compilerOptions": { "types": ["@chr33s/solarflare" ] },
  "extends": "@chr33s/solarflare/tsconfig.json",
  "include": ["./src", "./worker-configuration.d.ts"]
}
`,
  };

  await mkdir(APP_DIR, { recursive: true });

  for (const [filename, content] of Object.entries(templates)) {
    const filepath = join(APP_DIR, filename);
    if (!(await exists(filepath))) {
      await write(filepath, content);
    }
  }

  for (const [filename, content] of Object.entries(rootTemplates)) {
    const filepath = join(ROOT_DIR, filename);
    if (!(await exists(filepath))) {
      await write(filepath, content);
    }
  }
}

/**
 * Validates all route files using AST analysis.
 * @param routeFiles - Route file paths to validate
 * @param layoutFiles - Layout file paths to validate
 * @returns Whether all validations passed
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
 * Extracts props property names from a TypeScript file using the type checker.
 * @param program - TypeScript program
 * @param filePath - Absolute file path
 * @returns Array of prop names
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
 * Generates typed routes file using AST-based path parsing.
 * @param routeFiles - Route file paths
 * @returns TypeScript type declaration content
 */
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

/** Component metadata. */
interface ComponentMeta {
  file: string;
  tag: string;
  props: string[];
  parsed: ReturnType<typeof parsePath>;
  /** Chunk filename */
  chunk: string;
  /** Content hash */
  hash?: string;
}

/**
 * Normalizes asset path from nested directories to dot-separated.
 * @param path - Asset path to normalize
 * @returns Normalized path with dots instead of slashes
 */
function normalizeAssetPath(path: string): string {
  return path.replace(/\//g, ".");
}

/**
 * Generates chunk filename from file path.
 * @param file - Source file path
 * @param contentHash - Optional content hash for cache busting
 * @returns Chunk filename
 */
function getChunkName(file: string, contentHash?: string): string {
  const base = file
    .replace(/\.client\.tsx?$/, "")
    .replace(/\//g, ".")
    .replace(/\$/g, "") // Remove $ to avoid URL issues
    .replace(/^index$/, "index");

  return contentHash ? `${base}.${contentHash}.js` : `${base}.js`;
}

async function getComponentMeta(program: ts.Program, file: string): Promise<ComponentMeta> {
  const filePath = join(APP_DIR, file);
  const props = extractPropsFromProgram(program, filePath);
  const parsed = parsePath(file);

  // Generate hash from file content
  const content = await readText(filePath);
  const contentHash = hash(content);
  const chunk = getChunkName(file, contentHash);

  return { file, tag: parsed.tag, props, parsed, chunk, hash: contentHash };
}

/**
 * Finds all route modules in the app directory.
 * @returns Array of route module paths
 */
async function findRouteModules(): Promise<string[]> {
  return scanFiles("**/*.{client,server}.{ts,tsx}", APP_DIR);
}

/**
 * Finds all layout files in the app directory.
 * @returns Array of layout file paths
 */
async function findLayouts(): Promise<string[]> {
  return scanFiles("**/_layout.tsx", APP_DIR);
}

/**
 * Finds the error file in the app directory.
 * @returns Error file path or null if not found
 */
async function findErrorFile(): Promise<string | null> {
  const files = await scanFiles("_error.tsx", APP_DIR);
  return files.length > 0 ? files[0] : null;
}

/**
 * Finds all client components in the app directory.
 * @returns Array of client component paths
 */
async function findClientComponents(): Promise<string[]> {
  return scanFiles("**/*.client.tsx", APP_DIR);
}

/**
 * Extracts CSS import paths from a TypeScript/TSX file.
 * @param filePath - File path to analyze
 * @returns Array of CSS import paths
 */
async function extractCssImports(filePath: string): Promise<string[]> {
  const content = await readText(filePath);
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
 * Extracts component import paths from a TypeScript/TSX file.
 * @param filePath - File path to analyze
 * @returns Array of local component import paths
 */
async function extractComponentImports(filePath: string): Promise<string[]> {
  const content = await readText(filePath);
  const imports: string[] = [];

  // Match import statements for local .tsx/.ts files (starting with ./ or ../)
  // Also match #app/* aliases
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

/**
 * Resolves an import path to an absolute file path.
 * @param importPath - Import path from source
 * @param fromFile - File containing the import
 * @returns Absolute file path or null if not found
 */
async function resolveImportPath(importPath: string, fromFile: string): Promise<string | null> {
  const fromDir = fromFile.split("/").slice(0, -1).join("/");

  // Handle #app/* alias
  if (importPath.startsWith("#app/")) {
    const relativePath = importPath.replace("#app/", "");
    // Try .tsx, .ts, /index.tsx, /index.ts extensions
    const extensions = [".tsx", ".ts", "/index.tsx", "/index.ts"];
    for (const ext of extensions) {
      const fullPath = join(APP_DIR, relativePath + ext);
      if (await exists(fullPath)) {
        return fullPath;
      }
    }
    // Try without extension (might already have it)
    const fullPath = join(APP_DIR, relativePath);
    if (await exists(fullPath)) {
      return fullPath;
    }
    return null;
  }

  // Handle relative imports
  if (importPath.startsWith("./") || importPath.startsWith("../")) {
    const extensions = [".tsx", ".ts", "/index.tsx", "/index.ts", ""];
    for (const ext of extensions) {
      const fullPath = join(fromDir, importPath + ext);
      if (await exists(fullPath)) {
        return fullPath;
      }
    }
  }

  return null;
}

/**
 * Recursively extracts all CSS imports from a file and its dependencies.
 * @param filePath - File path to start from
 * @param visited - Set of already-visited paths
 * @returns Array of all CSS import paths
 */
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
    if (resolvedPath && (await exists(resolvedPath))) {
      const nestedCss = await extractAllCssImports(resolvedPath, visited);
      allCss.push(...nestedCss);
    }
  }

  return allCss;
}

/** Routes manifest for client-side routing. */
interface RoutesManifest {
  routes: Array<{
    pattern: string;
    tag: string;
    chunk?: string;
    styles?: string[];
    type: "client";
    params: string[];
  }>;
}

/**
 * Generates virtual client entry for a single component with HMR support.
 * @param meta - Component metadata
 * @param routesManifest - Routes manifest for routing
 * @returns Generated JavaScript entry code
 */
function generateChunkedClientEntry(meta: ComponentMeta, routesManifest: RoutesManifest): string {
  const debugImports = args.debug
    ? `import 'preact/debug'
import '@preact/signals-debug'
`
    : "";

  // Inline the routes manifest to avoid fetch
  const inlinedRoutes = JSON.stringify(routesManifest);

  return /* js */ `/** Auto-generated: ${meta.chunk} */
${debugImports}import { h, Component as PreactComponent } from 'preact';
import { signal, useSignal, useSignalEffect } from '@preact/signals';
import register from 'preact-custom-element';
import { initRouter, getRouter, initHydrationCoordinator, extractDataIsland } from '@chr33s/solarflare/client';
import BaseComponent from '../src/${meta.file}';

// Initialize hydration coordinator for streaming SSR
initHydrationCoordinator();

let CurrentComponent = BaseComponent;
const hmrVersion = signal(0);

// ============================================================================
// HMR Scroll Position Preservation
// ============================================================================
const scrollPositions = new Map();

function saveScrollPosition() {
  scrollPositions.set('${meta.tag}', { x: window.scrollX, y: window.scrollY });
}

function restoreScrollPosition() {
  const pos = scrollPositions.get('${meta.tag}');
  if (pos) {
    requestAnimationFrame(() => window.scrollTo(pos.x, pos.y));
  }
}

// ============================================================================
// HMR Hook State Preservation
// ============================================================================
const hookStateStorage = new Map();

function saveHookState(instance) {
  if (instance?.__hooks?.list) {
    hookStateStorage.set('${meta.tag}', 
      instance.__hooks.list.map(hook => hook?._value !== undefined ? hook._value : hook?.current)
    );
  }
}

function restoreHookState(instance) {
  const saved = hookStateStorage.get('${meta.tag}');
  if (saved && instance?.__hooks?.list) {
    instance.__hooks.list.forEach((hook, i) => {
      if (saved[i] !== undefined) {
        if (hook?._value !== undefined) hook._value = saved[i];
        else if (hook?.current !== undefined) hook.current = saved[i];
      }
    });
  }
}

// ============================================================================
// CSS Hot Module Replacement
// ============================================================================
function reloadStylesheets() {
  // Find all stylesheets and bust their cache
  const links = document.querySelectorAll('link[rel="stylesheet"]');
  links.forEach(link => {
    const href = link.getAttribute('href');
    if (href && !href.includes('?')) {
      link.setAttribute('href', href + '?t=' + Date.now());
    } else if (href) {
      link.setAttribute('href', href.replace(/\\?t=\\d+/, '?t=' + Date.now()));
    }
  });
  console.log('[HMR] Reloaded stylesheets');
}

// Listen for CSS-only updates
if (import.meta.hot) {
  import.meta.hot.on('sf:css-update', () => {
    reloadStylesheets();
  });
}

// ============================================================================
// HMR Error Boundary
// ============================================================================
class HMRErrorBoundary extends PreactComponent {
  constructor(props) {
    super(props);
    this.state = { error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, errorInfo) {
    this.setState({ errorInfo });
    console.error('[HMR] Error in <${meta.tag}>:', error);
    document.dispatchEvent(new CustomEvent('sf:hmr:error', { 
      detail: { tag: '${meta.tag}', error } 
    }));
  }

  componentDidUpdate(prevProps) {
    // Auto-recover when HMR version changes
    if (prevProps.hmrVersion !== this.props.hmrVersion && this.state.error) {
      console.log('[HMR] Attempting recovery for <${meta.tag}>');
      this.setState({ error: null, errorInfo: null });
      document.dispatchEvent(new CustomEvent('sf:hmr:recover', { 
        detail: { tag: '${meta.tag}' } 
      }));
    }
  }

  retry = () => {
    this.setState({ error: null, errorInfo: null });
  };

  render() {
    if (this.state.error) {
      return h('div', { 
        style: { 
          padding: '16px', 
          margin: '8px', 
          backgroundColor: '#fee2e2', 
          border: '1px solid #ef4444', 
          borderRadius: '8px',
          fontFamily: 'system-ui, sans-serif'
        } 
      },
        h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' } },
          h('span', { style: { fontSize: '20px' } }, '⚠️'),
          h('strong', { style: { color: '#991b1b' } }, 'Error in <${meta.tag}>')
        ),
        h('pre', { 
          style: { 
            margin: '8px 0', 
            padding: '8px', 
            backgroundColor: '#fef2f2', 
            borderRadius: '4px', 
            overflow: 'auto',
            fontSize: '12px',
            color: '#7f1d1d'
          } 
        }, this.state.error.message),
        this.state.errorInfo?.componentStack && h('details', { style: { marginTop: '8px' } },
          h('summary', { style: { cursor: 'pointer', color: '#991b1b' } }, 'Component Stack'),
          h('pre', { style: { fontSize: '10px', color: '#7f1d1d', whiteSpace: 'pre-wrap' } }, 
            this.state.errorInfo.componentStack)
        ),
        h('button', {
          onClick: this.retry,
          style: {
            marginTop: '12px',
            padding: '8px 16px',
            backgroundColor: '#ef4444',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer',
            fontSize: '14px'
          }
        }, 'Retry')
      );
    }
    return this.props.children;
  }
}

// ============================================================================
// HMR Support
// ============================================================================
if (import.meta.hot) {
  import.meta.hot.accept('../src/${meta.file}', (newModule) => {
    if (newModule?.default) {
      // Save scroll position before update
      saveScrollPosition();
      
      // Save hook state from existing instances
      const el = document.querySelector('${meta.tag}');
      if (el?._vdom) saveHookState(el._vdom);
      
      CurrentComponent = newModule.default;
      console.log('[HMR] Updated <${meta.tag}>');
      hmrVersion.value++;
      
      // Restore scroll position after render
      requestAnimationFrame(() => {
        restoreScrollPosition();
        // Attempt to restore hook state
        const el = document.querySelector('${meta.tag}');
        if (el?._vdom) restoreHookState(el._vdom);
      });
      
      document.dispatchEvent(new CustomEvent('sf:hmr:update', { 
        detail: { tag: '${meta.tag}' } 
      }));
    }
  });
  
  import.meta.hot.dispose(() => {
    console.log('[HMR] Disposing <${meta.tag}>');
    // Save state before disposal
    saveScrollPosition();
    const el = document.querySelector('${meta.tag}');
    if (el?._vdom) saveHookState(el._vdom);
  });
}

const routesManifest = ${inlinedRoutes};

let routerInitialized = false;
function ensureRouter() {
  if (typeof document === 'undefined') return null;
  if (routerInitialized) {
    try { return getRouter(); } catch { return null; }
  }
  routerInitialized = true;
  return initRouter(routesManifest).start();
}

/** HMR wrapper with deferred data hydration and error boundary. */
function Component(props) {
  const deferredProps = useSignal(null);
  const _ = hmrVersion.value;

  useSignalEffect(() => {
    const el = document.querySelector('${meta.tag}');
    if (!el) return;
    
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
    
    extractDeferred();
    
    const hydrateHandler = (e) => { deferredProps.value = e.detail };
    el.addEventListener('sf:hydrate', hydrateHandler);
    
    const navHandler = () => setTimeout(extractDeferred, 0);
    window.addEventListener('sf:navigate', navHandler);
    
    ensureRouter();
    
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

  // Wrap in error boundary with HMR recovery
  return h(HMRErrorBoundary, { hmrVersion: hmrVersion.value },
    h(CurrentComponent, finalProps)
  );
}

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

/** Chunk manifest. */
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

  // Copy static assets before JS build
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

        if (!(await exists(cssSourcePath))) {
          continue;
        }

        const cssRelativePath = cssSourcePath.replace(APP_DIR + "/", "");
        let cssContent = await readText(cssSourcePath);

        // Minify CSS in production
        if (args.production) {
          const result = transform({
            code: Buffer.from(cssContent),
            filename: cssSourcePath,
            minify: true,
          });
          cssContent = result.code.toString();
        }

        const cssHash = hash(cssContent);
        const cssBase = normalizeAssetPath(cssRelativePath.replace(/\.css$/, ""));
        const cssOutputName = `${cssBase}.${cssHash}.css`;

        await mkdir(DIST_CLIENT, { recursive: true });
        const destPath = join(DIST_CLIENT, cssOutputName);
        await write(destPath, cssContent);

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

  // Copy public directory
  if (await exists(PUBLIC_DIR)) {
    const publicFiles = await scanFiles("**/*", PUBLIC_DIR);
    for (const file of publicFiles) {
      const src = join(PUBLIC_DIR, file);
      const dest = join(DIST_CLIENT, file);

      // Ensure the directory structure exists
      const destDir = dirname(dest);
      await mkdir(destDir, { recursive: true });

      const content = await readText(src);
      await write(dest, content);
    }
  }

  if (!args.production) {
    const consoleScript = generateClientScript();
    const consoleScriptPath = join(DIST_CLIENT, "console-forward.js");
    await write(consoleScriptPath, consoleScript);
    console.log("   Generated console-forward.js (dev mode)");
  }

  const inlineRoutesManifest: RoutesManifest = {
    routes: metas.map((meta) => ({
      pattern: meta.parsed.pattern,
      tag: meta.tag,
      chunk: `/${meta.chunk}`,
      styles: undefined, // Will be populated after CSS processing
      type: "client" as const,
      params: meta.parsed.params,
    })),
  };

  // Generate individual entry files for each component
  const entryPaths: string[] = [];
  const entryToMeta: Record<string, ComponentMeta> = {};

  await mkdir(DIST_DIR, { recursive: true });

  for (const meta of metas) {
    const entryContent = generateChunkedClientEntry(meta, inlineRoutesManifest);
    const entryPath = join(DIST_DIR, `.entry-${meta.chunk.replace(".js", "")}.generated.tsx`);
    await write(entryPath, entryContent);
    entryPaths.push(entryPath);
    entryToMeta[entryPath] = meta;
  }

  console.log("📦 Building client chunks...");

  // Build each entry with rolldown
  await mkdir(DIST_CLIENT, { recursive: true });

  for (const entryPath of entryPaths) {
    const meta = entryToMeta[entryPath];

    const bundle = await rolldown({
      input: entryPath,
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
      resolve: {
        alias: {
          "#app": APP_DIR,
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
      dir: DIST_CLIENT,
      format: "esm",
      entryFileNames: meta.chunk,
      minify: args.production,
      chunkFileNames: "[name].[hash].js",
      advancedChunks: {
        groups: [{ name: "vendor", test: /[\\/]node_modules[\\/]/ }],
      },
      ...(args.sourcemap && { sourcemap: true }),
    });

    await bundle.close();
  }

  // Post-process all CSS files for minification
  if (args.production) {
    // Match all CSS files including those starting with dots (.entry-*.css)
    const cssFiles = await scanFiles("?(.)*.css", DIST_CLIENT);
    for (const cssFile of cssFiles) {
      const cssPath = join(DIST_CLIENT, cssFile);
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

  // Build manifest mapping routes to their chunks
  const manifest: ChunkManifest = {
    chunks: {},
    tags: {},
    styles: {},
    devScripts: args.production ? undefined : ["/console-forward.js"],
  };

  for (const meta of metas) {
    manifest.chunks[meta.parsed.pattern] = `/${meta.chunk}`;
    manifest.tags[meta.tag] = `/${meta.chunk}`;
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

  await write(CHUNKS_PATH, JSON.stringify(manifest, null, 2));

  console.log(`   Generated ${metas.length} chunk(s)`);

  for (const entryPath of entryPaths) {
    await remove(entryPath);
  }

  console.log("✅ Client build complete");
}

/** Builds the server bundle. */
async function buildServer() {
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
  await write(ROUTES_TYPE_PATH, routesTypeContent);
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

  await write(MODULES_PATH, modulesContent);

  console.log("📦 Building server bundle...");

  await mkdir(DIST_SERVER, { recursive: true });

  const bundle = await rolldown({
    input: join(APP_DIR, "index.ts"),
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
      // Keep Preact ecosystem external to avoid duplicate instances
      "preact",
      "preact/hooks",
      "preact/compat",
      "@preact/signals",
      "@preact/signals-core",
      "preact-render-to-string",
      "preact-render-to-string/stream",
      // Client-only library - avoid bundling for server
      "preact-custom-element",
    ],
    resolve: {
      alias: {
        "#app": APP_DIR,
        ".modules.generated": MODULES_PATH,
        ".chunks.generated.json": CHUNKS_PATH,
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
    dir: DIST_SERVER,
    format: "esm",
    inlineDynamicImports: true,
    entryFileNames: "index.js",
    minify: args.production,
    ...(args.sourcemap && { sourcemap: true }),
  });

  await bundle.close();

  // Post-process all CSS files for minification
  if (args.production) {
    const cssFiles: string[] = [];
    for await (const file of glob("?(.)*.css", { cwd: DIST_SERVER, withFileTypes: false })) {
      cssFiles.push(file as string);
    }
    for (const cssFile of cssFiles) {
      const cssPath = join(DIST_SERVER, cssFile);
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

/**
 * Cleans the dist directory.
 * @returns Promise that resolves when cleaning completes
 */
async function clean() {
  const { rm } = await import("fs/promises");
  try {
    await rm(DIST_DIR, { recursive: true, force: true });
    console.log("🧹 Cleaned dist directory");
  } catch {
    // Ignore errors if directory doesn't exist
  }
}

/**
 * Main build function.
 * @returns Promise that resolves when build completes
 */
async function build() {
  const startTime = performance.now();

  console.log("\n⚡ Solarflare Build\n");

  if (args.clean) {
    await clean();
  }

  await scaffoldTemplates();

  await buildClient();
  await buildServer();

  const duration = ((performance.now() - startTime) / 1000).toFixed(2);
  console.log(`\n🚀 Build completed in ${duration}s\n`);
}

/**
 * Watch mode - rebuilds on file changes and optionally starts dev server.
 * @returns Promise that never resolves (runs until interrupted)
 */
async function watchMode() {
  console.log("\n⚡ Solarflare Dev Mode\n");

  try {
    await build();
  } catch (err) {
    console.error("❌ Initial build failed:", err);
  }

  let wranglerProc: ChildProcess | null = null;

  if (args.serve) {
    console.log("🌐 Starting wrangler dev server...\n");
    wranglerProc = spawn("npx", ["wrangler", "dev"], {
      stdio: "inherit",
      env: { ...env },
    });
  }

  console.log("\n👀 Watching for changes...\n");

  let debounceTimer: NodeJS.Timeout | null = null;
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
