/** Route entry from build-time manifest. */
export interface RouteManifestEntry {
  pattern: string;
  tag: string;
  chunk?: string;
  styles?: string[];
  type: "client" | "server";
  params: string[];
}

/** Build-time routes manifest. */
export interface RoutesManifest {
  routes: RouteManifestEntry[];
  base?: string;
}

/** Chunk manifest mapping routes to assets. */
export interface ChunkManifest {
  chunks: Record<string, string>;
  tags: Record<string, string>;
  styles: Record<string, string[]>;
  devScripts?: string[];
}
