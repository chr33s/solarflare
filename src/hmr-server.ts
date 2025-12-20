/** HMR WebSocket server for hot module replacement. */

/** HMR update event types */
export type HmrEventType = "update" | "full-reload" | "css-update" | "connected";

// Track connected HMR clients for broadcasting updates
const hmrClients = new Set<WebSocket>();

/**
 * Checks if request is an HMR WebSocket upgrade request.
 * @param request - Incoming request
 * @returns Whether this is an HMR request
 */
export function isHmrRequest(request: Request): boolean {
  const url = new URL(request.url);
  return url.pathname === "/_hmr" && request.headers.get("Upgrade") === "websocket";
}

/**
 * Handles HMR WebSocket upgrade request.
 * Uses Cloudflare Workers WebSocketPair for WebSocket upgrade.
 * @returns WebSocket upgrade response
 */
export function handleHmrRequest(): Response {
  // WebSocketPair is a Cloudflare Workers global
  const pair = new (
    globalThis as unknown as { WebSocketPair: new () => { 0: WebSocket; 1: WebSocket } }
  ).WebSocketPair();
  const client = pair[0];
  const server = pair[1] as WebSocket & { accept(): void };

  server.accept();
  hmrClients.add(server);

  // Send connected event
  server.send(JSON.stringify({ type: "connected" }));

  server.addEventListener("message", (event: MessageEvent) => {
    try {
      const message = JSON.parse(event.data as string);
      if (message.type === "ping") {
        server.send(JSON.stringify({ type: "pong" }));
      }
    } catch {
      // Ignore malformed messages
    }
  });

  server.addEventListener("close", () => {
    hmrClients.delete(server);
  });

  server.addEventListener("error", () => {
    hmrClients.delete(server);
  });

  return new Response(null, {
    status: 101,
    // @ts-expect-error - Cloudflare Workers Response extension
    webSocket: client,
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
      client.send(message);
    } catch {
      hmrClients.delete(client);
    }
  }
}
