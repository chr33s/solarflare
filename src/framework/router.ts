/**
 * Solarflare Client Router
 * Lean SPA navigation using native URLPattern, Navigation API, and View Transitions
 * Uses signals-core for reactive state without Preact dependency
 */

import { signal, computed, effect, type ReadonlySignal } from '@preact/signals-core'
import diff from 'diff-dom-streaming'

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
  /** Called when navigation fails with an error */
  onError?: (error: Error, url: URL) => void
}

/**
 * Subscription callback for route changes
 */
export type RouteSubscriber = (match: RouteMatch | null) => void

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
 * - Signals for reactive state (framework-agnostic)
 */
export class Router {
  #routes: Route[] = []
  #config: Required<RouterConfig>
  #started = false
  #cleanupFns: (() => void)[] = []

  /** Reactive current match */
  readonly current = signal<RouteMatch | null>(null)

  /** Reactive params derived from current match */
  readonly params: ReadonlySignal<Record<string, string>>

  /** Reactive pathname for easy access */
  readonly pathname: ReadonlySignal<string>

  constructor(manifest: RoutesManifest, config: RouterConfig = {}) {
    this.#config = {
      base: manifest.base ?? config.base ?? '',
      viewTransitions: config.viewTransitions ?? supportsViewTransitions(),
      scrollBehavior: config.scrollBehavior ?? 'auto',
      onNotFound: config.onNotFound ?? (() => {}),
      onNavigate: config.onNavigate ?? (() => {}),
      onError: config.onError ?? ((error, url) => {
        console.error(`[solarflare] Navigation error for ${url.href}:`, error)
      }),
    }

    this.params = computed(() => this.current.value?.params ?? {})
    this.pathname = computed(() => this.current.value?.url.pathname ?? '')
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

  /** Handle navigation errors */
  #handleError(error: Error, url: URL): void {
    this.#config.onError(error, url)

    // Render error UI in #app
    const app = document.querySelector('#app')
    if (app) {
      app.innerHTML = `
        <div class="error-page">
          <h1>Something went wrong</h1>
          <p>${error.message}</p>
          <p class="error-url">Failed to load: ${url.pathname}</p>
          <a href="/">Go home</a>
        </div>
      `
    }
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
    const useTransition = this.#config.viewTransitions && 
      supportsViewTransitions() && 
      !options.skipTransition

    try {
      if (match) {
        await this.#loadRoute(match, url, useTransition)
        this.current.value = match
        this.#config.onNavigate(match)
      } else {
        this.current.value = null
        this.#config.onNotFound(url)
      }
      this.#handleScroll(url)
    } catch (error) {
      this.#handleError(error instanceof Error ? error : new Error(String(error)), url)
    }
  }

  /** Load route assets and swap page content */
  async #loadRoute(match: RouteMatch, url: URL, useTransition: boolean): Promise<void> {
    const { entry } = match

    // Fetch the new page HTML from the server
    const response = await fetch(url.href, {
      headers: { Accept: 'text/html' },
    })

    if (!response.ok) {
      throw new Error(`Failed to fetch ${url.href}: ${response.status}`)
    }

    // Use diff-dom-streaming to incrementally update DOM
    // This preserves web component state and only mutates changed nodes
    // Must diff against document (not #app) since response is full HTML
    await diff(document, response.body!, { transition: useTransition })

    // Load any new CSS (ensure absolute URL)
    if (entry.styles?.length) {
      for (const href of entry.styles) {
        const absoluteHref = new URL(href, location.origin).href
        if (!document.querySelector(`link[href="${absoluteHref}"], link[href="${href}"]`)) {
          const link = document.createElement('link')
          link.rel = 'stylesheet'
          link.href = absoluteHref
          document.head.appendChild(link)
        }
      }
    }

    // Load JS chunk for web component registration (ensure absolute URL)
    if (entry.chunk) {
      const absoluteChunk = new URL(entry.chunk, location.origin).href
      await import(absoluteChunk)
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

    // Set initial route match (don't fetch - page is already SSR'd)
    const url = new URL(location.href)
    const match = this.match(url)
    if (match) {
      this.current.value = match
    }

    this.#started = true
    return this
  }

  /** Stop the router and cleanup listeners */
  stop(): this {
    for (const cleanup of this.#cleanupFns) {
      cleanup()
    }
    this.#cleanupFns = []
    this.#started = false
    return this
  }

  /** Setup Navigation API interception */
  #setupNavigationAPI(): void {
    const nav = (window as any).navigation
    const handler = (event: any) => {
      if (!event.canIntercept || event.downloadRequest) return

      const url = new URL(event.destination.url)
      if (url.origin !== location.origin) return

      const match = this.match(url)
      if (!match) return

      event.intercept({
        scroll: 'manual',
        handler: () => this.#executeNavigation(url, match, {}),
      })
    }

    nav.addEventListener('navigate', handler)
    this.#cleanupFns.push(() => nav.removeEventListener('navigate', handler))
  }

  /** Setup legacy popstate/click handlers */
  #setupLegacyNavigation(): void {
    const popstateHandler = () => {
      const url = new URL(location.href)
      const match = this.match(url)
      this.#executeNavigation(url, match, { skipTransition: true })
    }

    const clickHandler = (event: MouseEvent) => {
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
    }

    addEventListener('popstate', popstateHandler)
    document.addEventListener('click', clickHandler)

    this.#cleanupFns.push(
      () => removeEventListener('popstate', popstateHandler),
      () => document.removeEventListener('click', clickHandler)
    )
  }

  // ============================================================================
  // Subscription API (for non-signal consumers)
  // ============================================================================

  /**
   * Subscribe to route changes
   * Returns an unsubscribe function
   */
  subscribe(callback: RouteSubscriber): () => void {
    return effect(() => {
      callback(this.current.value)
    })
  }

  // ============================================================================
  // Navigation Helpers
  // ============================================================================

  back(): void {
    history.back()
  }

  forward(): void {
    history.forward()
  }

  go(delta: number): void {
    history.go(delta)
  }

  /** Check if a path matches the current route */
  isActive(path: string, exact = false): boolean {
    const match = this.current.value
    if (!match) {
      if (typeof location === 'undefined') return false
      const currentPath = location.pathname
      return exact ? currentPath === path : currentPath.startsWith(path)
    }

    const currentPath = match.url.pathname
    return exact ? currentPath === path : currentPath.startsWith(path)
  }

  /** Reactive isActive check (returns a computed signal) */
  isActiveSignal(path: string, exact = false): ReadonlySignal<boolean> {
    return computed(() => {
      const match = this.current.value
      if (!match) return false
      const currentPath = match.url.pathname
      return exact ? currentPath === path : currentPath.startsWith(path)
    })
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
// Global Router Instance (optional singleton pattern)
// ============================================================================

let globalRouter: Router | null = null

/**
 * Get the global router instance
 * Throws if router hasn't been initialized
 */
export function getRouter(): Router {
  if (!globalRouter) {
    throw new Error('[solarflare] Router not initialized. Call initRouter() first.')
  }
  return globalRouter
}

/**
 * Initialize the global router instance
 * Returns the router for chaining
 */
export function initRouter(manifest: RoutesManifest, config?: RouterConfig): Router {
  globalRouter = createRouter(manifest, config)
  return globalRouter
}

// ============================================================================
// Convenience Functions (use global router)
// ============================================================================

/**
 * Navigate using the global router
 * @example navigate('/blog/my-post')
 */
export function navigate(to: string | URL, options?: NavigateOptions): Promise<void> {
  return getRouter().navigate(to, options)
}

/**
 * Check if path is active using global router
 */
export function isActive(path: string, exact = false): boolean {
  return getRouter().isActive(path, exact)
}

// ============================================================================
// Link Enhancement (vanilla DOM)
// ============================================================================

/**
 * Enhance existing anchor elements with SPA navigation
 * Call this after dynamic content is added to the page
 *
 * @example
 * ```ts
 * // Enhance all links in a container
 * enhanceLinks(document.querySelector('.dynamic-content'))
 *
 * // Or enhance specific links
 * enhanceLinks(document.querySelectorAll('a[data-spa]'))
 * ```
 */
export function enhanceLinks(
  target: Element | NodeListOf<Element> | null,
  router?: Router
): void {
  if (!target) return

  const r = router ?? globalRouter
  if (!r) {
    console.warn('[solarflare] Cannot enhance links: router not initialized')
    return
  }

  const elements = 'forEach' in target ? target : [target]

  elements.forEach((el) => {
    const links = el.tagName === 'A' ? [el as HTMLAnchorElement] : el.querySelectorAll('a')

    links.forEach((link) => {
      // Skip already enhanced or external links
      if (link.dataset.spaEnhanced) return
      if (link.target && link.target !== '_self') return

      const href = link.getAttribute('href')
      if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:'))
        return

      try {
        const url = new URL(href, location.origin)
        if (url.origin !== location.origin) return

        link.dataset.spaEnhanced = 'true'

        link.addEventListener('click', (event) => {
          if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
          if (event.button !== 0) return

          event.preventDefault()
          r.navigate(url)
        })
      } catch {
        // Invalid URL, skip
      }
    })
  })
}

// ============================================================================
// Active Link Styling (vanilla DOM)
// ============================================================================

/**
 * Update active state classes on links reactively
 * Returns cleanup function
 *
 * @example
 * ```ts
 * // Add 'active' class to current route links
 * const cleanup = trackActiveLinks({
 *   selector: 'nav a',
 *   activeClass: 'active',
 *   exact: false
 * })
 * ```
 */
export function trackActiveLinks(options: {
  selector: string
  activeClass?: string
  exact?: boolean
  router?: Router
}): () => void {
  const { selector, activeClass = 'active', exact = false, router } = options

  const r = router ?? globalRouter
  if (!r) {
    console.warn('[solarflare] Cannot track active links: router not initialized')
    return () => {}
  }

  return effect(() => {
    const match = r.current.value
    const currentPath = match?.url.pathname ?? location.pathname

    document.querySelectorAll<HTMLAnchorElement>(selector).forEach((link) => {
      const href = link.getAttribute('href')
      if (!href) return

      try {
        const url = new URL(href, location.origin)
        const isMatch = exact ? url.pathname === currentPath : currentPath.startsWith(url.pathname)

        link.classList.toggle(activeClass, isMatch)
        link.setAttribute('aria-current', isMatch ? 'page' : '')
      } catch {
        // Invalid URL, skip
      }
    })
  })
}
