import type { VNode } from "preact";
import { Assets } from "../framework/server";
import { Nav } from "./_components/nav";

export default function Layout({ children }: { children: VNode }) {
  return (
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <Assets />
      </head>
      <body>
        <Nav />
        <div id="app">{children}</div>
      </body>
    </html>
  );
}
