import { glob, readFile } from "node:fs/promises";
import { join } from "node:path";

import { exists } from "./fs.ts";

export interface BuildScanContext {
  rootDir: string;
  appDir: string;
}

export function createScanner(ctx: BuildScanContext) {
  const { rootDir, appDir } = ctx;
  let packageImportsCache: Record<string, string> | null = null;

  async function scanFiles(pattern: string, cwd: string) {
    const files: string[] = [];
    for await (const file of glob(pattern, { cwd, withFileTypes: false })) {
      files.push(file as string);
    }
    return files.sort();
  }

  async function getPackageImports() {
    if (packageImportsCache) return packageImportsCache;

    const pkgPath = join(rootDir, "package.json");
    try {
      const content = await readFile(pkgPath, "utf-8");
      const pkg = JSON.parse(content) as { imports?: Record<string, string> };
      const imports = pkg.imports ?? {};

      packageImportsCache = {};
      for (const [key, value] of Object.entries(imports)) {
        const aliasKey = key.replace(/\/\*$/, "");
        const aliasValue = value.replace(/\/\*$/, "");
        packageImportsCache[aliasKey] = aliasValue.startsWith(".")
          ? join(rootDir, aliasValue)
          : aliasValue;
      }
      return packageImportsCache;
    } catch {
      packageImportsCache = { "#app": appDir };
      return packageImportsCache;
    }
  }

  async function findRouteModules() {
    return scanFiles("**/*.{client,server}.{ts,tsx}", appDir);
  }

  async function findLayouts() {
    return scanFiles("**/_layout.tsx", appDir);
  }

  async function findErrorFile() {
    const files = await scanFiles("_error.tsx", appDir);
    return files.length > 0 ? files[0] : null;
  }

  async function findClientComponents() {
    return scanFiles("**/*.client.tsx", appDir);
  }

  async function extractCssImports(filePath: string) {
    const content = await readFile(filePath, "utf-8");
    const cssImports: string[] = [];

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

  async function extractComponentImports(filePath: string) {
    const content = await readFile(filePath, "utf-8");
    const imports: string[] = [];

    const importRegex = /import\s+(?:{[^}]+}|\w+)\s+from\s+['"]([^'"]+)['"]/g;
    let match;
    while ((match = importRegex.exec(content)) !== null) {
      const importPath = match[1];
      if (
        importPath.startsWith("./") ||
        importPath.startsWith("../") ||
        importPath.startsWith("#")
      ) {
        imports.push(importPath);
      }
    }

    return imports;
  }

  async function resolveImportPath(importPath: string, fromFile: string) {
    const fromDir = fromFile.split("/").slice(0, -1).join("/");

    if (importPath.startsWith("#")) {
      const imports = await getPackageImports();
      for (const [alias, target] of Object.entries(imports)) {
        if (importPath === alias || importPath.startsWith(alias + "/")) {
          const relativePath = importPath.slice(alias.length + 1);
          const baseDir = target;
          const extensions = [".tsx", ".ts", "/index.tsx", "/index.ts"];
          for (const ext of extensions) {
            const fullPath = relativePath ? join(baseDir, relativePath + ext) : baseDir + ext;
            if (await exists(fullPath)) {
              return fullPath;
            }
          }
          const fullPath = relativePath ? join(baseDir, relativePath) : baseDir;
          if (await exists(fullPath)) {
            return fullPath;
          }
          return null;
        }
      }
      return null;
    }

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

  async function extractAllCssImports(filePath: string, visited: Set<string> = new Set()) {
    if (visited.has(filePath)) {
      return [];
    }
    visited.add(filePath);

    const allCss: string[] = [];
    const fileDir = filePath.split("/").slice(0, -1).join("/");

    const cssImports = await extractCssImports(filePath);
    for (const cssImport of cssImports) {
      const cssPath = join(fileDir, cssImport);
      if (cssPath.startsWith(appDir)) {
        allCss.push(cssPath.replace(appDir + "/", "./"));
      } else {
        allCss.push(cssImport);
      }
    }

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

  /** Detects `define(_, { shadow: true })` in a client component file. */
  async function detectShadowOption(filePath: string) {
    const content = await readFile(filePath, "utf-8");
    return /define\s*\([^)]*\{[^}]*shadow\s*:\s*true/.test(content);
  }

  return {
    scanFiles,
    getPackageImports,
    findRouteModules,
    findLayouts,
    findErrorFile,
    findClientComponents,
    extractCssImports,
    extractComponentImports,
    resolveImportPath,
    extractAllCssImports,
    detectShadowOption,
  };
}
