import {
  acquireSceneReadOnlyLease,
  type ArtifactStore,
  configureArtifactStore,
  loadPlugin,
  useScene,
} from '@pascal-app/core'
import { renderPlugin } from '@pascal-app/nodes/render'
import { configureViewer, pendingSceneBuildCount, useViewer, Viewer as PascalViewer } from '@pascal-app/viewer'
import { useFrame } from '@react-three/fiber'
import { useEffect, useRef, useState } from 'react'
import { PASCAL_BASE_URL } from '../config'
import type { SceneResponse } from '../pascal'
import { captureLiveScene, type LiveScene } from './liveCapture'
import type { FocusProps, ModelInfo } from './Model'
import { Viewer } from './Viewer'

type SceneInput = Parameters<ReturnType<typeof useScene.getState>['setScene']>
type LiveViewerProps = FocusProps & {
  scene: SceneResponse
  label: string
  onError: (error: unknown) => void
  onReady: (info: ModelInfo) => void
}

configureViewer({ assetsBaseUrl: PASCAL_BASE_URL })
const pluginReady = loadPlugin(renderPlugin)

/** Frames the runtime must hold still (nothing left to build) before it is captured. */
const SETTLED_FRAMES = 6

/**
 * An unbaked project, drawn like a baked one. Pascal's runtime builds the published graph on a
 * hidden canvas, the way Pascal's own bake page does (no daylight, no post-processing); once it
 * has settled, `captureLiveScene` copies what it built, shaped like a bake, the runtime unmounts,
 * and the copy goes to the same `Viewer` a downloaded file does.
 */
export function LiveViewer({ scene, label, onError, onReady, ...focus }: LiveViewerProps) {
  const [loaded, setLoaded] = useState<SceneResponse | null>(null)
  const [captured, setCaptured] = useState<{ scene: SceneResponse; live: LiveScene } | null>(null)
  const building = loaded === scene && captured?.scene !== scene
  // Which scene the runtime last said it had built; `Capture` reads it every frame.
  const readyFor = useRef<SceneResponse | null>(null)

  useEffect(() => {
    let cancelled = false
    let release: (() => void) | undefined
    // The API keeps kind-specific data loose; core migrates it when loading.
    const graph = scene.graph as unknown as {
      nodes: SceneInput[0]
      rootNodeIds: SceneInput[1]
    } & NonNullable<SceneInput[2]>
    void pluginReady
      .then(() => {
        if (cancelled) return
        release = acquireSceneReadOnlyLease()
        configureArtifactStore(artifactStore(scene.project.id))
        // No library or scene materials: the drawing gives every surface its own tone.
        useScene.getState().setScene(graph.nodes, graph.rootNodeIds, {
          materials: {},
          collections: graph.collections,
          installedPlugins: graph.installedPlugins,
        })
        const viewer = useViewer.getState()
        viewer.resetSelection()
        // Everything built, every floor in place, walls whole: what a bake holds.
        viewer.setLevelMode('stacked')
        viewer.setWallMode('up')
        viewer.setShowGrid(false)
        viewer.setShowMeasurements(false)
        // The bake's own look: Pascal's materials as authored (glass stays see-through, leaves
        // keep their texture's alpha), none of the viewer's presentation on top.
        viewer.setEdges('off')
        viewer.setRenderQuality('low')
        setLoaded(scene)
      })
      .catch((error: unknown) => !cancelled && onError(error))
    return () => {
      cancelled = true
      release?.()
      configureArtifactStore(null)
    }
  }, [scene, onError])

  return (
    <>
      {building ? (
        <div aria-hidden className="live-build">
          <PascalViewer
            daylight={false}
            disablePostFx
            onRenderError={onError}
            sceneReadyKey={`${scene.project.id}:${scene.revision.version}`}
            selectionManager="custom"
            transparent
            onSceneReadyChange={(ready) => {
              if (ready) readyFor.current = scene
            }}
          >
            <Capture
              onCapture={() => {
                try {
                  setCaptured({ scene, live: captureLiveScene(scene.graph) })
                } catch (error) {
                  onError(error)
                }
              }}
              ready={() => readyFor.current === scene}
            />
          </PascalViewer>
        </div>
      ) : null}
      {captured?.scene === scene ? (
        <Viewer {...focus} graph={scene.graph} label={label} onError={onError} onReady={onReady} source={captured.live} />
      ) : null}
    </>
  )
}

/**
 * Where the runtime finds a project's generated geometry (scripted items, such as a light
 * fitting, name theirs `artifact://<sha256>`): Pascal serves each from the project, redirecting
 * to signed storage. Read-only. Without it those items draw as placeholder boxes.
 */
function artifactStore(projectId: string): ArtifactStore {
  const url = (sha256: string) =>
    `${PASCAL_BASE_URL}/api/projects/${encodeURIComponent(projectId)}/artifacts/${encodeURIComponent(sha256)}`
  return {
    url,
    put: () => Promise.reject(new Error('This viewer only reads projects.')),
    text: (sha256) =>
      fetch(url(sha256))
        .then((response) => (response.ok ? response.text() : null))
        .catch(() => null),
  }
}

/** Inside the runtime's canvas: captures once it is ready and has nothing left to build. */
function Capture({ ready, onCapture }: { ready: () => boolean; onCapture: () => void }) {
  const still = useRef(0)
  const done = useRef(false)
  useFrame(() => {
    if (done.current) return
    still.current = ready() && pendingSceneBuildCount() === 0 ? still.current + 1 : 0
    if (still.current < SETTLED_FRAMES) return
    done.current = true
    onCapture()
  })
  return null
}
