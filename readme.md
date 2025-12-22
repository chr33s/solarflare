# Solarflare

Streaming SSR for Preact + Cloudflare Workers with file-based routing and web component hydration.

## Features

- File-based routing with SSR streaming
- Web component hydration via `preact-custom-element`
- SPA navigation (Navigation API + View Transitions)
- Constructable Stylesheets
- TypeScript

## Requirements

- [Node.js](https://nodejs.org) ≥v24.12.0
- Modern browser (Chrome 102+, Edge 102+, Safari 15.4+)

## CLI

```sh
solarflare [options]
```

| Option               | Description               |
| -------------------- | ------------------------- |
| `--clean`, `-c`      | Clean output before build |
| `--debug`, `-d`      | Enable debugging          |
| `--production`, `-p` | Optimize for production   |
| `--serve`, `-s`      | Start dev server with HMR |
| `--sourcemap`        | Generate source maps      |
| `--watch`, `-w`      | Watch and rebuild         |

## Conventions

| Directory      | Purpose                                   |
| -------------- | ----------------------------------------- |
| `./src`        | Original (source) human readable code     |
| `./dist`       | Compiled (distribution) output code       |

| File           | Purpose                                   |
| -------------- | ----------------------------------------- |
| `*.client.tsx` | Client component (web component)          |
| `*.server.tsx` | Server handler (Workers runtime)          |
| `_layout.tsx`  | Layout wrapper                            |
| `_*`           | Private (not routed)                      |
| `$param`       | Dynamic segment → `:param`                |
| `index.*`      | Directory root                            |

| Path           | Purpose                                   |
| -------------- | ----------------------------------------- |
| `/_*`          | reserved internal use (e.g. `/_console`)  |

## API

### Server Handler

```tsx
export default async function server(request: Request, params: Record<string, string>) {
  return { title: "Hello" }
}
```

Promise-valued props are streamed independently (deferred):

```tsx
export default async function server() {
  const user = await fetchUser();                 // blocking
  const analytics = fetchAnalytics();             // deferred
  const recommendations = fetchRecommendations(); // deferred
  return { user, analytics, recommendations };
}
```

Response metadata via `_*` prefixed props:

```tsx
export default async function server() {
  return {
    _status: 201,
    _headers: { "Cache-Control": "max-age=3600" },
    title: "Created"
  }
}
```

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

### Performance Meta Tags

```tsx
<meta name="sf:preconnect" content="https://cdn.example.com" />
<meta name="sf:early-flush" content="true" />
<meta name="sf:critical-css" content="true" />
<meta name="sf:cache-max-age" content="300" />
<meta name="sf:cache-swr" content="3600" />
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
```

## Examples

- [Minimal](examples/minimal/readme.md) — Single route
- [Basic](examples/basic/readme.md) — Layouts, dynamic routes, API, components
- [Node](examples/node/readme.md) — Using `srvx` instead of Workers

## Development

```sh
npm install && npm run dev
```

## License

MIT
