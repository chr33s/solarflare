# Solarflare

> cloudflare renderer SSR streaming Preact web components

## Quickstart

```sh
bun install # brew install bun
bun dev --serve --watch
```

```jsx
// src/blog/[slug].server.tsx
export default async function blogServer({ request, params }) {
  return Response.json({
    url: request.url,
    params,
  })
}

// src/blog/[slug].client.tsx
export default function Component({ params }) {
  return <h1>Blog: {params.slug}</h1>
}

// src/api.server.ts
import { env } from 'cloudflare:workers'

export default async function apiServer(request: Request) {
  return Response.json({
    hello: env.HELLO ?? 'world'
    url: request.url,
  });
}
```

### Development

```sh
bun link
bun run clean
bun run build
bun run dev
```

## Framework Implementation Plan

### Overview

A file-based routing framework for Preact + Cloudflare Workers using `preact-custom-element` for web component hydration, TypeScript Compiler API for build-time code generation, pre-resolved module maps for route discovery, and URLPattern for request matching.

### Architecture

```
src/framework/
├── ast.ts           # TypeScript Compiler API utilities for path parsing, validation, code generation
├── build.ts         # Build script: route scanning, validation, client/server bundling
├── client.tsx       # Web component registration, hydration, hooks, SPA router
├── route-tree.ts    # Optimized route tree for O(path_length) URL matching
├── router.ts        # Client SPA router internals (URLPattern, Navigation API, View Transitions)
├── server.tsx       # Server utilities: createRouter(), findLayouts(), matchRoute(), wrapWithLayouts()
├── worker.tsx       # Cloudflare Worker fetch handler with SSR and asset injection
└── solarflare.d.ts  # Type declarations
```

### Package

```json
{
  "bin": "./src/framework/build.ts",
  "exports": {
    "./client": "./src/framework/client.tsx",
    "./server": "./src/framework/server.tsx",
    "./worker": "./src/framework/worker.tsx"
  },
  "dependencies": {
    "@preact/signals": "^2.5.1",
    "preact": "^10.28.0",
    "preact-custom-element": "^4.6.0",
    "preact-render-to-string": "^6.6.3",
    "typescript": "~5.9.3"
  },
  "devDependencies": {
    "@types/bun": "^1.3.4",
    "wrangler": "^4.54.0"
  }
}
```

### File Conventions

| Pattern | Purpose |
|---------|---------|
| `*.client.tsx` | Client components, auto-registered as web components |
| `*.server.tsx` | Server handlers, run in Workers runtime |
| `_layout.tsx` | Layout component, wraps child routes |
| `_*` | Hidden from routes (layouts, components) |
| `$param` | Dynamic URL segment → `:param` in URLPattern |
| `index.*` | Matches directory root path |

### Layouts

Layouts wrap route content and nest from root to leaf. Each `_layout.tsx` receives `children` and optional route data.

#### Layout Example

```
src/app/
├── _layout.tsx           # Root layout (html, head, body)
├── index.server.tsx      # Home page
└── blog/
    ├── _layout.tsx       # Blog layout (sidebar, nav)
    └── $slug.server.tsx  # Blog post page
```

#### Layout Component

```tsx
// src/app/_layout.tsx
import type { ComponentChildren } from "preact";

interface Props {
  children: ComponentChildren;
}

export default function RootLayout({ children }: Props) {
  return (
    <html>
      <head>
        <meta charset="utf-8" />
        <script type="module" src="/index.js"></script>
      </head>
      <body>{children}</body>
    </html>
  );
}
```

```tsx
// src/app/blog/_layout.tsx
import type { ComponentChildren } from "preact";

interface Props {
  children: ComponentChildren;
}

export default function BlogLayout({ children }: Props) {
  return (
    <div class="blog-container">
      <nav>Blog Navigation</nav>
      <main>{children}</main>
    </div>
  );
}
```

#### Rendered Output

Request to `/blog/hello` renders nested layouts:

```html
<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <link rel="stylesheet" href="/index.css">
    <script type="module" src="/blog.slug.js"></script>
  </head>
  <body>
    <div class="blog-container">
      <nav>Blog Navigation</nav>
      <main>
        <sf-blog-slug slug="hello">
          <article>...</article>
        </sf-blog-slug>
      </main>
    </div>
  </body>
</html>
```

### Build Process

The build runs via `bun run build` (which executes `bunx solarflare`):

1. **Scan** — Find all `*.client.tsx`, `*.server.tsx`, and `_layout.tsx` files
2. **Validate** — Use TypeScript Compiler API to validate module exports
3. **Generate Modules** — Create `.modules.generated.ts` with pre-resolved imports
4. **Build Client** — Per-route code splitting, generates chunk manifest
5. **Build Server** — Bundle for Cloudflare Workers runtime
6. **Inject Assets** — CSS and JS paths resolved from chunk manifest

#### Generated Files

```
src/app/
├── .modules.generated.ts    # Pre-resolved route imports (temp, deleted after build)
└── .chunks.generated.json   # Chunk manifest (temp, deleted after build)

dist/
├── routes.json              # Routes manifest (exposed as solarflare:routes)
└── routes.d.ts              # Type-safe route definitions (exposed as solarflare:routes/types)
```

### Client Router

The client router enables SPA navigation using native browser APIs:
- **URLPattern** for route matching
- **Navigation API** for intercepting navigation
- **View Transitions API** for smooth page transitions
- **Preact Signals** for reactive state

#### Usage

```tsx
// src/app/index.client.tsx
import { createRouter, RouterProvider, Link, useRoute, useNavigate } from 'solarflare/client'
import manifest from 'solarflare:routes'

// Create router from build-time manifest
const router = createRouter(manifest, {
  viewTransitions: true,
  onNavigate: (match) => console.log('Navigated to:', match.url.pathname)
})

function App() {
  return (
    <RouterProvider router={router}>
      <nav>
        <Link to="/" activeClass="active" exact>Home</Link>
        <Link to="/blog/hello" activeClass="active">Blog Post</Link>
      </nav>
      <Content />
    </RouterProvider>
  )
}

function Content() {
  const match = useRoute()
  const navigate = useNavigate()
  
  return (
    <div>
      <p>Current path: {match?.url.pathname}</p>
      <button onClick={() => navigate('/blog/world')}>
        Go to World
      </button>
    </div>
  )
}
```

#### Routes Manifest Format

```json
{
  "routes": [
    {
      "pattern": "/blog/:slug",
      "tag": "sf-blog-slug",
      "chunk": "/blog.slug.js",
      "styles": ["/blog.css"],
      "type": "client",
      "params": ["slug"]
    },
    {
      "pattern": "/",
      "tag": "sf-root",
      "chunk": "/index.js",
      "type": "client",
      "params": []
    },
    {
      "pattern": "/api",
      "tag": "sf-api",
      "type": "server",
      "params": []
    }
  ]
}
```

### Web Component Registration

#### How It Works

The `define` function runs at **runtime** in the browser and:
1. Parses the tag name from the file path using `parsePath()` from ast.ts
2. Validates the tag against web component naming rules
3. Registers the component with `preact-custom-element`

#### Usage

```tsx
// src/app/blog/$slug.client.tsx
import { define } from "solarflare/client";

interface Props {
  slug: string;
  title: string;
  content: string;
}

function BlogPost({ slug, title, content }: Props) {
  return (
    <article>
      <h1>{title}</h1>
      <div>{content}</div>
    </article>
  );
}

// Props are passed via build-time extraction
// Tag "sf-blog-slug" is generated from file path
export default define(BlogPost);
```

#### Build-Time Props Extraction

The build script uses TypeScript Compiler API to extract props:

```tsx
// src/framework/build.ts
function extractPropsFromProgram(program: ts.Program, filePath: string): string[] {
  const checker = program.getTypeChecker()
  const sourceFile = program.getSourceFile(filePath)
  const exportInfo = getDefaultExportInfo(checker, sourceFile)
  
  // Get first parameter type (props)
  const firstParam = exportInfo.signatures[0].getParameters()[0]
  const paramType = checker.getTypeOfSymbolAtLocation(firstParam, sourceFile)
  
  return paramType.getProperties().map((p) => p.getName())
}
```

#### Generated Client Entry

Each component gets its own chunk entry:

```tsx
// .entry-blog.slug.generated.tsx (auto-generated, temp file)
import register from 'preact-custom-element'
import Component from './app/blog/$slug.client.tsx'

register(Component, 'sf-blog-slug', ["slug", "title", "content"], { shadow: false })
```

#### `solarflare/client` (client.tsx)

```tsx
import { type FunctionComponent, createContext } from 'preact'
import { useContext } from 'preact/hooks'
import register from 'preact-custom-element'
import { parsePath } from './ast'

const ParamsContext = createContext<Record<string, string>>({})
const DataContext = createContext<unknown>(null)

/** Hook to access current route params */
export function useParams(): Record<string, string> {
  return useContext(ParamsContext)
}

/** Hook to access parsed data attribute */
export function useData<T>(): T {
  return useContext(DataContext) as T
}

export interface TagMeta {
  tag: string
  filePath: string
  segments: string[]
  paramNames: string[]
  isRoot: boolean
  type: 'client' | 'server' | 'unknown'
}

/** Parse file path into structured tag metadata */
export function parseTagMeta(path: string): TagMeta {
  const parsed = parsePath(path)
  return {
    tag: parsed.tag,
    filePath: parsed.original,
    segments: parsed.segments,
    paramNames: parsed.params,
    isRoot: parsed.isIndex,
    type: parsed.kind === 'client' || parsed.kind === 'server' ? parsed.kind : 'unknown',
  }
}

/** Validate a generated tag against web component naming rules */
export function validateTag(meta: TagMeta): TagValidation

export interface DefineOptions {
  tag?: string
  shadow?: boolean
  observedAttributes?: string[]
  validate?: boolean
}

/** Register a Preact component as a web component */
export function define<P>(
  Component: FunctionComponent<P>,
  options?: DefineOptions
): FunctionComponent<P> {
  if (typeof window !== 'undefined' && typeof HTMLElement !== 'undefined') {
    const propNames = options?.observedAttributes ?? []
    const filePath = import.meta.path
    const meta = parseTagMeta(filePath)
    const tag = options?.tag ?? meta.tag
    const shadow = options?.shadow ?? false

    register(Component, tag, propNames, { shadow })
  }
  return Component
}
```

#### `solarflare/ast` (ast.ts)

```tsx
import ts from 'typescript'

export type ModuleKind = 'server' | 'client' | 'layout' | 'unknown'

export interface ParsedPath {
  original: string
  normalized: string
  kind: ModuleKind
  segments: string[]
  params: string[]
  isIndex: boolean
  isPrivate: boolean
  pattern: string      // URLPattern pathname
  tag: string          // Custom element tag
  specificity: number  // Route sorting score
}

/** Determine module kind from file path */
export function getModuleKind(filePath: string): ModuleKind

/** Parse a file path into structured metadata */
export function parsePath(filePath: string): ParsedPath

/** Create a shared TypeScript program for analyzing multiple files */
export function createProgram(files: string[]): ts.Program

/** Get detailed information about a module's default export */
export function getDefaultExportInfo(checker: ts.TypeChecker, sourceFile: ts.SourceFile): ExportInfo | null

/** Validate a module against expected patterns */
export function validateModule(program: ts.Program, filePath: string, baseDir?: string): ValidationResult

/** Find paired modules for a given path (client/server pairs, layouts) */
export function findPairedModules(filePath: string, availableModules: string[]): PairedModules

/** Generate a complete type-safe modules file */
export function generateTypedModulesFile(entries: ModuleEntry[]): { content: string; errors: string[] }
```

#### Router API (exported from `solarflare/client`)

```tsx
import { Signal, ReadonlySignal } from '@preact/signals'

/** Route definition from build-time manifest */
export interface RouteManifestEntry {
  pattern: string           // URLPattern pathname (e.g., '/blog/:slug')
  tag: string               // Custom element tag name
  chunk?: string            // Chunk path for this route's JS
  styles?: string[]         // CSS stylesheets for this route
  type: 'client' | 'server' // Route type
  params: string[]          // Dynamic parameter names
}

/** Build-time routes manifest */
export interface RoutesManifest {
  routes: RouteManifestEntry[]
  base?: string             // Base path for all routes
}

/** Route match result */
export interface RouteMatch {
  entry: RouteManifestEntry
  params: Record<string, string>
  url: URL
}

/** Router configuration */
export interface RouterConfig {
  base?: string                                    // Base path for all routes
  viewTransitions?: boolean                        // Enable view transitions (default: true if supported)
  scrollBehavior?: 'auto' | 'smooth' | 'instant' | false
  onNotFound?: (url: URL) => void                  // Called when no route matches
  onNavigate?: (match: RouteMatch) => void         // Called after navigation
}

/** Check if Navigation API is supported */
export function supportsNavigation(): boolean

/** Check if View Transitions API is supported */
export function supportsViewTransitions(): boolean

/** Create a router from build-time routes manifest */
export function createRouter(manifest: RoutesManifest, config?: RouterConfig): Router

/** Router class */
export class Router {
  /** Reactive current match (Preact Signal) */
  readonly current: Signal<RouteMatch | null>
  
  /** Reactive params derived from current match */
  readonly params: ReadonlySignal<Record<string, string>>
  
  /** Match a URL against registered routes */
  match(url: URL): RouteMatch | null
  
  /** Navigate to a URL */
  navigate(to: string | URL, options?: NavigateOptions): Promise<void>
  
  /** Navigate back/forward in history */
  back(): void
  forward(): void
  go(delta: number): void
  
  /** Start/stop the router */
  start(): this
  stop(): this
}

// Preact hooks
export function useRouter(): Router
export function useRoute(): RouteMatch | null
export function useParams(): Record<string, string>
export function useNavigate(): (to: string | URL, options?: NavigateOptions) => Promise<void>
export function useIsActive(path: string, exact?: boolean): boolean

// Preact components
export const RouterProvider: FunctionComponent<{ router: Router; children?: VNode }>
export const Link: FunctionComponent<{
  to: string
  options?: NavigateOptions
  children?: VNode | string
  class?: string
  activeClass?: string
  exact?: boolean
}>
```

#### `solarflare/server` (server.tsx)

```tsx
import { type VNode, h } from 'preact'
import { parsePath } from './ast'

export const ASSETS_MARKER = '<!--SOLARFLARE_ASSETS-->'

/** Assets placeholder - place in root layout for CSS/JS injection */
export function Assets(): VNode<any>

export interface Route {
  pattern: URLPattern
  parsedPattern: ParsedPattern
  path: string
  tag: string
  loader: () => Promise<{ default: unknown }>
  type: 'client' | 'server'
}

export interface ParsedPattern {
  filePath: string
  pathname: string
  params: RouteParamDef[]
  isStatic: boolean
  specificity: number
}

/** Convert file path to URLPattern pathname with parsed metadata */
export function parsePattern(filePath: string): ParsedPattern

export interface ModuleMap {
  server: Record<string, () => Promise<{ default: unknown }>>
  client: Record<string, () => Promise<{ default: unknown }>>
  layout: Record<string, () => Promise<{ default: unknown }>>
}

/** Create router from structured module map */
export function createRouter(modules: ModuleMap): Route[]

export interface Layout {
  path: string
  loader: () => Promise<{ default: unknown }>
  depth: number
  directory: string
}

/** Find all ancestor layouts for a route path */
export function findLayouts(routePath: string, modules: ModuleMap): Layout[]

export interface RouteMatch {
  route: Route
  params: Record<string, string>
  paramDefs: RouteParamDef[]
  complete: boolean
}

/** Match URL against routes using URLPattern */
export function matchRoute(routes: Route[], url: URL): RouteMatch | null

/** Wrap content in nested layouts (innermost first) */
export async function wrapWithLayouts(content: VNode, layouts: Layout[]): Promise<VNode>

/** Generate asset HTML tags for injection */
export function generateAssetTags(script?: string, styles?: string[]): string

/** Render a component with its tag wrapper for hydration */
export function renderComponent(Component: FunctionComponent, tag: string, props: Record<string, unknown>): VNode
```

#### `solarflare/route-tree` (route-tree.ts)

Optimized route lookups using a hierarchical tree structure. Reduces sequential matching of all URL patterns by narrowing the search space as we traverse, achieving O(path_length) lookups instead of O(num_routes).

```tsx
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
  /** Routes that terminate at this node */
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
 * Optimized Route Tree for fast URL matching
 *
 * Routes are organized hierarchically:
 * - Static segments are checked first (fastest)
 * - Parameterized segments (:id) are checked second
 * - Wildcard segments (*) are checked last
 */
export class RouteTree {
  /** Root node of the tree */
  readonly root: RouteNode

  /** Add a route to the tree */
  addRoute(route: Route): void

  /** Add multiple routes to the tree */
  addRoutes(routes: Route[]): void

  /** Match a URL against the route tree */
  match(url: URL): TreeMatch | null

  /** Clear the match cache */
  clearCache(): void

  /** Get all routes in the tree (for compatibility) */
  getRoutes(): Route[]

  /** Get tree statistics for debugging */
  getStats(): {
    totalRoutes: number
    cacheSize: number
    treeDepth: number
    staticNodes: number
    paramNodes: number
    wildcardNodes: number
  }
}

/** Create a route tree from an array of routes */
export function createRouteTree(routes: Route[]): RouteTree

/** Match a URL against the route tree and return a RouteMatch (compatible with matchRoute API) */
export function matchRouteFromTree(tree: RouteTree, url: URL): RouteMatch | null
```

#### `solarflare/worker` (worker.tsx)

```tsx
import { type FunctionComponent } from 'preact'
import { renderToString } from 'preact-render-to-string'
import {
  createRouter,
  matchRoute,
  findLayouts,
  wrapWithLayouts,
  renderComponent,
  generateAssetTags,
  ASSETS_MARKER,
  type ModuleMap,
} from './server'
// Generated at build time
import modules from '../app/.modules.generated'
import chunkManifest from '../app/.chunks.generated.json'

interface ChunkManifest {
  chunks: Record<string, string>    // pattern -> chunk filename
  tags: Record<string, string>      // tag -> chunk filename
  styles: Record<string, string[]>  // pattern -> CSS filenames
}

const routes = createRouter(modules as ModuleMap)

/** Get the script path for a route from the chunk manifest */
function getScriptPath(tag: string): string | undefined

/** Get stylesheets for a route pattern from the chunk manifest */
function getStylesheets(pattern: string): string[]

/** Find paired module (server for client, or client for server) */
function findPairedModule(path: string): string | null

/** Cloudflare Worker fetch handler */
async function worker(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url)

  // Serve static assets first
  if (url.pathname !== '/' && url.pathname.includes('.')) {
    const asset = await env.ASSETS.fetch(request)
    if (asset.ok) return asset
  }

  const match = matchRoute(routes, url)
  if (!match) return new Response('Not Found', { status: 404 })

  const { route, params } = match

  // Server-only routes (no paired client) return Response directly
  if (route.type === 'server' && !findPairedModule(route.path)) {
    const mod = await route.loader()
    return (mod.default as Function)(request)
  }

  // Load props from server loader if available
  let props: Record<string, unknown> = { ...params }
  const serverPath = findPairedModule(route.path)
  if (serverPath) {
    const serverMod = await modules.server[serverPath]()
    props = { ...params, ...(await serverMod.default(request)) }
  }

  // Load and render client component
  const clientMod = await modules.client[route.path]()
  const Component = clientMod.default as FunctionComponent
  let content = renderComponent(Component, route.tag, props)

  // Apply layouts
  const layouts = findLayouts(route.path, modules)
  if (layouts.length > 0) {
    content = await wrapWithLayouts(content, layouts)
  }

  // Render to HTML and inject assets
  let html = renderToString(content)
  const assetTags = generateAssetTags(getScriptPath(route.tag), getStylesheets(route.parsedPattern.pathname))
  html = html.replace(`<solarflare-assets>${ASSETS_MARKER}</solarflare-assets>`, assetTags)

  return new Response(html, {
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  })
}

export default worker
```

##### Entry Server Integration

```tsx
// src/app/index.ts
import worker from 'solarflare/worker'

export default { fetch: worker }
```

### Types

```tsx
/** Module kind based on file naming convention */
type ModuleKind = 'server' | 'client' | 'layout' | 'unknown'

/** Parsed path information with AST-validated metadata */
interface ParsedPath {
  original: string
  normalized: string
  kind: ModuleKind
  segments: string[]
  params: string[]
  isIndex: boolean
  isPrivate: boolean
  pattern: string
  tag: string
  specificity: number
}

/** Route definition with parsed pattern metadata */
interface Route {
  pattern: URLPattern
  parsedPattern: ParsedPattern
  path: string
  tag: string
  loader: () => Promise<{ default: unknown }>
  type: 'client' | 'server'
}

/** Validated route match with type-safe params */
interface RouteMatch {
  route: Route
  params: Record<string, string>
  paramDefs: RouteParamDef[]
  complete: boolean
}

/** Layout definition with hierarchy information */
interface Layout {
  path: string
  loader: () => Promise<{ default: unknown }>
  depth: number
  directory: string
}

/** Structured module map with typed categories */
interface ModuleMap {
  server: Record<string, () => Promise<{ default: unknown }>>
  client: Record<string, () => Promise<{ default: unknown }>>
  layout: Record<string, () => Promise<{ default: unknown }>>
}

/** Chunk manifest mapping routes to their JS chunks and CSS */
interface ChunkManifest {
  chunks: Record<string, string>    // pattern -> chunk filename
  tags: Record<string, string>      // tag -> chunk filename
  styles: Record<string, string[]>  // pattern -> CSS filenames
}

/** Tag metadata from file path */
interface TagMeta {
  tag: string
  filePath: string
  segments: string[]
  paramNames: string[]
  isRoot: boolean
  type: 'client' | 'server' | 'unknown'
}

/** Validation result for modules */
interface ValidationResult {
  file: string
  kind: ModuleKind
  valid: boolean
  errors: string[]
  warnings: string[]
  exportInfo: ExportInfo | null
}

/** Route tree node for hierarchical URL matching */
interface RouteNode {
  static: Map<string, RouteNode>      // Static segment children
  parameterized: RouteNode | null     // Parameterized segment child (:id)
  paramName: string | null            // Parameter name for parameterized nodes
  wildcard: RouteNode | null          // Wildcard segment child (*)
  routes: Route[]                     // Routes terminating at this node
}

/** Match result from route tree traversal */
interface TreeMatch {
  route: Route                        // The matched route
  params: Record<string, string>      // Extracted URL parameters
  matchedSegments: string[]           // Matched path segments
}
```

### SSR Output Example

Server renders:
```html
<!DOCTYPE html>
<html>
<head>
  <link rel="stylesheet" href="/index.css">
  <script type="module" src="/blog.slug.js"></script>
</head>
<body>
  <sf-blog-slug slug="hello" title="Hello World" content="...">
    <!-- SSR content -->
    <article><h1>Hello World</h1></article>
  </sf-blog-slug>
</body>
</html>
```

### Implementation Steps

1. **ast.ts** — `parsePath()`, `createProgram()`, `validateModule()`, `generateTypedModulesFile()`
2. **build.ts** — Route scanning, validation, client/server bundling, chunk manifest generation
3. **route-tree.ts** — `RouteTree` class, `createRouteTree()`, `matchRouteFromTree()` for O(path_length) lookups
4. **client.tsx** — `define()` with tag validation, `useParams()`, `useData()` hooks
5. **server.tsx** — `createRouter()`, `matchRoute()`, `findLayouts()`, `wrapWithLayouts()`, `renderComponent()`, `Assets`
6. **worker.tsx** — Fetch handler with SSR, asset injection from chunk manifest

### Benefits

- **Zero config** — Props auto-extracted from TypeScript types via Compiler API
- **Type-safe** — Full TypeScript support for component props and route params
- **Build-time validation** — Module exports validated against expected signatures
- **Per-route code splitting** — Each client component gets its own chunk
- **Fast routing** — O(path_length) lookups via hierarchical route tree with LRU caching
- **DX** — Just export `define(Component)`, everything else is automatic
- **Nested layouts** — Automatic layout discovery and nesting
- **Asset injection** — CSS and JS paths resolved from chunk manifest

### Documentation

- All exports documented with JSDoc comments
- Type declarations in `solarflare.d.ts`

### Future plans

#### devalue for Serialization

The current attribute-based prop passing (<sf-blog-slug slug="hello" title="Hello">) only supports strings and has XSS/size concerns. sveltejs/devalue is the best fit—it enables complex types (Date, Map, Set), is XSS-safe, and requires minimal changes

**Steps:**
1. Add devalue dependency — Add devalue to package.json dependencies (~3KB)
2. Create data island serializer in server.tsx — Use uneval() to emit <script>window.__SF__=...</script> with all component data keyed by ID
3. Update SSR rendering — Change custom element output from inline attributes to data-sf="component-id" references
4. Modify useData() hook in client.tsx — Read from window.__SF__[id] instead of DOM attributes
5. Adjust define() macro output — Generate hydration wrapper that pulls props from data island, not observed attributes

**Further Considerations:**
- Data island placement: Single global script at `</body>` for fewer DOM nodes
- Streaming SSR: Data island must come before components or use dynamic injection
- `capnweb` for client→Worker RPC: Separate from hydration — Phase 2
