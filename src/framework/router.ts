/**
 * Solarflare Client Router
 * SPA navigation using native URLPattern, Navigation API, and View Transitions
 * Optimized for build-time routes with Preact integration
 */

import { createContext, h, type FunctionComponent, type VNode } from 'preact'
import { useContext, useEffect, useCallback } from 'preact/hooks'
import { signal, computed, type ReadonlySignal } from '@preact/signals'

// ============================================================================
// Types
// ============================================================================

/**
 * Route definition from build-time manifest
 */
export interface RouteManifestEntry {
  /** URL pattern pathname (e.g., '/blog/:slug') */
  pattern: string
  /** Custom element tag name */
  tag: string
  /** Chunk path for this route's JS */
  chunk?: string
  /** CSS stylesheets for this route */
  styles?: string[]
  /** Route type */
  type: 'client' | 'server'
  /** Dynamic parameter names */
  params: string[]
}

/**
 * Build-time routes manifest
 */
export interface RoutesManifest {
  routes: RouteManifestEntry[]
  /** Base path for all routes */
  base?: string
}

/**
 * Internal route representation
 */
interface Route {
  pattern: URLPattern
  entry: RouteManifestEntry
}

/**
 * Route match result
 */
export interface RouteMatch {
  /** Matched manifest entry */
  entry: RouteManifestEntry
  /** Extracted URL parameters */
  params: Record<string, string>
  /** The matched URL */
  url: URL
}

/**
 * Navigation options
 */
export interface NavigateOptions {
  /** Replace current history entry instead of pushing */
  replace?: boolean
  /** State to associate with the history entry */
  state?: unknown
  /** Skip view transition entirely */
  skipTransition?: boolean
}

/**
 * Router configuration
 */
export interface RouterConfig {
  /** Base path for all routes */
  base?: string
  /** Enable view transitions (default: true if supported) */
  viewTransitions?: boolean
  /** Scroll behavior after navigation */
  scrollBehavior?: 'auto' | 'smooth' | 'instant' | false
  /** Called when no route matches */
  onNotFound?: (url: URL) => void
  /** Called after navigation completes */
  onNavigate?: (match: RouteMatch) => void
}

// ============================================================================
// Feature Detection
// ============================================================================

/** Check if View Transitions API is supported */
export function supportsViewTransitions(): boolean {
  return typeof document !== 'undefined' && 'startViewTransition' in document
}

/** Check if Navigation API is supported */
export function supportsNavigation(): boolean {
  return typeof window !== 'undefined' && 'navigation' in window
}

// ============================================================================
// Router Class
// ============================================================================

/**
 * Client-side SPA Router for build-time routes
 *
 * Uses native browser APIs:
 * - URLPattern for route matching
 * - Navigation API for intercepting navigation
 * - View Transitions API for smooth page transitions
 * - Preact Signals for reactive state
 */
export class Router {
  #routes: Route[] = []
  #config: Required<RouterConfig>
  #started = false

  /** Reactive current match - components re-render when this changes */
  readonly current = signal<RouteMatch | null>(null)

  /** Reactive params derived from current match */
  readonly params: ReadonlySignal<Record<string, string>>

  constructor(manifest: RoutesManifest, config: RouterConfig = {}) {
    this.#config = {
      base: manifest.base ?? config.base ?? '',
      viewTransitions: config.viewTransitions ?? supportsViewTransitions(),
      scrollBehavior: config.scrollBehavior ?? 'auto',
      onNotFound: config.onNotFound ?? (() => {}),
      onNavigate: config.onNavigate ?? (() => {}),
    }

    this.params = computed(() => this.current.value?.params ?? {})
    this.#loadManifest(manifest)
  }

  /** Load routes from build-time manifest */
  #loadManifest(manifest: RoutesManifest): void {
    for (const entry of manifest.routes) {
      // Only register client routes for SPA navigation
      if (entry.type !== 'client') continue

      const pathname = this.#config.base + entry.pattern
      this.#routes.push({
        pattern: new URLPattern({ pathname }),
        entry,
      })
    }

    // Sort by specificity (static segments first)
    this.#routes.sort((a, b) => {
      const aStatic = (a.entry.pattern.match(/[^:*]+/g) || []).join('').length
      const bStatic = (b.entry.pattern.match(/[^:*]+/g) || []).join('').length
      return bStatic - aStatic
    })
  }

  /** Match a URL against routes */
  match(url: URL): RouteMatch | null {
    for (const { pattern, entry } of this.#routes) {
      const result = pattern.exec(url)
      if (result) {
        const params: Record<string, string> = {}
        for (const [key, value] of Object.entries(result.pathname.groups)) {
          if (value != null) params[key] = value as string
        }
        return { entry, params, url }
      }
    }
    return null
  }

  /** Navigate to a URL */
  async navigate(to: string | URL, options: NavigateOptions = {}): Promise<void> {
    const url = typeof to === 'string' ? new URL(to, location.origin) : to
    const match = this.match(url)

    // Update history
    if (options.replace) {
      history.replaceState(options.state ?? null, '', url.href)
    } else {
      history.pushState(options.state ?? null, '', url.href)
    }

    await this.#executeNavigation(url, match, options)
  }

  /** Execute navigation with optional view transition */
  async #executeNavigation(
    url: URL,
    match: RouteMatch | null,
    options: NavigateOptions
  ): Promise<void> {
    const doTransition = async () => {
      if (match) {
        await this.#loadRoute(match, url)
        this.current.value = match
        this.#config.onNavigate(match)
      } else {
        this.current.value = null
        this.#config.onNotFound(url)
      }
      this.#handleScroll(url)
    }

    // Use View Transitions if enabled
    if (this.#config.viewTransitions && supportsViewTransitions() && !options.skipTransition) {
      await (document as any).startViewTransition(doTransition).finished
    } else {
      await doTransition()
    }
  }

  /** Load route assets and swap page content */
  async #loadRoute(match: RouteMatch, url: URL): Promise<void> {
    const { entry } = match

    // Fetch the new page HTML from the server
    const response = await fetch(url.href, {
      headers: { 'Accept': 'text/html' }
    })
    
    if (!response.ok) {
      throw new Error(`Failed to fetch ${url.href}: ${response.status}`)
    }

    const html = await response.text()
    const parser = new DOMParser()
    const doc = parser.parseFromString(html, 'text/html')

    // Swap the main content (#app or body)
    const newContent = doc.querySelector('#app') ?? doc.body
    const currentContent = document.querySelector('#app') ?? document.body

    if (newContent && currentContent) {
      currentContent.innerHTML = newContent.innerHTML
    }

    // Load any new CSS
    if (entry.styles?.length) {
      for (const href of entry.styles) {
        if (!document.querySelector(`link[href="${href}"]`)) {
          const link = document.createElement('link')
          link.rel = 'stylesheet'
          link.href = href
          document.head.appendChild(link)
        }
      }
    }

    // Load JS chunk for web component registration
    if (entry.chunk) {
      await import(entry.chunk)
    }
  }

  /** Handle scroll restoration */
  #handleScroll(url: URL): void {
    const behavior = this.#config.scrollBehavior
    if (behavior === false) return

    // Scroll to hash target if present
    if (url.hash) {
      const target = document.querySelector(url.hash)
      if (target) {
        target.scrollIntoView({ behavior: behavior === 'auto' ? 'instant' : behavior })
        return
      }
    }

    // Scroll to top
    scrollTo({ top: 0, left: 0, behavior: behavior === 'auto' ? 'instant' : behavior })
  }

  /** Start intercepting navigation */
  start(): this {
    if (this.#started) return this

    if (supportsNavigation()) {
      this.#setupNavigationAPI()
    } else {
      this.#setupLegacyNavigation()
    }

    // Handle initial route
    const url = new URL(location.href)
    const match = this.match(url)
    this.#executeNavigation(url, match, { skipTransition: true })

    this.#started = true
    return this
  }

  /** Stop the router */
  stop(): this {
    this.#started = false
    return this
  }

  /** Setup Navigation API interception */
  #setupNavigationAPI(): void {
    const nav = (window as any).navigation
    nav.addEventListener('navigate', (event: any) => {
      if (!event.canIntercept || event.downloadRequest) return

      const url = new URL(event.destination.url)
      if (url.origin !== location.origin) return

      const match = this.match(url)
      if (!match) return

      event.intercept({
        scroll: 'manual',
        handler: () => this.#executeNavigation(url, match, {}),
      })
    })
  }

  /** Setup legacy popstate/click handlers */
  #setupLegacyNavigation(): void {
    addEventListener('popstate', () => {
      const url = new URL(location.href)
      const match = this.match(url)
      this.#executeNavigation(url, match, { skipTransition: true })
    })

    document.addEventListener('click', (event) => {
      const link = (event.target as Element).closest('a')
      if (!link) return

      const href = link.getAttribute('href')
      if (!href || link.hasAttribute('download')) return
      if (link.target && link.target !== '_self') return
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return

      try {
        const url = new URL(href, location.origin)
        if (url.origin !== location.origin) return

        event.preventDefault()
        this.navigate(url)
      } catch {
        // Invalid URL, let browser handle it
      }
    })
  }

  // Navigation helpers
  back(): void {
    history.back()
  }
  forward(): void {
    history.forward()
  }
  go(delta: number): void {
    history.go(delta)
  }
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create a router from a build-time routes manifest
 *
 * @example
 * ```ts
 * import manifest from 'solarflare:routes'
 *
 * const router = createRouter(manifest, {
 *   viewTransitions: true,
 *   onNavigate: (match) => console.log('Navigated to:', match.url.pathname)
 * })
 *
 * router.start()
 * ```
 */
export function createRouter(manifest: RoutesManifest, config?: RouterConfig): Router {
  return new Router(manifest, config)
}

// ============================================================================
// Preact Context & Hooks
// ============================================================================

/** Router context */
export const RouterContext = createContext<Router | null>(null)

/** Hook to access the router instance */
export function useRouter(): Router {
  const router = useContext(RouterContext)
  if (!router) {
    throw new Error('useRouter must be used within a RouterProvider')
  }
  return router
}

/**
 * Hook to get current route match (reactive via signals)
 * Components using this will re-render when route changes
 */
export function useRoute(): RouteMatch | null {
  const router = useRouter()
  return router.current.value
}

/**
 * Hook to get current route params (reactive via signals)
 * Components using this will re-render when params change
 */
export function useParams(): Record<string, string> {
  const router = useRouter()
  return router.params.value
}

/** Hook for programmatic navigation */
export function useNavigate(): (to: string | URL, options?: NavigateOptions) => Promise<void> {
  const router = useRouter()
  return useCallback(
    (to: string | URL, options?: NavigateOptions) => router.navigate(to, options),
    [router]
  )
}

/** Hook to check if a path matches the current route */
export function useIsActive(path: string, exact = false): boolean {
  const router = useRouter()
  const match = router.current.value
  if (!match) return false

  const currentPath = match.url.pathname
  return exact ? currentPath === path : currentPath.startsWith(path)
}

// ============================================================================
// Preact Components
// ============================================================================

/** Link component props */
export interface LinkProps {
  /** Target URL */
  to: string
  /** Navigation options */
  options?: NavigateOptions
  /** Link children */
  children?: VNode | VNode[] | string
  /** Additional class names */
  class?: string
  /** Active class name when link matches current route */
  activeClass?: string
  /** Whether to match exactly */
  exact?: boolean
  /** Additional HTML attributes */
  [key: string]: unknown
}

/**
 * Link component for SPA navigation with view transitions
 *
 * @example
 * ```tsx
 * <Link to="/blog/my-post">Read Post</Link>
 * <Link to="/about" activeClass="active" exact>About</Link>
 * ```
 */
export const Link: FunctionComponent<LinkProps> = ({
  to,
  options,
  children,
  class: className,
  activeClass,
  exact = false,
  ...rest
}) => {
  const router = useRouter()
  const isActive = useIsActive(to, exact)

  const handleClick = (event: MouseEvent) => {
    // Don't intercept modified clicks
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    if (event.button !== 0) return // Only left clicks

    event.preventDefault()
    router.navigate(to, options)
  }

  const classes = [className, isActive && activeClass].filter(Boolean).join(' ') || undefined

  return h(
    'a',
    {
      href: to,
      onClick: handleClick,
      class: classes,
      'aria-current': isActive ? 'page' : undefined,
      ...rest,
    },
    children
  )
}

/** Router provider props */
export interface RouterProviderProps {
  /** Router instance */
  router: Router
  /** Children to render */
  children?: VNode | VNode[]
}

/**
 * Router provider component
 *
 * @example
 * ```tsx
 * import manifest from 'solarflare:routes'
 *
 * const router = createRouter(manifest, { viewTransitions: true })
 *
 * render(
 *   <RouterProvider router={router}>
 *     <App />
 *   </RouterProvider>,
 *   document.getElementById('app')
 * )
 * ```
 */
export const RouterProvider: FunctionComponent<RouterProviderProps> = ({ router, children }) => {
  useEffect(() => {
    router.start()
    return () => router.stop()
  }, [router])

  return h(RouterContext.Provider, { value: router }, children)
}
