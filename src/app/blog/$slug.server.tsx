export default async function server(
  request: Request,
  params: Record<string, string>,
  env: Env
) {
  const { slug } = params
  console.log({
    method: request.method,
    url: request.url,
    body: request.method === "POST" ? await request.formData() : null,
    params,
  });
  return Response.json({ slug, hello: env.HELLO ?? 'world' })
}
