import { describe, it, expect } from "bun:test";
import { parseTagMeta, validateTag, type TagMeta, type TagValidation } from "./client";

describe("parseTagMeta", () => {
  it("should parse basic client file path", () => {
    const meta = parseTagMeta("./index.client.tsx");
    expect(meta.type).toBe("client");
    expect(meta.tag).toBe("sf-root");
    expect(meta.isRoot).toBe(true);
  });

  it("should parse server file path", () => {
    const meta = parseTagMeta("./blog/$slug.server.tsx");
    expect(meta.type).toBe("server");
    expect(meta.tag).toBe("sf-blog-slug");
  });

  it("should extract param names", () => {
    const meta = parseTagMeta("./users/$userId/posts/$postId.client.tsx");
    expect(meta.paramNames).toEqual(["userId", "postId"]);
  });

  it("should extract segments", () => {
    const meta = parseTagMeta("./blog/posts/featured.client.tsx");
    expect(meta.segments).toEqual(["blog", "posts", "featured"]);
  });

  it("should preserve original file path", () => {
    const path = "./custom/path.client.tsx";
    const meta = parseTagMeta(path);
    expect(meta.filePath).toBe(path);
  });

  it("should detect root/index components", () => {
    const indexMeta = parseTagMeta("./index.client.tsx");
    expect(indexMeta.isRoot).toBe(true);

    const nestedIndex = parseTagMeta("./blog/index.client.tsx");
    expect(nestedIndex.isRoot).toBe(true);
  });

  it("should detect non-root components", () => {
    const meta = parseTagMeta("./blog/$slug.client.tsx");
    expect(meta.isRoot).toBe(false);
  });

  it("should handle unknown module types", () => {
    const meta = parseTagMeta("./utils/helpers.ts");
    expect(meta.type).toBe("unknown");
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
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it("should validate tag with numbers", () => {
      const meta = createMeta({ tag: "sf-blog-post-123" });
      const result = validateTag(meta);
      expect(result.valid).toBe(true);
    });

    it("should validate multi-hyphen tags", () => {
      const meta = createMeta({ tag: "sf-user-profile-settings" });
      const result = validateTag(meta);
      expect(result.valid).toBe(true);
    });
  });

  describe("invalid tags", () => {
    it("should reject tags without hyphen", () => {
      const meta = createMeta({ tag: "component" });
      const result = validateTag(meta);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("hyphen"))).toBe(true);
    });

    it("should reject tags starting with uppercase", () => {
      const meta = createMeta({ tag: "Sf-component" });
      const result = validateTag(meta);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("lowercase"))).toBe(true);
    });

    it("should reject tags starting with xml", () => {
      const meta = createMeta({ tag: "xml-component" });
      const result = validateTag(meta);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("reserved prefix"))).toBe(true);
    });

    it("should reject tags starting with xlink", () => {
      const meta = createMeta({ tag: "xlink-element" });
      const result = validateTag(meta);
      expect(result.valid).toBe(false);
    });

    it("should reject tags starting with xmlns", () => {
      const meta = createMeta({ tag: "xmlns-tag" });
      const result = validateTag(meta);
      expect(result.valid).toBe(false);
    });

    it("should reject tags with invalid characters", () => {
      const meta = createMeta({ tag: "sf_component" });
      const result = validateTag(meta);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("invalid characters"))).toBe(true);
    });

    it("should reject tags with uppercase letters", () => {
      const meta = createMeta({ tag: "sf-MyComponent" });
      const result = validateTag(meta);
      expect(result.valid).toBe(false);
    });

    it("should reject tags with special characters", () => {
      const meta = createMeta({ tag: "sf-comp@nent" });
      const result = validateTag(meta);
      expect(result.valid).toBe(false);
    });
  });

  describe("warnings", () => {
    it("should warn about very long tag names", () => {
      const longTag = "sf-" + "a".repeat(50);
      const meta = createMeta({ tag: longTag });
      const result = validateTag(meta);
      expect(result.warnings.some((w) => w.includes("very long"))).toBe(true);
    });

    it("should warn about server components as custom elements", () => {
      const meta = createMeta({
        tag: "sf-api-handler",
        type: "server",
        filePath: "./api.server.tsx",
      });
      const result = validateTag(meta);
      expect(result.warnings.some((w) => w.includes("Server component"))).toBe(true);
    });

    it("should warn about unknown component types", () => {
      const meta = createMeta({
        tag: "sf-unknown",
        type: "unknown",
        filePath: "./unknown.tsx",
      });
      const result = validateTag(meta);
      expect(result.warnings.some((w) => w.includes("unknown type"))).toBe(true);
    });

    it("should not warn for valid client components", () => {
      const meta = createMeta({
        tag: "sf-valid-client",
        type: "client",
      });
      const result = validateTag(meta);
      expect(result.warnings.filter((w) => w.includes("Server component"))).toEqual([]);
      expect(result.warnings.filter((w) => w.includes("unknown type"))).toEqual([]);
    });
  });

  describe("validation result structure", () => {
    it("should return valid=true when no errors", () => {
      const meta = createMeta({ tag: "sf-valid" });
      const result = validateTag(meta);
      expect(result.valid).toBe(true);
    });

    it("should return valid=false when errors exist", () => {
      const meta = createMeta({ tag: "invalid" });
      const result = validateTag(meta);
      expect(result.valid).toBe(false);
    });

    it("should include all validation errors", () => {
      const meta = createMeta({ tag: "XML-COMPONENT" });
      const result = validateTag(meta);
      expect(result.errors.length).toBeGreaterThan(1);
    });

    it("should return TagValidation interface", () => {
      const meta = createMeta({ tag: "sf-test" });
      const result: TagValidation = validateTag(meta);
      expect(result).toHaveProperty("valid");
      expect(result).toHaveProperty("errors");
      expect(result).toHaveProperty("warnings");
    });
  });
});
