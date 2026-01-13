import type { VNode } from "preact";
import { Head, Body } from "@chr33s/solarflare/server";

export default function Layout({ children }: { children: VNode }) {
  return (
    <html>
      <head>
        <script src="https://cdn.shopify.com/shopifycloud/app-bridge.js"></script>
        <script src="https://cdn.shopify.com/shopifycloud/polaris.js"></script>
        <Head />
      </head>
      <body>
        {children}
        <Body />
      </body>
    </html>
  );
}
