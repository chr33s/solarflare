import { defineConfig } from "rolldown";

import pkg from "./package.json" with { type: "json" };

export default defineConfig({
  transform: {
    define: {
      "import.meta.env.SOLARFLARE_VERSION": JSON.stringify(pkg.version),
    },
  },
});
