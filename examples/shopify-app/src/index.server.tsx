export default async function server(_request: Request, _params: Record<string, string>) {
  return {
    _headers: {
      "Content-Security-Policy":
        "frame-ancestors 'self' https://admin.shopify.com https://*.myshopify.com https://localhost:8443 http://localhost:8443 https://127.0.0.1:8443 http://127.0.0.1:8443;",
    },
  };
}
