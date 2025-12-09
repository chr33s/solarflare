import { renderToReadableStream } from 'preact-render-to-string/stream'
import { App } from './app'

export default {
  async fetch(request: Request, env: Env) {
    const url = new URL(request.url)

    if (url.pathname !== "/") {
      console.log({ asset: url.pathname })
      const asset = await env.ASSETS.fetch(request.url)
      if (asset.ok) return asset
    }

    console.log({ fallback: "index.html" })
    const asset = await env.ASSETS.fetch(new URL("index.html", url))
    const template = await asset.text()

    const [before, after] = template.split(/<div id="app">(?:\$1)?<\/div>/)
    const app = renderToReadableStream(<App />)

    const encoder = new TextEncoder()
    const stream = new ReadableStream({
      async start(controller) {
        controller.enqueue(encoder.encode(before + '<div id="app">'))
        const reader = app.getReader()
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          controller.enqueue(typeof value === 'string' ? encoder.encode(value) : value)
        }
        controller.enqueue(encoder.encode('</div>' + after))
        controller.close()
      }
    })

    return new Response(stream, {
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    })
  },
} satisfies ExportedHandler<Env>
