# Plan: HTML Web APIs (`<template>`)

## Goals

- Expand `<template>` usage beyond tests to support deferred layout/content scaffolding.
- Maintain streaming-first SSR behavior while reducing initial DOM work.
- Keep API changes minimal and well-documented.

## Non-goals

- No new public API unless required by SSR/streaming constraints.
- No client runtime re-architecture or breaking changes.

## Current Signals

- Tests already use `<template>` for deferred rendering.
- Live integration appears limited to testing paths.

## Milestones

1. **Audit current `<template>` usage**
2. **Design server-side integration**
3. **Implement and validate**

## Tasks

1. Inventory `<template>` usage in tests and runtime.
2. Identify rendering touchpoints for integration (e.g. server render path and head context).
3. Propose a minimal server-side `<template>` strategy for deferred layout scaffolding.
4. Add or update tests to cover the new behavior.
5. Validate streaming and hydration characteristics.

## Candidate Touchpoints

- [src/server.ts](src/server.ts)
- [src/head.ts](src/head.ts)

## Risks

- Deferred content could conflict with streaming flush order.
- Hydration boundaries may be affected if templates are used incorrectly.

## Acceptance Criteria

- `<template>` usage is integrated into at least one live server-render path.
- Existing tests pass, and new coverage asserts the intended behavior.
- No observable regressions in streaming or hydration behavior.
