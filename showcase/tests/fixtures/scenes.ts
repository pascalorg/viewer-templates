import type { SceneGraph } from '../../src/pascal/contract'
import live from './live-scene.json' with { type: 'json' }
import plugin from './plugin-scene.json' with { type: 'json' }

export const liveFixture = live as unknown as SceneGraph
export const libraryMaterials = plugin.libraryMaterials
export const pluginFixture = structuredClone(liveFixture)
pluginFixture.nodes.pool_fixture = plugin.pool
pluginFixture.nodes.level_fixture!.children!.push('pool_fixture')
pluginFixture.nodes.wall_south!.materialPreset = 'library:mtl_s2fixture'
pluginFixture.installedPlugins = ['pascal:pool']
