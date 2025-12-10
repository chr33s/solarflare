#!/usr/bin/env bun
/**
 * Solarflare Build Script
 * Auto-generates client and server entries, then builds both bundles
 */
import { Glob } from 'bun'
import { join } from 'path'

const APP_DIR = './src/app'
const DIST_CLIENT = './dist/client'
const DIST_SERVER = './dist/server'
const PUBLIC_DIR = './public'

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
 * Extract Props interface property names from a TypeScript file
 */
async function extractPropsFromFile(filePath: string): Promise<string[]> {
  const content = await Bun.file(filePath).text()

  // Match interface Props { ... } or type Props = { ... }
  const propsMatch = content.match(
    /(?:interface|type)\s+Props\s*(?:=\s*)?\{([^}]+)\}/
  )

  if (!propsMatch) return []

  const propsBody = propsMatch[1]

  // Extract property names (handles "name: type" and "name?: type")
  const propNames = propsBody
    .split(/[;\n]/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('//'))
    .map((line) => {
      const match = line.match(/^(\w+)\??:/)
      return match ? match[1] : null
    })
    .filter(Boolean) as string[]

  return propNames
}

/**
 * Get component metadata for client entry generation
 */
interface ComponentMeta {
  file: string
  tag: string
  props: string[]
}

async function getComponentMeta(file: string): Promise<ComponentMeta> {
  const filePath = join(APP_DIR, file)
  const props = await extractPropsFromFile(filePath)
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
async function generateClientEntry(clientFiles: string[]): Promise<string> {
  const metas = await Promise.all(clientFiles.map(getComponentMeta))

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

  const entryContent = await generateClientEntry(clientFiles)

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
  })

  if (!result.success) {
    console.error('❌ Server build failed:')
    for (const log of result.logs) {
      console.error(log)
    }
    process.exit(1)
  }

  // Clean up generated file
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
