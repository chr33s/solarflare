#!/usr/bin/env -S npx tsx
import { spawn, type ChildProcess } from "node:child_process";
import { watch } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { argv, env } from "node:process";
import { parseArgs } from "node:util";
import { buildClient } from "./build.bundle-client.ts";
import { buildServer } from "./build.bundle-server.ts";
import { loadUserConfig, type BuildArgs } from "./build.bundle.ts";
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

export type BuildCliArgs = Partial<BuildArgs> & {
  production?: boolean;
  sourcemap?: boolean;
  debug?: boolean;
};

function toBuildArgs(args: BuildCliArgs): BuildArgs {
  return {
    production: Boolean(args.production),
    sourcemap: Boolean(args.sourcemap),
    debug: Boolean(args.debug),
    clean: args.clean,
    serve: args.serve,
    watch: args.watch,
    codemod: args.codemod,
    dry: args.dry,
  };
}

/** Parses CLI argv into build options. Call from main() only — not at import time. */
export function parseCliArgs(args = argv.slice(2)) {
  return parseArgs({
    allowPositionals: true,
    args,
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
}

/** Canonical root layout snippet shared by README and scaffold. */
export const LAYOUT_TEMPLATE = /* tsx */ `import type { VNode } from "preact";
import { Head, Body } from "@chr33s/solarflare/server";

export default function Layout({ children }: { children: VNode }) {
  return (
    <html>
      <head>
        <Head />
      </head>
      <body>
        {children}
        <Body />
      </body>
    </html>
  );
}
`;

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
    "_layout.tsx": LAYOUT_TEMPLATE,
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
export async function build(args: BuildCliArgs = {}) {
  const startTime = performance.now();

  console.log("\n⚡ Solarflare Build\n");

  if (args.clean) {
    await clean();
  }

  await scaffoldTemplates();

  const userConfig = await loadUserConfig(ROOT_DIR);
  if (userConfig) console.log("📋 Loaded rolldown.config.ts");

  const buildArgs = toBuildArgs(args);

  await buildClient({
    args: buildArgs,
    rootDir: ROOT_DIR,
    appDir: APP_DIR,
    distDir: DIST_DIR,
    distClient: DIST_CLIENT,
    publicDir: PUBLIC_DIR,
    chunksPath: CHUNKS_PATH,
    userConfig,
  });

  await buildServer({
    args: buildArgs,
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
export async function watchBuild(args: BuildCliArgs = {}) {
  console.log("\n⚡ Solarflare Dev Mode\n");

  try {
    await build(args);
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
      await build(args);
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

/** CLI entry — argv is parsed here, not at module import time. */
export async function main(argvInput = argv.slice(2)) {
  const { values: args, positionals } = parseCliArgs(argvInput);

  if (args.codemod) {
    const { codemod } = await import("./codemod.ts");
    codemod(positionals, args);
  } else if (args.watch) {
    await watchBuild(args);
  } else {
    await build(args);
  }
}

if (import.meta.main) {
  void main();
}
