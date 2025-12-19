# Solarflare

File-based routing for Preact + Cloudflare Workers with SSR streaming and web component hydration.

> [!IMPORTANT]  
> Authoritative Prompt: See prompt.txt for the workflow, strict binding validation, security guidance, and AI usage rules.

## Features

- **File-based routing** — Routes derived from file structure
- **SSR streaming** — Server-side rendering with Cloudflare Workers
- **Web component hydration** — Auto-registration via `preact-custom-element`
- **SPA navigation** — Navigation API with View Transitions
- **Type-safe** — Full TypeScript support

## Requirements

- [Node.js](https://nodejs.org) ≥v24.12.0 (primary runtime)
- Modern browser (Chrome 102+, Edge 102+, Safari 15.4+)

## Examples

- [**Minimal**](examples/minimal/readme.md) — Single route with server/client pair
- [**Basic**](examples/basic/readme.md) — Layouts, dynamic routes, API endpoints, components

## CLI

```sh
solarflare [options]
```

| Option               | Description                    |
| -------------------- | ------------------------------ |
| `--clean`, `-c`      | Clean output before build      |
| `--debug`, `-d`      | Enable debugging               |
| `--production`, `-p` | Optimize build for production  |
| `--serve`, `-s`      | Start development server (hmr) |
| `--sourcemap`        | Generate source maps           |
| `--watch`, `-w`      | Watch for changes and rebuild  |

## Folder Conventions

| Directory | Purpose                               |
| --------- | ------------------------------------- |
| `./src`   | Original (source) human readable code |
| `./dist`  | Compiled (distribution) output code   |

## File Conventions

| Pattern        | Purpose                                            |
| -------------- | -------------------------------------------------- |
| `*.client.tsx` | Client component, auto-registered as web component |
| `*.server.tsx` | Server handler, runs in Workers runtime            |
| `_layout.tsx`  | Layout component, wraps child routes               |
| `_*`           | Private (not routed)                               |
| `$param`       | Dynamic URL segment → `:param`                     |
| `index.*`      | Matches directory root                             |

## Path Conventions

| Pattern | Purpose                                               |
| ------- | ----------------------------------------------------- |
| `/_`    | is reserved for internal framework (e.g. `/_console`) |

## API

### Server Handler

```tsx
export default async function server(
  request: Request,
  params: Record<string, string>
) {
  return { title: "Hello" }  // Props for client component
}
```

#### Streaming Deferred Props

Any **Promise-valued** prop returned from a `*.server.tsx` handler is treated as **deferred**:

- The page shell can start streaming without waiting for it.
- Multiple deferred props are **independent**: each one is streamed as soon as it resolves.
- On the client, deferred props are merged into the component props as they arrive.

```tsx
export default async function server() {
  const user = await fetchUser(); // blocking

  // non-blocking (deferred)
  const analytics = fetchAnalytics();
  const recommendations = fetchRecommendations();

  return { user, analytics, recommendations };
}
```

#### With Response Metadata

Control HTTP status, status text, and headers from your server handler:

```tsx
export default async function server(
  request: Request,
  params: Record<string, string>
) {
  return {
    _status: 201,
    _statusText: "Created",
    _headers: {
      "X-Custom-Header": "value",
      "Cache-Control": "max-age=3600"
    },
    title: "Resource Created"
  }
}
```

**Notes:**

- `_status` defaults to 200 if not provided
- `_headers` are merged with default headers (custom headers take priority)
- All `_*` prefixed properties are reserved for response metadata and won't be passed as component props

### Client Component

```tsx
export default function Client({ title }: { title: string }) {
  return <h1>{title}</h1>
}
```

### Layout

```tsx
export default function Layout({ children }: { children: ComponentChildren }) {
  return <html><body>{children}</body></html>
}
```

### Custom Web Component

```tsx
import { define } from '@chr33s/solarflare/client'

export default define(MyComponent, { shadow: true })
```

### HMR Events

```tsx
import { onHMREvent } from "@chr33s/solarflare/client"

onHMREvent("update", ({ tag }) => console.log(`Updated: ${tag}`))
onHMREvent("error", ({ tag, error }) => console.error(`Error:`, error))
```

## Development

### Node.js (Primary)

```sh
npm install && npm run dev
```

## Build

```sh
npm install && npm run build
```

## Testing

```sh
npm run test
```

## License

MIT
