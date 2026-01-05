# Deno Example

The simplest Solarflare app using Deno — a single route with server handler and client component.

## Structure

```
src/
├── index.ts           # Worker handler
├── index.server.tsx   # Server handler
└── index.client.tsx   # Client component
```

## Quick Start

```sh
deno install
deno task build
deno task start
```
