> [!WARNING]  
> Experimental: API is unstable and not production-ready.

# Solarflare

Cloudflare-optimized streaming SSR/CSR meta-framework built on web platform APIs, whilst retaining the DX of JSX / React|Preact.

## Features

- **Streaming SSR** — File-based routing with deferred promise streaming
- **Web Components** — Hydration via `preact-custom-element`
- **SPA Navigation** — Navigation API + View Transitions
- **HMR** — Hot module replacement with scroll restoration
- **Styles** — Constructable Stylesheets, critical CSS extraction
- **Performance** — Early hints, route caching, preconnect hints
- **Cloudflare** — Workers-optimized with edge caching
- **TypeScript** — Full type safety

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

| Directory  | Purpose                                                 |
| ---------- | ------------------------------------------------------- |
| `./src`    | Original (source) human readable code                   |
| `./dist`   | Compiled (distribution) [client, server] output code    |
| `./public` | Static assets, copied verbatim to dist/client directory |

| File           | Purpose                          |
| -------------- | -------------------------------- |
| `*.client.tsx` | Client component (web component) |
| `*.server.tsx` | Server handler (Workers runtime) |
| `_layout.tsx`  | Layout wrapper                   |
| `_*`           | Private (not routed)             |
| `$param`       | Dynamic segment → `:param`       |
| `index.*`      | Directory root                   |

| Path  | Purpose                                  |
| ----- | ---------------------------------------- |
| `/_*` | reserved internal use (e.g. `/_console`) |

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

### Deferred (Suspense like deferred renderer)

```tsx
import { Deferred } from "@chr33s/solarflare/client";

<Deferred
  priority="high"
  fallback={<div>Loading additional content...</div>}
>
  ...
</Deferred>
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

## Environment

| File                    | Purpose                                                      |
| ----------------------- | ------------------------------------------------------------ |
| `WRANGLER_LOG`          | Set logging verbosity for both wrangler & console forwarding |
| `WRANGLER_SEND_METRICS` | Disable sending anonymous usage data to Cloudflare           |

## Examples

- [Minimal](examples/minimal/readme.md) — Single route
- [Basic](examples/basic/readme.md) — Layouts, dynamic routes, API, components
- [Node](examples/node/readme.md) — Using `srvx` instead of Workers

## Development

```sh
npm install && npm run dev
```

## Codemod

```sh
npm install --save-optional
npx solarflare --codemod ./app
```

## License

MIT
