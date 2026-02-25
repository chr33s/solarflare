#!/usr/bin/env node
import { spawn, type ChildProcess } from "node:child_process";
import { watch } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { argv, env } from "node:process";
import { parseArgs } from "node:util";
import { buildClient } from "./build.bundle-client.ts";
import { buildServer } from "./build.bundle-server.ts";
import { loadUserConfig } from "./build.bundle.ts";
import { exists } from "./fs.ts";

/** Resolve paths relative to the current working directory. */
const ROOT_DIR = process.cwd();
const APP_DIR = join(ROOT_DIR, "src");
const DIST_DIR = join(ROOT_DIR, "dist");
const DIST_CLIENT = join(DIST_DIR, "client");
const DIST_SERVER = join(DIST_DIR, "server");
const PUBLIC_DIR = join(ROOT_DIR, "public");

/** Generated file paths. */
const MODULES_PATH = join(DIST_DIR, ".modules.generated.ts");
const CHUNKS_PATH = join(DIST_DIR, ".chunks.generated.json");
const ROUTES_TYPE_PATH = join(DIST_DIR, "routes.d.ts");

/** CLI entry point: parse args early so they're available. */
const { values: args, positionals } = parseArgs({
  allowPositionals: true,
  args: argv.slice(2),
  options: {
    production: {
      type: "boolean",
      short: "p",
      default: env.NODE_ENV === "production",
    },
    serve: { type: "boolean", short: "s", default: false },
    watch: { type: "boolean", short: "w", default: false },
    clean: { type: "boolean", short: "c", default: false },
    debug: { type: "boolean", short: "d", default: false },
    sourcemap: { type: "boolean", default: false },
    codemod: { type: "boolean", default: false },
    dry: { type: "boolean", default: false },
  },
});

/** Auto-scaffolds missing template files. */
async function scaffoldTemplates() {
  const templates: Record<string, string> = {
    "index.ts": /* tsx */ `import worker from "@chr33s/solarflare";
export default { fetch: worker };
`,
    "_error.tsx": /* tsx */ `export default function ErrorPage({ error }: { error: Error }) {
  return <div><h1>Error</h1><p>{error.message}</p></div>;
}
`,
    "_layout.tsx": /* tsx */ `import type { VNode } from "preact";
import { Head, Body } from "@chr33s/solarflare/server";

export default function Layout({ children }: { children: VNode }) {
  return <html><head><Head /></head><body>{children}<Body /></body></html>;
}
`,
  };

  const rootTemplates: Record<string, string> = {
    "wrangler.json": /* json */ `
      {
        "assets": { "directory": "./dist/client" },
        "compatibility_date": "2025-12-10",
        "compatibility_flags": ["nodejs_compat"],
        "dev": { "port": 8080 },
        "main": "./dist/server/index.js",
        "name": "solarflare"
      }
    `,
  };

  for (const [filename, content] of Object.entries(templates)) {
    const filepath = join(APP_DIR, filename);
    if (!(await exists(filepath))) {
      await writeFile(filepath, content);
    }
  }

  for (const [filename, content] of Object.entries(rootTemplates)) {
    const filepath = join(ROOT_DIR, filename);
    if (!(await exists(filepath))) {
      await writeFile(filepath, content);
    }
  }
}

/** Cleans the dist directory. */
async function clean() {
  const { rm } = await import("fs/promises");
  try {
    await rm(DIST_DIR, { recursive: true, force: true });
    console.log("🧹 Cleaned dist directory");
  } catch {}
}

/** Main build function. */
async function build() {
  const startTime = performance.now();

  console.log("\n⚡ Solarflare Build\n");

  if (args.clean) {
    await clean();
  }

  await scaffoldTemplates();

  const userConfig = await loadUserConfig(ROOT_DIR);
  if (userConfig) console.log("📋 Loaded rolldown.config.ts");

  await buildClient({
    args,
    rootDir: ROOT_DIR,
    appDir: APP_DIR,
    distDir: DIST_DIR,
    distClient: DIST_CLIENT,
    publicDir: PUBLIC_DIR,
    chunksPath: CHUNKS_PATH,
    userConfig,
  });

  await buildServer({
    args,
    rootDir: ROOT_DIR,
    appDir: APP_DIR,
    distServer: DIST_SERVER,
    modulesPath: MODULES_PATH,
    chunksPath: CHUNKS_PATH,
    routesTypePath: ROUTES_TYPE_PATH,
    userConfig,
  });

  const duration = ((performance.now() - startTime) / 1000).toFixed(2);
  console.log(`\n🚀 Build completed in ${duration}s\n`);
}

/** Watch mode - rebuilds on file changes and optionally starts dev server. */
async function watchBuild() {
  console.log("\n⚡ Solarflare Dev Mode\n");

  try {
    await build();
  } catch (err) {
    console.error("❌ Initial build failed:", err);
  }

  let wranglerProc: ChildProcess | null = null;

  if (args.serve) {
    console.log("🌐 Starting wrangler dev server...\n");
    wranglerProc = spawn("npx", ["wrangler", "dev"], {
      stdio: "inherit",
      env: { ...env },
    });
  }

  console.log("\n👀 Watching for changes...\n");

  let debounceTimer: NodeJS.Timeout | null = null;
  let isBuilding = false;
  let pendingBuild = false;
  const DEBOUNCE_MS = 150;

  async function doBuild(filename: string) {
    if (isBuilding) {
      pendingBuild = true;
      return;
    }

    isBuilding = true;
    console.log(`\n🔄 Change detected: ${filename}\n`);
    try {
      await build();
      console.log("\n👀 Watching for changes...\n");
    } catch (err) {
      console.error("❌ Build failed:", err);
      console.log("\n👀 Watching for changes...\n");
    } finally {
      isBuilding = false;
      if (pendingBuild) {
        pendingBuild = false;
        await doBuild("(queued changes)");
      }
    }
  }

  const watcher = watch(APP_DIR, { recursive: true }, (_event, filename) => {
    if (!filename) return;

    if (filename.endsWith(".generated.ts") || filename.endsWith(".generated.json")) {
      return;
    }

    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }

    debounceTimer = setTimeout(() => {
      void doBuild(filename);
    }, DEBOUNCE_MS);
  });

  let isExiting = false;
  process.on("SIGINT", () => {
    if (isExiting) return;
    isExiting = true;
    console.log("\n\n👋 Stopping dev server...\n");
    watcher.close();
    if (wranglerProc) {
      wranglerProc.kill("SIGTERM");
    }
    process.exit(0);
  });

  await new Promise(() => {});
}

if (import.meta.main) {
  if (args.codemod) {
    const { codemod } = await import("./codemod.ts");
    codemod(positionals, args);
  } else if (args.watch) {
    void watchBuild();
  } else {
    void build();
  }
}
