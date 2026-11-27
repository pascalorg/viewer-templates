import { acquireSceneReadOnlyLease, configureArtifactStore, getArtifactStore, loadPlugin, nodeRegistry, registerNode, type AnyNodeDefinition } from '@pascal-app/core'
import { renderPlugin } from '@pascal-app/nodes/render'
import { configureViewer } from '@pascal-app/viewer'
import { PASCAL_ASSETS_URL, PASCAL_BASE_URL } from '../config'
import type { SceneGraph } from '../pascal/contract'
import { createProjectArtifactStore } from './artifacts'
import { registerReferencedLibraryMaterials } from './materials'
import { createPluginLoader, loadScenePluginsBounded } from './plugin-loader'
import { neededPlugins, publishedSceneSetup, renderSources, warnUnknownKinds } from './plugins'

/** Synchronous built-in registration, as on the hosted render-only bootstrap. */
export function bootstrapRuntime(): void {
  configureViewer({
    assetsBaseUrl: PASCAL_ASSETS_URL, sfxBaseUrl: '/audios/sfx', iconsBaseUrl: '/icons',
    decoders: { basisPath: '/decoders/basis/', dracoPath: '/decoders/draco/' },
  })
  for (const definition of renderPlugin.nodes ?? []) {
    if (!nodeRegistry.has(definition.kind)) registerNode(definition as AnyNodeDefinition)
  }
}

// No discovery hook: even a discovery implementation supplied by an embedding app
// must never execute arbitrary packages from a scene in this static viewer.
const loader = createPluginLoader(renderSources, loadPlugin)
export const loadSceneRenderPlugins = (packageNames: readonly string[]): Promise<void> => loader.loadPackages(packageNames)

export type PrepareSceneRuntimeOptions = {
  projectId: string
  graph: SceneGraph
  libraryMaterials?: readonly unknown[]
  baseUrl?: string
  token?: string
  signal?: AbortSignal
  onLate?: () => void
  pluginTimeoutMs?: number
}

export type PreparedSceneRuntime = {
  setup: ReturnType<typeof publishedSceneSetup>
  unknownKinds: Record<string, number>
  pluginsLoaded: boolean
  dispose: () => void
}

/**
 * Before either live or baked assembly: await this, then mount the scene. Keep the
 * result for its entire lifetime and dispose after unmount. onLate must remount the
 * live graph / refresh GLB replace nodes; registry changes alone do not rerender them.
 */
export async function prepareSceneRuntime({ projectId, graph, libraryMaterials = [], baseUrl = PASCAL_BASE_URL, token, signal, onLate = () => {}, pluginTimeoutMs = 20_000 }: PrepareSceneRuntimeOptions): Promise<PreparedSceneRuntime> {
  signal?.throwIfAborted()
  bootstrapRuntime()
  const release = acquireSceneReadOnlyLease()
  let artifacts: Awaited<ReturnType<typeof createProjectArtifactStore>> | undefined
  let disposed = false
  const dispose = () => {
    if (disposed) return
    disposed = true
    if (artifacts && getArtifactStore() === artifacts.store) configureArtifactStore(null)
    artifacts?.dispose()
    release()
  }
  try {
    registerReferencedLibraryMaterials(libraryMaterials)
    artifacts = await createProjectArtifactStore({ baseUrl, projectId, graph, token, signal })
    signal?.throwIfAborted()
    configureArtifactStore(artifacts.store)
    const pluginsLoaded = await loadScenePluginsBounded(neededPlugins(graph), loadSceneRenderPlugins, pluginTimeoutMs, () => {
      if (!disposed && !signal?.aborted) onLate()
    })
    signal?.throwIfAborted()
    return { setup: publishedSceneSetup(graph), unknownKinds: warnUnknownKinds(graph), pluginsLoaded, dispose }
  } catch (error) {
    dispose()
    throw error
  }
}
