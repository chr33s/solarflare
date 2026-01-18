# Plan: HTML Web Apis (Range, DocumentFragment)

## Goal

After reviewing the source code and structure of the `chr33s/solarflare` repository, here are specific examples of where the HTML Web APIs, `Range` and `DocumentFragment`, can be implemented:

### 1. **Inserting Routes Dynamically:**

In `src/codemod.ts`, there is a function `extractRouteStructure` for handling route structures in the application. Enhance it using the `Range` API to enable precise dynamic template rendering or modification at specified portions of the route-based template:

Original example:

```typescript
if (calleeName === "route" && args.length >= 2) {
  const routePath = Node.isStringLiteral(pathArg) ? pathArg.getLiteralValue() : "?";
}
```

Improved with `Range`:

```typescript
const range = document.createRange();
const parentElement = document.querySelector("#my-routes-section");

range.selectNode(parentElement);

const routeElement = document.createElement("div");
routeElement.setAttribute("data-route", routePath);

range.insertNode(routeElement);
```

---

### 2. **Deferred Rendering with Priority:**

In the `readme.md`, the section describing the `Deferred` component mentions deferred rendering with fallback content:

```tsx
<Deferred priority="high" fallback={<div>Loading additional content...</div>}>
  ...
</Deferred>
```

This could utilize a `DocumentFragment` to preload the high-priority content into the DOM before final rendering. This ensures smooth user experience by reducing blocking during deferred loading.

```javascript
const fragment = document.createDocumentFragment();
const fallback = document.createElement("div");
fallback.textContent = "Loading additional content...";
fragment.append(fallback);

// Later, replace fallback with the content
const content = document.createElement("div");
content.textContent = "Actual content";
fragment.replaceChild(content, fallback);

document.getElementById("deferred-container").appendChild(fragment);
```

---

### 3. **Speculation Rules Preloading:**

In `src/speculation-rules.ts`, speculation rules manage prefetch and prerendering. To align with this feature, `Range` could help to dynamically inject meta tags for better SEO or performance optimizations:

```javascript
const range = document.createRange();
const headElement = document.getElementsByTagName("head")[0];

range.selectNode(headElement);

const prefetchMeta = document.createElement("meta");
prefetchMeta.setAttribute("name", "rel");
prefetchMeta.setAttribute("content", "prefetch");
prefetchMeta.setAttribute("href", "/api/data");

range.insertNode(prefetchMeta);
```

---

Integrating these features into Solarflare will optimize rendering and dynamic content handling, improving user experience. Let me know if you'd like help implementing these enhancements in specific files or modules!

---

## Implementation Plan (src directory)

### 1. Confirm integration points in core runtime

- Use the streamed navigation path in `src/router.ts` (`#loadRoute`) as the primary DOM update entry point. This is where streamed HTML is diffed and applied and where new styles are appended.
- Use `src/diff-dom-streaming.ts` as the core DOM mutation engine to introduce `DocumentFragment`-based batching for insertions.
- Use `src/head.ts` (`applyHeadToDOM`) and `src/speculation-rules.ts` (`injectSpeculationRules`) as the centralized head mutation APIs to introduce `Range`-based insertion control.

### 2. DocumentFragment batching for DOM insertions

- **`src/diff-dom-streaming.ts`**: In `setChildNodes`, batch multiple appended/inserted nodes into a `DocumentFragment` before a single DOM insertion when `insertedNode` is used. This keeps the diffing algorithm intact while minimizing reflow during streaming.
- **`src/router.ts`**: In `#loadRoute`, when adding `entry.styles`, create a `DocumentFragment` for new `<link>` tags and append once to `document.head`.

### 3. Range-based insertion for head mutations

- **`src/head.ts`**: In `applyHeadToDOM`, use a `Range` anchored to `document.head` to insert newly created head tags before the first managed head node (or at the end if none exist). This preserves resolved tag order and avoids reliance on `appendChild` ordering when existing nodes are present.
- **`src/speculation-rules.ts`**: Update `injectSpeculationRules` to use a `Range` to replace any existing speculation rules script in place (if present), otherwise insert before the first managed head node for stable ordering.

### 4. Tests and validation

- **`src/diff-dom-streaming.test.ts`**: Add a case validating that batched fragment insertion produces identical DOM results and mutation ordering for streamed chunks.
- **`src/head.test.ts`**: Add coverage ensuring `applyHeadToDOM` preserves order when existing managed nodes are present and new nodes are inserted via `Range`.
- **`src/speculation-rules.test.ts`**: Add coverage for replacing existing speculation rules scripts without duplicating tags.
- Run `npm run check && npm run test` after implementation.

### 5. Rollout and verification

- Verify streamed navigation updates still trigger `handleDeferredHydrationNode` and that deferred hydration remains functional with batched DOM insertions.
- Confirm head tag deduplication and ordering remain consistent across SSR and client navigation flows.
