# Solarflare

> cloudflare renderer SSR streaming Preact web components

## Quickstart

```sh
bun install
bun run build
bun run dev
bun link
```

## Framework Implementation Plan

### Overview

A file-based routing framework for Preact + Cloudflare Workers using `preact-custom-element` for web component hydration, Bun macros for build-time code generation, `import.meta.glob` for route discovery, and URLPattern for request matching.

### Architecture

```
src/framework/
├── client.tsx       # Web component registration, hydration & Bun macros
├── server.tsx       # Server utilities: parse(), createRouter(), findLayouts()
├── worker.tsx       # Cloudflare Worker fetch handler factory
├── cloudflare.ts    # Bun plugin for local CF APIs
└── solarflare.d.ts  # Type declarations
```

### Package

```json
{
  "exports": {
    "./client": "./src/framework/client.tsx",
    "./server": "./src/framework/server.tsx",
    "./worker": "./src/framework/worker.tsx"
  },
  "dependencies": {
    "preact": "^11.0.0-beta.0",
    "preact-render-to-string": "^6.6.3",
    "preact-custom-element": "^4.6.0"
  },
  "devDependencies": {
    "@types/bun": "^1.3.4",
    "typescript": "~5.9.2",
    "wrangler": "^4.53.0"
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
    <script type="module" src="/index.js"></script>
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

### Bun Macro: Auto Web Component Registration

#### How It Works

The `define` macro runs at **build time** and:
1. Extracts prop names from the component's TypeScript interface
2. Generates the custom element tag name from the file path
3. Outputs the `preact-custom-element` registration code

#### Usage

```tsx
// src/app/blog/$slug.client.tsx
import { define } from "solarflare/client" with { type: "macro" };

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

// Macro extracts ["slug", "title", "content"] from Props
// Generates tag "sf-blog-slug" from file path
export default define(BlogPost);
```

#### Build Output

The macro transforms the above into:

```tsx
import register from "preact-custom-element";

function BlogPost({ slug, title, content }) {
  return (
    <article>
      <h1>{title}</h1>
      <div>{content}</div>
    </article>
  );
}

register(BlogPost, "sf-blog-slug", ["slug", "title", "content"], { shadow: false });

export default BlogPost;
```

#### Macro Implementation

```tsx
// src/framework/client.tsx
import type { FunctionComponent } from "preact";

/**
 * Build-time macro that registers a Preact component as a web component
 * Extracts observed attributes from the component's props type
 */
export function define<P>(
  Component: FunctionComponent<P>,
  options?: { shadow?: boolean; tag?: string }
): FunctionComponent<P> {
  // This runs at build time via Bun macros
  // Bun's macro system has access to the AST and can extract prop names
  
  const propNames = extractPropNames(Component); // Build-time introspection
  const tag = options?.tag ?? generateTagName(); // From import.meta.path
  
  // Emits: register(Component, tag, propNames, { shadow: false })
  return Component;
}

/**
 * Extract prop names from component's TypeScript interface
 * Only available at build time via Bun macro
 */
function extractPropNames(Component: unknown): string[] {
  // Bun macro has access to TypeScript types at build time
  // Returns array of prop names from the Props interface
}

/**
 * Generate custom element tag from file path
 * e.g., "app/blog/$slug.client.tsx" → "sf-blog-slug"
 */
function generateTagName(): string {
  const path = import.meta.path;
  return pathToTagName(path);
}

/**
 * Hook to access current route params
 */
export function useParams(): Record<string, string>;

/**
 * Hook to access parsed data attribute
 */
export function useData<T>(): T;
```

#### `solarflare/server` (server.tsx)

```tsx
/**
 * Cloudflare Server handler
 */
/**
 * Convert file path to URLPattern pathname
 * e.g., "./app/blog/$slug.client.tsx" → "/blog/:slug"
 */
function pathToPattern(filePath: string): string {
  return filePath
    .replace(/^\.\/app/, '')
    .replace(/\.(client|server)\.tsx$/, '')
    .replace(/\/index$/, '')
    .replace(/\$([^/]+)/g, ':$1')
    || '/'
}

/**
 * Generate custom element tag from file path
 * e.g., "./app/blog/$slug.client.tsx" → "sf-blog-slug"
 */
function pathToTag(filePath: string): string {
  return 'sf-' + filePath
    .replace(/^\.\/app\//, '')
    .replace(/\.(client|server)\.tsx$/, '')
    .replace(/\//g, '-')
    .replace(/\$/g, '')
    .replace(/index$/, 'root')
    .toLowerCase()
}

/**
 * Create router from import.meta.glob result
 * Filters out _prefixed files, sorts static before dynamic routes
 */
function createRouter(
  modules: Record<string, () => Promise<{ default: unknown }>>
): Route[] {
  return Object.entries(modules)
    .filter(([path]) => !path.includes('/_'))
    .map(([path, loader]) => ({
      pattern: new URLPattern({ pathname: pathToPattern(path) }),
      path,
      tag: pathToTag(path),
      loader,
      type: path.includes('.server.') ? 'server' : 'client',
    }))
    .sort((a, b) => {
      const aStatic = !a.pattern.pathname.includes(':')
      const bStatic = !b.pattern.pathname.includes(':')
      if (aStatic !== bStatic) return aStatic ? -1 : 1
      return b.path.length - a.path.length
    })
}

/**
 * Find all ancestor layouts for a route path
 * Returns layouts from root to leaf order
 * e.g., "./app/blog/$slug.server.tsx" → ["./app/_layout.tsx", "./app/blog/_layout.tsx"]
 */
function findLayouts(
  routePath: string,
  modules: Record<string, () => Promise<{ default: unknown }>>
): Layout[] {
  const layouts: Layout[] = []
  const segments = routePath.replace(/^\.\/app/, '').split('/').slice(0, -1)
  
  // Check root layout first
  const rootLayout = './app/_layout.tsx'
  if (rootLayout in modules) {
    layouts.push({ path: rootLayout, loader: modules[rootLayout] })
  }
  
  // Walk up the path checking for layouts
  let current = './app'
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
function matchRoute(routes: Route[], url: URL): RouteMatch | null {
  for (const route of routes) {
    const result = route.pattern.exec(url)
    if (result) {
      return {
        route,
        params: result.pathname.groups as Record<string, string>,
      }
    }
  }
  return null
}

/**
 * Wrap content in nested layouts (innermost first)
 */
async function wrapWithLayouts(
  content: VNode,
  layouts: Layout[]
): Promise<VNode> {
  let wrapped = content
  
  // Apply layouts from leaf to root (reverse order)
  for (let i = layouts.length - 1; i >= 0; i--) {
    const { loader } = layouts[i]
    const { default: Layout } = await loader()
    wrapped = <Layout>{wrapped}</Layout>
  }
  
  return wrapped
}
```

#### `solarflare/worker` (worker.tsx)

```tsx
/**
 * Cloudflare Worker fetch handler
 * Discovers routes via import.meta.glob and handles SSR
 */
import { h } from 'preact'
import { renderToReadableStream } from 'preact-render-to-string/stream'
import { createRouter, matchRoute } from './server'

/**
 * Factory function that creates a Cloudflare Worker fetch handler
 * @param path - Glob pattern for route discovery (e.g., './*')
 */
export default function worker(path: string) {
  const modules = import.meta.glob(path)
  const routes = createRouter(modules)

  return async (request: Request, env: Env) => {
    const url = new URL(request.url)

    // Serve static assets first (non-root paths)
    if (url.pathname !== '/') {
      const asset = await env.ASSETS.fetch(request.url)
      if (asset.ok) return asset
    }

    const match = matchRoute(routes, url)
    if (match) {
      const module = await match.route.loader()

      // Server routes return Response directly
      if (match.route.type === 'server') {
        return (module.default as Function)(request, match.params, env)
      }

      // Client routes get SSR + hydration via custom elements
      const Component = module.default as preact.FunctionComponent
      const customElement = h(match.route.tag, match.params, h(Component, match.params))

      const stream = renderToReadableStream(
        <html>
          <head>
            <script type="module" src="/index.js"></script>
          </head>
          <body>{customElement}</body>
        </html>
      )

      return new Response(stream, {
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      })
    }

    return new Response('Not Found', { status: 404 })
  }
}
```

##### Entry Server Integration

```tsx
// src/app/index.ts
import worker from 'solarflare/worker'

export default {
  fetch: worker('./*')
}
```

### Types

```tsx
interface Route {
  pattern: URLPattern;
  path: string;
  tag: string;
  loader: () => Promise<{ default: unknown }>;
  type: "client" | "server";
}

interface RouteMatch {
  route: Route;
  params: Record<string, string>;
}

interface Layout {
  path: string;
  loader: () => Promise<{ default: unknown }>;
}
```

### SSR Output Example

Server renders:
```html
<!DOCTYPE html>
<html>
<head>
  <script type="module" src="/index.js"></script>
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

1. **client.tsx** — `define()` macro with prop extraction, tag generation, runtime fallback, hooks
2. **server.tsx** — `parse()`, `matchRoute()`, `findLayouts()`, `wrapWithLayouts()`, `renderComponent()`
3. **worker.tsx** — Fetch handler with SSR streaming, layout wrapping

### Benefits

- **Zero config** — Props auto-extracted from TypeScript types
- **Type-safe** — Full TypeScript support for component props
- **Build-time** — No runtime overhead for registration logic
- **DX** — Just export `define(Component)`, everything else is automatic
- **Nested layouts** — Automatic layout discovery and nesting

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
