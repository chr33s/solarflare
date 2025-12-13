import { useNavigate, useRoute } from '#solarflare/client'
import { CountButton } from '#app/_components/count-button'
import { PostForm } from '#app/_components/post-form'

export default function BlogPost({ slug, title }: { slug: string; title: string }) {
  const navigate = useNavigate()
  const route = useRoute()

  return (
    <article>
      <h1>Blog: {title}</h1>
      <p>Blog post content goes here. {route?.params}</p>
      <CountButton />
      <PostForm action={`/blog/${slug}`} />
      <button onClick={() => navigate('/')}>Go Home</button>
    </article>
  )
}
