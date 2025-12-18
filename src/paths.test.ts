import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { parsePath } from "./paths.ts";

describe("parsePath", () => {
  describe("module kind detection", () => {
    it("should detect server modules", () => {
      const result = parsePath("./blog/$slug.server.tsx");
      assert.strictEqual(result.kind, "server");
    });

    it("should detect client modules", () => {
      const result = parsePath("./blog/$slug.client.tsx");
      assert.strictEqual(result.kind, "client");
    });

    it("should detect layout modules", () => {
      const result = parsePath("./blog/_layout.tsx");
      assert.strictEqual(result.kind, "layout");
    });

    it("should detect error modules", () => {
      const result = parsePath("./_error.tsx");
      assert.strictEqual(result.kind, "error");
    });

    it("should return unknown for unrecognized patterns", () => {
      const result = parsePath("./utils/helpers.tsx");
      assert.strictEqual(result.kind, "unknown");
    });
  });

  describe("path normalization", () => {
    it("should remove leading ./", () => {
      const result = parsePath("./src/app/index.tsx");
      assert.ok(!result.normalized.startsWith("./"));
    });

    it("should normalize paths with app prefix", () => {
      const result = parsePath("./src/app/blog/$slug.client.tsx");
      assert.strictEqual(result.normalized, "blog/$slug.client.tsx");
    });

    it("should preserve original path", () => {
      const original = "./blog/$slug.server.tsx";
      const result = parsePath(original);
      assert.strictEqual(result.original, original);
    });
  });

  describe("dynamic parameters", () => {
    it("should extract single dynamic param", () => {
      const result = parsePath("./blog/$slug.server.tsx");
      assert.deepStrictEqual(result.params, ["slug"]);
    });

    it("should extract multiple dynamic params", () => {
      const result = parsePath("./shop/$category/$productId.client.tsx");
      assert.deepStrictEqual(result.params, ["category", "productId"]);
    });

    it("should return empty params for static routes", () => {
      const result = parsePath("./about.server.tsx");
      assert.deepStrictEqual(result.params, []);
    });

    it("should handle nested dynamic params", () => {
      const result = parsePath("./users/$userId/posts/$postId.server.tsx");
      assert.deepStrictEqual(result.params, ["userId", "postId"]);
    });
  });

  describe("segments", () => {
    it("should parse route segments", () => {
      const result = parsePath("./blog/posts/recent.server.tsx");
      assert.deepStrictEqual(result.segments, ["blog", "posts", "recent"]);
    });

    it("should include dynamic segments", () => {
      const result = parsePath("./blog/$slug.server.tsx");
      assert.deepStrictEqual(result.segments, ["blog", "$slug"]);
    });

    it("should handle root index", () => {
      const result = parsePath("./index.server.tsx");
      assert.deepStrictEqual(result.segments, ["index"]);
    });
  });

  describe("isIndex detection", () => {
    it("should detect root index", () => {
      const result = parsePath("./index.server.tsx");
      assert.strictEqual(result.isIndex, true);
    });

    it("should detect nested index", () => {
      const result = parsePath("./blog/index.client.tsx");
      assert.strictEqual(result.isIndex, true);
    });

    it("should return false for non-index routes", () => {
      const result = parsePath("./blog/$slug.server.tsx");
      assert.strictEqual(result.isIndex, false);
    });
  });

  describe("private file detection", () => {
    it("should detect underscore-prefixed files as private", () => {
      const result = parsePath("./_layout.tsx");
      assert.strictEqual(result.isPrivate, true);
    });

    it("should detect private files in subdirectories", () => {
      const result = parsePath("./blog/_layout.tsx");
      assert.strictEqual(result.isPrivate, true);
    });

    it("should not mark regular files as private", () => {
      const result = parsePath("./blog/$slug.server.tsx");
      assert.strictEqual(result.isPrivate, false);
    });
  });

  describe("URL pattern generation", () => {
    it("should generate pattern for root index", () => {
      const result = parsePath("./index.server.tsx");
      assert.strictEqual(result.pattern, "/");
    });

    it("should generate pattern for static route", () => {
      const result = parsePath("./about.server.tsx");
      assert.strictEqual(result.pattern, "/about");
    });

    it("should generate pattern with dynamic segments", () => {
      const result = parsePath("./blog/$slug.server.tsx");
      assert.strictEqual(result.pattern, "/blog/:slug");
    });

    it("should generate pattern with multiple dynamic segments", () => {
      const result = parsePath("./users/$userId/posts/$postId.server.tsx");
      assert.strictEqual(result.pattern, "/users/:userId/posts/:postId");
    });

    it("should remove trailing /index from pattern", () => {
      const result = parsePath("./blog/index.client.tsx");
      assert.strictEqual(result.pattern, "/blog");
    });
  });

  describe("custom element tag generation", () => {
    it("should generate tag for root", () => {
      const result = parsePath("./index.server.tsx");
      assert.strictEqual(result.tag, "sf-root");
    });

    it("should generate tag for nested route", () => {
      const result = parsePath("./blog/$slug.server.tsx");
      assert.strictEqual(result.tag, "sf-blog-slug");
    });

    it("should lowercase tags", () => {
      const result = parsePath("./Blog/Post.client.tsx");
      assert.strictEqual(result.tag, "sf-blog-post");
    });

    it("should replace slashes with hyphens", () => {
      const result = parsePath("./users/profile/settings.client.tsx");
      assert.strictEqual(result.tag, "sf-users-profile-settings");
    });

    it("should strip $ from dynamic segments in tags", () => {
      const result = parsePath("./shop/$category/$productId.client.tsx");
      assert.strictEqual(result.tag, "sf-shop-category-productid");
    });
  });

  describe("specificity scoring", () => {
    it("should give higher specificity to static routes", () => {
      const staticRoute = parsePath("./blog/featured.server.tsx");
      const dynamicRoute = parsePath("./blog/$slug.server.tsx");
      assert.ok(staticRoute.specificity > dynamicRoute.specificity);
    });

    it("should give root route lower specificity than nested routes", () => {
      const root = parsePath("./index.server.tsx");
      const nested = parsePath("./blog/post.server.tsx");
      assert.ok(root.specificity < nested.specificity);
    });

    it("should increase specificity with more segments", () => {
      const shallow = parsePath("./blog.server.tsx");
      const deep = parsePath("./blog/posts/recent.server.tsx");
      assert.ok(deep.specificity > shallow.specificity);
    });
  });
});
