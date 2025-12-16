/** Pure path parsing utilities, safe for client-side use. */

/** Module kind based on file naming convention. */
export type ModuleKind = "server" | "client" | "layout" | "error" | "unknown";

/** Parsed path information with validated metadata. */
export interface ParsedPath {
  /** Original file path */
  original: string;
  /** Normalized path (without leading ./) */
  normalized: string;
  /** Module kind based on file suffix */
  kind: ModuleKind;
  /** Route segments */
  segments: string[];
  /** Dynamic parameter names (from $param) */
  params: string[];
  /** Whether this is an index/root route */
  isIndex: boolean;
  /** Whether this is a private file (_prefixed) */
  isPrivate: boolean;
  /** URLPattern pathname */
  pattern: string;
  /** Custom element tag name */
  tag: string;
  /** Route specificity score */
  specificity: number;
}

/** Determines module kind from file path. */
export function getModuleKind(filePath: string): ModuleKind {
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
