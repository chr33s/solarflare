import type { VNode } from 'preact'

export default function Layout({ children }: { children: VNode }) {
  return (
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <link rel="stylesheet" href="/index.css" />
      </head>
      <body>
        <div id="app">{children}</div>
        <script type="module" src="/index.js"></script>
      </body>
    </html>
  )
}
