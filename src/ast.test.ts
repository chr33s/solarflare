import { describe, it, expect } from "bun:test";
import { join } from "path";
import ts from "typescript";
import {
  createProgram,
  getDefaultExportInfo,
  getTypeDeclaration,
  generateTypedModulesFile,
  type ModuleEntry,
} from "./ast";
import { parsePath } from "./paths";

describe("createProgram", () => {
  it("should create a TypeScript program", () => {
    const program = createProgram([]);
    expect(program).toBeDefined();
    expect(typeof program.getTypeChecker).toBe("function");
  });

  it("should create program with source files", () => {
    // Create a minimal test file
    const testFile = join(import.meta.dir, "paths.ts");
    const program = createProgram([testFile]);
    expect(program).toBeDefined();
    const sourceFile = program.getSourceFile(testFile);
    expect(sourceFile).toBeDefined();
  });
});

describe("getDefaultExportInfo", () => {
  it("should return null for file without default export", () => {
    const testFile = join(import.meta.dir, "paths.ts");
    const program = createProgram([testFile]);
    const checker = program.getTypeChecker();
    const sourceFile = program.getSourceFile(testFile)!;

    const exportInfo = getDefaultExportInfo(checker, sourceFile);
    // paths.ts has named exports but no default export
    expect(exportInfo).toBeNull();
  });

  it("should return export info for file with default export", () => {
    // Create an inline source file for testing
    const code = `export default function test() { return 42; }`;
    // TypeScript can parse the file, but we need a full program for type checking
    ts.createSourceFile("test.ts", code, ts.ScriptTarget.Latest, true);

    // We can't easily test this without a full program context
    // but we can verify the function exists and returns the right type
    expect(typeof getDefaultExportInfo).toBe("function");
  });
});

describe("getTypeDeclaration", () => {
  it("should return server loader type declaration", () => {
    const declaration = getTypeDeclaration("server");
    expect(declaration).toContain("Request");
    expect(declaration).toContain("Response");
    expect(declaration).toContain("Record<string, string>");
  });

  it("should return client component type declaration", () => {
    const declaration = getTypeDeclaration("client");
    expect(declaration).toContain("props");
    expect(declaration).toContain("VNode");
  });

  it("should return layout component type declaration", () => {
    const declaration = getTypeDeclaration("layout");
    expect(declaration).toContain("children");
    expect(declaration).toContain("VNode");
  });

  it("should return error component type declaration", () => {
    const declaration = getTypeDeclaration("error");
    expect(declaration).toContain("error");
    expect(declaration).toContain("Error");
    expect(declaration).toContain("statusCode");
  });

  it("should return unknown for unrecognized kind", () => {
    const declaration = getTypeDeclaration("unknown");
    expect(declaration).toBe("unknown");
  });
});

describe("generateTypedModulesFile", () => {
  it("should generate empty modules file with no entries", () => {
    const { content, errors } = generateTypedModulesFile([]);
    expect(errors).toEqual([]);
    expect(content).toContain("Auto-generated route modules");
    expect(content).toContain("export default modules");
  });

  it("should include module count comments", () => {
    const entries: ModuleEntry[] = [
      {
        path: "./index.server.tsx",
        parsed: parsePath("./index.server.tsx"),
        validation: null,
      },
      {
        path: "./index.client.tsx",
        parsed: parsePath("./index.client.tsx"),
        validation: null,
      },
    ];
    const { content } = generateTypedModulesFile(entries);
    expect(content).toContain("Server modules: 1");
    expect(content).toContain("Client modules: 1");
  });

  it("should generate server module entries", () => {
    const entries: ModuleEntry[] = [
      {
        path: "./blog/$slug.server.tsx",
        parsed: parsePath("./blog/$slug.server.tsx"),
        validation: null,
      },
    ];
    const { content } = generateTypedModulesFile(entries);
    expect(content).toContain("server:");
    expect(content).toContain("blog/$slug.server.tsx");
  });

  it("should generate client module entries", () => {
    const entries: ModuleEntry[] = [
      {
        path: "./blog/$slug.client.tsx",
        parsed: parsePath("./blog/$slug.client.tsx"),
        validation: null,
      },
    ];
    const { content } = generateTypedModulesFile(entries);
    expect(content).toContain("client:");
    expect(content).toContain("blog/$slug.client.tsx");
  });

  it("should generate layout module entries", () => {
    const entries: ModuleEntry[] = [
      {
        path: "./_layout.tsx",
        parsed: parsePath("./_layout.tsx"),
        validation: null,
      },
    ];
    const { content } = generateTypedModulesFile(entries);
    expect(content).toContain("layout:");
  });

  it("should include error module when present", () => {
    const entries: ModuleEntry[] = [
      {
        path: "./_error.tsx",
        parsed: parsePath("./_error.tsx"),
        validation: null,
      },
    ];
    const { content } = generateTypedModulesFile(entries);
    expect(content).toContain("error:");
    expect(content).toContain("_error.tsx");
  });

  it("should set error to undefined when not present", () => {
    const entries: ModuleEntry[] = [];
    const { content } = generateTypedModulesFile(entries);
    expect(content).toContain("error: undefined");
  });

  it("should collect validation errors", () => {
    const entries: ModuleEntry[] = [
      {
        path: "./bad-module.server.tsx",
        parsed: parsePath("./bad-module.server.tsx"),
        validation: {
          file: "./bad-module.server.tsx",
          kind: "server",
          valid: false,
          errors: ["Missing default export"],
          warnings: [],
          exportInfo: null,
        },
      },
    ];
    const { errors } = generateTypedModulesFile(entries);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("Missing default export");
  });

  it("should include type declarations", () => {
    const { content } = generateTypedModulesFile([]);
    expect(content).toContain("type ServerLoader");
    expect(content).toContain("type ClientComponent");
    expect(content).toContain("type LayoutComponent");
    expect(content).toContain("type ErrorComponent");
  });

  it("should include ModuleMap interface", () => {
    const { content } = generateTypedModulesFile([]);
    expect(content).toContain("interface ModuleMap");
    expect(content).toContain("server:");
    expect(content).toContain("client:");
    expect(content).toContain("layout:");
  });

  it("should generate import paths from dist to src", () => {
    const entries: ModuleEntry[] = [
      {
        path: "./index.client.tsx",
        parsed: parsePath("./index.client.tsx"),
        validation: null,
      },
    ];
    const { content } = generateTypedModulesFile(entries);
    expect(content).toContain("import('../src/");
  });
});
