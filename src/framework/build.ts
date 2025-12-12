#!/usr/bin/env bun
/**
 * Solarflare Build Script
 * Auto-generates client and server entries, then builds both bundles
 */
import { Glob } from 'bun'
import { exists } from 'fs/promises'
import { join } from 'path'
import { unlink } from 'fs/promises'
import ts from 'typescript'
import {
  createProgram,
  getDefaultExportInfo,
  parsePath,
  validateModule,
  generateTypedModulesFile,
  type ModuleEntry,
  type ValidationResult,
} from './ast'

const APP_DIR = './src/app'
const DIST_CLIENT = './dist/client'
const DIST_SERVER = './dist/server'
const PUBLIC_DIR = './public'

/**
 * Validate all route files and report errors/warnings using AST analysis
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

  const program = createProgram(allFiles)

  const results: ValidationResult[] = []

  // Validate all files using the unified AST validator
  for (const file of [...routeFiles, ...layoutFiles]) {
    const result = validateModule(program, file, APP_DIR)
    results.push(result)
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
 * Generate typed routes file using AST-based path parsing
 */
function generateRoutesTypeFile(routeFiles: string[]): string {
  const clientRoutes = routeFiles.filter((f) => f.includes('.client.'))

  const routeTypes = clientRoutes
    .map((file) => {
      const parsed = parsePath(file)
      const paramsType =
        parsed.params.length > 0
          ? `{ ${parsed.params.map((p) => `${p}: string`).join('; ')} }`
          : 'Record<string, never>'
      return `  '${parsed.pattern}': { params: ${paramsType} }`
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
  parsed: ReturnType<typeof parsePath>
}

function getComponentMeta(
  program: ts.Program,
  file: string
): ComponentMeta {
  const filePath = join(APP_DIR, file)
  const props = extractPropsFromProgram(program, filePath)
  const parsed = parsePath(file)

  return { file, tag: parsed.tag, props, parsed }
}

/**
 * Scan files in a directory matching a glob pattern
 */
async function scanFiles(pattern: string, dir: string = APP_DIR): Promise<string[]> {
  const glob = new Glob(pattern)
  const files: string[] = []

  for await (const file of glob.scan(dir)) {
    files.push(file)
  }

  return files.sort()
}

/**
 * Find all route modules in the app directory
 */
async function findRouteModules(): Promise<string[]> {
  return scanFiles('**/*.{client,server}.{ts,tsx}')
}

/**
 * Find all layout files in the app directory
 */
async function findLayouts(): Promise<string[]> {
  return scanFiles('**/_layout.tsx')
}

/**
 * Find all client components in the app directory
 */
async function findClientComponents(): Promise<string[]> {
  return scanFiles('**/*.client.tsx')
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
 * Generate modules file using AST-based analysis
 * Delegates to generateTypedModulesFile from ast.ts for unified generation
 */
function generateModulesFile(
  program: ts.Program,
  routeFiles: string[],
  layoutFiles: string[]
): { content: string; errors: string[] } {
  const allFiles = [...layoutFiles, ...routeFiles]

  // Create module entries with parsed path info and validation
  const entries: ModuleEntry[] = allFiles.map((file) => ({
    path: file,
    parsed: parsePath(file),
    validation: validateModule(program, file, APP_DIR),
  }))

  // Use the unified generator from ast.ts
  return generateTypedModulesFile(entries)
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
  const program = createProgram(filePaths)

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
  if (await exists(PUBLIC_DIR)) {
    const publicFiles = await scanFiles('**/*', PUBLIC_DIR)
    for (const file of publicFiles) {
      const src = join(PUBLIC_DIR, file)
      const dest = join(DIST_CLIENT, file)
      await Bun.write(dest, Bun.file(src))
    }
  }

  // Clean up temporary file
  if (await Bun.file(entryPath).exists()) {
    await unlink(entryPath)
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
  const routesTypePath = './src/app/.routes.generated.d.ts'
  const routesTypeContent = generateRoutesTypeFile(routeFiles)
  await Bun.write(routesTypePath, routesTypeContent)
  console.log('   Generated route types')

  // Create shared program for AST analysis of all modules
  const allModuleFiles = [
    ...routeFiles.map((f) => join(APP_DIR, f)),
    ...layoutFiles.map((f) => join(APP_DIR, f)),
  ]
  const moduleProgram = createProgram(allModuleFiles)

  // Generate modules file with AST-validated types
  console.log('🔬 Analyzing module exports via AST...')
  const { content: modulesContent, errors: moduleErrors } = generateModulesFile(
    moduleProgram,
    routeFiles,
    layoutFiles
  )

  // Report any module analysis errors
  for (const error of moduleErrors) {
    console.error(`   ❌ ${error}`)
  }
  if (moduleErrors.length > 0) {
    console.error('❌ Module analysis failed')
    process.exit(1)
  }

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
    await unlink(modulesPath)
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
