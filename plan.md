# Plan: Simplify

## Status

- [x] Implemented (uncommitted): fetch retry extracted to `fetch.ts` with new tests; router NDJSON streaming moved to `router-stream.ts`; asset injection moved to `stream-assets.ts`; deferred island id helpers centralized; manifest/runtime helpers consolidated; paired module helper moved to `paths.ts`; CLI fs helper moved to `fs.ts` and call sites updated; compiler options injectable + AST helpers extracted; store cloning simplified.
- [ ] Pending: Phase 0 side-effect isolation items and Phase 5 containment items not yet started.
- [ ] Review untracked/aux changes: docs updates and example public file.

## Concise actionable plan

### Phase 0 — Side-effect isolation quick wins

0. Build CLI: split plan vs execute, and move argv/env parsing out of module scope. (src/build.ts)
1. Runtime globals: introduce `createRuntime()`/`getRuntimeFrom()` to avoid touching `globalThis` directly. (src/runtime.ts)
2. Hydration: separate DOM extraction from JSON parsing and store application; inject logger. (src/hydration.ts)
3. Stylesheets: split pure planning from DOM/CSSOM backends; add a no-op backend for tests. (src/stylesheets.ts)
4. Worker factory: build `createWorker()` with injectable caches/clock/modules. (src/worker.ts)
5. Fetch retry: inject `fetch` + `sleep` so tests can be deterministic. (src/fetch.ts, src/router.ts)

### Phase 1 — Low risk, high clarity

1. Store cloning: simplify `setParams` / `initStore` cloning. (src/store.ts)
2. Fetch retry: move `fetchWithRetry()` to `src/fetch.ts`. (src/router.ts)

### Phase 2 — Streaming + routing cohesion

3. Stream assets: move `createAssetInjectionTransformer()` + `generateAssetTags()` to `src/stream-assets.ts`. (src/server.ts)
4. Deferred ids: centralize island id formatting and reuse in SSR + hydration. (src/server.ts, src/hydration.ts, src/router-deferred.ts)
5. Router streaming: move NDJSON parsing + diff wiring to `src/router-stream.ts`. (src/router.ts)

### Phase 3 — Module boundaries, API hygiene, testability

6. Signals facade: stop re-exporting `@preact/signals` from `store.ts`. (src/store.ts)
7. Compiler options: make `readCompilerOptions()` injectable. (src/ast.ts)
8. AST helpers: extract `getFirstCallSignature()` + `getSignatureParameterInfo()`. (src/ast.ts)
9. Manifest/runtime helpers: consolidate module access helpers. (src/worker.ts, src/manifest.runtime.ts)
10. Module pairing: move `findPairedModule()` into a path utility. (src/worker.ts, src/paths.ts)
11. CLI fs helpers: move `exists/readText/write` into `src/fs.ts`. (src/build.ts, src/fs.ts)

### Phase 4 — Functional core, imperative shell

12. Define small `Env/IO` interfaces per domain (fs, net, timers, dom, logger).
13. Convert entry points to create real envs and call pure cores.

### Phase 5 — Side-effects containment pass

14. Build effects: wrap FS/process/signal handling in IO and keep imports side‑effect free. (src/build.ts, src/fs.ts)
15. Worker caches: inject `responseCache`/`staticShellCache` per worker instance. (src/worker.ts)
16. Critical CSS cache: make cache injectable/resettable. (src/critical-css.ts)
17. Component style cache + CSS fetch: abstract cache + fetch behind a client env. (src/client.styles.ts)
18. DevTools UUID cache: allow injection/reset for deterministic tests. (src/devtools-json.ts)
19. DOM platform: centralize DOM/RAF/scroll/custom element hooks behind a platform interface. (src/client.ts, src/stylesheets.ts, src/hmr.ts, src/diff-dom-streaming.ts)
20. Inline script injection: separate script generation from DOM insertion. (src/critical-css.ts, src/server.styles.ts, src/server.ts)
21. Early flush streaming: add a pure chunk generator and adapt to `ReadableStream`. (src/early-flush.ts)
