import worker from "@chr33s/solarflare";

const clientDir = new URL("../client", import.meta.url).pathname;

Bun.serve({
  fetch: worker,
  port: 8080,
  routes: Object.fromEntries(
    [...new Bun.Glob("**/*").scanSync(clientDir)].map((file) => [
      `/${file}`,
      new Response(Bun.file(`${clientDir}/${file}`)),
    ]),
  ),
});
