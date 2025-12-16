import { navigate } from "@chr33s/solarflare/client";
import { CountButton } from "#app/_components/count-button";
import { PostForm } from "#app/_components/post-form";

export default function BlogPost({ slug, title }: { slug: string; title: string }) {
  return (
    <article>
      <h1>Blog: {title}</h1>
      <p>Slug: {slug}</p>
      <CountButton />
      <PostForm action={`/blog/${slug}`} />
      <button onClick={() => navigate("/")}>Go Home</button>
    </article>
  );
}
