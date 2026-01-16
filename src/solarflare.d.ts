interface ImportMeta {
  glob<T = { default: unknown }>(
    pattern: string,
    options?: { eager?: boolean },
  ): Record<string, () => Promise<T>>;
  /** The file path of the current module (Node runtime) */
  path?: string;
  /** Environment variables (bundler) */
  env?: {
    DEV?: boolean;
    PROD?: boolean;
    MODE?: string;
    [key: string]: unknown;
  };
}

/**
 * Globals used by Solarflare-generated client entries.
 * Kept intentionally loose to avoid leaking internal types.
 */
interface Window {
  /** Shared head context across per-route client chunks. */
  __sfHeadContext?: unknown;
  /** Legacy guard used by older generated entries. */
  __sfHeadInit?: boolean;
}

/** Shared server data shape used by client/server modules. */
interface SolarflareServerData<T = unknown> {
  data: T;
  loading: boolean;
  error: Error | null;
}

/** Shared store config used by client/server modules. */
interface SolarflareStoreConfig {
  params?: Record<string, string>;
  serverData?: unknown;
}

/** Shared routes manifest types used by client module exports. */
interface SolarflareRouteManifestEntry {
  pattern: string;
  tag: string;
  chunk?: string;
  styles?: string[];
  type: "client" | "server";
  params: string[];
}

interface SolarflareRoutesManifest {
  routes: SolarflareRouteManifestEntry[];
  base?: string;
}

interface SolarflareRouteMatch {
  entry: SolarflareRouteManifestEntry;
  params: Record<string, string>;
  url: URL;
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
declare module "@chr33s/solarflare/client" {
  import { FunctionComponent, VNode, Component } from "preact";
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
    data: SolarflareServerData<T>["data"];
    /** Whether data is still loading (for streaming) */
    loading: SolarflareServerData<T>["loading"];
    /** Error if data fetch failed */
    error: SolarflareServerData<T>["error"];
  }

  /**
   * Store configuration
   */
  export interface StoreConfig {
    /** Initial route params */
    params?: SolarflareStoreConfig["params"];
    /** Initial server data */
    serverData?: SolarflareStoreConfig["serverData"];
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

  /** Inline stylesheet entry for dev HMR registration. */
  export interface InlineStyleEntry {
    id: string;
    css: string;
  }

  /** Registers inline stylesheets for a component (dev HMR). */
  export function registerInlineStyles(tag: string, styles: InlineStyleEntry[]): void;

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
    pattern: SolarflareRouteManifestEntry["pattern"];
    tag: SolarflareRouteManifestEntry["tag"];
    chunk?: SolarflareRouteManifestEntry["chunk"];
    styles?: SolarflareRouteManifestEntry["styles"];
    type: SolarflareRouteManifestEntry["type"];
    params: SolarflareRouteManifestEntry["params"];
  }

  export interface RoutesManifest {
    routes: SolarflareRoutesManifest["routes"];
    base?: SolarflareRoutesManifest["base"];
  }

  export interface RouteMatch {
    entry: SolarflareRouteMatch["entry"];
    params: SolarflareRouteMatch["params"];
    url: SolarflareRouteMatch["url"];
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

  // ============================================================================
  // HMR (Hot Module Replacement) Utilities
  // ============================================================================

  /**
   * Options for creating an HMR wrapper component
   */
  export interface HMRWrapperOptions {
    /** Component tag name for identification */
    tag: string;
    /** Preserve scroll position across HMR updates. Defaults to true */
    preserveScroll?: boolean;
    /** Preserve hook state across HMR updates. Defaults to true */
    preserveHookState?: boolean;
    /** Custom error fallback UI */
    errorFallback?: (error: Error, retry: () => void) => VNode;
  }

  /**
   * HMR event detail structure
   */
  export interface HMREventDetail {
    /** Component tag that was updated */
    tag: string;
    /** Error that occurred (for error events) */
    error?: Error;
  }

  /**
   * HMR event types
   */
  export type HMREventType = "update" | "error" | "recover";

  // Hook state preservation
  /**
   * Saves hook state for a component before HMR update
   */
  export function saveHookState(componentId: string, hookState: unknown[]): void;

  /**
   * Restores hook state for a component after HMR update
   */
  export function restoreHookState(componentId: string): unknown[] | undefined;

  /**
   * Clears hook state for a component
   */
  export function clearHookState(componentId: string): void;

  /**
   * Gets or creates the ref storage for a component
   */
  export function getRefStorage(componentId: string): Map<number, unknown>;

  // Scroll position preservation
  /**
   * Saves current scroll position before HMR update
   */
  export function saveScrollPosition(tag?: string): void;

  /**
   * Restores scroll position after HMR update
   */
  export function restoreScrollPosition(tag?: string): void;

  /**
   * Clears stored scroll position
   */
  export function clearScrollPosition(tag?: string): void;

  // CSS HMR
  /**
   * Reloads a CSS file by updating its href with a cache-busting query
   */
  export function reloadStylesheet(href: string): void;

  /**
   * Reloads all linked stylesheets on the page
   */
  export function reloadAllStylesheets(): void;

  /**
   * Removes a stylesheet from the document
   */
  export function removeStylesheet(href: string): void;

  /**
   * Accepts CSS HMR updates. Returns cleanup function
   */
  export function acceptCssHMR(cssFiles: string[]): () => void;

  // HMR wrapper
  /**
   * Creates an HMR-enabled component wrapper with error boundary and state preservation
   */
  export function createHMRWrapper<P extends Record<string, unknown>>(
    hmrVersion: Signal<number>,
    getComponent: () => FunctionComponent<P>,
    options: HMRWrapperOptions,
  ): FunctionComponent<P>;

  // HMR events
  /**
   * Dispatches an HMR event for external listeners
   */
  export function dispatchHMREvent(type: HMREventType, detail: HMREventDetail): void;

  /**
   * Registers an HMR event listener. Returns unsubscribe function
   */
  export function onHMREvent(
    type: HMREventType,
    handler: (detail: HMREventDetail) => void,
  ): () => void;

  /**
   * Error boundary component that auto-recovers on HMR updates
   */
  export class HMRErrorBoundary extends Component<{
    children?: VNode;
    tag: string;
    hmrVersion: Signal<number>;
    fallback?: (error: Error, retry: () => void) => VNode;
  }> {}
}

declare module "@chr33s/solarflare/server" {
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
   * Marker for body injection - will be replaced with actual script/style tags
   */
  export const BODY_MARKER: string;

  /**
   * Body placeholder component
   * Place this at the end of your root layout's <body> to inject route-specific CSS and scripts
   */
  export function Body(): VNode<any>;

  /**
   * Layout props - just children, assets are injected separately via <Body />
   */
  export interface LayoutProps {
    children: VNode<any>;
  }

  // =========================================================================
  // Head Management
  // =========================================================================

  /**
   * Marker for head tag injection during streaming
   */
  export const HEAD_MARKER: string;

  /**
   * Supported head tag names
   */
  export type HeadTagName = "title" | "meta" | "link" | "script" | "base" | "style" | "noscript";

  /**
   * Tag priority for ordering (lower = earlier in head)
   */
  export type TagPriority = "critical" | "high" | number | "low";

  /**
   * Tag position in the document
   */
  export type TagPosition = "head" | "bodyOpen" | "bodyClose";

  /**
   * Head tag structure
   */
  export interface HeadTag {
    /** Tag name */
    tag: HeadTagName;
    /** Tag attributes/props */
    props: Record<string, string | boolean | null | undefined>;
    /** Inner content (for title, script, style) */
    textContent?: string;
    /** Deduplication key */
    key?: string;
    /** Priority for ordering */
    tagPriority?: TagPriority;
    /** Position in document */
    tagPosition?: TagPosition;
  }

  /**
   * Head input schema (similar to unhead)
   */
  export interface HeadInput {
    /** Document title */
    title?: string;
    /** Title template (function or string with %s placeholder) */
    titleTemplate?: string | ((title?: string) => string);
    /** Base element */
    base?: { href?: string; target?: string };
    /** Meta tags */
    meta?: Array<{
      charset?: string;
      name?: string;
      property?: string;
      "http-equiv"?: string;
      content?: string;
      key?: string;
    }>;
    /** Link tags */
    link?: Array<{
      rel?: string;
      href?: string;
      type?: string;
      sizes?: string;
      media?: string;
      crossorigin?: string;
      as?: string;
      key?: string;
    }>;
    /** Script tags */
    script?: Array<{
      src?: string;
      type?: string;
      async?: boolean;
      defer?: boolean;
      innerHTML?: string;
      key?: string;
    }>;
    /** Style tags */
    style?: Array<{
      type?: string;
      media?: string;
      innerHTML?: string;
      key?: string;
    }>;
    /** HTML element attributes */
    htmlAttrs?: Record<string, string>;
    /** Body element attributes */
    bodyAttrs?: Record<string, string>;
  }

  /**
   * Active head entry with lifecycle methods
   */
  export interface ActiveHeadEntry {
    /** Update the head entry */
    patch: (input: Partial<HeadInput>) => void;
    /** Remove the head entry */
    dispose: () => void;
  }

  /**
   * Head entry options
   */
  export interface HeadEntryOptions {
    /** Priority of tags */
    tagPriority?: TagPriority;
    /** Position of tags */
    tagPosition?: TagPosition;
  }

  /**
   * Registers head tags (works on both server and client)
   * Inspired by unhead's useHead composable
   * @example
   * useHead({
   *   title: "My Page",
   *   meta: [
   *     { name: "description", content: "Page description" },
   *     { property: "og:title", content: "My Page" }
   *   ]
   * });
   */
  export function useHead(input: HeadInput, options?: HeadEntryOptions): ActiveHeadEntry;

  /**
   * Install automatic head tag hoisting.
   * When installed, head tags (title, meta, link, script, base, style, noscript)
   * placed anywhere in the component tree are automatically hoisted to the document head.
   *
   * Called automatically by initServerContext(), but can be called manually for testing.
   * @example
   * // Head tags anywhere in components are automatically hoisted
   * function MyComponent() {
   *   return (
   *     <div>
   *       <title>My Page</title>
   *       <meta name="description" content="..." />
   *       <h1>Content</h1>
   *     </div>
   *   );
   * }
   */
  export function installHeadHoisting(): void;

  /**
   * Head component - renders marker for SSR head injection.
   * Place in your layout's <head> where dynamic head tags should be injected.
   * @example
   * <head>
   *   <meta charset="UTF-8" />
   *   <Head />
   *   <Assets />
   * </head>
   */
  export function Head(): VNode<any>;

  /** @deprecated Use Head instead */
  export function HeadOutlet(): VNode<any>;

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
    data: SolarflareServerData<T>["data"];
    loading: SolarflareServerData<T>["loading"];
    error: SolarflareServerData<T>["error"];
  }

  /**
   * Store configuration
   */
  export interface StoreConfig {
    params?: SolarflareStoreConfig["params"];
    serverData?: SolarflareStoreConfig["serverData"];
  }

  /**
   * Deferred data configuration for streaming
   */
  export interface DeferredData {
    tag: string;
    promises: Record<string, Promise<unknown>>;
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
    _headers?: Record<string, string>;
    _status?: number;
    _statusText?: string;
  }

  /**
   * Extended stream interface with allReady promise
   */
  export interface SolarflareStream extends ReadableStream<Uint8Array> {
    allReady: Promise<void>;
    status?: number;
    statusText?: string;
    headers?: Record<string, string>;
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
  export function serializeHeadForHydration(): Promise<string>;
  export function hydrateHead(): Promise<void>;
}

declare module "@chr33s/solarflare" {
  import { ModuleMap } from "@chr33s/solarflare/server";

  /**
   * Cloudflare Worker fetch handler
   * Routes are auto-discovered at build time from the generated modules
   * Uses streaming SSR for improved TTFB
   */
  const worker: (request: Request, env: Env) => Promise<Response>;

  export default worker;
}
