import { defineConfig } from "rolldown";

export default defineConfig({
  transform: {
    define: {
      "import.meta.env.SHOPIFY_API_KEY": JSON.stringify(process.env.SHOPIFY_API_KEY || ""),
    },
  },
});
