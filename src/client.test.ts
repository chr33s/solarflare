import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { parseTagMeta, validateTag, type TagMeta, type TagValidation } from "./client.ts";

describe("parseTagMeta", () => {
  it("should parse basic client file path", () => {
    const meta = parseTagMeta("./index.client.tsx");
    assert.strictEqual(meta.type, "client");
    assert.strictEqual(meta.tag, "sf-root");
    assert.strictEqual(meta.isRoot, true);
  });

  it("should parse server file path", () => {
    const meta = parseTagMeta("./blog/$slug.server.tsx");
    assert.strictEqual(meta.type, "server");
    assert.strictEqual(meta.tag, "sf-blog-slug");
  });

  it("should extract param names", () => {
    const meta = parseTagMeta("./users/$userId/posts/$postId.client.tsx");
    assert.deepStrictEqual(meta.paramNames, ["userId", "postId"]);
  });

  it("should extract segments", () => {
    const meta = parseTagMeta("./blog/posts/featured.client.tsx");
    assert.deepStrictEqual(meta.segments, ["blog", "posts", "featured"]);
  });

  it("should preserve original file path", () => {
    const path = "./custom/path.client.tsx";
    const meta = parseTagMeta(path);
    assert.strictEqual(meta.filePath, path);
  });

  it("should detect root/index components", () => {
    const indexMeta = parseTagMeta("./index.client.tsx");
    assert.strictEqual(indexMeta.isRoot, true);

    const nestedIndex = parseTagMeta("./blog/index.client.tsx");
    assert.strictEqual(nestedIndex.isRoot, true);
  });

  it("should detect non-root components", () => {
    const meta = parseTagMeta("./blog/$slug.client.tsx");
    assert.strictEqual(meta.isRoot, false);
  });

  it("should handle unknown module types", () => {
    const meta = parseTagMeta("./utils/helpers.ts");
    assert.strictEqual(meta.type, "unknown");
  });
});

describe("validateTag", () => {
  const createMeta = (overrides: Partial<TagMeta>): TagMeta => ({
    tag: "sf-test",
    filePath: "./test.client.tsx",
    segments: ["test"],
    paramNames: [],
    isRoot: false,
    type: "client",
    ...overrides,
  });

  describe("valid tags", () => {
    it("should validate standard solarflare tag", () => {
      const meta = createMeta({ tag: "sf-component" });
      const result = validateTag(meta);
      assert.strictEqual(result.valid, true);
      assert.deepStrictEqual(result.errors, []);
    });

    it("should validate tag with numbers", () => {
      const meta = createMeta({ tag: "sf-blog-post-123" });
      const result = validateTag(meta);
      assert.strictEqual(result.valid, true);
    });

    it("should validate multi-hyphen tags", () => {
      const meta = createMeta({ tag: "sf-user-profile-settings" });
      const result = validateTag(meta);
      assert.strictEqual(result.valid, true);
    });
  });

  describe("invalid tags", () => {
    it("should reject tags without hyphen", () => {
      const meta = createMeta({ tag: "component" });
      const result = validateTag(meta);
      assert.strictEqual(result.valid, false);
      assert.strictEqual(
        result.errors.some((e) => e.includes("hyphen")),
        true,
      );
    });

    it("should reject tags starting with uppercase", () => {
      const meta = createMeta({ tag: "Sf-component" });
      const result = validateTag(meta);
      assert.strictEqual(result.valid, false);
      assert.strictEqual(
        result.errors.some((e) => e.includes("lowercase")),
        true,
      );
    });

    it("should reject tags starting with xml", () => {
      const meta = createMeta({ tag: "xml-component" });
      const result = validateTag(meta);
      assert.strictEqual(result.valid, false);
      assert.strictEqual(
        result.errors.some((e) => e.includes("reserved prefix")),
        true,
      );
    });

    it("should reject tags starting with xlink", () => {
      const meta = createMeta({ tag: "xlink-element" });
      const result = validateTag(meta);
      assert.strictEqual(result.valid, false);
    });

    it("should reject tags starting with xmlns", () => {
      const meta = createMeta({ tag: "xmlns-tag" });
      const result = validateTag(meta);
      assert.strictEqual(result.valid, false);
    });

    it("should reject tags with invalid characters", () => {
      const meta = createMeta({ tag: "sf_component" });
      const result = validateTag(meta);
      assert.strictEqual(result.valid, false);
      assert.strictEqual(
        result.errors.some((e) => e.includes("invalid characters")),
        true,
      );
    });

    it("should reject tags with uppercase letters", () => {
      const meta = createMeta({ tag: "sf-MyComponent" });
      const result = validateTag(meta);
      assert.strictEqual(result.valid, false);
    });

    it("should reject tags with special characters", () => {
      const meta = createMeta({ tag: "sf-comp@nent" });
      const result = validateTag(meta);
      assert.strictEqual(result.valid, false);
    });
  });

  describe("warnings", () => {
    it("should warn about very long tag names", () => {
      const longTag = "sf-" + "a".repeat(50);
      const meta = createMeta({ tag: longTag });
      const result = validateTag(meta);
      assert.strictEqual(
        result.warnings.some((w) => w.includes("very long")),
        true,
      );
    });

    it("should warn about server components as custom elements", () => {
      const meta = createMeta({
        tag: "sf-api-handler",
        type: "server",
        filePath: "./api.server.tsx",
      });
      const result = validateTag(meta);
      assert.strictEqual(
        result.warnings.some((w) => w.includes("Server component")),
        true,
      );
    });

    it("should warn about unknown component types", () => {
      const meta = createMeta({
        tag: "sf-unknown",
        type: "unknown",
        filePath: "./unknown.tsx",
      });
      const result = validateTag(meta);
      assert.strictEqual(
        result.warnings.some((w) => w.includes("unknown type")),
        true,
      );
    });

    it("should not warn for valid client components", () => {
      const meta = createMeta({
        tag: "sf-valid-client",
        type: "client",
      });
      const result = validateTag(meta);
      assert.deepStrictEqual(
        result.warnings.filter((w) => w.includes("Server component")),
        [],
      );
      assert.deepStrictEqual(
        result.warnings.filter((w) => w.includes("unknown type")),
        [],
      );
    });
  });

  describe("validation result structure", () => {
    it("should return valid=true when no errors", () => {
      const meta = createMeta({ tag: "sf-valid" });
      const result = validateTag(meta);
      assert.strictEqual(result.valid, true);
    });

    it("should return valid=false when errors exist", () => {
      const meta = createMeta({ tag: "invalid" });
      const result = validateTag(meta);
      assert.strictEqual(result.valid, false);
    });

    it("should include all validation errors", () => {
      const meta = createMeta({ tag: "XML-COMPONENT" });
      const result = validateTag(meta);
      assert.ok(result.errors.length > 1);
    });

    it("should return TagValidation interface", () => {
      const meta = createMeta({ tag: "sf-test" });
      const result: TagValidation = validateTag(meta);
      assert.ok("valid" in result);
      assert.ok("errors" in result);
      assert.ok("warnings" in result);
    });
  });
});
