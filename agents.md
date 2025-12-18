# AGENTS.md

## Overview

This repository, `chr33s/solarflare`, is a platform designed for streaming SSR, with hot module replacement, efficient routing, and reactive state management.

---

## Tech Stack

- **TypeScript**: Static typing and compiler utilities (`ast.ts`).
- **Preact**: Lightweight UI framework for components.
- **Preact Signals**: Reactive state management (`store.ts`).
- **Node.js**: Primary runtime for builds (`build.ts`), requires v24.12.0+.
- **Rolldown**: Rust-based bundler for client/server builds.
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

1. **Check**: Check lint rules
   ```bash
   npm run check
   ```
2. **Build**: Create server and client bundles.
   ```bash
   npm run build
   ```
   Build CLI Options:
   - `--clean` / `-c`: Clean output directory before building
   - `--production` / `-p`: Optimize for production
   - `--watch` / `-w`: Watch for changes and rebuild
   - `--serve` / `-s`: Start development server with HMR
   - `--debug` / `-d`: Enable debugging features
   - `--sourcemap`: Generate source maps for debugging
3. **Dev**: Start development mode.
   ```bash
   npm run dev
   ```
4. **Test**: Run functional, integration & e2e tests
   ```bash
   npm run test
   ```

---

## Folder Structure

- **`src/`**: Core logic for routing, HMR, SSR, and state:
  - `build.ts`: Node.js build script using rolldown.
  - `test-utils.ts`: Test utilities with expect() API.
  - `server.ts`: SSR utilities.
  - `store.ts`: Signal state layers.
  - `router.ts`: SPA routing.
- **`dist/`**: Generated output for client/server builds.

## Path Structure

- **`/_`**: reserved for internal framework
  - `_console`: Browser / Server console piping

---

By adhering to this guide, contributors can ensure efficient agent development within the `solarflare` ecosystem.
