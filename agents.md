# AGENTS.md

## Overview
This repository, `chr33s/solarflare`, is a platform designed for streaming SSR, with hot module replacement, efficient routing, and reactive state management.

---

## Tech Stack
- **TypeScript**: Static typing and compiler utilities (`ast.ts`).
- **Preact**: Lightweight UI framework for components.
- **Preact Signals**: Reactive state management (`store.ts`).
- **Bun**: Modern JavaScript runtime for builds (`build.ts`).
- **Cloudflare Workers**: Server hosting for SSR (`worker.ts`).

---

## Key Conventions
1. **File Suffixes**:
   - `.server.ts(x)`: Server-only logic.
   - `.client.ts(x)`: Client-side rendering.
   - `_layout.tsx`: Layout components.
   - `_error.tsx`: Error boundary files.
2. **State Management**:
   - Manage state using `@preact/signals`.
   - Structure routes via `router.ts`.
3. **HMR Utilities**:
   - Hook state and scroll preservation handled via `hmr.ts`.

## Agent-Specific Notes

- **Error Boundaries**: Wrap components using `<HMRErrorBoundary>` to isolate crashes without affecting the app.
- **Scroll Restoration**: Automatically managed during HMR updates; ensure proper tags for state keys.
- **Routing Patterns**: Define in `router.ts` as `URLPattern` and `RoutesManifest`.

---

## Scripts
1. **Build**: Create server and client bundles.
   ```bash
   bun build
   ```
2. **Check**: Check lint rules
   ```bash
   bun check
   ```
3. **Dev**: Start development mode.
   ```bash
   bun dev
   ```
4. **Test**: Run functional, integration & e2e tests
   ```bash
   bun test
   ```

---

## Folder Structure
- **`src/`**: Core logic for routing, HMR, SSR, and state:
  - `server.ts`: SSR utilities.
  - `store.ts`: Signal state layers.
  - `router.ts`: SPA routing.
- **`dist/`**: Generated output for client/server builds.

---

By adhering to this guide, contributors can ensure efficient agent development within the `solarflare` ecosystem.
