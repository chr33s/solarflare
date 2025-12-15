export function PostForm({ action }: { action: string }) {
  return (
    <form
      action={action}
      method="POST"
      onSubmit={(e) => {
        e.preventDefault();
        const form = e.currentTarget;
        const body = new FormData(form);
        fetch(action, { body, method: "POST" })
          .then(console.log)
          .catch(console.error)
          .finally(() => form.reset());
      }}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "8px",
        marginTop: "16px",
      }}
    >
      <label htmlFor="input">Input:</label>
      <input type="text" name="input" id="input" />
      <button type="submit">Submit</button>
    </form>
  );
}
