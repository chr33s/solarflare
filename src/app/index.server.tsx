import { env } from 'cloudflare:workers'
import { parse } from '#solarflare/server'

export default async function server(request: Request) {
  const params = parse(request);
  console.log({
    method: request.method,
    url: request.url,
    body: request.method === "POST" ? await request.text() : null,
    params,
  });
  return { hello: env.HELLO ?? 'world' }
}
