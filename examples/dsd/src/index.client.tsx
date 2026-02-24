import { define } from "@chr33s/solarflare/client";
import { useState } from "preact/hooks";
import "./index.css";

function Index(props: { title?: string; items?: string[] }) {
  const [count, setCount] = useState(0);

  return (
    <main>
      <h1>{props.title}</h1>
      <p>This component renders inside a declarative shadow root.</p>
      <p>Styles are encapsulated — they cannot leak out or be overridden by the document.</p>
      <ul>
        {props.items?.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
      <button onClick={() => setCount((c) => c + 1)}>count is {count}</button>
    </main>
  );
}

export default define(Index, { shadow: true });
