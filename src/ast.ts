import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { API, SignatureKind, SymbolFlags } from "typescript/unstable/sync";
import type { Checker, Project, Signature, Type } from "typescript/unstable/sync";
import type { Node, SourceFile } from "typescript/unstable/ast";
import { parsePath, type ParsedPath, type ModuleKind } from "./paths.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_TSCONFIG = join(__dirname, "..", "tsconfig.json");

/**
 * A minimal view over a tsgo {@link Project} that mirrors the subset of the
 * classic `ts.Program` surface the build tooling relies on. TypeScript 7 no
 * longer exposes an in-process program built from an arbitrary file list; the
 * native compiler is driven through {@link API}, whose projects are discovered
 * from a `tsconfig.json`. This facade keeps `createProgram`'s call sites
 * unchanged.
 */
export interface Program {
  getTypeChecker(): Checker;
  getSourceFile(fileName: string): SourceFile | undefined;
}

let api: API | undefined;

function getApi() {
  api ??= new API({ cwd: process.cwd() });
  return api;
}

function toProgram(project: Project | undefined): Program {
  return {
    getTypeChecker: () => {
      if (!project) throw new Error("No TypeScript project available");
      return project.checker;
    },
    getSourceFile: (fileName) => project?.program.getSourceFile(fileName),
  };
}

/**
 * Loads the TypeScript project covering `files` and returns a {@link Program}
 * facade over it. When called with no files (e.g. in tests), the framework's
 * own `tsconfig.json` project is loaded instead. The files' own `tsconfig.json`
 * is discovered from their location, so its `compilerOptions` (jsx, lib, …) are
 * honoured — replacing the previously hand-passed compiler options.
 */
export function createProgram(files: string[]) {
  const client = getApi();

  if (files.length === 0) {
    const snapshot = client.updateSnapshot({ openProjects: [DEFAULT_TSCONFIG] });
    return toProgram(snapshot.getProject(DEFAULT_TSCONFIG) ?? snapshot.getProjects()[0]);
  }

  const snapshot = client.updateSnapshot({ openFiles: files });
  return toProgram(snapshot.getDefaultProjectForFile(files[0]) ?? snapshot.getProjects()[0]);
}

export interface ExportInfo {
  type: Type;
  signatures: readonly Signature[];
  typeString: string;
  isFunction: boolean;
  parameters: ParameterInfo[];
  returnType: string | null;
}

export interface ParameterInfo {
  name: string;
  type: string;
  optional: boolean;
  properties: string[];
}

function getSignatureParameterInfo(checker: Checker, signature: Signature, location: Node) {
  const parameters: ParameterInfo[] = [];

  for (const param of signature.getParameters()) {
    const paramType = checker.getTypeOfSymbolAtLocation(param, location);
    const properties = checker.getPropertiesOfType(paramType).map((p) => p.name);

    parameters.push({
      name: param.name,
      type: checker.typeToString(paramType),
      optional: !!(param.flags & SymbolFlags.Optional),
      properties,
    });
  }

  const returnType = checker.getReturnTypeOfSignature(signature);

  return {
    parameters,
    returnType: returnType ? checker.typeToString(returnType) : "",
  };
}

/** Gets detailed information about a module's default export. */
export function getDefaultExportInfo(checker: Checker, sourceFile: SourceFile) {
  const symbol = checker.getSymbolAtLocation(sourceFile);
  if (!symbol) return null;

  const exports = checker.getExportsOfModule(symbol);
  const defaultExport = exports.find((e) => e.escapedName === "default");
  if (!defaultExport) return null;

  const type = checker.getTypeOfSymbolAtLocation(defaultExport, sourceFile);
  const signatures = checker.getSignaturesOfType(type, SignatureKind.Call);
  const typeString = checker.typeToString(type);
  const signature = signatures.length > 0 ? signatures[0] : null;
  const isFunction = !!signature;

  const parameters: ParameterInfo[] = [];
  let returnType: string | null = null;

  if (isFunction && signature) {
    const info = getSignatureParameterInfo(checker, signature, sourceFile);
    parameters.push(...info.parameters);
    returnType = info.returnType;
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

export interface ValidationResult {
  file: string;
  kind: ModuleKind;
  valid: boolean;
  errors: string[];
  warnings: string[];
  exportInfo: ExportInfo | null;
}

export function validateModule(program: Program, filePath: string, baseDir: string = "./src") {
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

function validateServerModule(result: ValidationResult, exportInfo: ExportInfo) {
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

function validateClientModule(result: ValidationResult, exportInfo: ExportInfo) {
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

function validateLayoutModule(result: ValidationResult, exportInfo: ExportInfo) {
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

export interface ModuleEntry {
  path: string;
  parsed: ParsedPath;
  validation: ValidationResult | null;
}

export function getTypeDeclaration(kind: ModuleKind) {
  switch (kind) {
    case "server":
      return "(request: Request, params: Record<string, string>, env: Env) => Response | Promise<Response> | Record<string, unknown> | Promise<Record<string, unknown>>";
    case "client":
      return '(props: any) => import("preact").VNode';
    case "layout":
      return '(props: { children: import("preact").VNode }) => import("preact").VNode';
    case "error":
      return '(props: { error: Error; url?: URL; statusCode?: number; reset?: () => void }) => import("preact").VNode';
    default:
      return "unknown";
  }
}

export function generateTypedModulesFile(entries: ModuleEntry[]) {
  const errors: string[] = [];

  // Group by kind
  const serverModules = entries.filter((e) => e.parsed.kind === "server");
  const clientModules = entries.filter((e) => e.parsed.kind === "client");
  const layoutModules = entries.filter((e) => e.parsed.kind === "layout");
  const errorModule = entries.find((e) => e.parsed.kind === "error");

  // Check for validation errors
  for (const entry of entries) {
    if (entry.validation && !entry.validation.valid) {
      for (const error of entry.validation.errors) {
        errors.push(`${entry.path}: ${error}`);
      }
    }
  }

  // Import paths are relative from dist/ to src/
  const generateEntries = (modules: ModuleEntry[]) =>
    modules
      .map((m) => `    './${m.parsed.normalized}': () => import('../src/${m.parsed.normalized}')`)
      .join(",\n");

  const errorEntry = errorModule
    ? `() => import('../src/${errorModule.parsed.normalized}')`
    : "undefined";

  const content = `/**
 * Auto-generated route modules
 * Pre-resolved imports for Cloudflare Workers compatibility
 *
 * Module types validated via AST analysis:
 * - Server modules: ${serverModules.length}
 * - Client modules: ${clientModules.length}
 * - Layout modules: ${layoutModules.length}
 * - Error module: ${errorModule ? "yes" : "no"}
 */

type ServerLoader = ${getTypeDeclaration("server")}
type ClientComponent = ${getTypeDeclaration("client")}
type LayoutComponent = ${getTypeDeclaration("layout")}
type ErrorComponent = ${getTypeDeclaration("error")}

interface ModuleMap {
  server: Record<string, () => Promise<{ default: ServerLoader }>>
  client: Record<string, () => Promise<{ default: ClientComponent }>>
  layout: Record<string, () => Promise<{ default: LayoutComponent }>>
  error?: () => Promise<{ default: ErrorComponent }>
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
  error: ${errorEntry},
}

export default modules
`;

  return { content, errors };
}
