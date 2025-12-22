# AGENTS.md

## Working Agreement

- Use `src/` for source, `dist/` for output
- Run `npm run check && npm run test` before committing
- Prefer npm over other package managers
- Ask for confirmation before adding new dependencies
- Use concise JSDoc syntax for inline documentation
- Write scripts to disk, never paste to terminal
- Use `node --test` for running tests

## Partial Test Suite

```bash
node --test --test-name-pattern="{pattern}" src/{file}.test.ts
```

## Agent-Specific Notes

- **Error Boundaries**: Wrap components using `<HMRErrorBoundary>` to isolate crashes
- **Scroll Restoration**: Automatically managed during HMR updates
- **Routing Patterns**: Define in `router.ts` as `URLPattern` and `RoutesManifest`
- **Deferred Streaming**: Promise-valued props from `*.server.ts(x)` are streamed independently; avoid `Promise.all` for true per-promise streaming
- **Path `/_`**: Reserved for internal framework (e.g. `/_console`)
