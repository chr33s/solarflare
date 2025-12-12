#!/usr/bin/env bun
/**
 * Solarflare Build Script
 * Auto-generates client and server entries, then builds both bundles
 */
import { Glob } from 'bun'
import { join } from 'path'
import ts from 'typescript'

const APP_DIR = './src/app'
const DIST_CLIENT = './dist/client'
const DIST_SERVER = './dist/server'
const PUBLIC_DIR = './public'

/**
 * Shared TypeScript program for type checking multiple files
 */
function createSharedProgram(files: string[]): ts.Program {
  return ts.createProgram(files, {
    target: ts.ScriptTarget.Latest,
    module: ts.ModuleKind.ESNext,
    jsx: ts.JsxEmit.ReactJSX,
    jsxImportSource: 'preact',
    strict: true,
    skipLibCheck: true,
  })
}

/**
 * Validation result for a file
 */
interface ValidationResult {
  file: string
  valid: boolean
  errors: string[]
  warnings: string[]
}

/**
 * Get the default export type info from a source file
 */
function getDefaultExportInfo(
  checker: ts.TypeChecker,
  sourceFile: ts.SourceFile
): { type: ts.Type; signatures: readonly ts.Signature[] } | null {
  const symbol = checker.getSymbolAtLocation(sourceFile)
  if (!symbol) return null

  const exports = checker.getExportsOfModule(symbol)
  const defaultExport = exports.find((e) => e.escapedName === 'default')
  if (!defaultExport) return null

  const type = checker.getTypeOfSymbolAtLocation(defaultExport, sourceFile)
  const signatures = type.getCallSignatures()

  return { type, signatures }
}

/**
 * Validate a server route file
 * Should export: (request: Request, params: Record<string, string>, env: Env) => Response | Promise<Response> | Record<string, unknown> | Promise<Record<string, unknown>>
 */
function validateServerRoute(
  checker: ts.TypeChecker,
  sourceFile: ts.SourceFile,
  file: string
): ValidationResult {
  const result: ValidationResult = { file, valid: true, errors: [], warnings: [] }

  const exportInfo = getDefaultExportInfo(checker, sourceFile)
  if (!exportInfo) {
    result.valid = false
    result.errors.push('Missing default export')
    return result
  }

  const { signatures } = exportInfo
  if (signatures.length === 0) {
    result.valid = false
    result.errors.push('Default export must be a function')
    return result
  }

  const sig = signatures[0]
  const params = sig.getParameters()

  // Should have at least 1 parameter (request), up to 3 (request, params, env)
  if (params.length < 1) {
    result.warnings.push('Server loader should accept (request, params?, env?) parameters')
  }

  // Check first param is Request-like
  if (params[0]) {
    const paramType = checker.getTypeOfSymbolAtLocation(params[0], sourceFile)
    const typeName = checker.typeToString(paramType)
    if (!typeName.includes('Request') && typeName !== 'any') {
      result.warnings.push(`First parameter should be Request, got ${typeName}`)
    }
  }

  return result
}

/**
 * Validate a client component file
 * Should export a function component
 */
function validateClientComponent(
  checker: ts.TypeChecker,
  sourceFile: ts.SourceFile,
  file: string
): ValidationResult {
  const result: ValidationResult = { file, valid: true, errors: [], warnings: [] }

  const exportInfo = getDefaultExportInfo(checker, sourceFile)
  if (!exportInfo) {
    result.valid = false
    result.errors.push('Missing default export')
    return result
  }

  const { signatures } = exportInfo
  if (signatures.length === 0) {
    result.valid = false
    result.errors.push('Default export must be a function component')
    return result
  }

  // Check return type is JSX-like (VNode, Element, or null)
  const returnType = signatures[0].getReturnType()
  const returnTypeName = checker.typeToString(returnType)

  if (
    !returnTypeName.includes('VNode') &&
    !returnTypeName.includes('Element') &&
    !returnTypeName.includes('JSX') &&
    returnTypeName !== 'null' &&
    returnTypeName !== 'any'
  ) {
    result.warnings.push(`Component should return JSX, got ${returnTypeName}`)
  }

  return result
}

/**
 * Validate a layout file
 * Should export a function component that accepts { children: VNode }
 */
function validateLayout(
  checker: ts.TypeChecker,
  sourceFile: ts.SourceFile,
  file: string
): ValidationResult {
  const result: ValidationResult = { file, valid: true, errors: [], warnings: [] }

  const exportInfo = getDefaultExportInfo(checker, sourceFile)
  if (!exportInfo) {
    result.valid = false
    result.errors.push('Missing default export')
    return result
  }

  const { signatures } = exportInfo
  if (signatures.length === 0) {
    result.valid = false
    result.errors.push('Default export must be a function component')
    return result
  }

  const sig = signatures[0]
  const params = sig.getParameters()

  if (params.length === 0) {
    result.warnings.push('Layout should accept { children } prop')
    return result
  }

  // Check first param has 'children' property
  const paramType = checker.getTypeOfSymbolAtLocation(params[0], sourceFile)
  const childrenProp = paramType.getProperty('children')

  if (!childrenProp) {
    result.warnings.push('Layout props should include "children"')
  }

  return result
}

/**
 * Validate all route files and report errors/warnings
 */
async function validateRoutes(
  routeFiles: string[],
  layoutFiles: string[]
): Promise<boolean> {
  const allFiles = [
    ...routeFiles.map((f) => join(APP_DIR, f)),
    ...layoutFiles.map((f) => join(APP_DIR, f)),
  ]

  if (allFiles.length === 0) return true

  const program = createSharedProgram(allFiles)
  const checker = program.getTypeChecker()

  const results: ValidationResult[] = []

  // Validate route files
  for (const file of routeFiles) {
    const filePath = join(APP_DIR, file)
    const sourceFile = program.getSourceFile(filePath)
    if (!sourceFile) continue

    if (file.includes('.server.')) {
      results.push(validateServerRoute(checker, sourceFile, file))
    } else if (file.includes('.client.')) {
      results.push(validateClientComponent(checker, sourceFile, file))
    }
  }

  // Validate layouts
  for (const file of layoutFiles) {
    const filePath = join(APP_DIR, file)
    const sourceFile = program.getSourceFile(filePath)
    if (!sourceFile) continue

    results.push(validateLayout(checker, sourceFile, file))
  }

  // Report results
  let hasErrors = false
  for (const result of results) {
    for (const error of result.errors) {
      console.error(`   ❌ ${result.file}: ${error}`)
      hasErrors = true
    }
    for (const warning of result.warnings) {
      console.warn(`   ⚠️  ${result.file}: ${warning}`)
    }
  }

  return !hasErrors
}

/**
 * Convert file path to URL pattern
 * e.g., "blog/$slug.client.tsx" → "/blog/:slug"
 */
function pathToPattern(filePath: string): string {
  return (
    '/' +
    filePath
      .replace(/\.(client|server)\.tsx$/, '')
      .replace(/\/index$/, '')
      .replace(/^index$/, '')
      .replace(/\$([^/]+)/g, ':$1')
  )
}

/**
 * Generate custom element tag from file path
 * e.g., "blog/$slug.client.tsx" → "sf-blog-slug"
 */
function pathToTag(filePath: string): string {
  return (
    'sf-' +
    filePath
      .replace(/\.(client|server)\.tsx$/, '')
      .replace(/\//g, '-')
      .replace(/\$/g, '')
      .replace(/^index$/, 'root')
      .replace(/-index$/, '')
      .toLowerCase()
  )
}

/**
 * Extract Props property names from a TypeScript file using the type checker
 * Uses Parameters<typeof DefaultExport>[0] to infer props from any function signature
 */
function extractPropsFromProgram(
  program: ts.Program,
  filePath: string
): string[] {
  const checker = program.getTypeChecker()
  const sourceFile = program.getSourceFile(filePath)
  if (!sourceFile) return []

  const exportInfo = getDefaultExportInfo(checker, sourceFile)
  if (!exportInfo || exportInfo.signatures.length === 0) return []

  const firstParam = exportInfo.signatures[0].getParameters()[0]
  if (!firstParam) return []

  const paramType = checker.getTypeOfSymbolAtLocation(firstParam, sourceFile)
  const properties = paramType.getProperties()

  return properties.map((p) => p.getName())
}

/**
 * Extract URL params from a route pattern
 * e.g., "/blog/:slug" → ["slug"]
 */
function extractParamsFromPattern(pattern: string): string[] {
  const matches = pattern.match(/:(\w+)/g)
  return matches ? matches.map((m) => m.slice(1)) : []
}

/**
 * Generate typed routes file
 */
function generateRoutesTypeFile(routeFiles: string[]): string {
  const clientRoutes = routeFiles.filter((f) => f.includes('.client.'))

  const routeTypes = clientRoutes
    .map((file) => {
      const pattern = pathToPattern(file)
      const params = extractParamsFromPattern(pattern)
      const paramsType =
        params.length > 0
          ? `{ ${params.map((p) => `${p}: string`).join('; ')} }`
          : 'Record<string, never>'
      return `  '${pattern}': { params: ${paramsType} }`
    })
    .join('\n')

  return `/**
 * Auto-generated Route Types
 * Provides type-safe route definitions
 */

export interface Routes {
${routeTypes}
}

export type RoutePath = keyof Routes

export type RouteParams<T extends RoutePath> = Routes[T]['params']
`
}

/**
 * Get component metadata for client entry generation
 */
interface ComponentMeta {
  file: string
  tag: string
  props: string[]
}

function getComponentMeta(
  program: ts.Program,
  file: string
): ComponentMeta {
  const filePath = join(APP_DIR, file)
  const props = extractPropsFromProgram(program, filePath)
  const tag = pathToTag(file)

  return { file, tag, props }
}

/**
 * Find all route modules in the app directory
 */
async function findRouteModules(): Promise<string[]> {
  const glob = new Glob('**/*.{client,server}.tsx')
  const files: string[] = []

  for await (const file of glob.scan(APP_DIR)) {
    files.push(file)
  }

  return files.sort()
}

/**
 * Find all layout files in the app directory
 */
async function findLayouts(): Promise<string[]> {
  const glob = new Glob('**/_layout.tsx')
  const files: string[] = []

  for await (const file of glob.scan(APP_DIR)) {
    files.push(file)
  }

  return files.sort()
}

/**
 * Find all client components in the app directory
 */
async function findClientComponents(): Promise<string[]> {
  const glob = new Glob('**/*.client.tsx')
  const files: string[] = []

  for await (const file of glob.scan(APP_DIR)) {
    files.push(file)
  }

  return files.sort()
}

/**
 * Generate virtual client entry content with inferred define options
 */
function generateClientEntry(
  program: ts.Program,
  clientFiles: string[]
): string {
  const metas = clientFiles.map((file) => getComponentMeta(program, file))

  const imports = metas
    .map((meta, i) => `import Component${i} from './app/${meta.file}'`)
    .join('\n')

  const registrations = metas
    .map(
      (meta, i) =>
        `register(Component${i}, '${meta.tag}', ${JSON.stringify(meta.props)}, { shadow: false })`
    )
    .join('\n')

  return `/**
 * Auto-generated Client Entry Point
 * Registers all client components as web components with inferred options
 */
import register from 'preact-custom-element'
${imports}

${registrations}
`
}

/**
 * Generate modules file with resolved imports
 */
function generateModulesFile(routeFiles: string[], layoutFiles: string[]): string {
  const allFiles = [...layoutFiles, ...routeFiles]
  const moduleEntries = allFiles
    .map((file) => `  './${file}': () => import('./${file}')`)
    .join(',\n')

  return `/**
 * Auto-generated route modules
 * Pre-resolved imports for Cloudflare Workers compatibility
 */
const modules: Record<string, () => Promise<{ default: unknown }>> = {
${moduleEntries},
}

export default modules
`
}

/**
 * Build the client bundle
 */
async function buildClient() {
  console.log('🔍 Scanning for client components...')
  const clientFiles = await findClientComponents()
  console.log(`   Found ${clientFiles.length} client component(s)`)

  // Create shared program for type checking
  const filePaths = clientFiles.map((f) => join(APP_DIR, f))
  const program = createSharedProgram(filePaths)

  const entryContent = generateClientEntry(program, clientFiles)

  // Write temporary entry file
  const entryPath = './src/.entry-client.generated.tsx'
  await Bun.write(entryPath, entryContent)

  console.log('📦 Building client bundle...')
  const result = await Bun.build({
    entrypoints: [entryPath],
    outdir: DIST_CLIENT,
    target: 'browser',
    naming: '[dir]/index.[ext]',
    minify: process.env.NODE_ENV === 'production',
  })

  if (!result.success) {
    console.error('❌ Client build failed:')
    for (const log of result.logs) {
      console.error(log)
    }
    process.exit(1)
  }

  // Copy public assets if directory exists
  if (await Bun.file(PUBLIC_DIR).exists()) {
    const glob = new Glob('**/*')
    for await (const file of glob.scan(PUBLIC_DIR)) {
      const src = join(PUBLIC_DIR, file)
      const dest = join(DIST_CLIENT, file)
      await Bun.write(dest, Bun.file(src))
    }
  }

  // Clean up temporary file
  if (await Bun.file(entryPath).exists()) {
    await Bun.$`rm ${entryPath}`
  }

  console.log('✅ Client build complete')
}

/**
 * Build the server bundle
 */
async function buildServer() {
  console.log('🔍 Scanning for route modules...')
  const routeFiles = await findRouteModules()
  const layoutFiles = await findLayouts()
  console.log(`   Found ${routeFiles.length} route(s) and ${layoutFiles.length} layout(s)`)

  // Validate routes and layouts
  console.log('🔎 Validating route types...')
  const valid = await validateRoutes(routeFiles, layoutFiles)
  if (!valid) {
    console.error('❌ Route validation failed')
    process.exit(1)
  }

  // Generate route types file (persisted for consumption)
  const routesTypePath = './src/app/.routes.generated.ts'
  const routesTypeContent = generateRoutesTypeFile(routeFiles)
  await Bun.write(routesTypePath, routesTypeContent)
  console.log('   Generated route types')

  const modulesContent = generateModulesFile(routeFiles, layoutFiles)

  // Write generated modules file (imported by worker.tsx)
  const modulesPath = './src/app/.modules.generated.ts'
  await Bun.write(modulesPath, modulesContent)

  console.log('📦 Building server bundle...')
  const result = await Bun.build({
    entrypoints: ['./src/app/index.ts'],
    outdir: DIST_SERVER,
    target: 'bun',
    naming: '[dir]/index.[ext]',
    minify: process.env.NODE_ENV === 'production',
    external: ['cloudflare:workers'],
  })

  if (!result.success) {
    console.error('❌ Server build failed:')
    for (const log of result.logs) {
      console.error(log)
    }
    process.exit(1)
  }

  // Clean up generated modules file (route types are kept)
  if (await Bun.file(modulesPath).exists()) {
    await Bun.$`rm ${modulesPath}`
  }

  console.log('✅ Server build complete')
}

/**
 * Main build function
 */
async function build() {
  const startTime = performance.now()

  console.log('\n⚡ Solarflare Build\n')

  await buildClient()
  await buildServer()

  const duration = ((performance.now() - startTime) / 1000).toFixed(2)
  console.log(`\n🚀 Build completed in ${duration}s\n`)
}

build()
