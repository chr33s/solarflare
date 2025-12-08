import { renderToReadableStream } from 'preact-render-to-string/stream'
import { App } from './app'

export async function render(uri: string) {
	console.log({ uri })
  const html = renderToReadableStream(<App />)
  return { html }
}

export default {
	async fetch(request: Request) {
		console.log({ "fetch": request.url });
		const { html } = await render(new URL(request.url).pathname);
		return new Response(html, {
			headers: { 'Content-Type': 'text/html; charset=utf-8' },
		});
	}
} satisfies ExportedHandler;
