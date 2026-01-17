/** HMR update event types */
export type HmrEventType = "update" | "full-reload" | "css-update" | "connected";

/** SSE controller for a connected client */
interface SseClient {
  controller: ReadableStreamDefaultController<Uint8Array>;
  encoder: TextEncoder;
}

const hmrClients = new Set<SseClient>();

/** Checks if request is an HMR SSE request. */
export function isHmrRequest(request: Request) {
  const url = new URL(request.url);
  return url.pathname === "/_hmr" && request.method === "GET";
}

/** Handles HMR SSE request. */
export function handleHmrRequest() {
  const encoder = new TextEncoder();
  let client: SseClient;
  let heartbeatInterval: ReturnType<typeof setInterval>;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      client = { controller, encoder };
      hmrClients.add(client);

      const data = JSON.stringify({ type: "connected" });
      controller.enqueue(encoder.encode(`data: ${data}\n\n`));

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

/** Broadcasts an HMR update to all connected clients. */
export function broadcastHmrUpdate(type: HmrEventType, path?: string) {
  const message = JSON.stringify({ type, path, timestamp: Date.now() });
  for (const client of hmrClients) {
    try {
      client.controller.enqueue(client.encoder.encode(`data: ${message}\n\n`));
    } catch {
      hmrClients.delete(client);
    }
  }
}
