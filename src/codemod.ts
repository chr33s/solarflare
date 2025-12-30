/**
 * Codemod to transform:
 * react -> preact
 * react-router (framework mode) -> solarflare
 */

import * as fs from "fs";
import { Project, SourceFile, SyntaxKind, Node } from "ts-morph";

interface RouteModule {
  loader?: string;
  action?: string;
  component?: string;
  meta?: string;
  hasDefault?: boolean;
}

/** React → Preact import mapping */
const REACT_TO_PREACT_IMPORTS: Record<string, string> = {
  react: "preact",
  "react-dom": "preact",
  "react-dom/client": "preact",
  "react/jsx-runtime": "preact/jsx-runtime",
  "react/jsx-dev-runtime": "preact/jsx-dev-runtime",
};

/** React hooks → Preact hooks mapping */
const REACT_HOOKS_TO_PREACT: Record<string, { source: string; name: string }> = {
  useState: { source: "preact/hooks", name: "useState" },
  useEffect: { source: "preact/hooks", name: "useEffect" },
  useContext: { source: "preact/hooks", name: "useContext" },
  useReducer: { source: "preact/hooks", name: "useReducer" },
  useCallback: { source: "preact/hooks", name: "useCallback" },
  useMemo: { source: "preact/hooks", name: "useMemo" },
  useRef: { source: "preact/hooks", name: "useRef" },
  useImperativeHandle: {
    source: "preact/hooks",
    name: "useImperativeHandle",
  },
  useLayoutEffect: { source: "preact/hooks", name: "useLayoutEffect" },
  useDebugValue: { source: "preact/hooks", name: "useDebugValue" },
  useId: { source: "preact/hooks", name: "useId" },
};

/** React types → Preact types mapping */
const REACT_TYPES_TO_PREACT: Record<string, { source: string; name: string }> = {
  ReactNode: { source: "preact", name: "ComponentChildren" },
  ReactElement: { source: "preact", name: "VNode" },
  FC: { source: "preact", name: "FunctionComponent" },
  FunctionComponent: { source: "preact", name: "FunctionComponent" },
  Component: { source: "preact", name: "Component" },
  ComponentType: { source: "preact", name: "ComponentType" },
  JSX: { source: "preact", name: "JSX" },
  ReactPortal: { source: "preact", name: "VNode" },
  RefObject: { source: "preact", name: "Ref" },
};

interface TransformOptions {
  dry?: boolean;
}

/** Transform source code directly (for testing) */
export function transformSource(source: string, filePath = "test.tsx"): string {
  const project = new Project({ useInMemoryFileSystem: true });
  const sourceFile = project.createSourceFile(filePath, source);

  transformReactToPreact(sourceFile);

  if (!filePath.includes("/routes/") && !filePath.includes("/app/")) {
    return sourceFile.getFullText();
  }

  const routeModule = analyzeRouteModule(sourceFile);

  if (filePath.endsWith("routes.ts") || filePath.endsWith("routes.tsx")) {
    return transformRoutesConfig(sourceFile);
  }

  if (routeModule.loader || routeModule.action || routeModule.component) {
    return sourceFile.getFullText();
  }

  return sourceFile.getFullText();
}

/** Main transformer function (reads from disk) */
export function transformer(filePath: string, options: TransformOptions = {}): string | null {
  if (filePath.includes("node_modules")) {
    return null;
  }

  const project = new Project({ useInMemoryFileSystem: true });
  const fileContent = fs.readFileSync(filePath, "utf-8");
  const sourceFile = project.createSourceFile(filePath, fileContent);

  transformReactToPreact(sourceFile);

  if (!filePath.includes("/routes/") && !filePath.includes("/app/")) {
    return sourceFile.getFullText();
  }

  const routeModule = analyzeRouteModule(sourceFile);

  if (filePath.endsWith("routes.ts") || filePath.endsWith("routes.tsx")) {
    return transformRoutesConfig(sourceFile);
  }

  if (routeModule.loader || routeModule.action || routeModule.component) {
    return transformRouteModule(sourceFile, filePath, routeModule, options);
  }

  return sourceFile.getFullText();
}

/** Transform React imports to Preact equivalents */
function transformReactToPreact(sourceFile: SourceFile): void {
  const hooksToAdd: string[] = [];
  const importsToRemove: number[] = [];
  const imports = sourceFile.getImportDeclarations();

  for (let i = 0; i < imports.length; i++) {
    const importDecl = imports[i];
    const moduleSpecifier = importDecl.getModuleSpecifierValue();

    if (REACT_TO_PREACT_IMPORTS[moduleSpecifier]) {
      const newSource = REACT_TO_PREACT_IMPORTS[moduleSpecifier];
      const namedImports = importDecl.getNamedImports();
      const defaultImport = importDecl.getDefaultImport();

      const hookImports: string[] = [];
      const otherImports: string[] = [];

      for (const named of namedImports) {
        const importName = named.getName();
        const alias = named.getAliasNode()?.getText();

        if (REACT_HOOKS_TO_PREACT[importName]) {
          hookImports.push(alias ? `${importName} as ${alias}` : importName);
          hooksToAdd.push(...hookImports);
        } else if (REACT_TYPES_TO_PREACT[importName]) {
          const preactType = REACT_TYPES_TO_PREACT[importName];
          otherImports.push(
            alias || importName !== preactType.name
              ? `${preactType.name} as ${alias || importName}`
              : preactType.name,
          );
        } else {
          otherImports.push(alias ? `${importName} as ${alias}` : importName);
        }
      }

      if (otherImports.length > 0 || defaultImport) {
        importDecl.setModuleSpecifier(newSource);
        if (namedImports.length > 0) {
          importDecl.removeNamedImports();
          if (otherImports.length > 0) {
            importDecl.addNamedImports(otherImports);
          }
        }
      } else {
        importsToRemove.push(i);
      }
    }

    if (moduleSpecifier === "react" && importDecl.isTypeOnly()) {
      const namedImports = importDecl.getNamedImports();
      const transformedImports: string[] = [];

      for (const named of namedImports) {
        const importName = named.getName();
        const alias = named.getAliasNode()?.getText();

        if (REACT_TYPES_TO_PREACT[importName]) {
          const preactType = REACT_TYPES_TO_PREACT[importName];
          transformedImports.push(
            alias || importName !== preactType.name
              ? `${preactType.name} as ${alias || importName}`
              : preactType.name,
          );
        } else {
          transformedImports.push(alias ? `${importName} as ${alias}` : importName);
        }
      }

      importDecl.setModuleSpecifier("preact");
      importDecl.removeNamedImports();
      importDecl.addNamedImports(transformedImports);
    }
  }

  for (const idx of importsToRemove.reverse()) {
    imports[idx].remove();
  }

  if (hooksToAdd.length > 0) {
    const uniqueHooks = [...new Set(hooksToAdd)];
    sourceFile.addImportDeclaration({
      moduleSpecifier: "preact/hooks",
      namedImports: uniqueHooks,
    });
  }

  const hasJsxFragment = sourceFile.getDescendantsOfKind(SyntaxKind.JsxFragment).length > 0;

  if (hasJsxFragment) {
    const preactImport = sourceFile.getImportDeclaration(
      (d) => d.getModuleSpecifierValue() === "preact",
    );
    const hasFragment = preactImport?.getNamedImports().some((n) => n.getName() === "Fragment");

    if (!hasFragment) {
      if (preactImport) {
        preactImport.addNamedImport("Fragment");
      } else {
        sourceFile.insertImportDeclaration(0, {
          moduleSpecifier: "preact",
          namedImports: ["Fragment"],
        });
      }
    }
  }
}

/** Analyze a React Router route module to extract exports */
function analyzeRouteModule(sourceFile: SourceFile): RouteModule {
  const module: RouteModule = {};

  for (const exportDecl of sourceFile.getExportedDeclarations()) {
    const [name, declarations] = exportDecl;

    for (const decl of declarations) {
      if (Node.isFunctionDeclaration(decl)) {
        const funcName = decl.getName();
        if (funcName === "loader") {
          module.loader = decl.getFullText();
        } else if (funcName === "action") {
          module.action = decl.getFullText();
        } else if (funcName === "meta") {
          module.meta = decl.getFullText();
        }
      }
    }

    if (name === "default") {
      module.hasDefault = true;
      module.component = declarations[0]?.getFullText();
    }
  }

  return module;
}

/** Transform a React Router route module into Solarflare server + client files */
function transformRouteModule(
  sourceFile: SourceFile,
  filePath: string,
  routeModule: RouteModule,
  options: TransformOptions,
): string | null {
  const baseName = filePath.replace(/\.(tsx|ts|jsx|js)$/, "");

  if (routeModule.loader || routeModule.action) {
    const serverFile = generateServerFile(sourceFile, routeModule);
    const serverPath = `${baseName}.server.tsx`;

    if (options.dry) {
      console.log(`Would create: ${serverPath}`);
    } else {
      fs.writeFileSync(serverPath, serverFile);
      console.log(`✓ Created: ${serverPath}`);
    }
  }

  if (routeModule.component) {
    const clientFile = generateClientFile(sourceFile, routeModule);
    const clientPath = `${baseName}.client.tsx`;

    if (options.dry) {
      console.log(`Would create: ${clientPath}`);
    } else {
      fs.writeFileSync(clientPath, clientFile);
      console.log(`✓ Created: ${clientPath}`);
    }
  }

  return `// This file has been split into .server.tsx and .client.tsx for Solarflare`;
}

/** Generate Solarflare server handler from React Router loader/action */
function generateServerFile(sourceFile: SourceFile, routeModule: RouteModule): string {
  const imports: string[] = [];
  const serverCode: string[] = [];

  for (const importDecl of sourceFile.getImportDeclarations()) {
    const source = importDecl.getModuleSpecifierValue();
    if (
      !source.includes("react-router") &&
      !source.includes("@remix-run") &&
      !source.includes("react") &&
      !source.includes("react-dom")
    ) {
      imports.push(importDecl.getFullText().trim());
    }
  }

  serverCode.push(`// Solarflare server handler`);
  serverCode.push(`// Converted from React Router loader/action\n`);

  if (imports.length > 0) {
    serverCode.push(...imports);
    serverCode.push("");
  }

  serverCode.push(
    `export default async function server(request: Request, params: Record<string, string>) {`,
  );
  serverCode.push(`  const method = request.method;`);
  serverCode.push("");

  if (routeModule.action) {
    serverCode.push(`  // Handle POST/PUT/DELETE (converted from action)`);
    serverCode.push(`  if (method !== 'GET') {`);
    serverCode.push(`    ${transformActionToServerHandler(routeModule.action)}`);
    serverCode.push(`  }`);
    serverCode.push("");
  }

  if (routeModule.loader) {
    serverCode.push(`  // Handle GET (converted from loader)`);
    serverCode.push(`  ${transformLoaderToServerHandler(routeModule.loader)}`);
  } else {
    serverCode.push(`  return {};`);
  }

  serverCode.push(`}`);

  return serverCode.join("\n");
}

/** Transform React Router loader to Solarflare server handler */
function transformLoaderToServerHandler(loaderCode: string): string {
  let body = loaderCode
    .replace(/export (async )?function loader\s*\([^)]*\)\s*{/, "")
    .replace(/}$/, "")
    .trim();

  body = body
    .replace(/import\s+{\s*json\s*}/g, "// json() not needed in Solarflare")
    .replace(/return\s+json\(/g, "return ")
    .replace(/\);\s*$/gm, ";")
    .replace(
      /{\s*params\s*}:\s*Route\.LoaderArgs/g,
      "request: Request, params: Record<string, string>",
    )
    .replace(
      /{\s*request,?\s*params\s*}:\s*Route\.LoaderArgs/g,
      "request: Request, params: Record<string, string>",
    );

  return body;
}

/** Transform React Router action to Solarflare server handler */
function transformActionToServerHandler(actionCode: string): string {
  let body = actionCode
    .replace(/export (async )?function action\s*\([^)]*\)\s*{/, "")
    .replace(/}$/, "")
    .trim();

  body = body
    .replace(
      /const\s+formData\s*=\s*await\s+request\.formData\(\)/g,
      "const formData = await request.formData()",
    )
    .replace(/return\s+json\(/g, "return ")
    .replace(
      /return\s+redirect\(/g,
      "return new Response(null, { status: 302, headers: { Location: ",
    )
    .replace(/\);\s*$/gm, " } });");

  return body;
}

/** Generate Solarflare client component from React Router component */
function generateClientFile(sourceFile: SourceFile, routeModule: RouteModule): string {
  const imports: string[] = [];
  const clientCode: string[] = [];

  clientCode.push(`// Solarflare client component`);
  clientCode.push(`// Converted from React Router route component\n`);

  for (const importDecl of sourceFile.getImportDeclarations()) {
    const source = importDecl.getModuleSpecifierValue();
    let importCode = importDecl.getFullText().trim();

    if (source.includes("react") && !source.includes("react-router")) {
      importCode = transformReactImportToPreact(importCode, source);
    }

    if (source.includes("react-router")) {
      importCode = transformReactRouterImports(importCode);
    }

    if (
      importCode &&
      !importCode.includes("LoaderArgs") &&
      !importCode.includes("ActionArgs") &&
      !importCode.includes("ComponentProps")
    ) {
      imports.push(importCode);
    }
  }

  const hasPreactImport = imports.some(
    (imp) => imp.includes("from 'preact'") || imp.includes('from "preact"'),
  );
  if (!hasPreactImport) {
    imports.unshift(`import type { VNode } from 'preact';`);
  }

  if (imports.length > 0) {
    clientCode.push(...imports);
    clientCode.push("");
  }

  if (routeModule.component) {
    let componentCode = routeModule.component
      .replace(/:  React\.ReactNode/g, ": VNode")
      .replace(/: ReactNode/g, ": VNode")
      .replace(/: React\.ReactElement/g, ": VNode")
      .replace(/: ReactElement/g, ": VNode")
      .replace(/React\.FC</g, "FunctionComponent<")
      .replace(/: React\.FC/g, ": FunctionComponent")
      .replace(/: FC</g, ": FunctionComponent<")
      .replace(
        /export default function (\w+)\s*\(\s*{\s*loaderData\s*}:\s*Route\.ComponentProps\s*\)/g,
        "export default function $1(props: any)",
      )
      .replace(/useLoaderData\(\)/g, "props")
      .replace(/useActionData\(\)/g, "props.actionData")
      .replace(/<Form /g, "<form ")
      .replace(/<\/Form>/g, "</form>")
      .replace(/import\s*{\s*Form\s*}\s*from\s*["']react-router["'];?\s*/g, "");

    componentCode = componentCode
      .replace(
        /const\s+navigate\s*=\s*useNavigate\(\)/g,
        "/* use navigate from @chr33s/solarflare/client */",
      )
      .replace(/navigate\(/g, "navigate(");

    clientCode.push(componentCode);
  }

  return clientCode.join("\n");
}

/** Transform a single React import statement to Preact */
function transformReactImportToPreact(importStatement: string, source: string): string {
  if (source === "react") {
    return importStatement.replace(/from ['"]react['"]/, "from 'preact'");
  }

  if (source === "react-dom" || source === "react-dom/client") {
    return importStatement.replace(/from ['"]react-dom(\/client)?['"]/, "from 'preact'");
  }

  return importStatement;
}

/** Transform React Router imports to Solarflare equivalents */
function transformReactRouterImports(importStatement: string): string {
  if (importStatement.includes("useNavigate") || importStatement.includes("Link")) {
    return `import { navigate } from '@chr33s/solarflare/client';`;
  }

  if (importStatement.includes("Outlet")) {
    return `/* Outlet not needed - use { children } prop in layouts */`;
  }

  return "";
}

/** Transform routes.ts config to Solarflare file structure */
function transformRoutesConfig(sourceFile: SourceFile): string {
  const output: string[] = [];

  output.push(`// Solarflare uses file-based routing`);
  output.push(`// Convert your routes.ts configuration to the following file structure:`);
  output.push(`//`);
  output.push(`// src/`);
  output.push(`//   index.server.tsx        # Root route (path: "/")`);
  output.push(`//   index.client.tsx`);
  output.push(`//   _layout.tsx             # Root layout`);
  output.push(`//   about.server.tsx        # /about route`);
  output.push(`//   about.client.tsx`);
  output.push(`//   blog/`);
  output.push(`//     _layout.tsx           # Blog layout`);
  output.push(`//     $slug.server.tsx      # /blog/:slug (dynamic param)`);
  output.push(`//     $slug.client.tsx`);
  output.push(`//   api.server.ts           # API endpoint (no .client needed)`);
  output.push(`//`);
  output.push(`// Naming conventions:`);
  output.push(`//   index.*       → directory root (/)`);
  output.push(`//   $param        → :param (dynamic segment)`);
  output.push(`//   _layout.tsx   → layout wrapper`);
  output.push(`//   _*            → private (not routed)`);
  output.push(`//   *.server.tsx  → server handler`);
  output.push(`//   *.client.tsx  → client component`);
  output.push("");

  const defaultExport = sourceFile.getDefaultExportSymbol();
  if (defaultExport) {
    const declarations = defaultExport.getDeclarations();
    for (const decl of declarations) {
      if (Node.isExportAssignment(decl)) {
        const expr = decl.getExpression();
        if (Node.isArrayLiteralExpression(expr)) {
          output.push("// Routes found in your config:");
          extractRouteStructure(expr, output, "");
        }
      }
    }
  }

  return output.join("\n");
}

/** Extract route structure from React Router config */
function extractRouteStructure(node: Node, output: string[], indent: string): void {
  if (Node.isArrayLiteralExpression(node)) {
    for (const element of node.getElements()) {
      if (Node.isCallExpression(element)) {
        const callee = element.getExpression();
        if (Node.isIdentifier(callee)) {
          const calleeName = callee.getText();
          const args = element.getArguments();

          if (calleeName === "route" && args.length >= 2) {
            const pathArg = args[0];
            const fileArg = args[1];
            const routePath = Node.isStringLiteral(pathArg) ? pathArg.getLiteralValue() : "?";
            const file = Node.isStringLiteral(fileArg) ? fileArg.getLiteralValue() : "?";
            output.push(`${indent}// Route: ${routePath} → convert ${file} to file-based routing`);
          } else if (calleeName === "index" && args.length >= 1) {
            const fileArg = args[0];
            const file = Node.isStringLiteral(fileArg) ? fileArg.getLiteralValue() : "?";
            output.push(
              `${indent}// Index route → convert ${file} to index.server.tsx + index.client.tsx`,
            );
          } else if (calleeName === "layout" && args.length >= 1) {
            const fileArg = args[0];
            const file = Node.isStringLiteral(fileArg) ? fileArg.getLiteralValue() : "?";
            output.push(`${indent}// Layout → convert ${file} to _layout.tsx`);
          }
        }
      }
    }
  }
}

/** Recursively collect files from a path (file or directory) */
function collectFiles(inputPath: string): string[] {
  const stat = fs.statSync(inputPath);
  if (stat.isFile()) {
    return [inputPath];
  }
  if (stat.isDirectory()) {
    const files: string[] = [];
    for (const entry of fs.readdirSync(inputPath, { withFileTypes: true })) {
      if (entry.name.startsWith(".")) continue;
      const fullPath = `${inputPath}/${entry.name}`;
      if (entry.isDirectory()) {
        files.push(...collectFiles(fullPath));
      } else if (/\.(tsx?|jsx?)$/.test(entry.name)) {
        files.push(fullPath);
      }
    }
    return files;
  }
  return [];
}

/** CLI entry point */
export function codemod(paths: string[], options: TransformOptions = {}): void {
  const files = paths.flatMap(collectFiles);
  for (const filePath of files) {
    try {
      const result = transformer(filePath, options);
      if (result !== null) {
        if (!options.dry) {
          fs.writeFileSync(filePath, result);
        }
        console.log(`✓ Transformed: ${filePath}`);
      }
    } catch (error) {
      console.error(`✗ Error processing ${filePath}:`, error);
    }
  }
}
