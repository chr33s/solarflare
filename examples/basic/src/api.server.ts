import { env } from "cloudflare:workers";

export default async function server(request: Request) {
  console.log({
    method: request.method,
    url: request.url,
  });
  return Response.json({ hello: env.HELLO ?? "world" });
}
