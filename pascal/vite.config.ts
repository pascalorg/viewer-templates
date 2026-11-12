import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { defineConfig, loadEnv, type Plugin } from 'vite'

const forbiddenSpecifier = /^(?:@pascal-app\/editor|next)(?:\/|$)/
const forbiddenPath = /\/node_modules\/(?:@pascal-app\/editor|next)(?:\/|$)/
const normalize = (id: string) => id.replaceAll('\\', '/').split('?')[0]!
const forbidden = (id: string) => forbiddenSpecifier.test(id) || forbiddenPath.test(normalize(id))

/** Guard before resolution (including uninstalled packages), after resolution and at bundle time. */
function pascalBoundary(): Plugin {
  return {
    name: 'pascal-boundary',
    enforce: 'pre',
    async resolveId(source, importer, options) {
      if (forbidden(source)) this.error(`Forbidden viewer import: ${source}`)
      const resolved = await this.resolve(source, importer, { ...options, skipSelf: true })
      if (resolved && forbidden(resolved.id)) this.error(`Forbidden viewer module: ${resolved.id}`)
      return resolved
    },
    generateBundle(_options, bundle) {
      const modules = [...this.getModuleIds()]
      const blocked = modules.filter(forbidden)
      if (blocked.length) this.error(`Forbidden viewer modules: ${blocked.join(', ')}`)
      const packages = [...new Set(modules.flatMap((id) =>
        [...normalize(id).matchAll(/\/node_modules\/((?:@[^/]+\/)?[^/]+)/g)].map((match) => match[1]!),
      ))].sort()
      const entryPluginModules = Object.values(bundle).flatMap((entry) =>
        entry.type === 'chunk' && entry.isEntry
          ? Object.keys(entry.modules).filter((id) => /\/node_modules\/@pascal-app\/plugin-/.test(normalize(id)))
              .map((id) => normalize(id).split('/node_modules/').at(-1)!)
          : [],
      )
      // Public package names only; never publish absolute workspace paths.
      this.emitFile({
        type: 'asset',
        fileName: 'build-boundary.json',
        source: JSON.stringify({ moduleCount: modules.length, packages, entryPluginModules }, null, 2),
      })
    },
  }
}

/** Keep decoder bytes matched to the installed Three release, on the page's own origin. */
function selfHostedDecoders(): Plugin {
  const require = createRequire(import.meta.url)
  const libs = resolve(dirname(require.resolve('three')), '../examples/jsm/libs')
  const files = new Map([
    ['basis/basis_transcoder.js', 'text/javascript'],
    ['basis/basis_transcoder.wasm', 'application/wasm'],
    ['draco/draco_decoder.js', 'text/javascript'],
    ['draco/draco_decoder.wasm', 'application/wasm'],
    ['draco/draco_wasm_wrapper.js', 'text/javascript'],
  ].map(([name, contentType]) => [
    `/decoders/${name}`, { contentType: contentType!, bytes: readFileSync(resolve(libs, name!)) },
  ]))
  return {
    name: 'self-hosted-decoders',
    generateBundle() {
      for (const [url, { bytes }] of files) {
        this.emitFile({ type: 'asset', fileName: url.slice(1), source: bytes })
      }
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const file = files.get(req.url?.split('?')[0] || '')
        if (!file) return next()
        res.setHeader('Content-Type', file.contentType)
        res.end(file.bytes)
      })
    },
  }
}

function contentSecurityPolicy(env: Record<string, string>): Plugin {
  const apiOrigin = new URL(env.VITE_PASCAL_BASE_URL || 'https://editor.pascal.app').origin
  const policy = [
    "default-src 'self'",
    // Emscripten Basis bindings construct functions; decoders also compile Wasm.
    "script-src 'self' 'wasm-unsafe-eval' 'unsafe-eval'",
    "worker-src 'self' blob:",
    `connect-src 'self' data: blob: ${apiOrigin} https://*.supabase.co`,
    "img-src 'self' data: blob: https:",
    "media-src 'self' blob:",
    "font-src 'self' data:",
    // Radix/drei insert styles at runtime.
    "style-src 'self' 'unsafe-inline'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ')
  return {
    name: 'content-security-policy',
    apply: 'build',
    transformIndexHtml: () => [{
      tag: 'meta',
      attrs: { 'http-equiv': 'Content-Security-Policy', content: policy },
      injectTo: 'head-prepend',
    }],
  }
}

function runtimeTestArtifact(): Plugin {
  return {
    name: 'runtime-test-artifact',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'tests/compiled-artifact.txt', source: 'compiled artifact bytes' })
    },
  }
}

export default defineConfig(({ mode }) => ({
  // Redirects carry an opaque Origin; the test storage stand-in needs public CORS.
  ...(mode === 'runtime-test' ? { preview: { cors: true } } : {}),
  plugins: [
    react(), tailwindcss(), pascalBoundary(), selfHostedDecoders(),
    contentSecurityPolicy(loadEnv(mode, process.cwd(), 'VITE_')),
    ...(mode === 'runtime-test' ? [runtimeTestArtifact()] : []),
  ],
  resolve: {
    dedupe: [
      'three', 'react', 'react-dom', '@react-three/fiber', '@react-three/drei', 'zustand',
      '@pascal-app/core', '@pascal-app/viewer', '@pascal-app/nodes',
    ],
  },
  // Default dynamic-import splitting keeps the measured chunks below the 20 MiB budget.
  build: {
    target: 'es2022', assetsDir: 'assets', sourcemap: false, chunkSizeWarningLimit: 4000,
    // S2 exercises the runtime without taking over S3's App. Never ship the harness.
    ...(mode === 'runtime-test' ? {
      rolldownOptions: { input: { app: 'index.html', runtime: 'tests/runtime.html' } },
      manifest: 'runtime-manifest.json',
    } : {}),
  },
}))
