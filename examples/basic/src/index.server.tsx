import { env } from "cloudflare:workers";

export default async function server(request: Request, params: Record<string, string>) {
  console.log({
    method: request.method,
    url: request.url,
    body: request.method === "POST" ? await request.text() : null,
    params,
  });
  return {
    string: "World",
    async: await new Promise((resolve) => resolve(env.HELLO ?? "world")), // <-- blocks
    defer: new Promise((resolve) => setTimeout(() => resolve(env.HELLO ?? "world"), 2_500)), // <-- non-blocking
  };
}
