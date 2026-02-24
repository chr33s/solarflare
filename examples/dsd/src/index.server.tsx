export default async function server(_request: Request, _params: Record<string, string>) {
  return {
    title: "Declarative Shadow DOM",
    items: ["Encapsulated styles", "No FOUC", "SSR shadow roots"],
  };
}
