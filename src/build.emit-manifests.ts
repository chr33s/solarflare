import ts from "typescript";
import { parsePath } from "./paths.ts";
import { generateTypedModulesFile, validateModule, type ModuleEntry } from "./ast.ts";

export function generateModulesFile(
  program: ts.Program,
  routeFiles: string[],
  layoutFiles: string[],
  errorFile: string | null,
  appDir: string,
): { content: string; errors: string[] } {
  const allFiles = [...layoutFiles, ...routeFiles];

  if (errorFile) {
    allFiles.push(errorFile);
  }

  const entries: ModuleEntry[] = allFiles.map((file) => ({
    path: file,
    parsed: parsePath(file),
    validation: validateModule(program, file, appDir),
  }));

  return generateTypedModulesFile(entries);
}
