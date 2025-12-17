# Solarflare

File-based routing for Preact + Cloudflare Workers with SSR streaming and web component hydration.

## Features

- **File-based routing** — Routes derived from file structure
- **SSR streaming** — Server-side rendering with Cloudflare Workers
- **Web component hydration** — Auto-registration via `preact-custom-element`
- **SPA navigation** — Navigation API with View Transitions
- **Type-safe** — Full TypeScript support

## Requirements

- [Bun](https://bun.sh) or pre-compiled binaries in `bin/`
- [Node.js](https://nodejs.org) ≥22.18.0
- Modern browser (Chrome 102+, Edge 102+, Safari 15.4+)

## Examples

- [**Minimal**](examples/minimal/readme.md) — Single route with server/client pair
- [**Basic**](examples/basic/readme.md) — Layouts, dynamic routes, API endpoints, components

## CLI

```sh
solarflare [options]
```

| Option            | Description                        |
| ----------------- | ---------------------------------- |
| `--watch`, `-w`   | Watch for changes and rebuild      |
| `--serve`, `-s`   | Start development server           |
| `--clean`, `-c`   | Clean output before build          |
| `--verbose`, `-v` | Verbose logging                    |

## File Conventions

| Pattern        | Purpose                                            |
| -------------- | -------------------------------------------------- |
| `*.client.tsx` | Client component, auto-registered as web component |
| `*.server.tsx` | Server handler, runs in Workers runtime            |
| `_layout.tsx`  | Layout component, wraps child routes               |
| `_*`           | Private (not routed)                               |
| `$param`       | Dynamic URL segment → `:param`                     |
| `index.*`      | Matches directory root                             |

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

```sh
bun install && bun run dev
```

## Build

```sh
bun install && bun run build:cli --all
```

## License

MIT
