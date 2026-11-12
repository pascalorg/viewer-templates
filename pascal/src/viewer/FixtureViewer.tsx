import { initSpatialGridSync, useScene } from '@pascal-app/core'
import { useViewer, Viewer } from '@pascal-app/viewer'
import { SceneLoader } from '@pascal-app/viewer/ui'
import { OrbitControls } from '@react-three/drei'
import { useEffect, useState, type ReactNode } from 'react'
import type { SceneGraph } from '../pascal/contract'
import { publishedSceneSetup } from '../runtime/plugins'
import { RetryButton, Status } from './screens'

/** Simple scaffold renderer, pending the public camera controls and hybrid assembly. */
export function FixtureViewer({ graph, sceneKey, title = 'Pascal viewer', source, textures = false, children, onRetry }: {
  graph: SceneGraph
  sceneKey: string
  title?: string
  source?: 'live' | 'baked'
  textures?: boolean
  children?: ReactNode
  onRetry?: () => void
}) {
  const [loaded, setLoaded] = useState(false)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<unknown>(null)

  // Preparation and its read-only lease belong to the parent; only scene hydration
  // and spatial subscriptions live here. Remount this viewer when a late plugin arrives.
  useEffect(() => {
    let stopGrid: (() => void) | undefined
    try {
      type Input = Parameters<ReturnType<typeof useScene.getState>['setScene']>
      useScene.getState().setScene(graph.nodes as Input[0], graph.rootNodeIds as Input[1], publishedSceneSetup(graph))
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
    } catch (failure) { setError(failure) }
    return () => stopGrid?.()
  }, [graph, textures])

  if (error) return <Status state="error" title="The 3D scene failed to render">
    {onRetry && <RetryButton onRetry={onRetry} />}
  </Status>
  return (
    <main className="relative h-full" data-state={ready ? 'ready' : 'loading'}
      data-scene-ready={ready} data-source={source}>
      {loaded && <Viewer daylight={false} defaultRender={{ shading: 'rendered', textures }}
        disablePostFx onRenderError={setError} onSceneReadyChange={setReady}
        renderContext="viewer" sceneReadyKey={sceneKey} selectionManager="custom" useBvh={false}>
        <OrbitControls makeDefault target={[0, 1, 0]} />
        {children}
      </Viewer>}
      {!ready && <SceneLoader />}
      <div className="pointer-events-none absolute bottom-4 left-4 rounded-2xl bg-background/90 px-4 py-3 shadow">
        <h1 className="text-lg font-semibold">{title}</h1>
        <p className="text-sm text-muted-foreground" role="status">
          {ready ? 'Live fixture ready · Drag to orbit, scroll to zoom' : 'Building scene…'}
        </p>
      </div>
    </main>
  )
}
