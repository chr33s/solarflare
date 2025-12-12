/**
 * Auto-generated Route Types
 * Provides type-safe route definitions
 */

export interface Routes {
  '/blog/:slug': { params: { slug: string } }
  '/': { params: Record<string, never> }
}

export type RoutePath = keyof Routes

export type RouteParams<T extends RoutePath> = Routes[T]['params']
