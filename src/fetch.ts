/** Fetch retry options. */
export interface FetchRetryOptions {
  /** Max retry attempts. @default 3 */
  maxRetries?: number;
  /** Base delay in ms between retries. @default 1000 */
  baseDelay?: number;
  /** Status codes to retry on. @default 5xx errors */
  retryOnStatus?: (status: number) => boolean;
}

/** Fetch with exponential backoff retry for transient failures. */
export async function fetchWithRetry(
  input: RequestInfo | URL,
  init?: RequestInit,
  options: FetchRetryOptions = {},
) {
  const { maxRetries = 3, baseDelay = 1000, retryOnStatus = (status) => status >= 500 } = options;

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(input, init);

      // Don't retry client errors (4xx), only server errors (5xx)
      if (response.ok || !retryOnStatus(response.status)) {
        return response;
      }

      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      // Network errors are retryable
      lastError = error instanceof Error ? error : new Error(String(error));
    }

    // Don't wait after the last attempt
    if (attempt < maxRetries) {
      const delay = baseDelay * Math.pow(2, attempt);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastError ?? new Error("Fetch failed after retries");
}
