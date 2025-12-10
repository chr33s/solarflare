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

  export interface DefineOptions {
    /** Custom element tag name. Defaults to generated from file path */
    tag?: string;
    /** Whether to use Shadow DOM. Defaults to false */
    shadow?: boolean;
    /** Observed attributes to pass as props. Auto-extracted if not provided */
    observedAttributes?: string[];
  }

  /**
   * Build-time macro that registers a Preact component as a web component
   */
  export function define<P extends Record<string, any>>(
    Component: FunctionComponent<P>,
    options?: DefineOptions
  ): FunctionComponent<P>;

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
   * Route definition
   */
  export interface Route {
    pattern: URLPattern;
    path: string;
    tag: string;
    loader: () => Promise<{ default: unknown }>;
    type: 'client' | 'server';
  }

  /**
   * Route match result
   */
  export interface RouteMatch {
    route: Route;
    params: Record<string, string>;
  }

  /**
   * Layout definition
   */
  export interface Layout {
    path: string;
    loader: () => Promise<{ default: unknown }>;
  }

  /**
   * Convert file path to URLPattern pathname
   */
  export function pathToPattern(filePath: string): string;

  /**
   * Generate custom element tag from file path
   */
  export function pathToTag(filePath: string): string;

  /**
   * Create router from import.meta.glob result
   */
  export function createRouter(
    modules: Record<string, () => Promise<{ default: unknown }>>
  ): Route[];

  /**
   * Find all ancestor layouts for a route path
   */
  export function findLayouts(
    routePath: string,
    modules: Record<string, () => Promise<{ default: unknown }>>
  ): Layout[];

  /**
   * Match URL against routes using URLPattern
   */
  export function matchRoute(routes: Route[], url: URL): RouteMatch | null;

  /**
   * Wrap content in nested layouts
   */
  export function wrapWithLayouts(
    content: VNode<any>,
    layouts: Layout[]
  ): Promise<VNode<any>>;

  /**
   * Render a component with its tag wrapper for hydration
   */
  export function renderComponent(
    Component: FunctionComponent<any>,
    tag: string,
    params: Record<string, string>
  ): VNode<any>;
}

declare module 'solarflare/worker' {
  /**
   * Factory function that creates a Cloudflare Worker fetch handler
   */
  export default function worker(
    modules: Record<string, () => Promise<{ default: unknown }>>
  ): (request: Request, env: Env) => Promise<Response>;
}
