import { useState } from 'preact/hooks'
import logo from './logo.svg'
import './index.css'

export default function Index({ hello }: { hello: string }) {
  const [count, setCount] = useState(0)

  return (
    <main>
      <img src={logo} alt="Logo" />
      <h1>{hello}</h1>
      <button onClick={() => setCount((count) => count + 1)}>
        count is {count}
      </button>
      <form
        action="/"
        method="POST"
        onSubmit={(e) => {
          e.preventDefault()
          const form = e.currentTarget
          const body = new FormData(form)
          fetch("/", { body, method: "POST" })
            .then(console.log)
            .catch(console.error)
            .finally(() => form.reset())
        }}
      >
        <input type="text" name="input" />
        <button type="submit">Submit</button>
      </form>
    </main>
  )
}
