import { join } from "node:path";
import { createProgram, validateModule, type ValidationResult } from "./ast.ts";
import { parsePath } from "./paths.ts";

export async function validateRoutes(routeFiles: string[], layoutFiles: string[], appDir: string) {
  const allFiles = [
    ...routeFiles.map((f) => join(appDir, f)),
    ...layoutFiles.map((f) => join(appDir, f)),
  ];

  if (allFiles.length === 0) return true;

  const program = createProgram(allFiles);
  const results: ValidationResult[] = [];

  for (const file of [...routeFiles, ...layoutFiles]) {
    const result = validateModule(program, file, appDir);
    results.push(result);
  }

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

export function generateRoutesTypeFile(routeFiles: string[]) {
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

  return /* ts */ `
    /**
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
