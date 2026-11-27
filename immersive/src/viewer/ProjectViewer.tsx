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
  type ViewerImmersiveSession,
} from '@pascal-app/viewer'
import { initInteractionSounds, useViewerUiSounds } from '@pascal-app/viewer/sfx'
import {
  applyViewerClick,
  applyViewerHover,
  DroneHud,
  type FloorplanPreviewScene,
  parseOpeningCamera,
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
import { createContext, type ReactNode, Suspense, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { Object3D } from 'three'
import { PASCAL_BASE_URL, viewerFlagsFromLocation } from '../config'
import type { SceneResponse } from '../pascal'
import { SettingsPanel, useViewerSettings } from '../pascal-react'
import { pluginInstallStateOf, publishedSceneSetup } from '../runtime/plugins'
import { DEFAULT_SETTINGS, parseImmersiveSettings } from '../settings/opening'
import { OpeningSettings } from '../settings/OpeningSettings'
import { TourSettings } from '../settings/TourSettings'
import { applyOpeningLook, CameraPoseBridge } from '../settings/viewer-actions'
import { useTourLook } from '../tour/look'
import { TourCamera } from '../tour/TourCamera'
import { TourEdgePrewarm, TourNoir } from '../tour/TourNoir'
import { TourPlan } from '../tour/TourPlan'
import { PlanPovOverlay, PlanPovTracker } from './chrome/PlanPov'
import { useIsCompact } from './chrome/useIsCompact'
import { VrWalkthroughHint } from './chrome/VrWalkthroughHint'
import { WalkMiniMap, WalkTeleporter } from './chrome/WalkMiniMap'
import { ErrorBoundary } from './ErrorBoundary'
import { MeasureTool } from './measure/MeasureTool'
import { PlanMeasure } from './measure/PlanMeasure'
import { useMeasureStore } from './measure/store'
import { BrandedLoader } from './screens'
import { ArSceneBridge } from './ar/ArSceneBridge'
import { ArSession } from './ar/ArSession'
import { useArStore } from './ar/store'
import { useVrStore } from './vr/store'
import { VrLoadingDome } from './vr/VrLoadingDome'
import { VrSessionBridge } from './vr/VrSessionBridge'
import { VrWalk } from './vr/VrWalk'
import { WalkInteractOutline } from './WalkInteractOutline'
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

interface VrSceneContextValue {
  projectName: string | null
  glbActive: boolean
  glbObjects: ReadonlyMap<string, Object3D>
  glbWalk: GlbWalkthrough
}

const VrSceneContext = createContext<VrSceneContextValue | null>(null)

function VrSceneWrapper({ children }: { children: ReactNode }) {
  const ctx = useContext(VrSceneContext)
  return (
    <>
      {children}
      {ctx && (
        <>
          <VrLoadingDome projectName={ctx.projectName} />
          <VrWalk glbActive={ctx.glbActive} glbObjects={ctx.glbObjects} glbWalk={ctx.glbWalk} />
        </>
      )}
    </>
  )
}

const VR_IMMERSIVE_SESSION: ViewerImmersiveSession = {
  Session: VrSessionBridge,
  Scene: VrSceneWrapper,
  onError: (cause) => {
    console.error('[vr] rendering error', cause)
    useVrStore.getState().exitVr()
  },
}

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
    <div className="ui-stage-backdrop absolute inset-0 z-30 flex items-center justify-center p-6 text-foreground">
      <div className="ui-glass corner-smooth w-full max-w-md rounded-2xl p-6">
        <p className="ui-eyebrow">Rendering error</p>
        <h2 className="mt-2 font-light text-2xl text-foreground leading-tight tracking-[-0.03em]">
          The 3D scene failed to render
        </h2>
        <div aria-hidden="true" className="mt-3.5 h-px w-12 bg-foreground/25" />
        <p className="mt-4 text-muted-foreground text-sm leading-relaxed">
          {projectName ? `"${projectName}" ` : ''}
          hit a rendering error.
        </p>
        <button
          className="mt-5 rounded-full bg-foreground px-5 py-2 font-medium text-background text-sm transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2"
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

export function ProjectViewer({ scene, glbUrl, runtimeRevision, token }: {
  scene: SceneResponse
  /** The credential the scene was read with: a configure one saves viewer settings. */
  token?: string
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
  const [stageMode, setStageMode] = useState<ViewerStageMode>('3d')
  const handleStageModeChange = useCallback((mode: ViewerStageMode) => {
    if (mode !== '3d') useViewer.getState().setWalkthroughMode(false)
    setStageMode(mode)
  }, [])
  const hasFloorplan = useMemo(
    () => Object.values(floorplanScene.nodes).some((node) => node.type === 'level'),
    [floorplanScene],
  )
  // Viewer settings: the saved opening and tour options, a manager's draft in Customize mode.
  const settings = useViewerSettings({
    settings: scene.settings, token, baseUrl: PASCAL_BASE_URL, projectId: project.id,
    parse: parseImmersiveSettings, defaults: DEFAULT_SETTINGS,
  })
  // The page opens on the settings it was read with; a manager's later changes show as they are
  // chosen in the panel and reach visitors once saved.
  const [arrival] = useState(() => settings.value)
  // A camera in the link (`?camera=`) wins over the saved one.
  const openingCamera = useMemo(() => {
    const parsed = parseOpeningCamera(flags.camera)
    if (parsed === 'saved') return savedSceneCamera(floorplanScene.nodes)
    return parsed ?? arrival.opening?.camera ?? null
  }, [flags.camera, floorplanScene, arrival])
  const [openingCameraApplied, setOpeningCameraApplied] = useState(false)
  const markOpeningCameraApplied = useCallback(() => setOpeningCameraApplied(true), [])
  const walkthroughMode = useViewer((s) => s.walkthroughMode)
  const vrStatus = useVrStore((s) => s.status)
  const vrSupport = useVrStore((s) => s.support)
  const vrSessionId = useVrStore((s) => s.sessionId)
  const vrActive = vrStatus === 'active'
  const arActive = useArStore((s) => s.status === 'active')
  const arCacheKey = `${sceneIdentity}:${runtimeRevision}`
  // The drone flies any scene with one controller; walking needs the scene's own colliders.
  const droneMovement = useViewer((s) => s.walkthroughMode && s.walkthroughMovement === 'drone')
  const droneActive = droneMovement && !vrActive
  const walkingOnFoot = walkthroughMode && !droneActive
  const desktopWalkingOnFoot = walkingOnFoot && !vrActive
  const parametricWalkthroughActive = desktopWalkingOnFoot && !glbUrl
  // Walking in the full 3D view (split view has the plan itself): a mini map, bottom right.
  const compact = useIsCompact()
  const showWalkMiniMap = desktopWalkingOnFoot && stageMode === '3d' && hasFloorplan && !compact
  useViewerFloorDisplay()

  useEffect(() => {
    useVrStore.getState().probeSupport()
    useArStore.getState().probeSupport()
    return () => {
      useVrStore.getState().exitVr()
      useArStore.getState().resetForScene(null)
    }
  }, [])

  useEffect(() => {
    useArStore.getState().resetForScene(arCacheKey)
  }, [arCacheKey])

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
    useMeasureStore.getState().exit()
    return () => {
      useMeasureStore.getState().exit()
      useViewer.getState().setProjectId(null)
    }
  }, [project.id, projectName])

  // The saved time of day and walls, once on arrival; the visitor's own choices after.
  useEffect(() => {
    applyOpeningLook(arrival.opening, { glbActive: !!glbUrl })
  }, [arrival, glbUrl])

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
    if (ready) {
      setPresentedScene(true)
      const vr = useVrStore.getState()
      if (vr.status === 'active') vr.markSceneReady(vr.sessionId)
    }
  }, [])
  const markGlbReady = useCallback(() => {
    setGlbReady(true)
    const vr = useVrStore.getState()
    if (vr.status === 'active') vr.markSceneReady(vr.sessionId)
  }, [])
  const vrSceneContextValue = useMemo<VrSceneContextValue | null>(
    () => (vrActive ? { projectName, glbActive: !!glbUrl, glbObjects, glbWalk } : null),
    [vrActive, projectName, glbUrl, glbObjects, glbWalk],
  )
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
  const arSceneReady = !loading && !waitingFor3D
  // A `?camera=` pose lands a frame after the scene is ready: the loader waits for it, so a
  // visible frame never shows the default view, then jumps.
  const waitingForOpeningCamera = openingCamera !== null && !openingCameraApplied
  const showSceneLoader =
    loading || (!presentedScene && stageMode !== '2d' && (waitingFor3D || waitingForOpeningCamera))
  const hideHeader = flags.hideHeader
  const tourActive = useTourLook((state) => state.active)
  // What the screen shows, on `<main>` for tests and embedders: viewer settings set these on arrival.
  const timeOfDay = useViewer((s) => (s.skyLive || s.timeOfDayMinutes !== null ? 'custom' : s.timeOfDay))
  const wallMode = useViewer((s) => s.wallMode)
  const measureActive = useMeasureStore((state) => state.active)
  const measureAllowed = !walkthroughMode && !tourActive && !vrActive && !arActive

  useEffect(() => {
    if (!measureAllowed) useMeasureStore.getState().exit()
  }, [measureAllowed])

  // Customize steps aside while the tour, a walkthrough, VR or AR owns the screen.
  const showCustomize = !showSceneLoader && !tourActive && !walkthroughMode && !vrActive && !arActive
  // A saved "start the tour on arrival", once the scene is on screen; never in embeds, VR or AR.
  const autostartTour = arrival.tour?.autostart === true && !flags.embed && !showSceneLoader && !vrActive && !arActive

  return (
    <main className="relative h-screen w-full" data-guided-tour-noir={tourActive ? 'on' : undefined}
      data-measure-active={measureActive ? 'true' : undefined}
      data-scene-ready={!showSceneLoader} data-source={glbUrl ? 'baked' : 'live'}
      data-stage-mode={stageMode} data-state={showSceneLoader ? 'loading' : 'ready'} data-time-of-day={timeOfDay}
      data-wall-mode={wallMode}>
      {showSceneLoader && <BrandedLoader fixed label="Preparing 3D scene" projectName={projectName} />}

      {!loading && (
        <>
          {/* Embed: no owner line and no guest CTA; chrome lives in `src/viewer/chrome/`. */}
          <ViewerOverlay
            arAutoOpen={flags.ar}
            autostartTour={autostartTour}
            embed={flags.embed}
            tourSettings={settings.value.tour}
            glbActive={!!glbUrl}
            glbHasGuides={glbReference.some((n) => n.type === 'guide')}
            glbHasScans={glbReference.some((n) => n.type === 'scan')}
            hasFloorplan={hasFloorplan}
            hideBottomBar={flags.hideBottomBar}
            hideHeader={hideHeader}
            onStageModeChange={handleStageModeChange}
            ownerName={flags.embed ? null : project.owner?.displayName ?? null}
            projectName={projectName}
            source={viewerSource}
            stageMode={stageMode}
          />

          <ViewerStage
            className="absolute inset-0"
            mode={stageMode}
            modes={hasFloorplan ? undefined : THREE_D_ONLY_STAGE_MODES}
            onModeChange={handleStageModeChange}
            scene={floorplanScene}
            showCompass={hasFloorplan && !vrActive && !arActive}
            // Floors are picked in the explore panel; the 2D plan follows the viewer's selected level.
            showLevelSelector={false}
            showSwitcher={false}
          >
            <ErrorBoundary fallback={<ViewerSceneCrashFallback projectName={projectName} />} key={sceneIdentity}>
              <VrSceneContext.Provider value={vrSceneContextValue}>
                <Viewer
                  // The guided tour draws in its Noir theme; the daylight sky comes back after it.
                  daylight={!tourActive}
                  defaultRender={{ shading: 'rendered' }}
                  immersive={vrActive ? VR_IMMERSIVE_SESSION : undefined}
                  onSceneReadyChange={onSceneReady}
                  presentation={glbUrl ? bakedPresentation : undefined}
                  renderContext="viewer"
                  sceneReadyKey={vrActive ? `${sceneIdentity}:vr:${vrSessionId}` : sceneIdentity}
                  selectionManager="custom"
                  useBvh={false}
                >
                  <SceneEnvironment />
                  {!vrActive && <ViewerCameraControls glbActive={!!glbUrl} holdOpening={openingCamera !== null} />}
                  {!vrActive && <CameraPoseBridge />}
                  {!vrActive && openingCamera && (
                    <ViewerOpeningCamera
                      onApplied={markOpeningCameraApplied}
                      pose={openingCamera}
                      ready={glbUrl ? glbReady : sceneReady}
                    />
                  )}
                  {!vrActive && !glbUrl && !measureActive && <ViewerSelectionManager />}
                  {/* The guided tour shows its room in colour, without room pills, outlines or callouts. */}
                  {!vrActive && !tourActive && !measureActive && <ViewerRooms source={viewerSource} />}
                  <InteractiveSystem />
                  {glbUrl && (
                    <Suspense fallback={null}>
                      <GlbReadySignal key={vrActive ? `vr-${vrSessionId}` : 'desktop'} onReady={markGlbReady} />
                      <GlbScene
                        interactiveItems={glbInteractive}
                        key={runtimeRevision}
                        onObjectsChange={setGlbObjects}
                        onPick={measureActive ? undefined : handleGlbPick}
                        onWalkthroughChange={setGlbWalk}
                        referenceNodes={glbReference}
                        replaceNodes={glbReplace}
                        sceneNodes={floorplanScene.nodes}
                        url={glbUrl}
                      />
                    </Suspense>
                  )}
                  {glbUrl && desktopWalkingOnFoot && (
                    <Suspense fallback={null}>
                      <GlbWalkthroughController url={glbUrl} />
                    </Suspense>
                  )}
                  {parametricWalkthroughActive && <LiveWalkthroughController />}
                  {/* What E would act on, in reach under the crosshair, wears the selection outline. */}
                  {desktopWalkingOnFoot && (glbUrl
                    ? <WalkInteractOutline glbObjects={glbObjects} glbTargeting={!!glbWalk?.door} />
                    : <WalkInteractOutline />)}
                  {droneActive && <DroneController />}
                  {!vrActive && walkthroughMode && (stageMode === 'split' || showWalkMiniMap) && <PlanPovTracker />}
                  {showWalkMiniMap && <WalkTeleporter />}
                  {/* Works out the tour's edges in idle time, so starting the tour doesn't freeze the page. */}
                  {!vrActive && !tourActive && !showSceneLoader && <TourEdgePrewarm source={viewerSource} />}
                  {!vrActive && tourActive && <TourNoir source={viewerSource} />}
                  {!vrActive && tourActive && <TourCamera />}
                  {measureActive && measureAllowed && stageMode !== '2d' && (
                    <MeasureTool glbActive={!!glbUrl} glbObjects={glbObjects} />
                  )}
                  {!vrActive && (
                    <ArSceneBridge glbActive={!!glbUrl} ready={arSceneReady} sceneIdentity={arCacheKey} />
                  )}
                </Viewer>
              </VrSceneContext.Provider>
              {!vrActive && !arActive && stageMode === '3d' && !measureActive && <ViewerHoverLabel nodes={viewerSource.nodes} />}
            </ErrorBoundary>
          </ViewerStage>

          <ArSession />

          {vrActive && (
            <div className="pointer-events-none absolute inset-0 z-30 flex items-end justify-center pb-8">
              <div className="ui-glass pointer-events-auto flex items-center gap-3 rounded-full py-2 pr-2 pl-4 text-foreground text-xs">
                <span className="text-muted-foreground">Viewing in VR</span>
                <button
                  className="rounded-full bg-foreground px-4 py-1.5 font-medium text-background text-xs transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2"
                  onClick={() => useVrStore.getState().exitVr()}
                  type="button"
                >
                  Exit VR
                </button>
              </div>
            </div>
          )}

          {/* Over the whole viewer, not the 3D pane, so split view centres the HUD on the screen;
              styles.css keeps the crosshair over the 3D pane, where the camera points. */}
          {glbUrl && desktopWalkingOnFoot && glbWalk && <GlbWalkthroughHudBridge state={glbWalk} />}
          {parametricWalkthroughActive && <ParametricWalkthroughHud />}
          {droneActive && <ViewerDroneHud />}
          <VrWalkthroughHint
            busy={vrStatus === 'requesting'}
            onEnterVr={() => useVrStore.getState().enterVr()}
            supported={vrSupport === 'supported'}
            visible={desktopWalkingOnFoot && vrSupport !== 'unknown' && !tourActive && !arActive}
          />
          {/* The tour on the 2D plan, in step with the 3D reveal, in split view and in 2D. */}
          {!vrActive && tourActive && stageMode !== '3d' && <TourPlan />}
          {!vrActive && walkthroughMode && stageMode === 'split' && (
            <PlanPovOverlay movement={droneActive ? 'drone' : 'walk'} nodes={viewerSource.nodes} />
          )}
          {measureActive && measureAllowed && stageMode !== '3d' && <PlanMeasure source={viewerSource} />}
          {showWalkMiniMap && <WalkMiniMap source={viewerSource} />}
          {showCustomize && (
            <SettingsPanel description={`How visitors tour and first see ${projectName?.trim() || 'this project'} in this viewer.`} settings={settings}>
              <TourSettings settings={settings} source={viewerSource} />
              <OpeningSettings glbActive={!!glbUrl} settings={settings} />
            </SettingsPanel>
          )}
        </>
      )}
    </main>
  )
}
