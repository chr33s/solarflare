/**
 * Solarflare Client
 * Web component registration, hydration & Bun macros
 */
import { type FunctionComponent, createContext } from 'preact'
import { useContext } from 'preact/hooks'
import register from 'preact-custom-element'

/**
 * Context for current route params
 */
const ParamsContext = createContext<Record<string, string>>({})

/**
 * Context for component data
 */
const DataContext = createContext<unknown>(null)

/**
 * Hook to access current route params
 */
export function useParams(): Record<string, string> {
  return useContext(ParamsContext)
}

/**
 * Hook to access parsed data attribute
 */
export function useData<T>(): T {
  return useContext(DataContext) as T
}

/**
 * Generate custom element tag from file path
 * e.g., "app/blog/$slug.client.tsx" → "sf-blog-slug"
 */
function pathToTagName(path: string): string {
  return (
    'sf-' +
    path
      .replace(/^.*\/app\//, '')
      .replace(/\.(client|server)\.tsx$/, '')
      .replace(/\//g, '-')
      .replace(/\$/g, '')
      .replace(/index$/, 'root')
      .toLowerCase()
  )
}

/**
 * Extract prop names from component function parameters
 * This is a runtime fallback - the macro version extracts from TypeScript types
 */
function extractPropNames(Component: FunctionComponent<any>): string[] {
  // Try to get from component's displayName or name
  const fnStr = Component.toString()
  
  // Match destructured props pattern: function({ prop1, prop2 }) or ({ prop1, prop2 }) =>
  const destructuredMatch = fnStr.match(/^(?:function\s*\w*\s*)?\(\s*\{\s*([^}]+)\s*\}/)
  if (destructuredMatch) {
    return destructuredMatch[1]
      .split(',')
      .map(s => s.trim().split(/[=:]/)[0].trim())
      .filter(Boolean)
  }
  
  return []
}

export interface DefineOptions {
  /** Custom element tag name. Defaults to generated from file path */
  tag?: string
  /** Whether to use Shadow DOM. Defaults to false */
  shadow?: boolean
  /** Observed attributes to pass as props. Auto-extracted if not provided */
  observedAttributes?: string[]
}

/**
 * Build-time macro that registers a Preact component as a web component
 * Extracts observed attributes from the component's props type
 * 
 * @example
 * ```tsx
 * import { define } from "solarflare/client" with { type: "macro" };
 * 
 * interface Props {
 *   slug: string;
 *   title: string;
 * }
 * 
 * function BlogPost({ slug, title }: Props) {
 *   return <article><h1>{title}</h1></article>;
 * }
 * 
 * export default define(BlogPost);
 * ```
 */
export function define<P extends Record<string, any>>(
  Component: FunctionComponent<P>,
  options?: DefineOptions
): FunctionComponent<P> {
  // Only register custom elements in the browser
  if (typeof window !== 'undefined' && typeof HTMLElement !== 'undefined') {
    // At build time, Bun macros have access to the AST and can extract prop names
    // At runtime, we fall back to parsing the function string
    const propNames = options?.observedAttributes ?? extractPropNames(Component)
    const tag = options?.tag ?? pathToTagName(import.meta.path)
    const shadow = options?.shadow ?? false

    // Register the component as a custom element
    register(Component, tag, propNames, { shadow })
  }

  return Component
}

/**
 * Export ParamsContext and DataContext for framework use
 */
export { ParamsContext, DataContext }
