interface Props {
  slug: string
}

export default function BlogPost({ slug }: Props) {
  return (
    <article>
      <h1>Blog: {slug}</h1>
      <p>Blog post content goes here.</p>
      <form action={`/blog/${slug}`} method="POST">
        <input type="text" name="input" />
        <button type="submit">Submit</button>
      </form>
    </article>
  )
}
