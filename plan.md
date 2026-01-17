# Router Protocol Update

Using **POST** for patch/Flight updates is the best fit for an **auth’d, app-like** Solarflare app where responses are **per-user / `no-store`**—and it neatly avoids the Cloudflare `Vary: Accept` concern.

To support **Deferred Streaming**, the response uses **NDJSON** (Newline Delimited JSON) to stream metadata immediately and then pipe HTML chunks as they are rendered.

### Implementation Protocol

1. **Endpoints**

- `GET /some/route` → normal HTML document (can be `private, no-store` or cached depending on auth model)
- `POST /_sf/patch` → returns the navigation update payload for the client router

2. **Request**

- `Content-Type: application/json`
- `Accept: application/x-ndjson`

```json
{
  "url": "/some/route?tab=teams",
  "outlet": "#app",
  "state": "opaque-client-state"
}
```

3. **Response Stream (NDJSON)**
   - `Content-Type: application/x-ndjson`
   - `Cache-Control: private, no-store`

- `X-Content-Type-Options: nosniff`

**Chunk 1 (Metadata):**

```json
{
  "type": "meta",
  "outlet": "#app",
  "requestId": "req_123",
  "head": [{ "tag": "title", "textContent": "Teams" }],
  "scripts": ["<script>window.store=...</script>"]
}
```

**Chunk N (HTML Stream):**

```json
{ "type": "html", "chunk": "<div>...</div>" }
```

**Chunk M (Deferred Data):**

````json
{ "type": "html", "chunk": "<script>...hydrate...</script>" }

**Final Chunk (EOF):**

```json
{ "type": "done" }
````

```

### Implementation notes

- **Server**: `renderToPatchStream` wraps the HTML stream.
- Sends a `meta` chunk first (head tags, critical scripts, request id).
- Transforms HTML chunks into `html` messages, one JSON object per line.
- Pipes deferred hydration scripts (data islands) as they resolve.
- Ends with a `done` chunk and closes the stream.
- **Client**: `src/router.ts` consumes the stream.
- Parses NDJSON line-by-line using `TextDecoder` and newline delimiters.
- Applies `meta` updates (Head, scripts) immediately.
- Reconstructs a `ReadableStream` from `html` chunks and feeds it to `diff-dom-streaming`.
- Aborts on route change using `AbortController`.
- **Error handling**:
- Use HTTP status for fatal errors (4xx/5xx) and a JSON error line when possible.
- Client treats non-200 or missing `meta` as a failed patch and falls back to full navigation.
- **Ordering**: maintain `meta → html* → done` and never interleave unrelated requests.
```
