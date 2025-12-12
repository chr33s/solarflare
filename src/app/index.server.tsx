export default async function server(
  request: Request,
  params: Record<string, string>,
  env: Env
) {
  console.log({
    method: request.method,
    url: request.url,
    body: request.method === "POST" ? await request.text() : null,
    params,
  });
  return { hello: env.HELLO ?? 'world' }
}
