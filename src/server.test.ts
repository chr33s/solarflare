import { describe, it, expect } from "bun:test";
import {
  parsePattern,
  createRouter,
  matchRoute,
  findLayoutHierarchy,
  findLayouts,
  generateAssetTags,
  type Route,
  type ModuleMap,
} from "./server";

describe("parsePattern", () => {
  it("should parse static route", () => {
    const result = parsePattern("./about.server.tsx");
    expect(result.pathname).toBe("/about");
    expect(result.isStatic).toBe(true);
    expect(result.params).toEqual([]);
  });

  it("should parse route with single param", () => {
    const result = parsePattern("./blog/$slug.server.tsx");
    expect(result.pathname).toBe("/blog/:slug");
    expect(result.isStatic).toBe(false);
    expect(result.params).toHaveLength(1);
    expect(result.params[0].name).toBe("slug");
  });

  it("should parse route with multiple params", () => {
    const result = parsePattern("./users/$userId/posts/$postId.server.tsx");
    expect(result.pathname).toBe("/users/:userId/posts/:postId");
    expect(result.params).toHaveLength(2);
    expect(result.params[0].name).toBe("userId");
    expect(result.params[1].name).toBe("postId");
  });

  it("should parse index route", () => {
    const result = parsePattern("./index.server.tsx");
    expect(result.pathname).toBe("/");
  });

  it("should parse nested index route", () => {
    const result = parsePattern("./blog/index.server.tsx");
    expect(result.pathname).toBe("/blog");
  });

  it("should preserve original file path", () => {
    const path = "./custom/path.server.tsx";
    const result = parsePattern(path);
    expect(result.filePath).toBe(path);
  });

  it("should calculate specificity", () => {
    const staticRoute = parsePattern("./blog/featured.server.tsx");
    const dynamicRoute = parsePattern("./blog/$slug.server.tsx");
    expect(staticRoute.specificity).toBeGreaterThan(dynamicRoute.specificity);
  });
});

describe("createRouter", () => {
  const mockModules: ModuleMap = {
    server: {
      "./index.server.tsx": async () => ({ default: () => {} }),
      "./blog/$slug.server.tsx": async () => ({ default: () => {} }),
      "./about.server.tsx": async () => ({ default: () => {} }),
    },
    client: {
      "./index.client.tsx": async () => ({ default: () => {} }),
      "./blog/$slug.client.tsx": async () => ({ default: () => {} }),
    },
    layout: {
      "./_layout.tsx": async () => ({ default: () => {} }),
    },
  };

  it("should create routes from module map", () => {
    const routes = createRouter(mockModules);
    expect(routes.length).toBeGreaterThan(0);
  });

  it("should exclude private files (underscore prefix)", () => {
    const routes = createRouter(mockModules);
    const privatePaths = routes.filter((r) => r.path.includes("/_"));
    expect(privatePaths).toEqual([]);
  });

  it("should sort routes by specificity", () => {
    const routes = createRouter(mockModules);
    // Static routes should come before dynamic routes
    const aboutIndex = routes.findIndex((r) => r.path.includes("about"));
    const slugIndex = routes.findIndex((r) => r.path.includes("$slug"));
    if (aboutIndex !== -1 && slugIndex !== -1) {
      expect(aboutIndex).toBeLessThan(slugIndex);
    }
  });

  it("should set correct route types", () => {
    const routes = createRouter(mockModules);
    for (const route of routes) {
      if (route.path.includes(".server.")) {
        expect(route.type).toBe("server");
      } else if (route.path.includes(".client.")) {
        expect(route.type).toBe("client");
      }
    }
  });

  it("should create URLPattern for each route", () => {
    const routes = createRouter(mockModules);
    for (const route of routes) {
      expect(route.pattern).toBeInstanceOf(URLPattern);
    }
  });
});

describe("matchRoute", () => {
  const mockModules: ModuleMap = {
    server: {
      "./index.server.tsx": async () => ({ default: () => {} }),
      "./blog/$slug.server.tsx": async () => ({ default: () => {} }),
      "./about.server.tsx": async () => ({ default: () => {} }),
    },
    client: {},
    layout: {},
  };

  let routes: Route[];

  it("should match root route", () => {
    routes = createRouter(mockModules);
    const url = new URL("http://localhost/");
    const match = matchRoute(routes, url);
    expect(match).not.toBeNull();
    expect(match?.route.path).toBe("./index.server.tsx");
  });

  it("should match static route", () => {
    routes = createRouter(mockModules);
    const url = new URL("http://localhost/about");
    const match = matchRoute(routes, url);
    expect(match).not.toBeNull();
    expect(match?.route.path).toBe("./about.server.tsx");
  });

  it("should match dynamic route", () => {
    routes = createRouter(mockModules);
    const url = new URL("http://localhost/blog/hello-world");
    const match = matchRoute(routes, url);
    expect(match).not.toBeNull();
    expect(match?.params.slug).toBe("hello-world");
  });

  it("should extract route params", () => {
    routes = createRouter(mockModules);
    const url = new URL("http://localhost/blog/my-post-123");
    const match = matchRoute(routes, url);
    expect(match?.params).toEqual({ slug: "my-post-123" });
  });

  it("should return null for unmatched routes", () => {
    routes = createRouter(mockModules);
    const url = new URL("http://localhost/nonexistent/path");
    const match = matchRoute(routes, url);
    expect(match).toBeNull();
  });

  it("should set complete flag for fully matched params", () => {
    routes = createRouter(mockModules);
    const url = new URL("http://localhost/blog/test");
    const match = matchRoute(routes, url);
    expect(match?.complete).toBe(true);
  });
});

describe("findLayoutHierarchy", () => {
  const mockLayoutModules: Record<string, () => Promise<{ default: unknown }>> = {
    "./_layout.tsx": async () => ({ default: () => {} }),
    "./blog/_layout.tsx": async () => ({ default: () => {} }),
    "./blog/posts/_layout.tsx": async () => ({ default: () => {} }),
  };

  it("should find root layout", () => {
    const result = findLayoutHierarchy("./index.server.tsx", mockLayoutModules);
    expect(result.layouts.some((l) => l.path === "./_layout.tsx")).toBe(true);
  });

  it("should find nested layouts in order", () => {
    const result = findLayoutHierarchy("./blog/posts/featured.server.tsx", mockLayoutModules);
    expect(result.layouts).toHaveLength(3);
    expect(result.layouts[0].path).toBe("./_layout.tsx");
    expect(result.layouts[1].path).toBe("./blog/_layout.tsx");
    expect(result.layouts[2].path).toBe("./blog/posts/_layout.tsx");
  });

  it("should set correct depth for each layout", () => {
    const result = findLayoutHierarchy("./blog/posts/featured.server.tsx", mockLayoutModules);
    expect(result.layouts[0].depth).toBe(0);
    expect(result.layouts[1].depth).toBe(1);
    expect(result.layouts[2].depth).toBe(2);
  });

  it("should return empty layouts when none exist", () => {
    const result = findLayoutHierarchy("./standalone.server.tsx", {});
    expect(result.layouts).toEqual([]);
  });

  it("should include checked paths", () => {
    const result = findLayoutHierarchy("./blog/posts/test.server.tsx", mockLayoutModules);
    expect(result.checkedPaths).toContain("./_layout.tsx");
    expect(result.checkedPaths).toContain("./blog/_layout.tsx");
    expect(result.checkedPaths).toContain("./blog/posts/_layout.tsx");
  });

  it("should include segments", () => {
    const result = findLayoutHierarchy("./blog/posts/test.server.tsx", mockLayoutModules);
    expect(result.segments).toEqual(["blog", "posts"]);
  });
});

describe("findLayouts", () => {
  const mockModules: ModuleMap = {
    server: {},
    client: {},
    layout: {
      "./_layout.tsx": async () => ({ default: () => {} }),
      "./blog/_layout.tsx": async () => ({ default: () => {} }),
    },
  };

  it("should find layouts using module map", () => {
    const layouts = findLayouts("./blog/post.server.tsx", mockModules);
    expect(layouts).toHaveLength(2);
  });

  it("should return layouts in root-to-leaf order", () => {
    const layouts = findLayouts("./blog/post.server.tsx", mockModules);
    expect(layouts[0].depth).toBeLessThan(layouts[1].depth);
  });
});

describe("generateAssetTags", () => {
  it("should generate script tag", () => {
    const result = generateAssetTags("/app.js");
    expect(result).toContain('<script type="module" src="/app.js"></script>');
  });

  it("should generate stylesheet links", () => {
    const result = generateAssetTags(undefined, ["/styles.css", "/theme.css"]);
    expect(result).toContain('<link rel="stylesheet" href="/styles.css">');
    expect(result).toContain('<link rel="stylesheet" href="/theme.css">');
  });

  it("should generate dev scripts", () => {
    const result = generateAssetTags(undefined, undefined, ["/dev.js"]);
    expect(result).toContain('<script src="/dev.js"></script>');
  });

  it("should generate all asset types together", () => {
    const result = generateAssetTags("/app.js", ["/styles.css"], ["/dev.js"]);
    expect(result).toContain('<link rel="stylesheet" href="/styles.css">');
    expect(result).toContain('<script src="/dev.js"></script>');
    expect(result).toContain('<script type="module" src="/app.js"></script>');
  });

  it("should return empty string for no assets", () => {
    const result = generateAssetTags();
    expect(result).toBe("");
  });

  it("should handle empty arrays", () => {
    const result = generateAssetTags(undefined, [], []);
    expect(result).toBe("");
  });
});
