# Simplification Plan

## Status (Jan 16, 2026)

Completed:

- ✅ Centralized manifest types (`src/manifest.ts`) and updated imports.
- ✅ Consolidated shared public types in `src/solarflare.d.ts` (server data/store config/routes manifest reuse).
- ✅ Unified CSS HMR into `src/hmr.ts` with `stylesheets` as single manager.
- ✅ Moved HMR wrapper logic to helpers in `src/hmr.ts` and wired generated entry to use them.
- ✅ Split worker pipeline into `handleDevEndpoints`, `matchAndLoad`, `renderStream`, `applyPerfFeatures`.
- ✅ Extracted deferred hydration DOM handling to `src/router-deferred.ts`.
- ✅ Split build steps into `src/build.*` modules.
- ✅ Store vs hydration separation: moved hydration queue + data island hydration to `src/hydration.ts` (store holds signals + setters only).
- ✅ Entry generation clarity: reduced template logic in `src/build.hmr-entry.ts` (CSS registration + router init helpers).
- ✅ Architecture doc alignment: updated file names/paths and removed stale references.

Remaining tasks:

- Remove unnessary typescript return types, when they can be inferred
- cleanup comments, ensure concise and in jsdoc format
- update readme.md (list all ./examples)

## Goals

- Reduce cross-module coupling and duplicate logic.
- Clarify runtime pipeline stages and public API surface.
- Make CSS/HMR flow single-source-of-truth.
- Improve maintainability without changing external behavior.

## Scope

- Source: src/ (build, runtime, router, HMR, styles)
- Docs: architecture.md (align with refactors)
- No new dependencies.

## Phase 1 — Inventory and boundaries

1. **Document shared types**
   - Create a single manifest type definition (e.g., `RoutesManifest`, `ChunkManifest`) and list every file that currently declares or redefines these shapes.
   - Acceptance: one authoritative type location referenced by build, worker, router, client.

2. **Map HMR responsibilities**
   - List all HMR-related behaviors in build-generated entries vs runtime helpers.
   - Identify overlaps (state preservation, error boundary, CSS updates, event dispatch).
   - Acceptance: a short matrix showing which file owns each behavior.

3. **Runtime pipeline outline**
   - Break worker request handling into clear stages: dev endpoints → routing → loader → render → perf features → response.
   - Acceptance: a named pipeline with boundaries and inputs/outputs per stage.

## Phase 2 — Reduce duplication (low-risk refactors)

1. **Centralize manifest types**
   - Add `src/manifest.ts` (or similar) containing shared interfaces.
   - Replace local duplicates across build/router/worker/client.
   - Acceptance: no duplicate manifest interface definitions in the codebase.

2. **Unify CSS HMR flow**
   - Consolidate CSS HMR functions into one module (fold `hmr-styles.ts` into `hmr.ts`).
   - Keep `stylesheets.ts` as the single storage/manager.
   - Acceptance: single entry point for CSS HMR, no duplicate reload/update paths.

3. **Reduce HMR wrapper duplication**
   - Move component wrapper logic in generated entries to a helper in `src/hmr.ts`.
   - Generated entry should call the helper with config only.
   - Acceptance: generated entry contains minimal wrapper code (config + imports only).

4. **Migrate existing code into new module layout**
   - Rehome files to match the Dir structure naming: `build.*`, `client.*`, `server.*`, and core runtime helpers.
   - Update all internal imports to new locations.
   - Keep public entry points stable via current `exports` map; no new export keys.
   - Acceptance: workspace builds with no duplicate modules and no broken internal imports.

## Phase 3 — Runtime structure simplification

1. **Worker pipeline functions**
   - Refactor `src/worker.ts` into small functions: `handleDevEndpoints`, `matchAndLoad`, `renderStream`, `applyPerfFeatures`.
   - Acceptance: each function is <100 lines and testable in isolation.

2. **Router responsibilities split**
   - Extract deferred-hydration DOM handling into a helper module (e.g., `router-deferred.ts`).
   - Keep `router.ts` focused on navigation + match + fetch.
   - Acceptance: router file shrinks, deferred hydration code is isolated and reusable.

3. **Store vs hydration separation**
   - Split store signal state from hydration queue management.
   - Acceptance: store module contains signals and setters only; hydration coordinator in separate module.

## Phase 4 — Build-time simplification

1. **Build step modules**
   - Split `src/build.ts` into submodules: `scan.ts`, `validate.ts`, `bundle-client.ts`, `bundle-server.ts`, `emit-manifests.ts`, `hmr-entry.ts`.
   - Keep CLI orchestration in `build.ts`.
   - Acceptance: each module has single responsibility and can be unit tested.

2. **Entry generation clarity**
   - Minimize string-templated logic; extract shared helpers for HMR wrapper, CSS registration, and router init.
   - Acceptance: generated entry template is short and declarative.

## Phase 5 — Documentation alignment

1. **Update architecture.md**
   - Reflect new module boundaries and pipeline stages.
   - Add short “where to look” guide for each stage.
   - Acceptance: architecture doc matches code structure.

## Deliverables

- New `src/manifest.ts` (or equivalent)
- Simplified HMR + CSS HMR API surface
- Smaller `worker.ts`, `router.ts`, `build.ts`
- Updated architecture documentation

## Risks and Mitigations

- **Risk**: Behavior changes in HMR or CSS updates.
  - Mitigation: keep API signatures, run existing test suite, add targeted tests for HMR/CSS reload.
- **Risk**: Runtime regressions due to pipeline refactor.
  - Mitigation: preserve function-level contracts, add integration test for SSR path and dev endpoints.

## Validation

- Run `npm run check && npm run test`.
- Manual smoke test: `examples/basic` dev server, verify HMR, CSS updates, SSR, and SPA navigation.

## Dir structure

```
src/
   [...file].ts (core runtime helpers, e.g. styles.ts)
   build.[...file].ts (build-time steps, e.g. build.scan.ts)
   client.[...file].ts (client-only runtime, e.g. client.styles.ts)
   server.[...file].ts (server-only runtime, e.g. server.styles.ts)
```

- New modules introduced in this plan should follow the above naming, and avoid cross-layer imports (client ↔ server ↔ build).
- Keep `src/index.ts`, `src/client.ts`, and `src/server.ts` as the stable public entry points.
- Migrate existing files into this structure as part of the refactor:
  - Move/rename runtime helpers into `src/[...file].ts`.
  - Move/rename build steps into `src/build.[...file].ts`.
  - Move/rename client-only logic into `src/client.[...file].ts`.
  - Move/rename server-only logic into `src/server.[...file].ts`.
  - Update all internal imports to the new locations; do not introduce cross-layer imports.

## Package.json

```jsonc
{
  "bin": "./src/build.ts",
  "exports": {
    ".": "./src/index.ts", // <-- (export default fetchHandler) + types
    "./client": "./src/client.ts",
    "./server": "./src/server.ts",
    "./tsconfig.json": "./tsconfig.json",
  },
}
```

- Preserve the `bin` entry for CLI usage.
- Any new public surface introduced by the refactor must be routed through the existing export points above (no new exports in this phase).
- Migrate existing code without changing public entry points:
  - Keep all user-facing imports working via the current `exports` map.
  - If files are moved, update internal import paths only; do not add new export keys.
