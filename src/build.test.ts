import { describe, it, expect } from "bun:test";

describe("generateHash logic", () => {
  const generateHash = (content: string): string => {
    const hasher = new Bun.CryptoHasher("sha256");
    hasher.update(content);
    return hasher.digest("hex").slice(0, 8);
  };

  it("should generate 8 character hash", () => {
    const hash = generateHash("test content");
    expect(hash.length).toBe(8);
  });

  it("should generate hex characters only", () => {
    const hash = generateHash("test content");
    expect(/^[0-9a-f]+$/.test(hash)).toBe(true);
  });

  it("should generate same hash for same content", () => {
    const hash1 = generateHash("test content");
    const hash2 = generateHash("test content");
    expect(hash1).toBe(hash2);
  });

  it("should generate different hashes for different content", () => {
    const hash1 = generateHash("content 1");
    const hash2 = generateHash("content 2");
    expect(hash1).not.toBe(hash2);
  });

  it("should handle empty string", () => {
    const hash = generateHash("");
    expect(hash.length).toBe(8);
  });

  it("should handle unicode content", () => {
    const hash = generateHash("Hello 世界 🌍");
    expect(hash.length).toBe(8);
  });
});

describe("normalizeAssetPath logic", () => {
  const normalizeAssetPath = (path: string): string => {
    return path.replace(/\//g, ".");
  };

  it("should replace slashes with dots", () => {
    expect(normalizeAssetPath("blog/posts/featured")).toBe("blog.posts.featured");
  });

  it("should handle single level path", () => {
    expect(normalizeAssetPath("index")).toBe("index");
  });

  it("should handle path with leading slash", () => {
    expect(normalizeAssetPath("/blog/post")).toBe(".blog.post");
  });

  it("should handle empty path", () => {
    expect(normalizeAssetPath("")).toBe("");
  });
});

describe("getChunkName logic", () => {
  const getChunkName = (file: string, hash?: string): string => {
    const base = file
      .replace(/\.client\.tsx?$/, "")
      .replace(/\//g, ".")
      .replace(/\$/g, "")
      .replace(/^index$/, "index");

    return hash ? `${base}.${hash}.js` : `${base}.js`;
  };

  it("should generate chunk name for index", () => {
    expect(getChunkName("index.client.tsx")).toBe("index.js");
  });

  it("should generate chunk name with hash", () => {
    expect(getChunkName("index.client.tsx", "abc12345")).toBe("index.abc12345.js");
  });

  it("should handle nested paths", () => {
    expect(getChunkName("blog/posts/featured.client.tsx")).toBe("blog.posts.featured.js");
  });

  it("should strip .client.ts extension", () => {
    expect(getChunkName("api.client.ts")).toBe("api.js");
  });

  it("should strip .client.tsx extension", () => {
    expect(getChunkName("component.client.tsx")).toBe("component.js");
  });

  it("should remove $ from dynamic segments", () => {
    expect(getChunkName("blog/$slug.client.tsx")).toBe("blog.slug.js");
  });

  it("should handle multiple dynamic segments", () => {
    expect(getChunkName("users/$userId/posts/$postId.client.tsx")).toBe(
      "users.userId.posts.postId.js",
    );
  });
});

describe("generateRoutesTypeFile logic", () => {
  // Simplified version of the route type generation
  const generateRoutesTypeFile = (routeFiles: string[]): string => {
    const clientRoutes = routeFiles.filter((f) => f.includes(".client."));

    // Simplified path parsing
    const parseRoute = (file: string) => {
      const withoutExt = file.replace(/\.client\.tsx?$/, "");
      const segments = withoutExt.split("/");
      const params = segments.filter((s) => s.startsWith("$")).map((s) => s.slice(1));
      const pattern =
        "/" +
        withoutExt
          .replace(/\/index$/, "")
          .replace(/^index$/, "")
          .replace(/\$([^/]+)/g, ":$1");

      return { pattern: pattern || "/", params };
    };

    const routeTypes = clientRoutes
      .map((file) => {
        const parsed = parseRoute(file);
        const paramsType =
          parsed.params.length > 0
            ? `{ ${parsed.params.map((p) => `${p}: string`).join("; ")} }`
            : "Record<string, never>";
        return `  '${parsed.pattern}': { params: ${paramsType} }`;
      })
      .join("\n");

    return `export interface Routes {\n${routeTypes}\n}`;
  };

  it("should generate empty interface for no routes", () => {
    const result = generateRoutesTypeFile([]);
    expect(result).toContain("export interface Routes");
  });

  it("should generate route type for index", () => {
    const result = generateRoutesTypeFile(["index.client.tsx"]);
    expect(result).toContain("'/'");
    expect(result).toContain("Record<string, never>");
  });

  it("should generate route type with params", () => {
    const result = generateRoutesTypeFile(["blog/$slug.client.tsx"]);
    expect(result).toContain("'/blog/:slug'");
    expect(result).toContain("slug: string");
  });

  it("should generate route type with multiple params", () => {
    const result = generateRoutesTypeFile(["users/$userId/posts/$postId.client.tsx"]);
    expect(result).toContain("userId: string");
    expect(result).toContain("postId: string");
  });

  it("should only include client routes", () => {
    const result = generateRoutesTypeFile([
      "blog/$slug.client.tsx",
      "blog/$slug.server.tsx",
      "api/data.server.tsx",
    ]);
    expect(result).toContain("'/blog/:slug'");
    expect(result).not.toContain("api");
  });
});

describe("extractCssImports logic", () => {
  const extractCssImports = (content: string): string[] => {
    const cssImports: string[] = [];
    const importRegex = /import\s+['"](.+\.css)['"]|import\s+['"](.+\.css)['"]\s*;/g;
    let match;
    while ((match = importRegex.exec(content)) !== null) {
      const cssPath = match[1] || match[2];
      if (cssPath) {
        cssImports.push(cssPath);
      }
    }
    return cssImports;
  };

  it("should extract single CSS import", () => {
    const content = `import './styles.css';`;
    const imports = extractCssImports(content);
    expect(imports).toContain("./styles.css");
  });

  it("should extract multiple CSS imports", () => {
    const content = `
      import './base.css';
      import './theme.css';
    `;
    const imports = extractCssImports(content);
    expect(imports).toContain("./base.css");
    expect(imports).toContain("./theme.css");
  });

  it("should handle double quotes", () => {
    const content = `import "./styles.css";`;
    const imports = extractCssImports(content);
    expect(imports).toContain("./styles.css");
  });

  it("should return empty array for no CSS imports", () => {
    const content = `
      import { Component } from 'preact';
      import './utils';
    `;
    const imports = extractCssImports(content);
    expect(imports).toEqual([]);
  });
});

describe("template scaffolding logic", () => {
  const templates: Record<string, string> = {
    "index.ts": `import worker from "@chr33s/solarflare/worker";\nexport default { fetch: worker };\n`,
    "_error.tsx": `export default function Error({ error }: { error: Error }) {\n  return <div><h1>Error</h1><p>{error.message}</p></div>;\n}\n`,
    "_layout.tsx": `import type { VNode } from "preact";\nimport { Assets } from "@chr33s/solarflare/server";\n\nexport default function Layout({ children }: { children: VNode }) {\n  return <html><head><Assets /></head><body>{children}</body></html>;\n}\n`,
  };

  it("should have index.ts template", () => {
    expect(templates["index.ts"]).toContain("solarflare/worker");
    expect(templates["index.ts"]).toContain("export default");
  });

  it("should have _error.tsx template", () => {
    expect(templates["_error.tsx"]).toContain("Error");
    expect(templates["_error.tsx"]).toContain("error.message");
  });

  it("should have _layout.tsx template", () => {
    expect(templates["_layout.tsx"]).toContain("Layout");
    expect(templates["_layout.tsx"]).toContain("children");
    expect(templates["_layout.tsx"]).toContain("Assets");
  });
});

describe("route file pattern matching", () => {
  const isRouteFile = (file: string): boolean => {
    return /\.(client|server)\.(ts|tsx)$/.test(file);
  };

  const isLayoutFile = (file: string): boolean => {
    return file.endsWith("_layout.tsx");
  };

  const isErrorFile = (file: string): boolean => {
    return file.endsWith("_error.tsx");
  };

  it("should match client route files", () => {
    expect(isRouteFile("index.client.tsx")).toBe(true);
    expect(isRouteFile("blog/$slug.client.tsx")).toBe(true);
    expect(isRouteFile("api.client.ts")).toBe(true);
  });

  it("should match server route files", () => {
    expect(isRouteFile("index.server.tsx")).toBe(true);
    expect(isRouteFile("api/data.server.ts")).toBe(true);
  });

  it("should not match non-route files", () => {
    expect(isRouteFile("utils.ts")).toBe(false);
    expect(isRouteFile("component.tsx")).toBe(false);
  });

  it("should match layout files", () => {
    expect(isLayoutFile("_layout.tsx")).toBe(true);
    expect(isLayoutFile("blog/_layout.tsx")).toBe(true);
  });

  it("should not match non-layout files", () => {
    expect(isLayoutFile("layout.tsx")).toBe(false);
    expect(isLayoutFile("_layout.ts")).toBe(false);
  });

  it("should match error files", () => {
    expect(isErrorFile("_error.tsx")).toBe(true);
  });

  it("should not match non-error files", () => {
    expect(isErrorFile("error.tsx")).toBe(false);
    expect(isErrorFile("_error.ts")).toBe(false);
  });
});
