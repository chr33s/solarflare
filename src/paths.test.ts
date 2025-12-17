import { describe, it, expect } from "bun:test";
import { parsePath } from "./paths";

describe("parsePath", () => {
  describe("module kind detection", () => {
    it("should detect server modules", () => {
      const result = parsePath("./blog/$slug.server.tsx");
      expect(result.kind).toBe("server");
    });

    it("should detect client modules", () => {
      const result = parsePath("./blog/$slug.client.tsx");
      expect(result.kind).toBe("client");
    });

    it("should detect layout modules", () => {
      const result = parsePath("./blog/_layout.tsx");
      expect(result.kind).toBe("layout");
    });

    it("should detect error modules", () => {
      const result = parsePath("./_error.tsx");
      expect(result.kind).toBe("error");
    });

    it("should return unknown for unrecognized patterns", () => {
      const result = parsePath("./utils/helpers.tsx");
      expect(result.kind).toBe("unknown");
    });
  });

  describe("path normalization", () => {
    it("should remove leading ./", () => {
      const result = parsePath("./src/app/index.tsx");
      expect(result.normalized).not.toStartWith("./");
    });

    it("should normalize paths with app prefix", () => {
      const result = parsePath("./src/app/blog/$slug.client.tsx");
      expect(result.normalized).toBe("blog/$slug.client.tsx");
    });

    it("should preserve original path", () => {
      const original = "./blog/$slug.server.tsx";
      const result = parsePath(original);
      expect(result.original).toBe(original);
    });
  });

  describe("dynamic parameters", () => {
    it("should extract single dynamic param", () => {
      const result = parsePath("./blog/$slug.server.tsx");
      expect(result.params).toEqual(["slug"]);
    });

    it("should extract multiple dynamic params", () => {
      const result = parsePath("./shop/$category/$productId.client.tsx");
      expect(result.params).toEqual(["category", "productId"]);
    });

    it("should return empty params for static routes", () => {
      const result = parsePath("./about.server.tsx");
      expect(result.params).toEqual([]);
    });

    it("should handle nested dynamic params", () => {
      const result = parsePath("./users/$userId/posts/$postId.server.tsx");
      expect(result.params).toEqual(["userId", "postId"]);
    });
  });

  describe("segments", () => {
    it("should parse route segments", () => {
      const result = parsePath("./blog/posts/recent.server.tsx");
      expect(result.segments).toEqual(["blog", "posts", "recent"]);
    });

    it("should include dynamic segments", () => {
      const result = parsePath("./blog/$slug.server.tsx");
      expect(result.segments).toEqual(["blog", "$slug"]);
    });

    it("should handle root index", () => {
      const result = parsePath("./index.server.tsx");
      expect(result.segments).toEqual(["index"]);
    });
  });

  describe("isIndex detection", () => {
    it("should detect root index", () => {
      const result = parsePath("./index.server.tsx");
      expect(result.isIndex).toBe(true);
    });

    it("should detect nested index", () => {
      const result = parsePath("./blog/index.client.tsx");
      expect(result.isIndex).toBe(true);
    });

    it("should return false for non-index routes", () => {
      const result = parsePath("./blog/$slug.server.tsx");
      expect(result.isIndex).toBe(false);
    });
  });

  describe("private file detection", () => {
    it("should detect underscore-prefixed files as private", () => {
      const result = parsePath("./_layout.tsx");
      expect(result.isPrivate).toBe(true);
    });

    it("should detect private files in subdirectories", () => {
      const result = parsePath("./blog/_layout.tsx");
      expect(result.isPrivate).toBe(true);
    });

    it("should not mark regular files as private", () => {
      const result = parsePath("./blog/$slug.server.tsx");
      expect(result.isPrivate).toBe(false);
    });
  });

  describe("URL pattern generation", () => {
    it("should generate pattern for root index", () => {
      const result = parsePath("./index.server.tsx");
      expect(result.pattern).toBe("/");
    });

    it("should generate pattern for static route", () => {
      const result = parsePath("./about.server.tsx");
      expect(result.pattern).toBe("/about");
    });

    it("should generate pattern with dynamic segments", () => {
      const result = parsePath("./blog/$slug.server.tsx");
      expect(result.pattern).toBe("/blog/:slug");
    });

    it("should generate pattern with multiple dynamic segments", () => {
      const result = parsePath("./users/$userId/posts/$postId.server.tsx");
      expect(result.pattern).toBe("/users/:userId/posts/:postId");
    });

    it("should remove trailing /index from pattern", () => {
      const result = parsePath("./blog/index.client.tsx");
      expect(result.pattern).toBe("/blog");
    });
  });

  describe("custom element tag generation", () => {
    it("should generate tag for root", () => {
      const result = parsePath("./index.server.tsx");
      expect(result.tag).toBe("sf-root");
    });

    it("should generate tag for nested route", () => {
      const result = parsePath("./blog/$slug.server.tsx");
      expect(result.tag).toBe("sf-blog-slug");
    });

    it("should lowercase tags", () => {
      const result = parsePath("./Blog/Post.client.tsx");
      expect(result.tag).toBe("sf-blog-post");
    });

    it("should replace slashes with hyphens", () => {
      const result = parsePath("./users/profile/settings.client.tsx");
      expect(result.tag).toBe("sf-users-profile-settings");
    });

    it("should strip $ from dynamic segments in tags", () => {
      const result = parsePath("./shop/$category/$productId.client.tsx");
      expect(result.tag).toBe("sf-shop-category-productid");
    });
  });

  describe("specificity scoring", () => {
    it("should give higher specificity to static routes", () => {
      const staticRoute = parsePath("./blog/featured.server.tsx");
      const dynamicRoute = parsePath("./blog/$slug.server.tsx");
      expect(staticRoute.specificity).toBeGreaterThan(dynamicRoute.specificity);
    });

    it("should give root route lower specificity than nested routes", () => {
      const root = parsePath("./index.server.tsx");
      const nested = parsePath("./blog/post.server.tsx");
      expect(root.specificity).toBeLessThan(nested.specificity);
    });

    it("should increase specificity with more segments", () => {
      const shallow = parsePath("./blog.server.tsx");
      const deep = parsePath("./blog/posts/recent.server.tsx");
      expect(deep.specificity).toBeGreaterThan(shallow.specificity);
    });
  });
});
