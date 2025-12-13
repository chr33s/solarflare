/**
 * Solarflare Route Tree
 * Optimized route lookups using URLPattern with hierarchical tree structure
 *
 * This reduces sequential matching of all URL patterns by leveraging a
 * tree structure that narrows the search space as we traverse.
 */

import type { Route, RouteMatch, RouteParamDef } from './server'

/**
 * Route tree node representing part of the route hierarchy
 * Each node manages static, parameterized, and wildcard routes separately
 */
export interface RouteNode {
  /** Static segment children (e.g., `/users`, `/posts`) */
  static: Map<string, RouteNode>
  /** Parameterized segment child (e.g., `/:id`) */
  parameterized: RouteNode | null
  /** Parameter name for parameterized nodes */
  paramName: string | null
  /** Wildcard segment child (e.g., `/*`) */
  wildcard: RouteNode | null
  /** Routes that terminate at this node (may have multiple for different HTTP methods) */
  routes: Route[]
}

/**
 * Match result from tree traversal
 */
export interface TreeMatch {
  /** The matched route */
  route: Route
  /** Extracted URL parameters */
  params: Record<string, string>
  /** Matched path segments */
  matchedSegments: string[]
}

/**
 * Create an empty route node
 */
function createNode(): RouteNode {
  return {
    static: new Map(),
    parameterized: null,
    paramName: null,
    wildcard: null,
    routes: [],
  }
}

/**
 * Parse a URLPattern pathname into segments with type information
 */
function parsePatternSegments(
  pathname: string
): Array<{ type: 'static' | 'param' | 'wildcard'; value: string }> {
  const segments: Array<{ type: 'static' | 'param' | 'wildcard'; value: string }> = []

  // Remove leading/trailing slashes and split
  const parts = pathname.replace(/^\/+|\/+$/g, '').split('/')

  for (const part of parts) {
    if (!part) continue

    if (part === '*' || part === ':*') {
      // Wildcard segment
      segments.push({ type: 'wildcard', value: '*' })
    } else if (part.startsWith(':')) {
      // Parameterized segment (e.g., :id, :slug)
      segments.push({ type: 'param', value: part.slice(1) })
    } else {
      // Static segment
      segments.push({ type: 'static', value: part })
    }
  }

  return segments
}

/**
 * Optimized Route Tree for fast URL matching
 *
 * Routes are organized hierarchically:
 * - Static segments are checked first (fastest)
 * - Parameterized segments (:id) are checked second
 * - Wildcard segments (*) are checked last
 *
 * This allows O(path_length) lookups instead of O(num_routes)
 */
export class RouteTree {
  /** Root node of the tree */
  readonly root: RouteNode

  /** All routes in the tree (for fallback iteration) */
  #allRoutes: Route[] = []

  /** Cache for frequently accessed paths */
  #cache: Map<string, TreeMatch | null> = new Map()

  /** Maximum cache size */
  #maxCacheSize = 1000

  constructor() {
    this.root = createNode()
  }

  /**
   * Add a route to the tree
   */
  addRoute(route: Route): void {
    const pathname = route.parsedPattern.pathname
    const segments = parsePatternSegments(pathname)

    let current = this.root

    for (const segment of segments) {
      switch (segment.type) {
        case 'static': {
          if (!current.static.has(segment.value)) {
            current.static.set(segment.value, createNode())
          }
          current = current.static.get(segment.value)!
          break
        }
        case 'param': {
          if (!current.parameterized) {
            current.parameterized = createNode()
            current.parameterized.paramName = segment.value
          }
          current = current.parameterized
          break
        }
        case 'wildcard': {
          if (!current.wildcard) {
            current.wildcard = createNode()
          }
          current = current.wildcard
          break
        }
      }
    }

    // Add route to the terminal node
    // Sort by specificity (client routes before server routes for SSR)
    current.routes.push(route)
    current.routes.sort((a, b) => {
      // Prefer client routes for SSR
      if (a.type !== b.type) {
        return a.type === 'client' ? -1 : 1
      }
      // Higher specificity first
      return b.parsedPattern.specificity - a.parsedPattern.specificity
    })

    // Also add to flat list for fallback
    this.#allRoutes.push(route)
    this.#allRoutes.sort((a, b) => {
      if (a.parsedPattern.isStatic !== b.parsedPattern.isStatic) {
        return a.parsedPattern.isStatic ? -1 : 1
      }
      return b.parsedPattern.specificity - a.parsedPattern.specificity
    })

    // Clear cache when routes change
    this.#cache.clear()
  }

  /**
   * Add multiple routes to the tree
   */
  addRoutes(routes: Route[]): void {
    for (const route of routes) {
      this.addRoute(route)
    }
  }

  /**
   * Match a URL against the route tree
   * Returns the first matching route with extracted parameters
   */
  match(url: URL): TreeMatch | null {
    const pathname = url.pathname

    // Check cache first
    const cached = this.#cache.get(pathname)
    if (cached !== undefined) {
      return cached
    }

    // Parse URL segments
    const segments = pathname.replace(/^\/+|\/+$/g, '').split('/').filter(Boolean)

    // Try tree-based matching first
    const result = this.#matchSegments(this.root, segments, 0, {})

    if (result) {
      // Validate match using URLPattern (ensures full compatibility)
      const patternResult = result.route.pattern.exec(url)
      if (patternResult) {
        // Merge params from URLPattern (more accurate) with tree params
        const params = {
          ...result.params,
          ...(patternResult.pathname.groups as Record<string, string>),
        }

        const match: TreeMatch = {
          route: result.route,
          params,
          matchedSegments: result.matchedSegments,
        }

        this.#cacheResult(pathname, match)
        return match
      }
    }

    // Fallback to linear search (handles edge cases)
    const fallback = this.#linearMatch(url)
    this.#cacheResult(pathname, fallback)
    return fallback
  }

  /**
   * Recursive segment matching through the tree
   */
  #matchSegments(
    node: RouteNode,
    segments: string[],
    index: number,
    params: Record<string, string>
  ): TreeMatch | null {
    // Base case: no more segments to match
    if (index >= segments.length) {
      // Check for index route at this node
      if (node.routes.length > 0) {
        return {
          route: node.routes[0],
          params: { ...params },
          matchedSegments: segments.slice(0, index),
        }
      }

      // Check for empty path in static children (handles trailing slashes)
      if (node.static.has('')) {
        const emptyNode = node.static.get('')!
        if (emptyNode.routes.length > 0) {
          return {
            route: emptyNode.routes[0],
            params: { ...params },
            matchedSegments: segments.slice(0, index),
          }
        }
      }

      return null
    }

    const segment = segments[index]

    // 1. Try static match first (fastest)
    if (node.static.has(segment)) {
      const result = this.#matchSegments(
        node.static.get(segment)!,
        segments,
        index + 1,
        params
      )
      if (result) return result
    }

    // 2. Try parameterized match
    if (node.parameterized) {
      const paramNode = node.parameterized
      const newParams = { ...params }

      if (paramNode.paramName) {
        newParams[paramNode.paramName] = segment
      }

      const result = this.#matchSegments(paramNode, segments, index + 1, newParams)
      if (result) return result
    }

    // 3. Try wildcard match (matches rest of path)
    if (node.wildcard) {
      const wildcardNode = node.wildcard
      const remainingPath = segments.slice(index).join('/')

      if (wildcardNode.routes.length > 0) {
        return {
          route: wildcardNode.routes[0],
          params: { ...params, '*': remainingPath },
          matchedSegments: segments,
        }
      }
    }

    // 4. Check if current node has routes (handles shorter patterns with wildcards)
    if (node.routes.length > 0) {
      // Verify this route accepts the remaining segments
      for (const route of node.routes) {
        const url = new URL(`http://localhost/${segments.join('/')}`)
        if (route.pattern.test(url)) {
          return {
            route,
            params: { ...params },
            matchedSegments: segments.slice(0, index),
          }
        }
      }
    }

    return null
  }

  /**
   * Linear fallback matching using URLPattern
   */
  #linearMatch(url: URL): TreeMatch | null {
    for (const route of this.#allRoutes) {
      const result = route.pattern.exec(url)
      if (result) {
        return {
          route,
          params: (result.pathname.groups as Record<string, string>) ?? {},
          matchedSegments: url.pathname.split('/').filter(Boolean),
        }
      }
    }
    return null
  }

  /**
   * Cache a match result with LRU-like eviction
   */
  #cacheResult(pathname: string, result: TreeMatch | null): void {
    // Simple size-based eviction
    if (this.#cache.size >= this.#maxCacheSize) {
      const firstKey = this.#cache.keys().next().value
      if (firstKey !== undefined) {
        this.#cache.delete(firstKey)
      }
    }
    this.#cache.set(pathname, result)
  }

  /**
   * Clear the match cache
   */
  clearCache(): void {
    this.#cache.clear()
  }

  /**
   * Get all routes in the tree (for compatibility)
   */
  getRoutes(): Route[] {
    return this.#allRoutes
  }

  /**
   * Get tree statistics for debugging
   */
  getStats(): {
    totalRoutes: number
    cacheSize: number
    treeDepth: number
    staticNodes: number
    paramNodes: number
    wildcardNodes: number
  } {
    let treeDepth = 0
    let staticNodes = 0
    let paramNodes = 0
    let wildcardNodes = 0

    const traverse = (node: RouteNode, depth: number) => {
      treeDepth = Math.max(treeDepth, depth)

      for (const child of node.static.values()) {
        staticNodes++
        traverse(child, depth + 1)
      }

      if (node.parameterized) {
        paramNodes++
        traverse(node.parameterized, depth + 1)
      }

      if (node.wildcard) {
        wildcardNodes++
        traverse(node.wildcard, depth + 1)
      }
    }

    traverse(this.root, 0)

    return {
      totalRoutes: this.#allRoutes.length,
      cacheSize: this.#cache.size,
      treeDepth,
      staticNodes,
      paramNodes,
      wildcardNodes,
    }
  }
}

/**
 * Create a route tree from an array of routes
 */
export function createRouteTree(routes: Route[]): RouteTree {
  const tree = new RouteTree()
  tree.addRoutes(routes)
  return tree
}

/**
 * Match a URL against the route tree and return a RouteMatch
 * Compatible with the existing matchRoute API
 */
export function matchRouteFromTree(tree: RouteTree, url: URL): RouteMatch | null {
  const treeMatch = tree.match(url)

  if (!treeMatch) {
    return null
  }

  const { route, params } = treeMatch
  const paramDefs: RouteParamDef[] = route.parsedPattern.params

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
