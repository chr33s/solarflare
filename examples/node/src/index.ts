import worker from "@chr33s/solarflare/worker";
import { readFile, stat } from "node:fs/promises";
import * as http from "node:http";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
// After bundling, this runs from dist/server/, so ../client points to dist/client/
const STATIC_DIR = join(__dirname, "../client");

const MIME_TYPES: Record<string, string> = {
  ".css": "text/css",
  ".gif": "image/gif",
  ".html": "text/html",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript",
  ".json": "application/json",
  ".mjs": "text/javascript",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain",
  ".wasm": "application/wasm",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

async function serve(request: Request): Promise<Response | null> {
  const url = new URL(request.url);
  const filePath = join(STATIC_DIR, url.pathname);

  // Prevent directory traversal
  if (!filePath.startsWith(STATIC_DIR)) {
    return null;
  }

  try {
    const stats = await stat(filePath);
    if (!stats.isFile()) {
      return null;
    }

    const content = await readFile(filePath);
    const ext = extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] ?? "application/octet-stream";

    return new Response(content, {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch {
    return null;
  }
}

async function handler(request: Request): Promise<Response> {
  // Try static files first
  const staticResponse = await serve(request);
  if (staticResponse) {
    return staticResponse;
  }

  // Fall through to SSR worker
  return worker(request, process.env);
}

const server = http.createServer(async (req, res) => {
  const method = req.method ?? "GET";
  const headers = new Headers();
  for (let i = 0; i < req.rawHeaders.length; i += 2) {
    headers.append(req.rawHeaders[i], req.rawHeaders[i + 1]);
  }

  const host = headers.get("Host") ?? "localhost";
  const url = new URL(req.url ?? "/", `http://${host}`);

  // Include body for methods that support it
  const hasBody = method !== "GET" && method !== "HEAD";
  const body = hasBody ? req : undefined;

  // @ts-expect-error Node.js IncomingMessage is compatible with BodyInit
  const request = new Request(url, { method, headers, body, duplex: "half" });

  try {
    const response = await handler(request);

    const resHeaders: Record<string, string> = {};
    for (const [key, value] of response.headers) {
      resHeaders[key] = value;
    }

    res.writeHead(response.status, response.statusText, resHeaders);

    if (response.body && method !== "HEAD") {
      const reader = response.body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(value);
      }
    }

    res.end();
  } catch (error) {
    console.error("Request handler error:", error);
    res.writeHead(500, { "Content-Type": "text/plain" });
    res.end("Internal Server Error");
  }
});
server.listen(8080, () => {
  console.log("🚀 Server running at http://localhost:8080");
});
