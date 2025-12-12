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
  /** Chunk filename for this component (e.g., "blog.$slug.js") */
  chunk: string
}

/**
 * Generate chunk filename from file path
 * e.g., "blog/$slug.client.tsx" → "blog.slug.js"
 * Note: $ is removed to avoid URL encoding issues
 */
function getChunkName(file: string): string {
  return file
    .replace(/\.client\.tsx?$/, '')
    .replace(/\//g, '.')
    .replace(/\$/g, '')  // Remove $ to avoid URL issues
    .replace(/^index$/, 'index')
    + '.js'
}

function getComponentMeta(
  program: ts.Program,
  file: string
): ComponentMeta {
  const filePath = join(APP_DIR, file)
  const props = extractPropsFromProgram(program, filePath)
  const parsed = parsePath(file)
  const chunk = getChunkName(file)

  return { file, tag: parsed.tag, props, parsed, chunk }
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
 * Extract CSS import paths from a TypeScript/TSX file
 */
async function extractCssImports(filePath: string): Promise<string[]> {
  const content = await Bun.file(filePath).text()
  const cssImports: string[] = []
  
  // Match import statements for .css files
  const importRegex = /import\s+['"](.+\.css)['"]|import\s+['"](.+\.css)['"]\s*;/g
  let match
  while ((match = importRegex.exec(content)) !== null) {
    const cssPath = match[1] || match[2]
    if (cssPath) {
      cssImports.push(cssPath)
    }
  }
  
  return cssImports
}

/**
 * Generate virtual client entry for a single component (for chunked builds)
 */
function generateChunkedClientEntry(
  meta: ComponentMeta
): string {
  return `/**
 * Auto-generated Client Chunk: ${meta.chunk}
 * Registers ${meta.tag} web component
 */
import register from 'preact-custom-element'
import Component from './app/${meta.file}'

register(Component, '${meta.tag}', ${JSON.stringify(meta.props)}, { shadow: false })
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
 * Chunk manifest mapping routes to their JS chunks and CSS
 */
interface ChunkManifest {
  chunks: Record<string, string>    // pattern -> chunk filename
  tags: Record<string, string>      // tag -> chunk filename
  styles: Record<string, string[]>  // pattern -> CSS filenames
}

/**
 * Build the client bundle with per-route code splitting
 */
async function buildClient() {
  console.log('🔍 Scanning for client components...')
  const clientFiles = await findClientComponents()
  console.log(`   Found ${clientFiles.length} client component(s)`)

  // Create shared program for type checking
  const filePaths = clientFiles.map((f) => join(APP_DIR, f))
  const program = createProgram(filePaths)

  // Get metadata for all components
  const metas = clientFiles.map((file) => getComponentMeta(program, file))

  // Generate individual entry files for each component
  const entryPaths: string[] = []
  const entryToMeta: Record<string, ComponentMeta> = {}

  for (const meta of metas) {
    const entryContent = generateChunkedClientEntry(meta)
    const entryPath = `./src/.entry-${meta.chunk.replace('.js', '')}.generated.tsx`
    await Bun.write(entryPath, entryContent)
    entryPaths.push(entryPath)
    entryToMeta[entryPath] = meta
  }

  console.log('📦 Building client chunks...')
  const result = await Bun.build({
    entrypoints: entryPaths,
    outdir: DIST_CLIENT,
    target: 'browser',
    splitting: true,
    minify: process.env.NODE_ENV === 'production',
  })

  if (!result.success) {
    console.error('❌ Client build failed:')
    for (const log of result.logs) {
      console.error(log)
    }
    process.exit(1)
  }

  // Build manifest mapping routes to their chunks
  const manifest: ChunkManifest = { chunks: {}, tags: {}, styles: {} }

  // Map entry paths to their output chunk names
  // Bun outputs entries as .entry-{name}.js when using splitting
  for (const output of result.outputs) {
    const outputPath = output.path
    const outputName = outputPath.split('/').pop() || ''

    // Skip non-JS outputs (CSS, etc.) and shared chunks
    if (!outputName.endsWith('.js') || outputName.startsWith('chunk-')) {
      continue
    }

    // Match output to our entry files
    for (const [entryPath, meta] of Object.entries(entryToMeta)) {
      // Extract the base name from entry path: .entry-index.generated.tsx -> index
      const entryBase = entryPath
        .split('/')
        .pop()!
        .replace('.generated.tsx', '')
        .replace('.entry-', '')

      // Check if this output corresponds to this entry
      // Bun names the output based on the entry file name
      if (outputName.includes(entryBase) || outputName === `.entry-${entryBase}.js`) {
        // Rename to the desired chunk name
        const targetPath = join(DIST_CLIENT, meta.chunk)
        if (outputPath !== targetPath) {
          await Bun.write(targetPath, Bun.file(outputPath))
          await unlink(outputPath)
        }
        manifest.chunks[meta.parsed.pattern] = `/${meta.chunk}`
        manifest.tags[meta.tag] = `/${meta.chunk}`
        break
      }
    }
  }

  // Handle CSS outputs - rename them to match route names
  for (const output of result.outputs) {
    const outputPath = output.path
    const outputName = outputPath.split('/').pop() || ''

    // Handle CSS files generated from imports
    if (outputName.endsWith('.css') && outputName.startsWith('.entry-')) {
      // Extract the route name and rename to a clean CSS name
      const baseName = outputName.replace('.entry-', '').replace('.generated.css', '')
      const targetPath = join(DIST_CLIENT, `${baseName}.css`)
      await Bun.write(targetPath, Bun.file(outputPath))
      await unlink(outputPath)
    }
  }

  // Scan layouts for CSS imports and copy them to dist
  const layoutFiles = await findLayouts()
  const layoutCssMap: Record<string, string[]> = {}  // layout directory -> CSS files

  for (const layoutFile of layoutFiles) {
    const layoutPath = join(APP_DIR, layoutFile)
    const cssImports = await extractCssImports(layoutPath)
    
    if (cssImports.length > 0) {
      const cssOutputPaths: string[] = []
      const layoutDir = layoutFile.split('/').slice(0, -1).join('/')
      
      for (const cssImport of cssImports) {
        // Resolve CSS path relative to layout file
        const cssSourcePath = join(APP_DIR, layoutDir, cssImport)
        
        // Generate output filename: retain the imported CSS filename
        const cssFileName = cssImport.replace('./', '')
        const cssOutputName = cssFileName
        
        // Copy CSS to dist
        if (await Bun.file(cssSourcePath).exists()) {
          const destPath = join(DIST_CLIENT, cssOutputName)
          await Bun.write(destPath, Bun.file(cssSourcePath))
          cssOutputPaths.push(`/${cssOutputName}`)
        }
      }
      
      if (cssOutputPaths.length > 0) {
        // Store by layout directory pattern (e.g., "/blog" or "/")
        const layoutPattern = layoutDir ? `/${layoutDir}` : '/'
        layoutCssMap[layoutPattern] = cssOutputPaths
      }
    }
  }

  // Add layout CSS to manifest based on route patterns
  for (const meta of metas) {
    const routeStyles: string[] = []
    
    // Check which layouts apply to this route and collect their CSS
    for (const [layoutPattern, cssFiles] of Object.entries(layoutCssMap)) {
      // A layout applies if the route pattern starts with the layout's directory
      if (layoutPattern === '/' || meta.parsed.pattern.startsWith(layoutPattern)) {
        routeStyles.push(...cssFiles)
      }
    }
    
    if (routeStyles.length > 0) {
      manifest.styles[meta.parsed.pattern] = routeStyles
    }
  }

  // Write chunk manifest for the server
  const manifestPath = './src/app/.chunks.generated.json'
  await Bun.write(manifestPath, JSON.stringify(manifest, null, 2))
  console.log(`   Generated ${metas.length} chunk(s)`)

  // Copy public assets if directory exists
  if (await exists(PUBLIC_DIR)) {
    const publicFiles = await scanFiles('**/*', PUBLIC_DIR)
    for (const file of publicFiles) {
      const src = join(PUBLIC_DIR, file)
      const dest = join(DIST_CLIENT, file)
      await Bun.write(dest, Bun.file(src))
    }
  }

  // Clean up temporary entry files
  for (const entryPath of entryPaths) {
    if (await Bun.file(entryPath).exists()) {
      await unlink(entryPath)
    }
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

  // Clean up generated files (route types are kept)
  const generatedFiles = [modulesPath, './src/app/.chunks.generated.json']
  for (const file of generatedFiles) {
    if (await Bun.file(file).exists()) {
      await unlink(file)
    }
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
