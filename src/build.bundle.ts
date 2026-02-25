import { join } from "node:path";
import type {
  ExternalOption,
  InputOptions,
  ModuleTypes,
  NormalizedOutputOptions,
  OutputBundle,
  OutputOptions,
  Plugin,
  RolldownOptions,
  RolldownPluginOption,
} from "rolldown";
import { exists } from "./fs.ts";

/** Load a `rolldown.config.ts` from `rootDir` if it exists. */
export async function loadUserConfig(rootDir: string): Promise<RolldownOptions | undefined> {
  const configPath = join(rootDir, "rolldown.config.ts");
  if (!(await exists(configPath))) return undefined;
  const { loadConfig } = await import("rolldown/config");
  const exported = await loadConfig(configPath);
  if (typeof exported === "function") return (await exported({})) as RolldownOptions;
  if (Array.isArray(exported)) return exported[0];
  return exported;
}

/** Merge user input options onto a framework base (plugins appended, resolve/external merged). */
export function mergeInputOptions(base: InputOptions, user?: RolldownOptions): InputOptions {
  if (!user) return base;
  const {
    output: _,
    plugins: userPlugins,
    resolve: userResolve,
    external: userExternal,
    ...rest
  } = user;
  return {
    ...base,
    ...rest,
    plugins: [...toArray(base.plugins), ...toArray(userPlugins)] as RolldownPluginOption[],
    resolve: {
      ...base.resolve,
      ...userResolve,
      alias: {
        ...(base.resolve?.alias as Record<string, string>),
        ...(userResolve?.alias as Record<string, string>),
      },
    },
    external: [...toArray(base.external), ...toArray(userExternal)] as ExternalOption,
  };
}

/** Merge user output options onto a framework base. */
export function mergeOutputOptions(base: OutputOptions, user?: RolldownOptions): OutputOptions {
  if (!user?.output) return base;
  const out = Array.isArray(user.output) ? user.output[0] : user.output;
  return { ...base, ...out };
}

function toArray<T>(value: T | T[] | undefined | null): T[] {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

/** Raw text replacement plugin for `%KEY%` patterns (like Vite's html env replacement). */
export function htmlReplacePlugin(replacements: Record<string, string>): Plugin {
  const entries = Object.entries(replacements);
  if (entries.length === 0) return { name: "html-replace" };
  return {
    name: "html-replace",
    transform(code) {
      let result = code;
      for (const [key, value] of entries) {
        result = result.replaceAll(key, value);
      }
      if (result === code) return null;
      return { code: result };
    },
  };
}

export const assetUrlPrefixPlugin = {
  name: "asset-url-prefix",
  generateBundle(_options: NormalizedOutputOptions, bundle: OutputBundle) {
    const assetFileNames = Object.values(bundle)
      .filter((item) => item.type === "asset")
      .map((asset) => asset.fileName);

    if (assetFileNames.length === 0) return;

    for (const item of Object.values(bundle)) {
      if (item.type !== "chunk") continue;
      let { code } = item;

      for (const fileName of assetFileNames) {
        const prefixed = `/assets/${fileName}`;
        code = code
          .replaceAll(`"${fileName}"`, `"${prefixed}"`)
          .replaceAll(`'${fileName}'`, `'${prefixed}'`)
          .replaceAll(`\`${fileName}\``, `\`${prefixed}\``);
      }

      item.code = code;
    }
  },
};

export interface BuildArgs {
  production: boolean;
  sourcemap: boolean;
  debug: boolean;
  clean?: boolean;
  serve?: boolean;
  watch?: boolean;
  codemod?: boolean;
  dry?: boolean;
}

export const moduleTypes: ModuleTypes = {
  ".svg": "asset",
  ".png": "asset",
  ".jpg": "asset",
  ".jpeg": "asset",
  ".gif": "asset",
  ".webp": "asset",
  ".ico": "asset",
};
