import type { VNode } from "preact";

export interface ErrorProps {
  error: Error;
  url?: URL;
  reset?: () => void;
}

export default function ErrorPage({ error, url, reset }: ErrorProps): VNode {
  return (
    <div class="error-page">
      <h1>Something went wrong</h1>
      <p>{error.message}</p>
      {url && <p class="error-url">Failed to load: {url.pathname}</p>}
      {reset && (
        <button onClick={reset} type="button">
          Try again
        </button>
      )}
      <a href="/">Go home</a>
    </div>
  );
}
