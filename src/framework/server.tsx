/**
 * Solarflare Server
 * Server utilities: createRouter(), findLayouts(), matchRoute(), wrapWithLayouts()
 */
import { type VNode, h } from 'preact'
import { type FunctionComponent } from 'preact'
import { parsePath } from './ast'

/**
 * Route parameter definition extracted from pattern
 */
export interface RouteParamDef {
  /** Parameter name (e.g., "slug" from ":slug") */
  name: string
  /** Whether the parameter is optional */
  optional: boolean
  /** Original segment in the pattern */
  segment: string
}

/**
 * Parsed route pattern with type information
 */
export interface ParsedPattern {
  /** Original file path */
  filePath: string
  /** URLPattern pathname */
  pathname: string
  /** Extracted parameter definitions */
  params: RouteParamDef[]
  /** Whether this is a static route (no params) */
  isStatic: boolean
  /** Route specificity score for sorting */
  specificity: number
}

/**
 * Parse URL parameters from a request URL using URLPattern
 * Matches against registered routes to extract dynamic segments
 */
export function parse(request: Request): Record<string, string> {
  const url = new URL(request.url)
  
  // Common route patterns - this will be populated by createRouter
  // For now, extract params by matching common patterns
  const pathname = url.pathname
  
  // Try to match dynamic segments like :slug, :id, etc.
  const params: Record<string, string> = {}
  
  // Extract path segments and look for dynamic values
  const segments = pathname.split('/').filter(Boolean)
  
  // Store the segments for potential dynamic matching
  // The actual pattern matching will happen when routes are registered
  if (segments.length > 0) {
    // Check if there's a route pattern that matches
    for (const route of _registeredRoutes) {
      const result = route.pattern.exec(url)
      if (result) {
        const groups = result.pathname.groups
        for (const [key, value] of Object.entries(groups)) {
          if (value !== undefined) {
            params[key] = value
          }
        }
        break
      }
    }
  }
  
  return params
}

// Internal route registry for parse() function
let _registeredRoutes: Route[] = []

/**
 * Route definition with parsed pattern metadata
 */
export interface Route {
  /** URLPattern for matching requests */
  pattern: URLPattern
  /** Parsed pattern with type information */
  parsedPattern: ParsedPattern
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
 * Convert file path to URLPattern pathname with parsed metadata
 * Delegates to parsePath from ast.ts for unified path handling
 */
export function parsePattern(filePath: string): ParsedPattern {
  const parsed = parsePath(filePath)
  
  // Transform params from string[] to RouteParamDef[]
  const params: RouteParamDef[] = parsed.params.map((name) => ({
    name,
    optional: false,
    segment: `:${name}`,
  }))

  return {
    filePath: parsed.original,
    pathname: parsed.pattern,
    params,
    isStatic: params.length === 0,
    specificity: parsed.specificity,
  }
}

/**
 * Structured module map with typed categories
 */
export interface ModuleMap {
  server: Record<string, () => Promise<{ default: unknown }>>
  client: Record<string, () => Promise<{ default: unknown }>>
  layout: Record<string, () => Promise<{ default: unknown }>>
}

/**
 * Flatten a structured ModuleMap into a flat record
 */
export function flattenModules(
  modules: ModuleMap
): Record<string, () => Promise<{ default: unknown }>> {
  return {
    ...modules.server,
    ...modules.client,
    ...modules.layout,
  }
}

/**
 * Create router from structured module map
 * Filters out _prefixed files, sorts by specificity using parsed pattern metadata
 */
export function createRouter(modules: ModuleMap): Route[] {
  // Combine server and client modules for routing (layouts are handled separately)
  const routeModules = { ...modules.server, ...modules.client }

  const routes = Object.entries(routeModules)
    .filter(([path]) => !path.includes('/_'))
    .map(([path, loader]) => {
      const parsedPattern = parsePattern(path)
      return {
        pattern: new URLPattern({ pathname: parsedPattern.pathname }),
        parsedPattern,
        path,
        tag: parsePath(path).tag,
        loader,
        type: path.includes('.server.') ? ('server' as const) : ('client' as const),
      }
    })
    .sort((a, b) => {
      // Static routes before dynamic routes
      if (a.parsedPattern.isStatic !== b.parsedPattern.isStatic) {
        return a.parsedPattern.isStatic ? -1 : 1
      }
      // Higher specificity first (more specific routes win)
      return b.parsedPattern.specificity - a.parsedPattern.specificity
    })

  // Register routes for parse() function
  _registeredRoutes = routes

  return routes
}

/**
 * Layout definition with hierarchy information
 */
export interface Layout {
  /** Layout file path */
  path: string
  /** Dynamic layout loader */
  loader: () => Promise<{ default: unknown }>
  /** Nesting depth (0 = root) */
  depth: number
  /** Directory this layout applies to */
  directory: string
}

/**
 * Layout hierarchy result with validation metadata
 */
export interface LayoutHierarchy {
  /** Ordered layouts from root to leaf */
  layouts: Layout[]
  /** Route path segments */
  segments: string[]
  /** Directories checked for layouts */
  checkedPaths: string[]
}

/**
 * Find all ancestor layouts for a route path with hierarchy metadata
 * Returns layouts from root to leaf order with validation info
 * e.g., "./blog/$slug.server.tsx" → { layouts: [...], segments: ["blog"], ... }
 */
export function findLayoutHierarchy(
  routePath: string,
  modules: Record<string, () => Promise<{ default: unknown }>>
): LayoutHierarchy {
  const layouts: Layout[] = []
  const checkedPaths: string[] = []

  // Remove leading ./ and get segments (minus the file itself)
  const segments = routePath.replace(/^\.\//, '').split('/').slice(0, -1)

  // Check root layout first
  const rootLayout = './_layout.tsx'
  checkedPaths.push(rootLayout)
  if (rootLayout in modules) {
    layouts.push({
      path: rootLayout,
      loader: modules[rootLayout],
      depth: 0,
      directory: '.',
    })
  }

  // Walk up the path checking for layouts
  let current = '.'
  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i]
    if (!segment) continue
    current += `/${segment}`
    const layoutPath = `${current}/_layout.tsx`
    checkedPaths.push(layoutPath)
    if (layoutPath in modules) {
      layouts.push({
        path: layoutPath,
        loader: modules[layoutPath],
        depth: i + 1,
        directory: current,
      })
    }
  }

  return { layouts, segments, checkedPaths }
}

/**
 * Find all ancestor layouts for a route path using structured module map
 * Returns layouts from root to leaf order
 * e.g., "./blog/$slug.server.tsx" → ["./_layout.tsx", "./blog/_layout.tsx"]
 */
export function findLayouts(
  routePath: string,
  modules: ModuleMap
): Layout[] {
  // Use the layout category from the structured module map
  return findLayoutHierarchy(routePath, modules.layout).layouts
}

/**
 * Validated route match with type-safe params
 */
export interface RouteMatch {
  /** Matched route */
  route: Route
  /** Extracted URL parameters (validated against pattern definition) */
  params: Record<string, string>
  /** Parameter definitions from the route pattern */
  paramDefs: RouteParamDef[]
  /** Whether all required params were matched */
  complete: boolean
}

/**
 * Match URL against routes using URLPattern with parameter validation
 */
export function matchRoute(routes: Route[], url: URL): RouteMatch | null {
  for (const route of routes) {
    const result = route.pattern.exec(url)
    if (result) {
      const params = (result.pathname.groups as Record<string, string>) ?? {}
      const paramDefs = route.parsedPattern.params

      // Validate that all required params are present
      const complete = paramDefs
        .filter((p) => !p.optional)
        .every((p) => p.name in params && params[p.name] !== undefined)

      return {
        route,
        params,
        paramDefs,
        complete,
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
