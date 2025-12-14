/**
 * Solarflare Path Utilities
 * Pure path parsing without TypeScript compiler dependency
 * Safe to import in client-side code
 */

// ============================================================================
// Path Analysis
// ============================================================================

/**
 * Module kind based on file naming convention
 */
export type ModuleKind = "server" | "client" | "layout" | "unknown";

/**
 * Parsed path information with validated metadata
 */
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

/**
 * Determine module kind from file path
 */
export function getModuleKind(filePath: string): ModuleKind {
  if (filePath.includes(".server.")) return "server";
  if (filePath.includes(".client.")) return "client";
  if (filePath.includes("_layout.")) return "layout";
  return "unknown";
}

/**
 * Parse a file path into structured metadata
 * This provides a unified approach to path analysis
 */
export function parsePath(filePath: string): ParsedPath {
  // Normalize path
  const normalized = filePath.replace(/^\.\//, "").replace(/^.*\/app\//, "");

  // Determine module kind
  const kind = getModuleKind(normalized);

  // Check if private
  const isPrivate = normalized.includes("/_") || normalized.startsWith("_");

  // Remove extension for processing - handle compound extensions like .client.tsx, .server.tsx
  const withoutExt = normalized
    .replace(/\.(client|server)\.tsx?$/, "") // Remove .client.tsx/.ts or .server.tsx/.ts
    .replace(/\.tsx?$/, ""); // Remove .ts or .tsx

  // Extract segments
  const segments = withoutExt.split("/").filter(Boolean);

  // Extract dynamic parameters (from $param segments)
  const params: string[] = [];
  for (const segment of segments) {
    const match = segment.match(/^\$(.+)$/);
    if (match) {
      params.push(match[1]);
    }
  }

  // Check if index
  const isIndex = withoutExt === "index" || withoutExt.endsWith("/index") || withoutExt === "";

  // Generate URLPattern pathname
  const pattern =
    "/" +
      withoutExt
        .replace(/\/index$/, "")
        .replace(/^index$/, "")
        .replace(/\$([^/]+)/g, ":$1") || "";

  // Generate custom element tag
  const tag =
    "sf-" +
      withoutExt
        .replace(/\//g, "-")
        .replace(/\$/g, "")
        .replace(/^index$/, "root")
        .replace(/-index$/, "")
        .toLowerCase() || "sf-root";

  // Calculate specificity
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
