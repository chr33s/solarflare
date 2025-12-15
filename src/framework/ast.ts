/**
 * Solarflare AST Utilities
 * Unified TypeScript Compiler API utilities for path parsing, type validation, and code generation
 */
import { join } from "path";
import ts from "typescript";
import { parsePath, type ParsedPath, type ModuleKind } from "./paths";

// ============================================================================
// Program & Type Checker Utilities
// ============================================================================

/**
 * Compiler options for Solarflare TypeScript analysis
 */
export const COMPILER_OPTIONS: ts.CompilerOptions = {
  target: ts.ScriptTarget.Latest,
  module: ts.ModuleKind.ESNext,
  jsx: ts.JsxEmit.ReactJSX,
  jsxImportSource: "preact",
  strict: true,
  skipLibCheck: true,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  noEmit: true, // Don't emit any files during analysis
};

/**
 * Create a shared TypeScript program for analyzing multiple files
 */
export function createProgram(files: string[]): ts.Program {
  return ts.createProgram(files, COMPILER_OPTIONS);
}

/**
 * Get the type checker from a program
 */
export function getChecker(program: ts.Program): ts.TypeChecker {
  return program.getTypeChecker();
}

// ============================================================================
// Export Analysis
// ============================================================================

/**
 * Information about a module's default export
 */
export interface ExportInfo {
  /** The TypeScript type of the export */
  type: ts.Type;
  /** Call signatures if the export is callable */
  signatures: readonly ts.Signature[];
  /** String representation of the type */
  typeString: string;
  /** Whether the export is a function */
  isFunction: boolean;
  /** Parameter types if it's a function */
  parameters: ParameterInfo[];
  /** Return type if it's a function */
  returnType: string | null;
}

/**
 * Information about a function parameter
 */
export interface ParameterInfo {
  name: string;
  type: string;
  optional: boolean;
  properties: string[];
}

/**
 * Get detailed information about a module's default export
 */
export function getDefaultExportInfo(
  checker: ts.TypeChecker,
  sourceFile: ts.SourceFile,
): ExportInfo | null {
  const symbol = checker.getSymbolAtLocation(sourceFile);
  if (!symbol) return null;

  const exports = checker.getExportsOfModule(symbol);
  const defaultExport = exports.find((e) => e.escapedName === "default");
  if (!defaultExport) return null;

  const type = checker.getTypeOfSymbolAtLocation(defaultExport, sourceFile);
  const signatures = type.getCallSignatures();
  const typeString = checker.typeToString(type);
  const isFunction = signatures.length > 0;

  const parameters: ParameterInfo[] = [];
  let returnType: string | null = null;

  if (isFunction && signatures.length > 0) {
    const sig = signatures[0];
    returnType = checker.typeToString(sig.getReturnType());

    for (const param of sig.getParameters()) {
      const paramType = checker.getTypeOfSymbolAtLocation(param, sourceFile);
      const properties = paramType.getProperties().map((p) => p.getName());

      parameters.push({
        name: param.getName(),
        type: checker.typeToString(paramType),
        optional: !!(param.flags & ts.SymbolFlags.Optional),
        properties,
      });
    }
  }

  return {
    type,
    signatures,
    typeString,
    isFunction,
    parameters,
    returnType,
  };
}

// ============================================================================
// Module Validation
// ============================================================================

/**
 * Validation result for a module
 */
export interface ValidationResult {
  file: string;
  kind: ModuleKind;
  valid: boolean;
  errors: string[];
  warnings: string[];
  exportInfo: ExportInfo | null;
}

/**
 * Validate a module against expected patterns
 */
export function validateModule(
  program: ts.Program,
  filePath: string,
  baseDir: string = "./src/app",
): ValidationResult {
  const fullPath = join(baseDir, filePath);
  const sourceFile = program.getSourceFile(fullPath);
  const checker = program.getTypeChecker();
  const parsed = parsePath(filePath);

  const result: ValidationResult = {
    file: filePath,
    kind: parsed.kind,
    valid: true,
    errors: [],
    warnings: [],
    exportInfo: null,
  };

  if (!sourceFile) {
    result.valid = false;
    result.errors.push(`Source file not found: ${fullPath}`);
    return result;
  }

  const exportInfo = getDefaultExportInfo(checker, sourceFile);
  result.exportInfo = exportInfo;

  if (!exportInfo) {
    result.valid = false;
    result.errors.push("Missing default export");
    return result;
  }

  // Validate based on module kind
  switch (parsed.kind) {
    case "server":
      validateServerModule(result, exportInfo);
      break;
    case "client":
      validateClientModule(result, exportInfo);
      break;
    case "layout":
      validateLayoutModule(result, exportInfo);
      break;
  }

  return result;
}

/**
 * Validate a server module
 */
function validateServerModule(result: ValidationResult, exportInfo: ExportInfo): void {
  if (!exportInfo.isFunction) {
    result.valid = false;
    result.errors.push("Default export must be a function");
    return;
  }

  if (exportInfo.parameters.length < 1) {
    result.warnings.push("Server loader should accept (request, params?, env?) parameters");
  }

  // Check first param is Request-like
  const firstParam = exportInfo.parameters[0];
  if (firstParam && !firstParam.type.includes("Request") && firstParam.type !== "any") {
    result.warnings.push(`First parameter should be Request, got ${firstParam.type}`);
  }
}

/**
 * Validate a client module
 */
function validateClientModule(result: ValidationResult, exportInfo: ExportInfo): void {
  if (!exportInfo.isFunction) {
    result.valid = false;
    result.errors.push("Default export must be a function component");
    return;
  }

  // Check return type is JSX-like
  if (
    exportInfo.returnType &&
    !exportInfo.returnType.includes("VNode") &&
    !exportInfo.returnType.includes("Element") &&
    !exportInfo.returnType.includes("JSX") &&
    exportInfo.returnType !== "null" &&
    exportInfo.returnType !== "any"
  ) {
    result.warnings.push(`Component should return JSX, got ${exportInfo.returnType}`);
  }
}

/**
 * Validate a layout module
 */
function validateLayoutModule(result: ValidationResult, exportInfo: ExportInfo): void {
  if (!exportInfo.isFunction) {
    result.valid = false;
    result.errors.push("Default export must be a function component");
    return;
  }

  if (exportInfo.parameters.length === 0) {
    result.warnings.push("Layout should accept { children } prop");
    return;
  }

  // Check first param has 'children' property
  const firstParam = exportInfo.parameters[0];
  if (!firstParam.properties.includes("children")) {
    result.warnings.push('Layout props should include "children"');
  }
}

// ============================================================================
// Code Generation
// ============================================================================

/**
 * Module entry for code generation
 */
export interface ModuleEntry {
  path: string;
  parsed: ParsedPath;
  validation: ValidationResult | null;
}

// ============================================================================
// Type Declarations
// ============================================================================

/**
 * Generate TypeScript type declaration for a module kind
 */
export function getTypeDeclaration(kind: ModuleKind): string {
  switch (kind) {
    case "server":
      return "(request: Request, params: Record<string, string>, env: Env) => Response | Promise<Response> | Record<string, unknown> | Promise<Record<string, unknown>>";
    case "client":
      return '(props: any) => import("preact").VNode';
    case "layout":
      return '(props: { children: import("preact").VNode }) => import("preact").VNode';
    default:
      return "unknown";
  }
}

/**
 * Generate a complete type-safe modules file
 */
export function generateTypedModulesFile(entries: ModuleEntry[]): {
  content: string;
  errors: string[];
} {
  const errors: string[] = [];

  // Group by kind
  const serverModules = entries.filter((e) => e.parsed.kind === "server");
  const clientModules = entries.filter((e) => e.parsed.kind === "client");
  const layoutModules = entries.filter((e) => e.parsed.kind === "layout");

  // Check for validation errors
  for (const entry of entries) {
    if (entry.validation && !entry.validation.valid) {
      for (const error of entry.validation.errors) {
        errors.push(`${entry.path}: ${error}`);
      }
    }
  }

  const generateEntries = (modules: ModuleEntry[]) =>
    modules
      .map(
        (m) => `    './${m.parsed.normalized}': () => import('../src/app/${m.parsed.normalized}')`,
      )
      .join(",\n");

  const content = `/**
 * Auto-generated route modules
 * Pre-resolved imports for Cloudflare Workers compatibility
 *
 * Module types validated via AST analysis:
 * - Server modules: ${serverModules.length}
 * - Client modules: ${clientModules.length}
 * - Layout modules: ${layoutModules.length}
 */

type ServerLoader = ${getTypeDeclaration("server")}
type ClientComponent = ${getTypeDeclaration("client")}
type LayoutComponent = ${getTypeDeclaration("layout")}

interface ModuleMap {
  server: Record<string, () => Promise<{ default: ServerLoader }>>
  client: Record<string, () => Promise<{ default: ClientComponent }>>
  layout: Record<string, () => Promise<{ default: LayoutComponent }>>
}

const modules: ModuleMap = {
  server: {
${generateEntries(serverModules)}
  },
  client: {
${generateEntries(clientModules)}
  },
  layout: {
${generateEntries(layoutModules)}
  },
}

export default modules
`;

  return { content, errors };
}
