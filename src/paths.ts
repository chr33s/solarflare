/** Module kind based on file naming convention. */
export type ModuleKind = "server" | "client" | "layout" | "error" | "unknown";

/** Parsed path information with validated metadata. */
export interface ParsedPath {
  original: string;
  normalized: string;
  kind: ModuleKind;
  segments: string[];
  params: string[];
  isIndex: boolean;
  isPrivate: boolean;
  pattern: string;
  tag: string;
  specificity: number;
}

/** Determines module kind from file path. */
function getModuleKind(filePath: string): ModuleKind {
  if (filePath.includes(".server.")) return "server";
  if (filePath.includes(".client.")) return "client";
  if (filePath.includes("_layout.")) return "layout";
  if (filePath.includes("_error.")) return "error";
  return "unknown";
}

/** Parses a file path into structured metadata. */
export function parsePath(filePath: string): ParsedPath {
  const normalized = filePath.replace(/^\.\//, "").replace(/^.*\/app\//, "");
  const kind = getModuleKind(normalized);
  const isPrivate = normalized.includes("/_") || normalized.startsWith("_");

  const withoutExt = normalized.replace(/\.(client|server)\.tsx?$/, "").replace(/\.tsx?$/, "");

  const segments = withoutExt.split("/").filter(Boolean);

  const params: string[] = [];
  for (const segment of segments) {
    const match = segment.match(/^\$(.+)$/);
    if (match) {
      params.push(match[1]);
    }
  }

  const isIndex = withoutExt === "index" || withoutExt.endsWith("/index") || withoutExt === "";

  const pattern =
    "/" +
      withoutExt
        .replace(/\/index$/, "")
        .replace(/^index$/, "")
        .replace(/\$([^/]+)/g, ":$1") || "";

  const tag =
    "sf-" +
      withoutExt
        .replace(/\//g, "-")
        .replace(/\$/g, "")
        .replace(/^index$/, "root")
        .replace(/-index$/, "")
        .toLowerCase() || "sf-root";

  const staticSegments = segments.filter((s) => !s.startsWith("$")).length;
  const dynamicSegments = segments.filter((s) => s.startsWith("$")).length;
  const specificity =
    staticSegments * 2 + dynamicSegments + (pattern === "/" ? 0 : segments.length);

  return {
    original: filePath,
    normalized,
    kind,
    segments,
    params,
    isIndex,
    isPrivate,
    pattern,
    tag,
    specificity,
  };
}

/** Finds a paired module path given a client or server path. */
export function findPairedModulePath(
  path: string,
  modules: { client: Record<string, unknown>; server: Record<string, unknown> },
) {
  if (path.includes(".client.")) {
    const serverPath = path.replace(".client.", ".server.");
    return serverPath in modules.server ? serverPath : null;
  }
  if (path.includes(".server.")) {
    const clientPath = path.replace(".server.", ".client.");
    return clientPath in modules.client ? clientPath : null;
  }
  return null;
}
