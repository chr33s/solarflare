/**
 * Solarflare Client
 * Web component registration, hydration & Bun macros
 */
import { type FunctionComponent, createContext } from 'preact'
import { useContext } from 'preact/hooks'
import register from 'preact-custom-element'
import { parsePath } from './ast'

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
 * Parsed tag metadata from file path
 */
export interface TagMeta {
  /** Generated custom element tag name */
  tag: string
  /** Original file path */
  filePath: string
  /** Route segments extracted from path */
  segments: string[]
  /** Dynamic parameter names (from $param segments) */
  paramNames: string[]
  /** Whether this is the root/index component */
  isRoot: boolean
  /** Component type based on file suffix */
  type: 'client' | 'server' | 'unknown'
}

/**
 * Validation result for tag generation
 */
export interface TagValidation {
  /** Whether the tag is valid */
  valid: boolean
  /** Validation errors */
  errors: string[]
  /** Validation warnings */
  warnings: string[]
}

/**
 * Parse file path into structured tag metadata
 * Delegates to parsePath from ast.ts for unified path handling
 */
export function parseTagMeta(path: string): TagMeta {
  const parsed = parsePath(path)
  
  // Map ModuleKind to TagMeta type
  const type: TagMeta['type'] = parsed.kind === 'client' || parsed.kind === 'server' 
    ? parsed.kind 
    : 'unknown'

  return {
    tag: parsed.tag,
    filePath: parsed.original,
    segments: parsed.segments,
    paramNames: parsed.params,
    isRoot: parsed.isIndex,
    type,
  }
}

/**
 * Validate a generated tag against web component naming rules
 */
export function validateTag(meta: TagMeta): TagValidation {
  const errors: string[] = []
  const warnings: string[] = []

  // Custom element names must contain a hyphen
  if (!meta.tag.includes('-')) {
    errors.push(`Tag "${meta.tag}" must contain a hyphen for custom elements`)
  }

  // Must start with a lowercase letter
  if (!/^[a-z]/.test(meta.tag)) {
    errors.push(`Tag "${meta.tag}" must start with a lowercase letter`)
  }

  // Must not start with reserved prefixes
  const reservedPrefixes = ['xml', 'xlink', 'xmlns']
  for (const prefix of reservedPrefixes) {
    if (meta.tag.toLowerCase().startsWith(prefix)) {
      errors.push(`Tag "${meta.tag}" must not start with reserved prefix "${prefix}"`)
    }
  }

  // Must only contain valid characters
  if (!/^[a-z][a-z0-9-]*$/.test(meta.tag)) {
    errors.push(`Tag "${meta.tag}" contains invalid characters (only lowercase letters, numbers, and hyphens allowed)`)
  }

  // Warn about very long tag names
  if (meta.tag.length > 50) {
    warnings.push(`Tag "${meta.tag}" is very long (${meta.tag.length} chars), consider shorter path`)
  }

  // Warn about server components being registered as custom elements
  if (meta.type === 'server') {
    warnings.push(`Server component "${meta.filePath}" should not be registered as a custom element`)
  }

  // Warn about unknown component types
  if (meta.type === 'unknown') {
    warnings.push(`Component "${meta.filePath}" has unknown type (missing .client. or .server. suffix)`)
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  }
}

/**
 * Generate custom element tag from file path with validation
 * e.g., "app/blog/$slug.client.tsx" → "sf-blog-slug"
 */
export function pathToTagName(path: string): string {
  return parsePath(path).tag
}

export interface DefineOptions {
  /** Custom element tag name. Defaults to generated from file path */
  tag?: string
  /** Whether to use Shadow DOM. Defaults to false */
  shadow?: boolean
  /** Observed attributes to pass as props. Auto-extracted if not provided */
  observedAttributes?: string[]
  /** Whether to validate the tag and warn on issues. Defaults to true in development */
  validate?: boolean
}

/**
 * Registration result with metadata for debugging
 */
export interface DefineResult<P> {
  /** The registered component */
  Component: FunctionComponent<P>
  /** Tag metadata */
  meta: TagMeta
  /** Validation result */
  validation: TagValidation
  /** Whether registration succeeded */
  registered: boolean
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
    const propNames = options?.observedAttributes ?? []
    const filePath = import.meta.path
    const meta = parseTagMeta(filePath)
    const tag = options?.tag ?? meta.tag
    const shadow = options?.shadow ?? false
    const shouldValidate = options?.validate ?? process.env.NODE_ENV !== 'production'

    // Validate tag if enabled
    if (shouldValidate) {
      const validation = validateTag({ ...meta, tag })

      // Log validation warnings in development
      for (const warning of validation.warnings) {
        console.warn(`[solarflare] ${warning}`)
      }

      // Log validation errors (but don't throw to allow recovery)
      for (const error of validation.errors) {
        console.error(`[solarflare] ${error}`)
      }

      if (!validation.valid) {
        console.error(`[solarflare] Tag validation failed for "${filePath}", component may not work correctly`)
      }
    }

    // Register the component as a custom element
    register(Component, tag, propNames, { shadow })
  }

  return Component
}

/**
 * Define with full metadata result (for debugging/testing)
 * Returns the component along with registration metadata
 */
export function defineWithMeta<P extends Record<string, any>>(
  Component: FunctionComponent<P>,
  options?: DefineOptions
): DefineResult<P> {
  const filePath = import.meta.path
  const meta = parseTagMeta(filePath)
  const tag = options?.tag ?? meta.tag
  const validation = validateTag({ ...meta, tag })

  let registered = false

  // Only register custom elements in the browser
  if (typeof window !== 'undefined' && typeof HTMLElement !== 'undefined') {
    const propNames = options?.observedAttributes ?? []
    const shadow = options?.shadow ?? false

    if (validation.valid) {
      register(Component, tag, propNames, { shadow })
      registered = true
    }
  }

  return {
    Component,
    meta: { ...meta, tag },
    validation,
    registered,
  }
}

/**
 * Export ParamsContext and DataContext for framework use
 */
export { ParamsContext, DataContext }
