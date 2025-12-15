import type { VNode } from "preact";
import "./_layout.css";

export default function Layout({ children }: { children: VNode }) {
  return <section id="blog">{children}</section>;
}
