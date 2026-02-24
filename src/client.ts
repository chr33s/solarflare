import { type FunctionComponent } from "preact";
import { parsePath } from "./paths.ts";
import { hydrateStore, initHydrationCoordinator } from "./hydration.ts";
import { installHeadHoisting, createHeadContext, setHeadContext } from "./head.ts";
import { getRuntime } from "./runtime.ts";
import { stylesheets, supportsConstructableStylesheets } from "./stylesheets.ts";
import { getPreloadedStylesheet } from "./server.styles.ts";

export { initHmrEntry, reloadAllStylesheets } from "./hmr.ts";
export { hmr } from "./client.hmr.ts";
export { Deferred } from "./render-priority.ts";
export { navigate } from "./router.ts";

/** Initializes client-side store from SSR hydration data. */
export async function initClient() {
  const runtime = getRuntime();
  runtime.headContext ??= createHeadContext();
  setHeadContext(runtime.headContext);
  installHeadHoisting();

  await hydrateStore();
  initHydrationCoordinator();
}

/** Inline stylesheet entry for dev HMR registration. */
export interface InlineStyleEntry {
  id: string;
  css: string;
}

/** Registers inline stylesheets for a component (dev HMR). */
export function registerInlineStyles(tag: string, styles: InlineStyleEntry[]) {
  if (!styles.length) return;
  if (!supportsConstructableStylesheets() || typeof document === "undefined") return;

  // If DSD already provided inline <style> in the shadow root, migrate it to
  // adoptedStyleSheets so StylesheetManager.update() can reach it during HMR.
  const el = document.querySelector(tag);
  const shadowStyle = el?.shadowRoot?.querySelector("style");
  if (shadowStyle) {
    shadowStyle.remove();
  }

  for (const style of styles) {
    const preloaded = getPreloadedStylesheet(style.id);
    if (!preloaded) {
      stylesheets.register(style.id, style.css, { consumer: tag });
    }
  }

  const sheets = stylesheets.getForConsumer(tag);
  const shadowRoot = el?.shadowRoot;
  if (shadowRoot) {
    shadowRoot.adoptedStyleSheets = [
      ...shadowRoot.adoptedStyleSheets.filter((s) => !sheets.includes(s)),
      ...sheets,
    ];
  } else {
    document.adoptedStyleSheets = [
      ...document.adoptedStyleSheets.filter((s) => !sheets.includes(s)),
      ...sheets,
    ];
  }
}

/** Tag metadata from file path. */
export interface TagMeta {
  tag: string;
  filePath: string;
  segments: string[];
  /** Dynamic param names (from $param). */
  paramNames: string[];
  isRoot: boolean;
  type: "client" | "server" | "unknown";
}

/** Validation result for tag generation. */
export interface TagValidation {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/** Parses file path into structured tag metadata. */
export function parseTagMeta(path: string) {
  const parsed = parsePath(path);

  const type: TagMeta["type"] =
    parsed.kind === "client" || parsed.kind === "server" ? parsed.kind : "unknown";

  return {
    tag: parsed.tag,
    filePath: parsed.original,
    segments: parsed.segments,
    paramNames: parsed.params,
    isRoot: parsed.isIndex,
    type,
  };
}

/** Validates a tag against web component naming rules. */
export function validateTag(meta: TagMeta) {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!meta.tag.includes("-")) {
    errors.push(`Tag "${meta.tag}" must contain a hyphen for custom elements`);
  }

  if (!/^[a-z]/.test(meta.tag)) {
    errors.push(`Tag "${meta.tag}" must start with a lowercase letter`);
  }

  const reservedPrefixes = ["xml", "xlink", "xmlns"];
  for (const prefix of reservedPrefixes) {
    if (meta.tag.toLowerCase().startsWith(prefix)) {
      errors.push(`Tag "${meta.tag}" must not start with reserved prefix "${prefix}"`);
    }
  }

  if (!/^[a-z][a-z0-9-]*$/.test(meta.tag)) {
    errors.push(
      `Tag "${meta.tag}" contains invalid characters (only lowercase letters, numbers, and hyphens allowed)`,
    );
  }

  if (meta.tag.length > 50) {
    warnings.push(
      `Tag "${meta.tag}" is very long (${meta.tag.length} chars), consider shorter path`,
    );
  }

  if (meta.type === "server") {
    warnings.push(
      `Server component "${meta.filePath}" should not be registered as a custom element`,
    );
  }

  if (meta.type === "unknown") {
    warnings.push(
      `Component "${meta.filePath}" has unknown type (missing .client. or .server. suffix)`,
    );
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

export interface DefineOptions {
  /** Custom element tag name. @default generated from file path */
  tag?: string;
  /** Use Shadow DOM. @default false */
  shadow?: boolean;
  /** Observed attributes. @default auto-extracted */
  observedAttributes?: string[];
  /** Validate tag in dev mode. @default true */
  validate?: boolean;
}

/**
 * Registers a Preact component as a web component.
 * When used inside the solarflare build pipeline, `initHmrEntry` handles
 * actual registration — `define()` just returns the component.
 */
export function define<P extends Record<string, any>>(
  Component: FunctionComponent<P>,
  _options?: DefineOptions,
) {
  return Component;
}
