/**
 * Extend ImportMeta with glob support
 */
interface ImportMeta {
  glob<T = { default: unknown }>(
    pattern: string,
    options?: { eager?: boolean }
  ): Record<string, () => Promise<T>>;
}

declare module '*.css' {
  const classNames: Record<string, string>;
  export default classNames;
}

declare module '*.gif' {
  const image: string;
  export default image;
}

declare module '*.html' {
  const html: string;
  export default html;
}

declare module '*.ico' {
  const image: string;
  export default image;
}

declare module '*.jpeg' {
  const image: string;
  export default image;
}

declare module '*.jpg' {
  const image: string;
  export default image;
}

declare module '*.png' {
  const image: string;
  export default image;
}

declare module '*.svg' {
  const image: any;
  export default image;
}

/**
 * Solarflare Framework Types
 */
declare module 'solarflare/client' {
  import { FunctionComponent, Context } from 'preact';

  /**
   * Parsed tag metadata from file path
   */
  export interface TagMeta {
    /** Generated custom element tag name */
    tag: string;
    /** Original file path */
    filePath: string;
    /** Route segments extracted from path */
    segments: string[];
    /** Dynamic parameter names (from $param segments) */
    paramNames: string[];
    /** Whether this is the root/index component */
    isRoot: boolean;
    /** Component type based on file suffix */
    type: 'client' | 'server' | 'unknown';
  }

  /**
   * Validation result for tag generation
   */
  export interface TagValidation {
    /** Whether the tag is valid */
    valid: boolean;
    /** Validation errors */
    errors: string[];
    /** Validation warnings */
    warnings: string[];
  }

  export interface DefineOptions {
    /** Custom element tag name. Defaults to generated from file path */
    tag?: string;
    /** Whether to use Shadow DOM. Defaults to false */
    shadow?: boolean;
    /** Observed attributes to pass as props. Auto-extracted if not provided */
    observedAttributes?: string[];
    /** Whether to validate the tag and warn on issues. Defaults to true in development */
    validate?: boolean;
  }

  /**
   * Registration result with metadata for debugging
   */
  export interface DefineResult<P> {
    /** The registered component */
    Component: FunctionComponent<P>;
    /** Tag metadata */
    meta: TagMeta;
    /** Validation result */
    validation: TagValidation;
    /** Whether registration succeeded */
    registered: boolean;
  }

  /**
   * Parse file path into structured tag metadata
   */
  export function parseTagMeta(path: string): TagMeta;

  /**
   * Validate a generated tag against web component naming rules
   */
  export function validateTag(meta: TagMeta): TagValidation;

  /**
   * Generate custom element tag from file path with validation
   */
  export function pathToTagName(path: string): string;

  /**
   * Build-time macro that registers a Preact component as a web component
   */
  export function define<P extends Record<string, any>>(
    Component: FunctionComponent<P>,
    options?: DefineOptions
  ): FunctionComponent<P>;

  /**
   * Define with full metadata result (for debugging/testing)
   */
  export function defineWithMeta<P extends Record<string, any>>(
    Component: FunctionComponent<P>,
    options?: DefineOptions
  ): DefineResult<P>;

  /**
   * Hook to access current route params
   */
  export function useParams(): Record<string, string>;

  /**
   * Hook to access parsed data attribute
   */
  export function useData<T>(): T;

  export const ParamsContext: Context<Record<string, string>>;
  export const DataContext: Context<unknown>;
}

declare module 'solarflare/server' {
  import { VNode, FunctionComponent } from 'preact';

  /**
   * Route parameter definition extracted from pattern
   */
  export interface RouteParamDef {
    /** Parameter name (e.g., "slug" from ":slug") */
    name: string;
    /** Whether the parameter is optional */
    optional: boolean;
    /** Original segment in the pattern */
    segment: string;
  }

  /**
   * Parsed route pattern with type information
   */
  export interface ParsedPattern {
    /** Original file path */
    filePath: string;
    /** URLPattern pathname */
    pathname: string;
    /** Extracted parameter definitions */
    params: RouteParamDef[];
    /** Whether this is a static route (no params) */
    isStatic: boolean;
    /** Route specificity score for sorting */
    specificity: number;
  }

  /**
   * Route definition with parsed pattern metadata
   */
  export interface Route {
    /** URLPattern for matching requests */
    pattern: URLPattern;
    /** Parsed pattern with type information */
    parsedPattern: ParsedPattern;
    /** Original file path */
    path: string;
    /** Custom element tag name */
    tag: string;
    /** Dynamic module loader */
    loader: () => Promise<{ default: unknown }>;
    /** Route type: client or server */
    type: 'client' | 'server';
  }

  /**
   * Validated route match with type-safe params
   */
  export interface RouteMatch {
    /** Matched route */
    route: Route;
    /** Extracted URL parameters (validated against pattern definition) */
    params: Record<string, string>;
    /** Parameter definitions from the route pattern */
    paramDefs: RouteParamDef[];
    /** Whether all required params were matched */
    complete: boolean;
  }

  /**
   * Layout definition with hierarchy information
   */
  export interface Layout {
    /** Layout file path */
    path: string;
    /** Dynamic layout loader */
    loader: () => Promise<{ default: unknown }>;
    /** Nesting depth (0 = root) */
    depth: number;
    /** Directory this layout applies to */
    directory: string;
  }

  /**
   * Layout hierarchy result with validation metadata
   */
  export interface LayoutHierarchy {
    /** Ordered layouts from root to leaf */
    layouts: Layout[];
    /** Route path segments */
    segments: string[];
    /** Directories checked for layouts */
    checkedPaths: string[];
  }

  /**
   * Structured module map with typed categories
   */
  export interface ModuleMap {
    server: Record<string, () => Promise<{ default: unknown }>>;
    client: Record<string, () => Promise<{ default: unknown }>>;
    layout: Record<string, () => Promise<{ default: unknown }>>;
  }

  /**
   * Parse file path into structured pattern metadata
   */
  export function parsePattern(filePath: string): ParsedPattern;

  /**
   * Convert file path to URLPattern pathname
   */
  export function pathToPattern(filePath: string): string;

  /**
   * Generate custom element tag from file path
   */
  export function pathToTag(filePath: string): string;

  /**
   * Flatten a structured ModuleMap into a flat record
   */
  export function flattenModules(
    modules: ModuleMap
  ): Record<string, () => Promise<{ default: unknown }>>;

  /**
   * Create router from structured module map
   */
  export function createRouter(modules: ModuleMap): Route[];

  /**
   * Find all ancestor layouts for a route path with hierarchy metadata
   */
  export function findLayoutHierarchy(
    routePath: string,
    modules: Record<string, () => Promise<{ default: unknown }>>
  ): LayoutHierarchy;

  /**
   * Find all ancestor layouts for a route path using structured module map
   */
  export function findLayouts(routePath: string, modules: ModuleMap): Layout[];

  /**
   * Match URL against routes using URLPattern with parameter validation
   */
  export function matchRoute(routes: Route[], url: URL): RouteMatch | null;

  /**
   * Marker for asset injection - will be replaced with actual script/style tags
   */
  export const ASSETS_MARKER: string;

  /**
   * Assets placeholder component
   * Place this in your root layout's <head> to inject route-specific CSS and scripts
   */
  export function Assets(): VNode<any>;

  /**
   * Layout props - just children, assets are injected separately via <Assets />
   */
  export interface LayoutProps {
    children: VNode<any>;
  }

  /**
   * Wrap content in nested layouts
   * @param content - The content to wrap
   * @param layouts - The layouts to apply
   */
  export function wrapWithLayouts(
    content: VNode<any>,
    layouts: Layout[]
  ): Promise<VNode<any>>;

  /**
   * Generate asset HTML tags for injection
   */
  export function generateAssetTags(script?: string, styles?: string[]): string;

  /**
   * Render a component with its tag wrapper for hydration
   */
  export function renderComponent(
    Component: FunctionComponent<any>,
    tag: string,
    props: Record<string, unknown>
  ): VNode<any>;

  /**
   * Parse URL parameters from a request URL using URLPattern
   */
  export function parse(request: Request): Record<string, string>;
}

declare module 'solarflare/worker' {
  import { ModuleMap } from 'solarflare/server';

  /**
   * Cloudflare Worker fetch handler
   * Routes are auto-discovered at build time from the generated modules
   */
  const worker: (request: Request, env: Env) => Promise<Response>;

  export default worker;
}

declare module 'solarflare/ast' {
  import ts from 'typescript';

  /**
   * Compiler options for Solarflare TypeScript analysis
   */
  export const COMPILER_OPTIONS: ts.CompilerOptions;

  /**
   * Create a shared TypeScript program for analyzing multiple files
   */
  export function createProgram(files: string[]): ts.Program;

  /**
   * Module kind based on file naming convention
   */
  export type ModuleKind = 'server' | 'client' | 'layout' | 'unknown';

  /**
   * Parsed path information with AST-validated metadata
   */
  export interface ParsedPath {
    /** Original file path */
    original: string;
    /** Normalized path (without leading ./) */
    normalized: string;
    /** Module kind based on file suffix */
    kind: ModuleKind;
    /** Route segments */
    segments: string[];
    /** Dynamic parameter names (from $param) */
    params: string[];
    /** Whether this is an index/root route */
    isIndex: boolean;
    /** Whether this is a private file (_prefixed) */
    isPrivate: boolean;
    /** URLPattern pathname */
    pattern: string;
    /** Custom element tag name */
    tag: string;
    /** Route specificity score */
    specificity: number;
  }

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
   * Module entry for code generation
   */
  export interface ModuleEntry {
    path: string;
    parsed: ParsedPath;
    validation: ValidationResult | null;
  }

  /**
   * Parse a file path into structured metadata
   */
  export function parsePath(filePath: string): ParsedPath;

  /**
   * Determine module kind from file path
   */
  export function getModuleKind(filePath: string): ModuleKind;

  /**
   * Get detailed information about a module's default export
   */
  export function getDefaultExportInfo(
    checker: ts.TypeChecker,
    sourceFile: ts.SourceFile
  ): ExportInfo | null;

  /**
   * Validate a module against expected patterns
   */
  export function validateModule(
    program: ts.Program,
    filePath: string,
    baseDir?: string
  ): ValidationResult;

  /**
   * Find paired modules for a given path
   */
  export function findPairedModules(
    filePath: string,
    availableModules: string[]
  ): {
    client: string | null;
    server: string | null;
    layouts: string[];
  };

  /**
   * Generate a complete type-safe modules file
   */
  export function generateTypedModulesFile(entries: ModuleEntry[]): {
    content: string;
    errors: string[];
  };

  /**
   * Validate generated code by parsing it
   */
  export function validateGeneratedCode(
    code: string,
    filename?: string
  ): {
    valid: boolean;
    errors: ts.Diagnostic[];
  };
}
