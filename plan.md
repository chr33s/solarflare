# Plan: Unified turbo-stream

## Goals

- Replace NDJSON patch streaming with turbo-stream on both client and server.
- Keep the patch message shapes (`meta`, `html`) and drop `done` (use stream close as completion).
- Update headers and tests to match the new stream format.

## Scope

- Client navigation stream decoding in [src/router-stream.ts](src/router-stream.ts).
- Patch request headers in [src/router.ts](src/router.ts).
- Patch stream encoding and headers in [src/worker.ts](src/worker.ts).
- Patch stream tests in [src/worker.test.ts](src/worker.test.ts).

## Steps

1. **Define media type**
   - Decide on a consistent `Content-Type`/`Accept` for turbo-stream patch responses (e.g. `text/x-turbo-stream` or `application/x-turbo-stream`).
   - Apply it consistently across client request and server response.

2. **Client: decode turbo-stream**
   - Replace NDJSON line parsing in `applyPatchStream()` with `decode()` from `turbo-stream`.
   - Convert `response.body` to a `ReadableStream<string>` using `TextDecoderStream` and feed into `decode()`.
   - For each decoded message:
     - `meta`: call `applyMeta()` once (usually first).
     - `html`: enqueue chunk to `htmlStream`.
     - Rely on stream close for completion; do not expect a `done` message.
   - Preserve error handling and `onChunkProcessed` behavior.

3. **Server: encode turbo-stream**
   - Replace `createPatchStream()` NDJSON serialization with `encode()` from `turbo-stream`.
   - Emit the same message shapes (`meta`, `html`) as objects via the encoder.
   - Ensure the stream flushes `meta` first and `html` chunks as they arrive; close stream to signal completion.

4. **Headers**
   - Update `getPatchHeaders()` to set the turbo-stream `Content-Type`.
   - Update client `fetch()` `Accept` header in navigation.

5. **Tests**
   - Update patch stream test to expect the turbo-stream `Content-Type`.
   - Replace NDJSON parsing with `decode()` for assertions and stop asserting about `done` messages; assert stream end instead.

6. **Validation**
   - Run targeted tests for patch streaming.
   - Verify client-side navigation still hydrates incrementally.

## Non-Goals

- Changing the patch message schema.
- Altering route matching or render pipeline.
- Introducing new dependencies (already using `turbo-stream`).
