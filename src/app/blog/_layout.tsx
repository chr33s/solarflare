import type { VNode } from 'preact'

export default function Layout({ children }: { children: VNode }) {
  return (
    <section id="blog">{children}</section>
  )
}
