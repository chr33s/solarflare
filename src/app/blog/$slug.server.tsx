import { env } from 'cloudflare:workers'

export default async function server(request: Request, params: Record<string, string>) {
  console.log({
    method: request.method,
    url: request.url,
    body: request.method === "POST" ? await request.formData() : null,
    params,
  })
  return Response.json({
    slug: params.slug,
    title: env.HELLO ?? 'world',
  });
}
