/**
 * Solarflare Server
 * Server utilities: pathToPattern(), pathToTag(), createRouter(), findLayouts(), matchRoute(), wrapWithLayouts()
 */
import { type VNode, h } from 'preact'
import { type FunctionComponent } from 'preact'

/**
 * Parse URL parameters from a request URL using URLPattern
 * @deprecated Use the params passed to server handlers instead
 */
export function parse(_request: Request): Record<string, string> {
  // This is a placeholder - actual parsing happens in matchRoute
  // Server handlers receive params directly from the worker
  return {}
}

/**
 * Route definition
 */
export interface Route {
  /** URLPattern for matching requests */
  pattern: URLPattern
  /** Original file path */
  path: string
  /** Custom element tag name */
  tag: string
  /** Dynamic module loader */
  loader: () => Promise<{ default: unknown }>
  /** Route type: client or server */
  type: 'client' | 'server'
}

/**
 * Route match result
 */
export interface RouteMatch {
  /** Matched route */
  route: Route
  /** Extracted URL parameters */
  params: Record<string, string>
}

/**
 * Layout definition
 */
export interface Layout {
  /** Layout file path */
  path: string
  /** Dynamic layout loader */
  loader: () => Promise<{ default: unknown }>
}

/**
 * Convert file path to URLPattern pathname
 * e.g., "./blog/$slug.client.tsx" → "/blog/:slug"
 * e.g., "./index.client.tsx" → "/"
 */
export function pathToPattern(filePath: string): string {
  return (
    filePath
      .replace(/^\.\//, '/')  // ./ -> /
      .replace(/\.(client|server)\.tsx$/, '')
      .replace(/\/index$/, '')
      .replace(/\$([^/]+)/g, ':$1') || '/'
  )
}

/**
 * Generate custom element tag from file path
 * e.g., "./blog/$slug.client.tsx" → "sf-blog-slug"
 * e.g., "./index.client.tsx" → "sf-root"
 */
export function pathToTag(filePath: string): string {
  return (
    'sf-' +
    filePath
      .replace(/^\.\//, '')  // Remove leading ./
      .replace(/\.(client|server)\.tsx$/, '')
      .replace(/\//g, '-')
      .replace(/\$/g, '')
      .replace(/^index$/, 'root')
      .replace(/-index$/, '')
      .toLowerCase()
  )
}

/**
 * Create router from import.meta.glob result
 * Filters out _prefixed files, sorts static before dynamic routes
 */
export function createRouter(
  modules: Record<string, () => Promise<{ default: unknown }>>
): Route[] {
  return Object.entries(modules)
    .filter(([path]) => !path.includes('/_'))
    .map(([path, loader]) => ({
      pattern: new URLPattern({ pathname: pathToPattern(path) }),
      path,
      tag: pathToTag(path),
      loader,
      type: path.includes('.server.') ? ('server' as const) : ('client' as const),
    }))
    .sort((a, b) => {
      // Static routes before dynamic routes
      const aStatic = !a.pattern.pathname.includes(':')
      const bStatic = !b.pattern.pathname.includes(':')
      if (aStatic !== bStatic) return aStatic ? -1 : 1
      // Longer paths first (more specific)
      return b.path.length - a.path.length
    })
}

/**
 * Find all ancestor layouts for a route path
 * Returns layouts from root to leaf order
 * e.g., "./blog/$slug.server.tsx" → ["./_layout.tsx", "./blog/_layout.tsx"]
 */
export function findLayouts(
  routePath: string,
  modules: Record<string, () => Promise<{ default: unknown }>>
): Layout[] {
  const layouts: Layout[] = []
  // Remove leading ./ and get segments (minus the file itself)
  const segments = routePath.replace(/^\.\//, '').split('/').slice(0, -1)

  // Check root layout first
  const rootLayout = './_layout.tsx'
  if (rootLayout in modules) {
    layouts.push({ path: rootLayout, loader: modules[rootLayout] })
  }

  // Walk up the path checking for layouts
  let current = '.'
  for (const segment of segments) {
    if (!segment) continue
    current += `/${segment}`
    const layoutPath = `${current}/_layout.tsx`
    if (layoutPath in modules) {
      layouts.push({ path: layoutPath, loader: modules[layoutPath] })
    }
  }

  return layouts
}

/**
 * Match URL against routes using URLPattern
 */
export function matchRoute(routes: Route[], url: URL): RouteMatch | null {
  for (const route of routes) {
    const result = route.pattern.exec(url)
    if (result) {
      return {
        route,
        params: (result.pathname.groups as Record<string, string>) ?? {},
      }
    }
  }
  return null
}

/**
 * Wrap content in nested layouts (innermost first)
 * Layouts are applied from root to leaf
 */
export async function wrapWithLayouts(
  content: VNode<any>,
  layouts: Layout[]
): Promise<VNode<any>> {
  let wrapped: VNode<any> = content

  // Apply layouts from leaf to root (reverse order)
  for (let i = layouts.length - 1; i >= 0; i--) {
    const { loader } = layouts[i]
    const mod = await loader()
    const Layout = mod.default as FunctionComponent<{ children: VNode<any> }>
    wrapped = h(Layout, { children: wrapped })
  }

  return wrapped
}

/**
 * Render a component with its tag wrapper for hydration
 */
export function renderComponent(
  Component: FunctionComponent<any>,
  tag: string,
  props: Record<string, unknown>
): VNode<any> {
  // Create the custom element wrapper with props as attributes
  // The SSR content goes inside the custom element
  // Convert props to string attributes for the custom element
  const attrs: Record<string, string> = {}
  for (const [key, value] of Object.entries(props)) {
    attrs[key] = String(value)
  }
  return h(tag, attrs, h(Component, props))
}
