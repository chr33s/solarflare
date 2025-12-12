export function PostForm({ action }: { action: string }) {
  return (
    <form
      action={action}
      method="POST"
      onSubmit={(e) => {
        e.preventDefault()
        const form = e.currentTarget
        const body = new FormData(form)
        fetch(action, { body, method: "POST" })
          .then(console.log)
          .catch(console.error)
          .finally(() => form.reset())
      }}
    >
      <input type="text" name="input" />
      <button type="submit">Submit</button>
    </form>
  )
}
