import { type AnyNode, initSpatialGridSync, sceneRegistry, useScene } from '@pascal-app/core'
import {
  buildGlbInteractiveItems,
  buildGlbReferenceNodes,
  buildGlbReplaceNodes,
  DroneController,
  type GlbPickEvent,
  GlbScene,
  type GlbWalkthrough,
  GlbWalkthroughController,
  InteractiveSystem,
  LiveWalkthroughController,
  SceneEnvironment,
  useViewer,
  Viewer,
} from '@pascal-app/viewer'
import { initInteractionSounds, useViewerUiSounds } from '@pascal-app/viewer/sfx'
import {
  applyViewerClick,
  applyViewerHover,
  DroneHud,
  type FloorplanPreviewScene,
  parseOpeningCamera,
  SceneLoader,
  savedSceneCamera,
  useFirstPersonHud,
  useViewerFloorDisplay,
  ViewerCameraControls,
  ViewerHoverLabel,
  ViewerOpeningCamera,
  ViewerRooms,
  ViewerSelectionManager,
  type ViewerSource,
  ViewerStage,
  type ViewerStageMode,
  WalkthroughHud,
} from '@pascal-app/viewer/ui'
import { Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import type { Object3D } from 'three'
import { viewerFlagsFromLocation } from '../config'
import type { SceneResponse } from '../pascal'
import { pluginInstallStateOf, publishedSceneSetup } from '../runtime/plugins'
import { ErrorBoundary } from './ErrorBoundary'
import { GuestPrompt } from './GuestPrompt'
import { ViewerOverlay } from './ViewerOverlay'

/**
 * Pascal's hosted viewer (editor.pascal.app/viewer/<id>), assembled from the public packages.
 * The tree below follows the hosted assembly; keep the two shaped alike so they can be diffed.
 *
 * Two sources, as on the hosted viewer: with a ready bake, the GLB draws the building while
 * interactive items, scans/guides and `bake: 'replace'` plugin kinds are rebuilt live from the
 * published graph; without one, the whole graph is rebuilt live.
 */
type SceneGraphInput = Parameters<typeof buildGlbInteractiveItems>[0]
type SetSceneArgs = Parameters<ReturnType<typeof useScene.getState>['setScene']>

const THREE_D_ONLY_STAGE_MODES = ['3d'] as const
const NO_OBJECTS: ReadonlyMap<string, Object3D> = new Map()

function GlbWalkthroughHudBridge({ state }: { state: NonNullable<GlbWalkthrough> }) {
  const suspended = useViewer((s) => s.walkthroughSuspended)
  return (
    <WalkthroughHud
      floorLabel={state.floorLabel}
      interact={state.door
        ? { label: state.door.label, verb: state.door.verb ?? (state.door.isOpen ? 'close' : 'open') }
        : null}
      onExit={() => useViewer.getState().setWalkthroughMode(false)}
      suspended={suspended}
      zoneLabel={state.zoneLabel}
    />
  )
}

function ViewerDroneHud() {
  const suspended = useViewer((state) => state.walkthroughSuspended)
  return <DroneHud onExit={() => useViewer.getState().setWalkthroughMode(false)} suspended={suspended} />
}

function ParametricWalkthroughHud() {
  const floorLabel = useFirstPersonHud((state) => state.floorLabel)
  const zoneLabel = useFirstPersonHud((state) => state.zoneLabel)
  const interact = useFirstPersonHud((state) => state.interact)
  const suspended = useViewer((state) => state.walkthroughSuspended)
  return (
    <WalkthroughHud
      floorLabel={floorLabel}
      interact={interact}
      onExit={() => useViewer.getState().setWalkthroughMode(false)}
      suspended={suspended}
      zoneLabel={zoneLabel}
    />
  )
}

function ViewerSceneCrashFallback({ projectName }: { projectName: string | null }) {
  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center bg-background/95 p-4 text-foreground">
      <div className="corner-smooth w-full max-w-md rounded-2xl border border-border/60 bg-background p-6 shadow-elevation-5">
        <h2 className="font-semibold text-lg">The 3D scene failed to render</h2>
        <p className="mt-2 text-muted-foreground text-sm">
          {projectName ? `"${projectName}" ` : ''}
          hit a rendering error.
        </p>
        <button
          className="mt-4 rounded-full border border-border bg-accent px-4 py-2 font-medium text-sm hover:bg-accent/80"
          onClick={() => window.location.reload()}
          type="button"
        >
          Reload scene
        </button>
      </div>
    </div>
  )
}

/**
 * Reports readiness from inside the GLB's Suspense boundary: siblings of `GlbScene` in one
 * `<Suspense>` commit only once the GLB and its textures resolved, so mounting means it's drawn.
 */
function GlbReadySignal({ onReady }: { onReady: () => void }) {
  useEffect(() => onReady(), [onReady])
  return null
}

export function ProjectViewer({ scene, glbUrl, runtimeRevision }: {
  scene: SceneResponse
  /** Blob URL of the downloaded bake, or null to rebuild the graph live. */
  glbUrl: string | null
  /** Bumped when a plugin arrives after the loading deadline: rebuild what it draws. */
  runtimeRevision: number
}) {
  const flags = useMemo(() => viewerFlagsFromLocation(), [])
  const { project, revision } = scene
  const sceneIdentity = `${project.id}:${revision.modelId}:${revision.version}`
  const projectName = project.name
  // A scene saved before install state existed keeps every plugin enabled.
  const graph = useMemo(() => ({
    ...scene.graph, installedPlugins: pluginInstallStateOf(scene.graph).installedPlugins,
  }) as unknown as NonNullable<SceneGraphInput>, [scene.graph])
  const floorplanScene = useMemo<FloorplanPreviewScene>(() => ({
    nodes: graph.nodes as Record<string, AnyNode>,
    installedPlugins: graph.installedPlugins as string[],
  }), [graph])

  const [loading, setLoading] = useState(true)
  const [presentedScene, setPresentedScene] = useState(false)
  const [sceneReady, setSceneReady] = useState(false)
  const [glbReady, setGlbReady] = useState(false)
  const [glbObjects, setGlbObjects] = useState<ReadonlyMap<string, Object3D>>(NO_OBJECTS)
  const [glbWalk, setGlbWalk] = useState<GlbWalkthrough>(null)
  // The bake keeps interactive items, scans/guides and `bake: 'replace'` kinds live.
  const glbInteractive = useMemo(() => (glbUrl ? buildGlbInteractiveItems(graph) : []), [glbUrl, graph])
  // The public read already removed scans and guides the owner keeps private.
  const glbReference = useMemo(() => (glbUrl ? buildGlbReferenceNodes(graph, { scans: true, guides: true }) : []), [glbUrl, graph])
  const glbReplace = useMemo(() => (glbUrl ? buildGlbReplaceNodes(graph) : []), [glbUrl, graph, runtimeRevision])
  // Doors, windows and switches operated from the selection callout make their sound,
  // and pointing, selecting and deselecting tick.
  useEffect(() => initInteractionSounds(), [])
  useViewerUiSounds()
  const bakedPresentation = useMemo(
    () => Object.values(floorplanScene.nodes).find((node) => node.type === 'site')?.presentation ?? null,
    [floorplanScene],
  )
  const [floorplanLevelId, setFloorplanLevelId] = useState<string | null>(null)
  const [stageMode, setStageMode] = useState<ViewerStageMode>('3d')
  const handleStageModeChange = useCallback((mode: ViewerStageMode) => {
    if (mode !== '3d') useViewer.getState().setWalkthroughMode(false)
    setStageMode(mode)
  }, [])
  const hasFloorplan = useMemo(
    () => Object.values(floorplanScene.nodes).some((node) => node.type === 'level'),
    [floorplanScene],
  )
  const openingCamera = useMemo(() => {
    const parsed = parseOpeningCamera(flags.camera)
    return parsed === 'saved' ? savedSceneCamera(floorplanScene.nodes) : parsed
  }, [flags.camera, floorplanScene])
  const [openingCameraApplied, setOpeningCameraApplied] = useState(false)
  const markOpeningCameraApplied = useCallback(() => setOpeningCameraApplied(true), [])
  const walkthroughMode = useViewer((s) => s.walkthroughMode)
  // The drone flies any scene with one controller; walking needs the scene's own colliders.
  const droneActive = useViewer((s) => s.walkthroughMode && s.walkthroughMovement === 'drone')
  const walkingOnFoot = walkthroughMode && !droneActive
  const parametricWalkthroughActive = walkingOnFoot && !glbUrl
  useViewerFloorDisplay()

  useEffect(() => {
    document.title = projectName || 'Pascal viewer'
    const viewer = useViewer.getState()
    viewer.setProjectId(project.id)
    // Start clean: a walkthrough left on unmounts the camera controls, so a `?camera=`
    // pose would never land and the loader would wait forever.
    viewer.resetSelection()
    viewer.setWalkthroughMode(false)
    viewer.setFocusedUnit(null)
    viewer.setHoveredId(null)
    viewer.setShowScans(true)
    viewer.setShowGuides(true)
    return () => useViewer.getState().setProjectId(null)
  }, [project.id, projectName])

  // Plugins are already registered (`useProjectScene` waits for them), so the live graph can
  // mount now; a late plugin bumps `runtimeRevision` and the graph mounts again to draw it.
  useEffect(() => {
    if (glbUrl) {
      setLoading(false)
      return
    }
    useScene.getState().setScene(graph.nodes as SetSceneArgs[0], graph.rootNodeIds as SetSceneArgs[1],
      publishedSceneSetup(graph))
    const stopGrid = initSpatialGridSync()
    setLoading(false)
    return stopGrid
  }, [glbUrl, graph, runtimeRevision])
  useEffect(() => () => useScene.getState().unloadScene(), [])

  const onSceneReady = useCallback((ready: boolean) => {
    setSceneReady(ready)
    if (ready) setPresentedScene(true)
  }, [])
  const markGlbReady = useCallback(() => setGlbReady(true), [])
  const sceneNodes = useScene((state) => state.nodes)
  // One navigation and one set of selection rules on both paths: the bake answers with its
  // pascalIds over the published graph, the live scene with the scene store's nodes.
  const viewerSource = useMemo<ViewerSource>(
    () => glbUrl
      ? { nodes: floorplanScene.nodes, objectFor: (id) => glbObjects.get(id) }
      : { nodes: sceneNodes, objectFor: (id) => sceneRegistry.nodes.get(id) },
    [glbUrl, floorplanScene, glbObjects, sceneNodes],
  )
  const handleGlbPick = useCallback(({ type, pick, modifiers }: GlbPickEvent) => {
    if (type === 'click') applyViewerClick(pick, floorplanScene.nodes, modifiers)
    else applyViewerHover(pick, floorplanScene.nodes)
  }, [floorplanScene])

  const embedReady = flags.embed && !loading && (glbUrl ? glbReady : sceneReady) &&
    (openingCamera === null || openingCameraApplied)
  useEffect(() => {
    if (!embedReady || window.parent === window) return
    // The page framing an embed is an origin the viewer cannot name, so the target is '*';
    // the message holds nothing the embedding page did not already put in the URL.
    window.parent.postMessage({ type: 'pascal:viewer-ready', projectId: project.id }, '*')
  }, [embedReady, project.id])

  const waitingFor3D = glbUrl ? !glbReady : !sceneReady
  // A `?camera=` pose lands a frame after the scene is ready: the loader waits for it, so a
  // visible frame never shows the default view, then jumps.
  const waitingForOpeningCamera = openingCamera !== null && !openingCameraApplied
  const showSceneLoader =
    loading || (!presentedScene && stageMode !== '2d' && (waitingFor3D || waitingForOpeningCamera))
  const hideHeader = flags.hideHeader

  return (
    <main className="relative h-screen w-full" data-scene-ready={!showSceneLoader}
      data-source={glbUrl ? 'baked' : 'live'} data-state={showSceneLoader ? 'loading' : 'ready'}>
      {showSceneLoader && <SceneLoader className="bg-background" fullScreen />}

      {!loading && (
        <>
          {/* Embed: header (name, breadcrumb, levels), controls bar and switcher; no owner
              line and no guest prompt. */}
          <ViewerOverlay
            glbActive={!!glbUrl}
            glbHasGuides={glbReference.some((n) => n.type === 'guide')}
            glbHasScans={glbReference.some((n) => n.type === 'scan')}
            hideBottomBar={flags.hideBottomBar || stageMode !== '3d'}
            hideHeader={hideHeader}
            ownerName={flags.embed ? null : project.owner?.displayName ?? null}
            projectName={projectName}
            source={viewerSource}
          />
          {flags.embed ? null : <GuestPrompt />}

          <ViewerStage
            className="absolute inset-0"
            levelId={floorplanLevelId}
            mode={stageMode}
            modes={hasFloorplan ? undefined : THREE_D_ONLY_STAGE_MODES}
            onLevelChange={setFloorplanLevelId}
            onModeChange={handleStageModeChange}
            scene={floorplanScene}
            showCompass={hasFloorplan}
            showLevelSelector={hasFloorplan}
            showSwitcher={hasFloorplan}
            switcherClassName={`${showSceneLoader ? 'z-[110]' : 'z-30'} ${hideHeader ? 'top-4' : 'top-28 md:top-4'}`}
          >
            <ErrorBoundary fallback={<ViewerSceneCrashFallback projectName={projectName} />} key={sceneIdentity}>
              <Viewer
                defaultRender={{ shading: 'rendered' }}
                onSceneReadyChange={onSceneReady}
                presentation={glbUrl ? bakedPresentation : undefined}
                renderContext="viewer"
                sceneReadyKey={sceneIdentity}
                selectionManager="custom"
                useBvh={false}
              >
                <SceneEnvironment />
                <ViewerCameraControls glbActive={!!glbUrl} holdOpening={openingCamera !== null} />
                {openingCamera && (
                  <ViewerOpeningCamera
                    onApplied={markOpeningCameraApplied}
                    pose={openingCamera}
                    ready={glbUrl ? glbReady : sceneReady}
                  />
                )}
                {!glbUrl && <ViewerSelectionManager />}
                <ViewerRooms source={viewerSource} />
                <InteractiveSystem />
                {glbUrl && (
                  <Suspense fallback={null}>
                    <GlbReadySignal onReady={markGlbReady} />
                    <GlbScene
                      interactiveItems={glbInteractive}
                      key={runtimeRevision}
                      onObjectsChange={setGlbObjects}
                      onPick={handleGlbPick}
                      onWalkthroughChange={setGlbWalk}
                      referenceNodes={glbReference}
                      replaceNodes={glbReplace}
                      sceneNodes={floorplanScene.nodes}
                      url={glbUrl}
                    />
                  </Suspense>
                )}
                {glbUrl && walkingOnFoot && (
                  <Suspense fallback={null}>
                    <GlbWalkthroughController url={glbUrl} />
                  </Suspense>
                )}
                {parametricWalkthroughActive && <LiveWalkthroughController />}
                {droneActive && <DroneController />}
              </Viewer>
              {glbUrl && walkingOnFoot && glbWalk && <GlbWalkthroughHudBridge state={glbWalk} />}
              {parametricWalkthroughActive && <ParametricWalkthroughHud />}
              {droneActive && <ViewerDroneHud />}
              {stageMode === '3d' && <ViewerHoverLabel nodes={viewerSource.nodes} />}
            </ErrorBoundary>
          </ViewerStage>
        </>
      )}
    </main>
  )
}
