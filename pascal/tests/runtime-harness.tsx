// Only included by --mode runtime-test. No test hooks are exposed by the production page.
import { getCatalogMaterialById, getMaterialPresetByRef, initSpatialGridSync, useScene } from '@pascal-app/core'
import { Viewer, useViewer } from '@pascal-app/viewer'
import { OrbitControls } from '@react-three/drei'
import { useThree } from '@react-three/fiber'
import { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Mesh } from 'three'
import type { SceneGraph } from '../src/pascal/contract'
import { prepareSceneRuntime, type PreparedSceneRuntime } from '../src/runtime/bootstrap'
import { createProjectArtifactStore, referencedArtifactHashes } from '../src/runtime/artifacts'
import { neededPlugins, pluginInstallStateOf, warnUnknownKinds } from '../src/runtime/plugins'
import liveFixture from './fixtures/live-scene.json'
import pluginFixture from './fixtures/plugin-scene.json'
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
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<unknown>(null)
  useEffect(() => {
    let runtime: PreparedSceneRuntime | undefined
    let stopGrid: (() => void) | undefined
    const abort = new AbortController()
    const mount = () => {
      type Input = Parameters<ReturnType<typeof useScene.getState>['setScene']>
      useScene.getState().setScene(graph.nodes as Input[0], graph.rootNodeIds as Input[1], runtime!.setup)
    }
    void prepareSceneRuntime({ projectId: 'fixture', graph, libraryMaterials: pluginFixture.libraryMaterials,
      signal: abort.signal, onLate: mount,
    }).then((prepared) => {
      runtime = prepared
      if (abort.signal.aborted) { prepared.dispose(); return }
      probe.prepared = prepared
      mount()
      stopGrid = initSpatialGridSync()
      const viewer = useViewer.getState()
      viewer.resetSelection()
      viewer.setCameraMode('perspective')
      viewer.setLevelMode('stacked')
      viewer.setWallMode('up')
      viewer.setShowGrid(false)
      viewer.setShowMeasurements(false)
      viewer.setTextures(textures)
      setLoaded(true)
    }).catch((error: unknown) => { if (!abort.signal.aborted) setError(error) })
    return () => { abort.abort(); stopGrid?.(); runtime?.dispose() }
  }, [])
  if (error) return <main role="alert">{String(error)}</main>
  return <main className="relative h-full" data-scene-ready={ready}>
    {loaded && <Viewer daylight={false} defaultRender={{ shading: 'rendered', textures }}
      disablePostFx onRenderError={setError} onSceneReadyChange={setReady} renderContext="viewer"
      sceneReadyKey="s2-runtime-fixture" selectionManager="custom" useBvh={false}>
      <OrbitControls makeDefault target={[3, 0, 0]} />
      <SceneProbe />
    </Viewer>}
    <p className="absolute bottom-4 left-4" role="status">{ready ? 'Runtime fixture ready' : 'Building runtime fixture…'}</p>
  </main>
}

createRoot(document.getElementById('root')!).render(<RuntimeFixture />)
