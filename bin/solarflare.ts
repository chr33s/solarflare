#!/usr/bin/env node
/**
 * Solarflare CLI Platform Detector
 * Automatically selects the correct compiled binary for the current platform
 */

import { execSync } from "child_process";
import { existsSync } from "fs";
import { join } from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const binDir = join(__dirname, "..");

// Detect platform
const platform = process.platform;
const arch = process.arch;

// Map to binary names
const binaries: Record<string, string> = {
  "darwin-x64": "solarflare-macos-x64",
  "darwin-arm64": "solarflare-macos-arm64",
  "linux-x64": "solarflare-linux-x64",
  "linux-arm64": "solarflare-linux-arm64",
  // "win32-x64": "solarflare-windows-x64.exe",
};

const key = `${platform}-${arch}`;
const binaryName = binaries[key];

if (!binaryName) {
  console.error(`❌ Solarflare CLI binary not available for ${platform} ${arch}`);
  console.error(`Available platforms: ${Object.keys(binaries).join(", ")}`);
  process.exit(1);
}

const binaryPath = join(binDir, "bin", binaryName);

if (!existsSync(binaryPath)) {
  console.error(
    `❌ Binary not found: ${binaryPath}\n` +
      `Run 'bun run build-cli' to compile the CLI for your platform.`,
  );
  process.exit(1);
}

// Execute the binary with all arguments
try {
  execSync(binaryPath + " " + process.argv.slice(2).join(" "), {
    cwd: process.cwd(),
    stdio: "inherit",
  });
} catch {
  process.exit(1);
}
