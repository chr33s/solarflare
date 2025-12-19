import type { VNode } from "preact";
import { Body, Head } from "@chr33s/solarflare/server";
import { Nav } from "./_components/nav";

export default function Layout({ children }: { children: VNode }) {
  return (
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <meta name="description" content="Solarflare Example App" />
        <title>Solarflare</title>
        <Head />
      </head>
      <body>
        <Nav />
        <div id="app">{children}</div>
        <Body />
      </body>
    </html>
  );
}
