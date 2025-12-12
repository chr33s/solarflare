import { CountButton } from './_components/count-button'
import { PostForm } from './_components/post-form'
import logo from './logo.svg'
import './index.css'

export default function Index({ hello }: { hello: string }) {
  return (
    <main>
      <img src={logo} alt="Logo" />
      <h1>{hello}</h1>
      <CountButton />
      <PostForm action="/" />
    </main>
  )
}
