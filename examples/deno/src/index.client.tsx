export default function Index(props: {
  async?: string;
  defer?: string;
  defer2?: string;
  string?: string;
}) {
  console.log({ ...props, children: undefined, timeStamp: Date.now() });
  return (
    <main>
      <title>Home | Solarflare</title>
      <h1>Hello {props.string}</h1>
      <h2>Async: {props.async}</h2>
      <h3>{props.defer ? `Deferred: ${props.defer}` : "Loading..."}</h3>
      <h3>{props.defer2 ? `Deferred2: ${props.defer2}` : "Loading..."}</h3>
    </main>
  );
}
