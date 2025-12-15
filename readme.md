# Solarflare

A file-based routing framework for Preact + Cloudflare Workers with SSR streaming and web component hydration.

## Features

- **File-based routing** — Routes derived from your file structure
- **SSR streaming** — Server-side rendering with Cloudflare Workers
- **Web component hydration** — Automatic registration via `preact-custom-element`
- **SPA navigation** — Native Navigation API with View Transitions
- **Type-safe** — Full TypeScript support with build-time validation
- **Zero config** — Just export your components

## Requirements

- [Bun](https://bun.sh) runtime
- Modern browser (Chrome 102+, Edge 102+, Safari 15.4+)

## Quick Start

```tsx
// src/app/index.server.tsx
export default async function server(
  request: Request,
  params: Record<string, string>
) {
  return { title: "Hello World" }
}

// src/app/index.client.tsx
export default function BlogPost({ title }: { title: string }) {
  return <h1>{title}</h1>
}
```

```sh
bun install
bun run build
bun run dev
```

## CLI Commands

### Build

```sh
bunx solarflare [options]
```

| Option | Description |
|--------|-------------|
| `--watch`, `-w` | Watch for file changes and rebuild |
| `--serve`, `-s` | Start the development server after build |
| `--clean`, `-c` | Clean output directory before build |
| `--verbose`, `-v` | Enable verbose logging |

### Examples

```sh
# Development with watch and server
bunx solarflare --watch --serve

# Production build
bunx solarflare --clean

# Verbose build for debugging
bunx solarflare --verbose
```

### NPM Scripts

```sh
bun run build    # Production build
bun run dev      # Development with watch + server
bun run clean    # Remove build artifacts
```

## Project Structure

```
src/app/
├── _layout.tsx           # Root layout (html, head, body)
├── _components/          # Shared components (not routed)
├── index.server.tsx      # Home page server handler
├── index.client.tsx      # Home page client component
├── api.server.tsx        # API endpoint
└── blog/
    ├── _layout.tsx       # Blog layout
    ├── $slug.server.tsx  # Dynamic route server handler
    └── $slug.client.tsx  # Dynamic route client component
```

## File Conventions

| Pattern | Purpose |
|---------|---------|
| `*.client.tsx` | Client component, auto-registered as web component |
| `*.server.tsx` | Server handler, runs in Workers runtime |
| `_layout.tsx` | Layout component, wraps child routes |
| `_*` | Private (not routed) — layouts, components, utilities |
| `$param` | Dynamic URL segment → `:param` in URLPattern |
| `index.*` | Matches directory root path |

## Usage

### Server Handler

Server handlers receive the request and route params, returning data or a Response:

```tsx
// src/app/blog/$slug.server.tsx
export default async function server(
  request: Request,
  params: Record<string, string>
) {
  const post = await fetchPost(params.slug)
  return { title: post.title, content: post.content }
}
```

### API Endpoint

Server-only routes (no paired client) return a Response directly:

```tsx
// src/app/api.server.tsx
import { env } from 'cloudflare:workers'

export default async function server(request: Request) {
  return Response.json({
    hello: env.HELLO ?? 'world',
    url: request.url,
  })
}
```

### Client Component

Client components receive props from paired server handlers:

```tsx
// src/app/blog/$slug.client.tsx
interface Props {
  slug: string
  title: string
  content: string
}

export default function BlogPost({ slug, title, content }: Props) {
  return (
    <article>
      <h1>{title}</h1>
      <div>{content}</div>
    </article>
  )
}
```

### Layout

Layouts wrap child routes and nest from root to leaf:

```tsx
// src/app/_layout.tsx
import type { ComponentChildren } from 'preact'

interface Props {
  children: ComponentChildren
}

export default function RootLayout({ children }: Props) {
  return (
    <html>
      <head>
        <meta charset="utf-8" />
        <link rel="stylesheet" href="/index.css" />
      </head>
      <body>{children}</body>
    </html>
  )
}
```

### Props-Based Component Design

All component state flows through props, making data dependencies explicit:

- **Route params** are passed as props from the server handler
- **Server data** is returned from the server handler and passed as props
- **No hooks needed** — component rendering is deterministic based on props

This ensures optimal performance and clear data flow in your application.

### Custom Web Component Options

Components are auto-registered, but you can customize:

```tsx
import { define } from 'solarflare/client'

function BlogPost({ title }: Props) {
  return <h1>{title}</h1>
}

export default define(BlogPost, { shadow: true })
```

## SSR Output

Request to `/blog/hello` renders:

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <link rel="stylesheet" href="/index.css">
  <script type="module" src="/blog.slug.js"></script>
</head>
<body>
  <sf-blog-slug slug="hello" title="Hello World">
    <article><h1>Hello World</h1></article>
  </sf-blog-slug>
</body>
</html>
```

## Development

### Local Development

```sh
bun link           # Link package locally
bun run clean      # Clean build artifacts
bun run build      # Build for production
bun run dev        # Start dev server with watch
```

### Deploying to Cloudflare

```sh
bunx wrangler deploy
```

## License

MIT
