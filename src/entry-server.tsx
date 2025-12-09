import { renderToString } from 'preact-render-to-string'
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

    const app = renderToString(<App />)
    const html = template.replace(
      /<div id="app">(?:\$1)?<\/div>/,
      `<div id="app">${app}</div>`
    )

    return new Response(html, {
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    })
  },
} satisfies ExportedHandler<Env>
