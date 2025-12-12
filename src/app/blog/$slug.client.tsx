export default function BlogPost({ slug, title }: { slug: string; title: string }) {
  return (
    <article>
      <h1>Blog: {title}</h1>
      <p>Blog post content goes here.</p>
      <form action={`/blog/${slug}`} method="POST">
        <input type="text" name="input" />
        <button type="submit">Submit</button>
      </form>
    </article>
  )
}
