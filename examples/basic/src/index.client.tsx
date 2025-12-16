import { CountButton } from "./_components/count-button";
import { PostForm } from "./_components/post-form";
import logo from "./logo.svg";
import "./index.css";

export default function Index(props: { async?: string; defer?: string; string?: string }) {
  console.log(props);
  return (
    <main>
      <img alt="Logo" height="231.25" src={logo} width="200" />
      <h1>Hello {props.string}</h1>
      <h2>Async: {props.async}</h2>
      <h3>{props.defer ? `Deferred: ${props.defer}` : "Loading..."}</h3>
      <CountButton />
      <PostForm action="/" />
    </main>
  );
}
