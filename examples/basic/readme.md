# Basic Example

A full-featured Solarflare app demonstrating layouts, dynamic routes, API endpoints, and components.

## Structure

```
src/
├── _layout.tsx           # Root layout
├── _components/          # Shared components
│   ├── count-button.tsx
│   ├── nav.tsx
│   └── post-form.tsx
├── index.server.tsx      # Home server handler
├── index.client.tsx      # Home client component
├── api.server.ts         # API endpoint
└── blog/
    ├── _layout.tsx       # Blog layout
    ├── $slug.server.tsx  # Dynamic route server
    └── $slug.client.tsx  # Dynamic route client
```

## Quick Start

```sh
npm install
npm run dev
```

## Features

- **Layouts** — Nested `_layout.tsx` files wrap child routes
- **Dynamic Routes** — `$slug` becomes `:slug` URL parameter
- **API Endpoints** — Server-only routes return `Response` directly
- **Components** — `_components/` directory for shared, non-routed components
- **Assets** — CSS and SVG imports
- **Deferred Data** — Promise props stream to client after initial render
