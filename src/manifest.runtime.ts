import type { ChunkManifest } from "./manifest.ts";
import type { ModuleMap } from "./server.ts";
// @ts-ignore - Generated at build time, aliased by bundler
import modules from ".modules.generated";
// @ts-ignore - Generated at build time, aliased by bundler
import chunkManifest from ".chunks.generated.json";

export const typedModules = modules as ModuleMap;

export const manifest = chunkManifest as ChunkManifest;

/** Gets the script path for a route from the chunk manifest. */
export function getScriptPath(tag: string) {
  return manifest.tags[tag];
}

/** Gets stylesheets for a route pattern from the chunk manifest. */
export function getStylesheets(pattern: string) {
  return manifest.styles[pattern] ?? [];
}

/** Gets whether a tag uses Shadow DOM (DSD). */
export function isShadowTag(tag: string) {
  return manifest.shadow?.[tag] ?? false;
}

/** Gets dev mode scripts from the chunk manifest. */
export function getDevScripts() {
  return manifest.devScripts;
}
