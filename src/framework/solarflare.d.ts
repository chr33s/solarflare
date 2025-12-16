/**
 * Extend ImportMeta with glob support
 */
interface ImportMeta {
  glob<T = { default: unknown }>(
    pattern: string,
    options?: { eager?: boolean },
  ): Record<string, () => Promise<T>>;
}

declare module "*.css" {
  const classNames: Record<string, string>;
  export default classNames;
}

declare module "*.gif" {
  const image: string;
  export default image;
}

declare module "*.html" {
  const html: string;
  export default html;
}

declare module "*.ico" {
  const image: string;
  export default image;
}

declare module "*.jpeg" {
  const image: string;
  export default image;
}

declare module "*.jpg" {
  const image: string;
  export default image;
}

declare module "*.png" {
  const image: string;
  export default image;
}

declare module "*.svg" {
  const image: any;
  export default image;
}

/**
 * Solarflare Framework Types
 */
declare module "solarflare/client" {
  import { FunctionComponent } from "preact";
  import { ReadonlySignal, Signal } from "@preact/signals";

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
    type: "client" | "server" | "unknown";
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
   * Server-rendered data passed to components
   */
  export interface ServerData<T = unknown> {
    /** The actual data payload */
    data: T;
    /** Whether data is still loading (for streaming) */
    loading: boolean;
    /** Error if data fetch failed */
    error: Error | null;
  }

  /**
   * Store configuration
   */
  export interface StoreConfig {
    /** Initial route params */
    params?: Record<string, string>;
    /** Initial server data */
    serverData?: unknown;
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
   * Build-time macro that registers a Preact component as a web component
   */
  export function define<P extends Record<string, any>>(
    Component: FunctionComponent<P>,
    options?: DefineOptions,
  ): FunctionComponent<P>;

  /**
   * Initialize client-side store from SSR hydration data
   */
  export function initClient(): Promise<void>;

  // Signals
  export const params: ReadonlySignal<Record<string, string>>;
  export const serverData: ReadonlySignal<ServerData<unknown>>;
  export const pathname: ReadonlySignal<string>;

  // Actions
  export function initStore(config?: StoreConfig): void;
  export function setParams(newParams: Record<string, string>): void;
  export function setServerData<T>(data: T): void;
  export function setPathname(path: string): void;
  export function hydrateStore(): Promise<void>;
  export function resetStore(): void;

  // Data islands
  export function serializeDataIsland(id: string, data: unknown): Promise<string>;
  export function extractDataIsland<T = unknown>(id: string): Promise<T | null>;

  // Hydration coordinator
  export function hydrateComponent(tag: string, dataIslandId?: string): Promise<void>;
  export function initHydrationCoordinator(): void;

  // Re-exports from signals
  export function signal<T>(value: T): Signal<T>;
  export function computed<T>(fn: () => T): ReadonlySignal<T>;
  export function effect(fn: () => void | (() => void)): () => void;
  export function batch(fn: () => void): void;

  export type { ReadonlySignal, Signal };

  // Router re-exports
  export interface RouteManifestEntry {
    pattern: string;
    tag: string;
    chunk?: string;
    styles?: string[];
    type: "client" | "server";
    params: string[];
  }

  export interface RoutesManifest {
    routes: RouteManifestEntry[];
    base?: string;
  }

  export interface RouteMatch {
    entry: RouteManifestEntry;
    params: Record<string, string>;
    url: URL;
  }

  export interface NavigateOptions {
    replace?: boolean;
    state?: unknown;
    skipTransition?: boolean;
  }

  export interface RouterConfig {
    base?: string;
    viewTransitions?: boolean;
    scrollBehavior?: "auto" | "smooth" | "instant" | false;
    onNotFound?: (url: URL) => void;
    onNavigate?: (match: RouteMatch) => void;
    onError?: (error: Error, url: URL) => void;
  }

  export type RouteSubscriber = (match: RouteMatch | null) => void;

  export function supportsViewTransitions(): boolean;

  export class Router {
    readonly current: Signal<RouteMatch | null>;
    readonly params: ReadonlySignal<Record<string, string>>;
    readonly pathname: ReadonlySignal<string>;

    constructor(manifest: RoutesManifest, config?: RouterConfig);
    match(url: URL): RouteMatch | null;
    navigate(to: string | URL, options?: NavigateOptions): Promise<void>;
    start(): this;
    stop(): this;
    subscribe(callback: RouteSubscriber): () => void;
    back(): void;
    forward(): void;
    go(delta: number): void;
    isActive(path: string, exact?: boolean): boolean;
    isActiveSignal(path: string, exact?: boolean): ReadonlySignal<boolean>;
  }

  export function createRouter(manifest: RoutesManifest, config?: RouterConfig): Router;
  export function initRouter(manifest: RoutesManifest, config?: RouterConfig): Router;
  export function getRouter(): Router;
  export function navigate(to: string | URL, options?: NavigateOptions): Promise<void>;
  export function isActive(path: string, exact?: boolean): boolean;
}

declare module "solarflare/server" {
  import { VNode, FunctionComponent } from "preact";
  import { ReadonlySignal } from "@preact/signals";

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
    type: "client" | "server";
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
    error?: () => Promise<{ default: unknown }>;
  }

  /**
   * Error page props interface
   */
  export interface ErrorPageProps {
    error: Error;
    url?: URL;
    statusCode?: number;
    reset?: () => void;
  }

  /**
   * Render an error page wrapped in layouts
   */
  export function renderErrorPage(
    error: Error,
    url: URL,
    modules: ModuleMap,
    statusCode?: number,
  ): Promise<VNode<any>>;

  /**
   * Parse file path into structured pattern metadata
   */
  export function parsePattern(filePath: string): ParsedPattern;

  /**
   * Create router from structured module map
   */
  export function createRouter(modules: ModuleMap): Route[];

  /**
   * Find all ancestor layouts for a route path with hierarchy metadata
   */
  export function findLayoutHierarchy(
    routePath: string,
    modules: Record<string, () => Promise<{ default: unknown }>>,
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
   */
  export function wrapWithLayouts(content: VNode<any>, layouts: Layout[]): Promise<VNode<any>>;

  /**
   * Generate asset HTML tags for injection
   */
  export function generateAssetTags(
    script?: string,
    styles?: string[],
    devScripts?: string[],
  ): string;

  /**
   * Render a component with its tag wrapper for hydration
   */
  export function renderComponent(
    Component: FunctionComponent<any>,
    tag: string,
    props: Record<string, unknown>,
  ): VNode<any>;

  /**
   * Server-rendered data passed to components
   */
  export interface ServerData<T = unknown> {
    data: T;
    loading: boolean;
    error: Error | null;
  }

  /**
   * Store configuration
   */
  export interface StoreConfig {
    params?: Record<string, string>;
    serverData?: unknown;
  }

  /**
   * Deferred data configuration for streaming
   */
  export interface DeferredData {
    tag: string;
    promise: Promise<Record<string, unknown>>;
  }

  /**
   * Options for streaming rendering
   */
  export interface StreamRenderOptions {
    params?: Record<string, string>;
    serverData?: unknown;
    pathname?: string;
    script?: string;
    styles?: string[];
    devScripts?: string[];
    deferred?: DeferredData;
  }

  /**
   * Extended stream interface with allReady promise
   */
  export interface SolarflareStream extends ReadableStream<Uint8Array> {
    allReady: Promise<void>;
  }

  /**
   * Initialize server-side store with request context
   */
  export function initServerContext(options: StreamRenderOptions): void;

  /**
   * Render a VNode to a streaming response with automatic asset injection
   */
  export function renderToStream(
    vnode: VNode<any>,
    options?: StreamRenderOptions,
  ): Promise<SolarflareStream>;

  // Store utilities
  export const params: ReadonlySignal<Record<string, string>>;
  export const serverData: ReadonlySignal<ServerData<unknown>>;
  export const pathname: ReadonlySignal<string>;
  export function initStore(config?: StoreConfig): void;
  export function setParams(newParams: Record<string, string>): void;
  export function setServerData<T>(data: T): void;
  export function setPathname(path: string): void;
  export function resetStore(): void;
  export function serializeStoreForHydration(): Promise<string>;
  export function serializeDataIsland(id: string, data: unknown): Promise<string>;
}

declare module "solarflare/worker" {
  import { ModuleMap } from "solarflare/server";

  /**
   * Cloudflare Worker fetch handler
   * Routes are auto-discovered at build time from the generated modules
   * Uses streaming SSR for improved TTFB
   */
  const worker: (request: Request, env: Env) => Promise<Response>;

  export default worker;
}
