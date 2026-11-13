import { nodeRegistry, type SceneMaterial, type SceneMaterialId } from '@pascal-app/core'
import { registerViewerPresentation } from '@pascal-app/viewer'
import { PASCAL_PLUGIN_TREES } from '../config'
import type { PluginSource } from './plugin-loader'

type RenderSource = PluginSource & { id: string; kindPrefix: string }

/** Audited package pins live in package.json. Never resolve imports from graph data. */
export const renderSources: readonly RenderSource[] = [
  ...(PASCAL_PLUGIN_TREES ? [{
    id: 'pascal:trees', packageName: '@pascal-app/plugin-trees', kindPrefix: 'trees:',
    load: async () => [(await import('@pascal-app/plugin-trees/render')).treesRenderPlugin],
  }] : []),
  {
    id: 'pascal:articraft', packageName: '@pascal-app/plugin-articraft', kindPrefix: 'articraft:',
    load: async () => [(await import('@pascal-app/plugin-articraft/render')).articraftRenderPlugin],
  },
  {
    id: 'pascal:boots', packageName: '@pascal-app/plugin-boots', kindPrefix: 'boots:',
    load: async () => [(await import('@pascal-app/plugin-boots/render')).bootsRenderPlugin],
  },
  {
    id: 'pascal:pool', packageName: '@pascal-app/plugin-pool', kindPrefix: 'pool:',
    load: async () => [(await import('@pascal-app/plugin-pool/render')).poolRenderPlugin],
  },
  {
    id: 'pascal:environment', packageName: '@pascal-app/plugin-environment', kindPrefix: 'environment:',
    load: async () => {
      const { environmentRenderPlugin, environmentPresentation } = await import('@pascal-app/plugin-environment/render')
      registerViewerPresentation(environmentPresentation)
      return [environmentRenderPlugin]
    },
  },
  {
    id: 'pascal:streetscape', packageName: '@pascal-app/plugin-streetscape', kindPrefix: 'streetscape:',
    load: async () => [(await import('@pascal-app/plugin-streetscape/render')).streetscapeRenderPlugin],
  },
]

export type PluginInstallState = {
  installedPlugins: string[]
  hasExplicitPluginInstallState: boolean
}

/** An explicit empty list disables plugins; an absent/malformed list is legacy. */
export function pluginInstallStateOf(graph?: { installedPlugins?: unknown } | null): PluginInstallState {
  return Array.isArray(graph?.installedPlugins)
    ? { installedPlugins: graph.installedPlugins.filter((id): id is string => typeof id === 'string'), hasExplicitPluginInstallState: true }
    : { installedPlugins: renderSources.map(({ id }) => id), hasExplicitPluginInstallState: false }
}

export function publishedSceneSetup(graph: { materials?: unknown; installedPlugins?: unknown }) {
  return {
    materials: (graph.materials ?? {}) as Record<SceneMaterialId, SceneMaterial>,
    collections: {},
    ...pluginInstallStateOf(graph),
  }
}

export type PluginGraph = { nodes: Record<string, { type: string }>; installedPlugins?: unknown }

/** Only enabled, allowlisted packages with kinds present in this scene. */
export function neededPlugins(graph: PluginGraph): string[] {
  const installed = new Set(pluginInstallStateOf(graph).installedPlugins)
  const kinds = Object.values(graph.nodes).map(({ type }) => type)
  return renderSources.filter(({ id, kindPrefix }) =>
    installed.has(id) && kinds.some((kind) => kind.startsWith(kindPrefix)),
  ).map(({ packageName }) => packageName)
}

const warnedKinds = new Set<string>()

/** Call after loading plugins. Counts feed the assembly's missing-parts notice. */
export function warnUnknownKinds(graph: PluginGraph): Record<string, number> {
  const counts: Record<string, number> = Object.create(null)
  for (const { type } of Object.values(graph.nodes)) {
    if (!nodeRegistry.has(type)) counts[type] = (counts[type] ?? 0) + 1
  }
  for (const [kind, count] of Object.entries(counts)) {
    if (warnedKinds.has(kind)) continue
    warnedKinds.add(kind)
    console.warn(`[viewer] unknown kind ${kind} (${count} nodes); skipping it`)
  }
  return counts
}
