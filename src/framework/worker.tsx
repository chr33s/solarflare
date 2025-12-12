/**
 * Solarflare Worker
 * Cloudflare Worker fetch handler factory
 */
import { type FunctionComponent } from 'preact'
import { renderToString } from 'preact-render-to-string'
import {
  createRouter,
  matchRoute,
  findLayouts,
  wrapWithLayouts,
  renderComponent,
  generateAssetTags,
  ASSETS_MARKER,
  type ModuleMap,
} from './server'
// @ts-ignore - Generated at build time
import modules from '../app/.modules.generated'
// @ts-ignore - Generated at build time
import chunkManifest from '../app/.chunks.generated.json'

const typedModules = modules as ModuleMap

/**
 * Chunk manifest type
 */
interface ChunkManifest {
  chunks: Record<string, string>    // pattern -> chunk filename
  tags: Record<string, string>      // tag -> chunk filename
  styles: Record<string, string[]>  // pattern -> CSS filenames
}

const manifest = chunkManifest as ChunkManifest

/**
 * Get the script path for a route from the chunk manifest
 */
function getScriptPath(tag: string): string | undefined {
  return manifest.tags[tag]
}

/**
 * Get stylesheets for a route pattern from the chunk manifest
 */
function getStylesheets(pattern: string): string[] {
  return manifest.styles[pattern] ?? []
}

/**
 * Server data loader function type
 * Returns props to pass to the paired client component
 */
type ServerLoader = (
  request: Request
) => Record<string, unknown> | Promise<Record<string, unknown>>

const routes = createRouter(typedModules)

/**
 * Find paired module (server for client, or client for server)
 */
function findPairedModule(path: string): string | null {
  if (path.includes('.client.')) {
    const serverPath = path.replace('.client.', '.server.')
    return serverPath in typedModules.server ? serverPath : null
  }
  if (path.includes('.server.')) {
    const clientPath = path.replace('.server.', '.client.')
    return clientPath in typedModules.client ? clientPath : null
  }
  return null
}

/**
 * Cloudflare Worker fetch handler
 * Routes are auto-discovered at build time
 */
async function worker(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url)

  // Serve static assets first (non-root paths with file extensions)
  if (url.pathname !== '/' && url.pathname.includes('.')) {
    try {
      const asset = await env.ASSETS.fetch(request)
      if (asset.ok) return asset
    } catch {
      // Asset not found, continue to route matching
    }
  }

  // Match route - prefer client routes for SSR
  const match = matchRoute(routes, url)

  if (!match) {
    // Try serving as static asset before 404
    try {
      const asset = await env.ASSETS.fetch(request)
      if (asset.ok) return asset
    } catch {
      // Ignore
    }
    return new Response('Not Found', { status: 404 })
  }

  const { route, params } = match

  // If this is a server-only route (no paired client), return Response directly
  if (route.type === 'server') {
    const pairedClientPath = findPairedModule(route.path)
    if (!pairedClientPath) {
      // No paired client component - this is an API route
      const mod = await route.loader()
      const handler = mod.default as (
        request: Request
      ) => Response | Promise<Response>
      return handler(request)
    }
  }

  // Determine the server and client paths
  let serverPath: string | null = null
  let clientPath: string

  if (route.type === 'server') {
    serverPath = route.path
    clientPath = route.path.replace('.server.', '.client.')
  } else {
    clientPath = route.path
    serverPath = findPairedModule(route.path)
  }

  // Load props from server loader if available
  let props: Record<string, unknown> = { ...params }

  if (serverPath && serverPath in typedModules.server) {
    const serverMod = await typedModules.server[serverPath]()
    const loader = serverMod.default as ServerLoader
    const serverProps = await loader(request)
    props = { ...params, ...serverProps }
  }

  // Load the client component
  const clientMod = await typedModules.client[clientPath]()
  const Component = clientMod.default as FunctionComponent<any>

  // Render component wrapped in custom element tag
  let content = renderComponent(Component, route.tag, props)

  // Find and apply layouts
  const layouts = findLayouts(route.path, typedModules)
  if (layouts.length > 0) {
    content = await wrapWithLayouts(content, layouts)
  }

  // Render to HTML string
  let html = renderToString(content)

  // Get the script and styles for this route's chunk
  const scriptPath = getScriptPath(route.tag)
  const stylesheets = getStylesheets(route.parsedPattern.pathname)

  // Generate asset tags and inject them by replacing the marker
  const assetTags = generateAssetTags(scriptPath, stylesheets)
  html = html.replace(`<solarflare-assets>${ASSETS_MARKER}</solarflare-assets>`, assetTags)

  return new Response(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
    },
  })
}

export default worker
