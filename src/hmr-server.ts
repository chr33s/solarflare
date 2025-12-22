/** HMR SSE server for hot module replacement. */

/** HMR update event types */
export type HmrEventType = "update" | "full-reload" | "css-update" | "connected";

/** SSE controller for a connected client */
interface SseClient {
  controller: ReadableStreamDefaultController<Uint8Array>;
  encoder: TextEncoder;
}

// Track connected HMR clients for broadcasting updates
const hmrClients = new Set<SseClient>();

/**
 * Checks if request is an HMR SSE request.
 * @param request - Incoming request
 * @returns Whether this is an HMR request
 */
export function isHmrRequest(request: Request): boolean {
  const url = new URL(request.url);
  return url.pathname === "/_hmr" && request.method === "GET";
}

/**
 * Handles HMR SSE request.
 * Returns a streaming response for Server-Sent Events.
 * @returns SSE streaming response
 */
export function handleHmrRequest(): Response {
  const encoder = new TextEncoder();
  let client: SseClient;
  let heartbeatInterval: ReturnType<typeof setInterval>;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      client = { controller, encoder };
      hmrClients.add(client);

      // Send connected event
      const data = JSON.stringify({ type: "connected" });
      controller.enqueue(encoder.encode(`data: ${data}\n\n`));

      // Send heartbeat every 30s to keep connection alive, cloudflare returns Error 524 after 100s on no activity
      heartbeatInterval = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(`: heartbeat\n\n`));
        } catch {
          clearInterval(heartbeatInterval);
          hmrClients.delete(client);
        }
      }, 3_000);
    },
    cancel() {
      clearInterval(heartbeatInterval);
      hmrClients.delete(client);
    },
  });

  return new Response(stream, {
    headers: {
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "Content-Encoding": "identity",
      "Content-Type": "text/event-stream",
    },
  });
}

/**
 * Broadcasts an HMR update to all connected clients.
 * @param type - Event type (e.g., 'update', 'full-reload', 'css-update')
 * @param path - Changed file path (optional)
 */
export function broadcastHmrUpdate(type: HmrEventType, path?: string): void {
  const message = JSON.stringify({ type, path, timestamp: Date.now() });
  for (const client of hmrClients) {
    try {
      client.controller.enqueue(client.encoder.encode(`data: ${message}\n\n`));
    } catch {
      hmrClients.delete(client);
    }
  }
}
