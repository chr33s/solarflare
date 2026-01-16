import worker from "@chr33s/solarflare";
import { serveDir } from "@std/http/file-server";

const clientDir = new URL("../client", import.meta.url).pathname;

Deno.serve({ port: 8080 }, async (req) => {
  const res = await serveDir(req, {
    fsRoot: clientDir,
    quiet: true,
  });

  if (res.status !== 404) {
    return res;
  }

  return worker(req);
});
