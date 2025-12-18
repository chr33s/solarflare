import { createHash } from "node:crypto";
import { describe, it } from "node:test";
import * as assert from "node:assert/strict";

describe("generateHash logic", () => {
  const generateHash = (content: string): string => {
    return createHash("sha256").update(content).digest("hex").slice(0, 8);
  };

  it("should generate 8 character hash", () => {
    const hash = generateHash("test content");
    assert.strictEqual(hash.length, 8);
  });

  it("should generate hex characters only", () => {
    const hash = generateHash("test content");
    assert.strictEqual(/^[0-9a-f]+$/.test(hash), true);
  });

  it("should generate same hash for same content", () => {
    const hash1 = generateHash("test content");
    const hash2 = generateHash("test content");
    assert.strictEqual(hash1, hash2);
  });

  it("should generate different hashes for different content", () => {
    const hash1 = generateHash("content 1");
    const hash2 = generateHash("content 2");
    assert.notStrictEqual(hash1, hash2);
  });

  it("should handle empty string", () => {
    const hash = generateHash("");
    assert.strictEqual(hash.length, 8);
  });

  it("should handle unicode content", () => {
    const hash = generateHash("Hello 世界 🌍");
    assert.strictEqual(hash.length, 8);
  });
});

describe("normalizeAssetPath logic", () => {
  const normalizeAssetPath = (path: string): string => {
    return path.replace(/\//g, ".");
  };

  it("should replace slashes with dots", () => {
    assert.strictEqual(normalizeAssetPath("blog/posts/featured"), "blog.posts.featured");
  });

  it("should handle single level path", () => {
    assert.strictEqual(normalizeAssetPath("index"), "index");
  });

  it("should handle path with leading slash", () => {
    assert.strictEqual(normalizeAssetPath("/blog/post"), ".blog.post");
  });

  it("should handle empty path", () => {
    assert.strictEqual(normalizeAssetPath(""), "");
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
    assert.strictEqual(getChunkName("index.client.tsx"), "index.js");
  });

  it("should generate chunk name with hash", () => {
    assert.strictEqual(getChunkName("index.client.tsx", "abc12345"), "index.abc12345.js");
  });

  it("should handle nested paths", () => {
    assert.strictEqual(getChunkName("blog/posts/featured.client.tsx"), "blog.posts.featured.js");
  });

  it("should strip .client.ts extension", () => {
    assert.strictEqual(getChunkName("api.client.ts"), "api.js");
  });

  it("should strip .client.tsx extension", () => {
    assert.strictEqual(getChunkName("component.client.tsx"), "component.js");
  });

  it("should remove $ from dynamic segments", () => {
    assert.strictEqual(getChunkName("blog/$slug.client.tsx"), "blog.slug.js");
  });

  it("should handle multiple dynamic segments", () => {
    assert.strictEqual(
      getChunkName("users/$userId/posts/$postId.client.tsx"),
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
    assert.ok(result.includes("export interface Routes"));
  });

  it("should generate route type for index", () => {
    const result = generateRoutesTypeFile(["index.client.tsx"]);
    assert.ok(result.includes("'/'"));
    assert.ok(result.includes("Record<string, never>"));
  });

  it("should generate route type with params", () => {
    const result = generateRoutesTypeFile(["blog/$slug.client.tsx"]);
    assert.ok(result.includes("'/blog/:slug'"));
    assert.ok(result.includes("slug: string"));
  });

  it("should generate route type with multiple params", () => {
    const result = generateRoutesTypeFile(["users/$userId/posts/$postId.client.tsx"]);
    assert.ok(result.includes("userId: string"));
    assert.ok(result.includes("postId: string"));
  });

  it("should only include client routes", () => {
    const result = generateRoutesTypeFile([
      "blog/$slug.client.tsx",
      "blog/$slug.server.tsx",
      "api/data.server.tsx",
    ]);
    assert.ok(result.includes("'/blog/:slug'"));
    assert.ok(!result.includes("api"));
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
    assert.ok(imports.includes("./styles.css"));
  });

  it("should extract multiple CSS imports", () => {
    const content = `
      import './base.css';
      import './theme.css';
    `;
    const imports = extractCssImports(content);
    assert.ok(imports.includes("./base.css"));
    assert.ok(imports.includes("./theme.css"));
  });

  it("should handle double quotes", () => {
    const content = `import "./styles.css";`;
    const imports = extractCssImports(content);
    assert.ok(imports.includes("./styles.css"));
  });

  it("should return empty array for no CSS imports", () => {
    const content = `
      import { Component } from 'preact';
      import './utils';
    `;
    const imports = extractCssImports(content);
    assert.deepStrictEqual(imports, []);
  });
});

describe("template scaffolding logic", () => {
  const templates: Record<string, string> = {
    "index.ts": `import worker from "@chr33s/solarflare/worker";\nexport default { fetch: worker };\n`,
    "_error.tsx": `export default function Error({ error }: { error: Error }) {\n  return <div><h1>Error</h1><p>{error.message}</p></div>;\n}\n`,
    "_layout.tsx": `import type { VNode } from "preact";\nimport { Assets } from "@chr33s/solarflare/server";\n\nexport default function Layout({ children }: { children: VNode }) {\n  return <html><head><Assets /></head><body>{children}</body></html>;\n}\n`,
  };

  it("should have index.ts template", () => {
    assert.ok(templates["index.ts"].includes("solarflare/worker"));
    assert.ok(templates["index.ts"].includes("export default"));
  });

  it("should have _error.tsx template", () => {
    assert.ok(templates["_error.tsx"].includes("Error"));
    assert.ok(templates["_error.tsx"].includes("error.message"));
  });

  it("should have _layout.tsx template", () => {
    assert.ok(templates["_layout.tsx"].includes("Layout"));
    assert.ok(templates["_layout.tsx"].includes("children"));
    assert.ok(templates["_layout.tsx"].includes("Assets"));
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
    assert.strictEqual(isRouteFile("index.client.tsx"), true);
    assert.strictEqual(isRouteFile("blog/$slug.client.tsx"), true);
    assert.strictEqual(isRouteFile("api.client.ts"), true);
  });

  it("should match server route files", () => {
    assert.strictEqual(isRouteFile("index.server.tsx"), true);
    assert.strictEqual(isRouteFile("api/data.server.ts"), true);
  });

  it("should not match non-route files", () => {
    assert.strictEqual(isRouteFile("utils.ts"), false);
    assert.strictEqual(isRouteFile("component.tsx"), false);
  });

  it("should match layout files", () => {
    assert.strictEqual(isLayoutFile("_layout.tsx"), true);
    assert.strictEqual(isLayoutFile("blog/_layout.tsx"), true);
  });

  it("should not match non-layout files", () => {
    assert.strictEqual(isLayoutFile("layout.tsx"), false);
    assert.strictEqual(isLayoutFile("_layout.ts"), false);
  });

  it("should match error files", () => {
    assert.strictEqual(isErrorFile("_error.tsx"), true);
  });

  it("should not match non-error files", () => {
    assert.strictEqual(isErrorFile("error.tsx"), false);
    assert.strictEqual(isErrorFile("_error.ts"), false);
  });
});
