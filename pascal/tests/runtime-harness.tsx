// Only included by --mode runtime-test. No test hooks are exposed by the production page.
import { getCatalogMaterialById, getMaterialPresetByRef, useScene } from '@pascal-app/core'
import { useThree } from '@react-three/fiber'
import { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Mesh } from 'three'
import type { SceneGraph } from '../src/pascal/contract'
import { prepareSceneRuntime, type PreparedSceneRuntime } from '../src/runtime/bootstrap'
import { createProjectArtifactStore, referencedArtifactHashes } from '../src/runtime/artifacts'
import { neededPlugins, pluginInstallStateOf, warnUnknownKinds } from '../src/runtime/plugins'
import { FixtureViewer } from '../src/viewer/FixtureViewer'
import { liveFixture, pluginFixture, libraryMaterials } from './fixtures/scenes'
import '../src/styles.css'

const params = new URLSearchParams(location.search)
const textures = params.has('unknown')
const graph = structuredClone(params.has('pool') ? pluginFixture : liveFixture) as unknown as SceneGraph
graph.nodes.wall_south!.materialPreset = 'library:mtl_s2fixture'
if (params.has('unknown')) {
  for (let i = 0; i < 2; i++) {
    const id = `unknown_${i}`
    graph.nodes[id] = { id, type: 'private:missing', parentId: 'level_fixture', children: [] }
    graph.nodes.level_fixture!.children!.push(id)
  }
}

type MeshProbe = { name: string; vertices: number; colors: string[] }
const probe = {
  prepareSceneRuntime, createProjectArtifactStore, referencedArtifactHashes,
  neededPlugins, pluginInstallStateOf,
  recheckUnknown: () => warnUnknownKinds(graph),
  material: () => ({ item: getCatalogMaterialById('mtl_s2fixture'), preset: getMaterialPresetByRef('library:mtl_s2fixture') }),
  isReadOnly: () => useScene.getState().readOnly,
  meshes: (): MeshProbe[] => [],
  prepared: null as PreparedSceneRuntime | null,
}
declare global { interface Window { runtimeTest: typeof probe } }
window.runtimeTest = probe

function SceneProbe() {
  const scene = useThree((state) => state.scene)
  useEffect(() => {
    probe.meshes = () => {
      const meshes: MeshProbe[] = []
      scene.traverseVisible((object) => {
        if (!(object instanceof Mesh)) return
        const materials = Array.isArray(object.material) ? object.material : [object.material]
        meshes.push({ name: object.name, vertices: object.geometry.getAttribute('position')?.count ?? 0,
          colors: materials.flatMap((material) => 'color' in material
            ? [(material.color as { getHexString: () => string }).getHexString()] : []) })
      })
      return meshes
    }
  }, [scene])
  return null
}

function RuntimeFixture() {
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    const abort = new AbortController()
    let runtime: PreparedSceneRuntime | undefined
    void prepareSceneRuntime({ projectId: 'fixture', graph, libraryMaterials,
      signal: abort.signal, onLate: () => setRevision((value) => value + 1),
    }).then((prepared) => {
      runtime = prepared
      if (abort.signal.aborted) { prepared.dispose(); return }
      probe.prepared = prepared
      setLoaded(true)
    }).catch((error: unknown) => { if (!abort.signal.aborted) setError(error) })
    return () => { abort.abort(); runtime?.dispose() }
  }, [])
  if (error) return <main role="alert">{String(error)}</main>
  return loaded ? <FixtureViewer key={revision} graph={graph} sceneKey={`runtime:${revision}`} textures={textures}>
    <SceneProbe />
  </FixtureViewer> : <main>Preparing runtime…</main>
}

createRoot(document.getElementById('root')!).render(<RuntimeFixture />)
