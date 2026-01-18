import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { fetchWithRetry } from "./fetch.ts";

describe("fetchWithRetry", () => {
  it("should return successful response", async () => {
    const mockResponse = new Response("OK", { status: 200 });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (() => Promise.resolve(mockResponse)) as unknown as typeof fetch;

    try {
      const response = await fetchWithRetry("http://localhost/test");
      assert.strictEqual(response.status, 200);
      assert.strictEqual(await response.text(), "OK");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("should retry on 5xx errors", async () => {
    let attempts = 0;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (() => {
      attempts++;
      if (attempts < 3) {
        return Promise.resolve(new Response("Error", { status: 500 }));
      }
      return Promise.resolve(new Response("OK", { status: 200 }));
    }) as unknown as typeof fetch;

    try {
      const response = await fetchWithRetry("http://localhost/test", undefined, {
        maxRetries: 3,
        baseDelay: 10,
      });
      assert.strictEqual(response.status, 200);
      assert.strictEqual(attempts, 3);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("should not retry on 4xx errors", async () => {
    let attempts = 0;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (() => {
      attempts++;
      return Promise.resolve(new Response("Not Found", { status: 404 }));
    }) as unknown as typeof fetch;

    try {
      const response = await fetchWithRetry("http://localhost/test", undefined, {
        maxRetries: 3,
        baseDelay: 10,
      });
      assert.strictEqual(response.status, 404);
      assert.strictEqual(attempts, 1);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("should throw after max retries", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (() =>
      Promise.resolve(new Response("Error", { status: 500 }))) as unknown as typeof fetch;

    try {
      await assert.rejects(
        fetchWithRetry("http://localhost/test", undefined, {
          maxRetries: 2,
          baseDelay: 10,
        }),
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("should retry on network errors", async () => {
    let attempts = 0;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (() => {
      attempts++;
      if (attempts < 2) {
        return Promise.reject(new Error("Network error"));
      }
      return Promise.resolve(new Response("OK", { status: 200 }));
    }) as unknown as typeof fetch;

    try {
      const response = await fetchWithRetry("http://localhost/test", undefined, {
        maxRetries: 3,
        baseDelay: 10,
      });
      assert.strictEqual(response.status, 200);
      assert.strictEqual(attempts, 2);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("should use custom retry predicate", async () => {
    let attempts = 0;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (() => {
      attempts++;
      return Promise.resolve(new Response("Rate limited", { status: 429 }));
    }) as unknown as typeof fetch;

    try {
      await fetchWithRetry("http://localhost/test", undefined, {
        maxRetries: 2,
        baseDelay: 10,
        retryOnStatus: (status) => status === 429 || status >= 500,
      });
    } catch {
      assert.strictEqual(attempts, 3); // Initial + 2 retries
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
