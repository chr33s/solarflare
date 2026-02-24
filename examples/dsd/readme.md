# DSD Example

Demonstrates Declarative Shadow DOM (`shadow: true`) — SSR-rendered shadow roots with encapsulated styles, zero FOUC.

## Structure

```
src/
├── _layout.tsx        # Root layout
├── index.server.tsx   # Server handler
├── index.client.tsx   # Client component (shadow: true)
├── index.css          # Scoped styles (inside shadow root)
└── index.ts           # Worker entry
```

## Quick Start

```sh
npm install
npm run dev
```

## Key Concept

The client component uses `define(Component, { shadow: true })` which:

1. **SSR** — wraps output in `<template shadowrootmode="open">` with inline `<style>`
2. **Hydration** — detects existing shadow root, skips `attachShadow()`
3. **Styles** — CSS is scoped to the shadow root, no leaking in or out

### Declarative Shadow DOM

When `{ shadow: true }` is passed to `define()`, the component renders inside a [Declarative Shadow DOM](https://developer.chrome.com/docs/css-ui/declarative-shadow-dom) (`<template shadowrootmode="open">`) during SSR. This eliminates FOUC for shadow-rooted components by letting the browser attach the shadow root before any JavaScript loads.

**Build**: The scanner detects `shadow: true` in client files and records it in the chunk manifest. The worker passes this to the server renderer automatically — no extra configuration needed.

**Hydration**: On the client, `define()` patches `attachShadow` so that `preact-custom-element` reuses the existing DSD shadow root instead of creating a new one.

**Styles**: Inline `<style>` elements rendered inside the DSD template are migrated to `adoptedStyleSheets` on first hydration, ensuring HMR style updates continue to work.

**SPA navigation**: The DOM differ detects shadow-root vs DSD-template mismatches and performs atomic element replacement to avoid structural diffing errors.
