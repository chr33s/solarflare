# AGENTS.md

## Working Agreement

- Use `src/` for source, `dist/` for output
- Run `npm run check && npm run test` before committing
- Prefer npm over other package managers
- Ask for confirmation before adding new dependencies
- Use concise JSDoc syntax for inline documentation when providing examples or where the interface is exported in package#exports, avoid adding unnecessary, redundant or verbose comments that can easily be inferred from use.
- Only add typescript return types that can not be inferred
- Write scripts to disk, never paste to terminal.
- Use `node --test --test-name-pattern='...' file.ts` for running individual/partial tests

## Agent-Specific Notes

- **Routing Patterns**: Define in `router.ts` as `URLPattern` and `RoutesManifest`
- **Deferred Streaming**: Promise-valued props from `*.server.ts(x)` are streamed independently; avoid `Promise.all` for true per-promise streaming
- **Path `/_`**: Reserved for internal framework (e.g. `/_console`)
