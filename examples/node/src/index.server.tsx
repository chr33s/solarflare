export default async function server(_request: Request, _params: Record<string, string>) {
  return {
    string: "World",
    async: await new Promise((resolve) => resolve("world")), // <-- blocks
    defer: new Promise((resolve) => setTimeout(() => resolve("world1"), 1_500)), // <-- non-blocking
    defer2: new Promise((resolve) => setTimeout(() => resolve("world2"), 3_000)), // <-- non-blocking
  };
}
