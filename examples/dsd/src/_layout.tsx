import type { VNode } from "preact";
import { Body, Head } from "@chr33s/solarflare/server";

export default function Layout({ children }: { children: VNode }) {
  return (
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>DSD Example | Solarflare</title>
        <Head />
      </head>
      <body>
        {children}
        <Body />
      </body>
    </html>
  );
}
