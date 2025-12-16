import type { VNode } from "preact";
import "./_error.css";

export interface ErrorProps {
  error: Error;
  url?: URL;
  statusCode?: number;
  reset?: () => void;
}

export default function ErrorPage({ error, url, statusCode = 500, reset }: ErrorProps): VNode {
  const title = statusCode === 404 ? "Page not found" : "Something went wrong";
  
  return (
    <div class="error-page">
      <h1>{title}</h1>
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
