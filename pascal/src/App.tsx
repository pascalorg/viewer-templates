import { acquireSceneReadOnlyLease, initSpatialGridSync, loadPlugin, useScene } from '@pascal-app/core'
import { renderPlugin } from '@pascal-app/nodes/render'
import { configureViewer, useViewer, Viewer } from '@pascal-app/viewer'
import { SceneLoader } from '@pascal-app/viewer/ui'
import { OrbitControls } from '@react-three/drei'
import { useEffect, useMemo, useState } from 'react'
import fixture from '../tests/fixtures/live-scene.json'
import { PASCAL_ASSETS_URL, PASCAL_BASE_URL, projectIdFromLocation } from './config'
import { hasHandoffCallback } from './pascal/handoff'
import { type ProjectSceneRuntime, type ProjectSceneState, useProjectScene } from './useProjectScene'
import { ErrorScreen, LoadingScreen, NeedsAccessScreen, NoFileScreen, RetryButton, Status } from './viewer/screens'

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

// S3 still renders only the local fixture. S4 supplies the real material/artifact/
// plugin preparation through ProjectSceneRuntime before mounting the project graph.
const fixtureRuntime: ProjectSceneRuntime = { prepare: async () => { await pluginReady } }

export function App() {
  const projectId = useMemo(() => projectIdFromLocation(), [])
  if (!projectId && !hasHandoffCallback()) return <Status state="missing-project" title="No project selected">
    <p>Add <code>?project=&lt;id&gt;</code> to the address, or set <code>VITE_PASCAL_PROJECT_ID</code>.</p>
  </Status>
  return <Project projectId={projectId || ''} />
}

function Project({ projectId }: { projectId: string }) {
  const { state, reload } = useProjectScene(PASCAL_BASE_URL, projectId, fixtureRuntime)
  switch (state.kind) {
    case 'loading': return <LoadingScreen />
    case 'opening': return <LoadingScreen opening />
    case 'downloading': return <LoadingScreen progress={state.progress} />
    case 'reopen': return <NeedsAccessScreen access={state.access} baseUrl={PASCAL_BASE_URL} projectId={projectId} />
    case 'error': return <ErrorScreen error={state.error} onRetry={reload} />
    case 'no-file': return <NoFileScreen scene={state.scene} onRetry={reload} />
    case 'live':
    case 'baked': return <FixtureViewer
      key={`${state.kind}:${state.scene.revision.modelId}:${state.scene.revision.version}:${state.runtimeRevision}`}
      resolved={state} onRetry={reload} />
  }
}

/** Temporary S1 fixture, gated by the real project data flow until S4 assembly. */
function FixtureViewer({ resolved, onRetry }: {
  resolved: Extract<ProjectSceneState, { kind: 'live' | 'baked' }>
  onRetry: () => void
}) {
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
    }).catch((failure: unknown) => { if (!cancelled) setError(failure) })
    return () => {
      cancelled = true
      stopGrid?.()
      release?.()
    }
  }, [])

  if (error) return <Status state="error" title="The 3D scene failed to render">
    <RetryButton onRetry={onRetry} />
  </Status>
  return (
    <main className="relative h-full" data-state={ready ? 'ready' : 'loading'}
      data-scene-ready={ready} data-source={resolved.kind}>
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
        <h1 className="text-lg font-semibold">{resolved.scene.project.name || 'Pascal viewer'}</h1>
        <p className="text-sm text-muted-foreground" role="status">
          {ready ? 'Live fixture ready · Drag to orbit, scroll to zoom' : 'Building scene…'}
        </p>
      </div>
    </main>
  )
}
