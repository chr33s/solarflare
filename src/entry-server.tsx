import { renderToReadableStream } from 'preact-render-to-string/stream'
import { App } from './app'
import { Layout } from './layout'

export default {
  async fetch(request: Request, env: Env) {
    const url = new URL(request.url)

    const abortController = new AbortController()
    request.signal.addEventListener('abort', () => abortController.abort())
    const init = { signal: abortController.signal }

    if (url.pathname !== "/") {
      console.log({ asset: url.pathname })
      const asset = await env.ASSETS.fetch(request.url, init)
      if (asset.ok) return asset
    }

    console.log({ stream: url.pathname })
    const stream = renderToReadableStream(
      <Layout title="Preactflare SSR">
        <App />
      </Layout>
    )

    return new Response(stream, {
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    })
  },
} satisfies ExportedHandler<Env>
