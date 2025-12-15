#!/usr/bin/env bun

type Target =
  | "bun-linux-x64"
  | "bun-linux-arm64"
  | "bun-darwin-x64"
  | "bun-darwin-arm64"
  | "bun-windows-x64";

const args = Bun.argv.slice(2);
const buildAll = args.includes("--all");
const current = !buildAll;

const outDir = "./bin";
const entrypoint = "./src/framework/build.ts";

// Platform configurations
const platforms: Array<{ target: Target; name: string }> = [
  { target: "bun-linux-x64", name: "solarflare-linux-x64" },
  { target: "bun-linux-arm64", name: "solarflare-linux-arm64" },
  { target: "bun-darwin-x64", name: "solarflare-macos-x64" },
  { target: "bun-darwin-arm64", name: "solarflare-macos-arm64" },
  { target: "bun-windows-x64", name: "solarflare-windows-x64.exe" },
];

export {};

console.log("🚀 Building Solarflare CLI...\n");

const targetsToBuild = current
  ? platforms.slice(2, 4) // Current platform (macOS versions as default)
  : platforms;

let successCount = 0;
let failCount = 0;

for (const { target, name } of targetsToBuild) {
  console.log(`\n📦 Building for ${target}...`);

  try {
    const outfilePath = `${outDir}/${name}`;

    // Bun.build with compile outputs to "build" by default
    const result = await Bun.build({
      entrypoints: [entrypoint],
      compile: {
        target,
        // Enable runtime loading of tsconfig.json and package.json
        // This allows the compiled binary to resolve path aliases like #app/* and #solarflare/*
        autoloadTsconfig: true,
        autoloadPackageJson: true,
        outfile: outfilePath,
      } as Record<string, unknown>,
      minify: true,
      sourcemap: "external",
    });
    if (!result.success) {
      throw new Error(`❌ Build failed for ${target}`, { cause: result.logs });
    }

    // Make executable
    const chmod = Bun.spawn(["chmod", "+x", outfilePath]);
    await chmod.exited;

    console.log(`✅ Built ${name}`);
    successCount++;
  } catch (error) {
    console.error(`❌ Error building ${target}:`, error);
    failCount++;
  }
}

console.log(`\n${"=".repeat(50)}`);
console.log(`✅ ${successCount} build(s) successful`);
if (failCount > 0) {
  console.log(`❌ ${failCount} build(s) failed`);
}
console.log(`${"=".repeat(50)}\n`);

if (failCount === 0) {
  console.log("📝 To use locally, symlink or copy a binary to your PATH:");
  console.log('   ln -sf "$(pwd)/bin/solarflare-macos-arm64" /usr/local/bin/solarflare');
  console.log("\n📦 To distribute, include all binaries from ./bin in your release.\n");
}

process.exit(failCount > 0 ? 1 : 0);
