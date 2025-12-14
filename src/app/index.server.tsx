import { env } from "cloudflare:workers";

export default async function server(request: Request, params: Record<string, string>) {
  console.log({
    method: request.method,
    url: request.url,
    body: request.method === "POST" ? await request.text() : null,
    params,
  });
  return Response.json({ hello: env.HELLO ?? "world" });
}
