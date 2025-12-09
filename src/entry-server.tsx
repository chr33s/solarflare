import { renderToReadableStream } from 'preact-render-to-string/stream'
import { App } from './app'

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

    console.log({ fallback: "index.html" })
    const asset = await env.ASSETS.fetch(new URL("index.html", url), init)
    const template = await asset.text()
    const [before, after] = template.split(/<div id="app">(?:\$1)?<\/div>/)

    const props = { title: "Preactflare" }
    const app = renderToReadableStream(<App {...props } />)

    const encoder = new TextEncoder()
    const stream = new ReadableStream({
      cancel() {
        abortController.abort()
      },
      async start(controller) {
        try {
          controller.enqueue(encoder.encode(before + '<div id="app">'))
          const reader = app.getReader()
          while (true) {
            if (abortController.signal.aborted) {
              reader.cancel()
              controller.close()
              return
            }

            const { done, value } = await reader.read()
            if (done) break
            controller.enqueue(typeof value === 'string' ? encoder.encode(value) : value)
          }
          controller.enqueue(encoder.encode('</div>'))
          controller.enqueue(encoder.encode(`<script>window.__PROPS__=${JSON.stringify(props)}</script>`))
          controller.enqueue(encoder.encode(after))
          controller.close()
        } catch (error) {
          if (abortController.signal.aborted) {
            controller.close()
          } else {
            controller.error(error)
          }
        }
      }
    })

    return new Response(stream, {
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    })
  },
} satisfies ExportedHandler<Env>
