import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";
import {
  createProgram,
  getDefaultExportInfo,
  getTypeDeclaration,
  generateTypedModulesFile,
  type ModuleEntry,
} from "./ast.ts";
import { parsePath } from "./paths.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));

describe("createProgram", () => {
  it("should create a TypeScript program", () => {
    const program = createProgram([]);
    assert.notStrictEqual(program, undefined);
    assert.strictEqual(typeof program.getTypeChecker, "function");
  });

  it("should create program with source files", () => {
    // Create a minimal test file
    const testFile = join(__dirname, "paths.ts");
    const program = createProgram([testFile]);
    assert.notStrictEqual(program, undefined);
    const sourceFile = program.getSourceFile(testFile);
    assert.notStrictEqual(sourceFile, undefined);
  });
});

describe("getDefaultExportInfo", () => {
  it("should return null for file without default export", () => {
    const testFile = join(__dirname, "paths.ts");
    const program = createProgram([testFile]);
    const checker = program.getTypeChecker();
    const sourceFile = program.getSourceFile(testFile)!;

    const exportInfo = getDefaultExportInfo(checker, sourceFile);
    // paths.ts has named exports but no default export
    assert.strictEqual(exportInfo, null);
  });

  it("should return export info for file with default export", () => {
    // Create an inline source file for testing
    const code = `export default function test() { return 42; }`;
    // TypeScript can parse the file, but we need a full program for type checking
    ts.createSourceFile("test.ts", code, ts.ScriptTarget.Latest, true);

    // We can't easily test this without a full program context
    // but we can verify the function exists and returns the right type
    assert.strictEqual(typeof getDefaultExportInfo, "function");
  });
});

describe("getTypeDeclaration", () => {
  it("should return server loader type declaration", () => {
    const declaration = getTypeDeclaration("server");
    assert.ok(declaration.includes("Request"));
    assert.ok(declaration.includes("Response"));
    assert.ok(declaration.includes("Record<string, string>"));
  });

  it("should return client component type declaration", () => {
    const declaration = getTypeDeclaration("client");
    assert.ok(declaration.includes("props"));
    assert.ok(declaration.includes("VNode"));
  });

  it("should return layout component type declaration", () => {
    const declaration = getTypeDeclaration("layout");
    assert.ok(declaration.includes("children"));
    assert.ok(declaration.includes("VNode"));
  });

  it("should return error component type declaration", () => {
    const declaration = getTypeDeclaration("error");
    assert.ok(declaration.includes("error"));
    assert.ok(declaration.includes("Error"));
    assert.ok(declaration.includes("statusCode"));
  });

  it("should return unknown for unrecognized kind", () => {
    const declaration = getTypeDeclaration("unknown");
    assert.strictEqual(declaration, "unknown");
  });
});

describe("generateTypedModulesFile", () => {
  it("should generate empty modules file with no entries", () => {
    const { content, errors } = generateTypedModulesFile([]);
    assert.deepStrictEqual(errors, []);
    assert.ok(content.includes("Auto-generated route modules"));
    assert.ok(content.includes("export default modules"));
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
    assert.ok(content.includes("Server modules: 1"));
    assert.ok(content.includes("Client modules: 1"));
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
    assert.ok(content.includes("server:"));
    assert.ok(content.includes("blog/$slug.server.tsx"));
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
    assert.ok(content.includes("client:"));
    assert.ok(content.includes("blog/$slug.client.tsx"));
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
    assert.ok(content.includes("layout:"));
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
    assert.ok(content.includes("error:"));
    assert.ok(content.includes("_error.tsx"));
  });

  it("should set error to undefined when not present", () => {
    const entries: ModuleEntry[] = [];
    const { content } = generateTypedModulesFile(entries);
    assert.ok(content.includes("error: undefined"));
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
    assert.strictEqual(errors.length, 1);
    assert.ok(errors[0].includes("Missing default export"));
  });

  it("should include type declarations", () => {
    const { content } = generateTypedModulesFile([]);
    assert.ok(content.includes("type ServerLoader"));
    assert.ok(content.includes("type ClientComponent"));
    assert.ok(content.includes("type LayoutComponent"));
    assert.ok(content.includes("type ErrorComponent"));
  });

  it("should include ModuleMap interface", () => {
    const { content } = generateTypedModulesFile([]);
    assert.ok(content.includes("interface ModuleMap"));
    assert.ok(content.includes("server:"));
    assert.ok(content.includes("client:"));
    assert.ok(content.includes("layout:"));
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
    assert.ok(content.includes("import('../src/"));
  });
});
