import worker from "@chr33s/solarflare";

export default {
  async fetch(request: Request, env: Env) {
    const response = await worker(request, env);
    const _response = new Response(response.body, response);
    _response.headers.set(
      "Content-Security-Policy",
      "frame-ancestors 'self' https://admin.shopify.com https://*.myshopify.com https://localhost:8080 http://localhost:8080 https://127.0.0.1:8080 http://127.0.0.1:8080",
    );
    return _response;
  },
};
