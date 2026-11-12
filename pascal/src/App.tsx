import { acquireSceneReadOnlyLease, initSpatialGridSync, loadPlugin, useScene } from '@pascal-app/core'
import { renderPlugin } from '@pascal-app/nodes/render'
import { configureViewer, useViewer, Viewer } from '@pascal-app/viewer'
import { SceneLoader } from '@pascal-app/viewer/ui'
import { OrbitControls } from '@react-three/drei'
import { useEffect, useState } from 'react'
import fixture from '../tests/fixtures/live-scene.json'
import { PASCAL_ASSETS_URL } from './config'

type SceneInput = Parameters<ReturnType<typeof useScene.getState>['setScene']>
// JSON widens discriminants. Core validates and migrates these public fixture nodes.
const scene = fixture as unknown as {
  nodes: SceneInput[0]
  rootNodeIds: SceneInput[1]
} & NonNullable<SceneInput[2]>

configureViewer({
  assetsBaseUrl: PASCAL_ASSETS_URL,
  sfxBaseUrl: '/audios/sfx',
  iconsBaseUrl: '/icons',
  decoders: { basisPath: '/decoders/basis/', dracoPath: '/decoders/draco/' },
})
const pluginReady = loadPlugin(renderPlugin)

/** S1 proves the public runtime with a local scene; project assembly follows later. */
export function App() {
  const [loaded, setLoaded] = useState(false)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<unknown>(null)

  useEffect(() => {
    let cancelled = false
    let release: (() => void) | undefined
    let stopGrid: (() => void) | undefined
    void pluginReady.then(() => {
      if (cancelled) return
      release = acquireSceneReadOnlyLease()
      useScene.getState().setScene(scene.nodes, scene.rootNodeIds, {
        materials: scene.materials,
        installedPlugins: scene.installedPlugins,
      })
      stopGrid = initSpatialGridSync()
      const viewer = useViewer.getState()
      viewer.resetSelection()
      viewer.setCameraMode('perspective')
      viewer.setLevelMode('stacked')
      viewer.setWallMode('up')
      viewer.setShowGrid(false)
      viewer.setShowMeasurements(false)
      viewer.setTextures(false)
      setLoaded(true)
    }).catch(setError)
    return () => {
      cancelled = true
      stopGrid?.()
      release?.()
    }
  }, [])

  if (error) return <main role="alert" className="p-6">The fixture failed to render. Reload to try again.</main>
  return (
    <main className="relative h-full" data-state={ready ? 'ready' : 'loading'} data-scene-ready={ready}>
      {loaded && (
        <Viewer
          daylight={false}
          defaultRender={{ shading: 'rendered', textures: false }}
          disablePostFx
          onRenderError={setError}
          onSceneReadyChange={setReady}
          renderContext="viewer"
          sceneReadyKey="s1-live-fixture"
          selectionManager="custom"
          useBvh={false}
        >
          <OrbitControls makeDefault target={[0, 1, 0]} />
        </Viewer>
      )}
      {!ready && <SceneLoader />}
      <div className="pointer-events-none absolute bottom-4 left-4 rounded-2xl bg-background/90 px-4 py-3 shadow">
        <h1 className="text-lg font-semibold">Pascal viewer</h1>
        <p className="text-sm text-muted-foreground" role="status">
          {ready ? 'Live fixture ready · Drag to orbit, scroll to zoom' : 'Building scene…'}
        </p>
      </div>
    </main>
  )
}
