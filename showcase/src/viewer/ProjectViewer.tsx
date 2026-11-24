import { type AnyNode, initSpatialGridSync, sceneRegistry, useScene } from '@pascal-app/core'
import {
  buildGlbInteractiveItems,
  buildGlbReferenceNodes,
  buildGlbReplaceNodes,
  GlbScene,
  GlbWalkthroughController,
  InteractiveSystem,
  sceneFamilies,
  LiveWalkthroughController,
  SceneEnvironment,
  useViewer,
  Viewer,
} from '@pascal-app/viewer'
import { initInteractionSounds } from '@pascal-app/viewer/sfx'
import {
  type FloorplanPreviewScene,
  parseOpeningCamera,
  savedSceneCamera,
  useViewerFloorDisplay,
  ViewerOpeningCamera,
  type ViewerSource,
  ViewerStage,
} from '@pascal-app/viewer/ui'
import { CameraControlsImpl } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { type Object3D, Vector3 } from 'three'
import { PASCAL_BASE_URL, viewerFlagsFromLocation } from '../config'
import type { SceneResponse } from '../pascal'
import { listLevels } from '../pascal/graph'
import { SettingsBar, useViewerSettings } from '../pascal-react'
import { pluginInstallStateOf, publishedSceneSetup } from '../runtime/plugins'
import { DiscoveryScene, renderCallout, reportBakedPick } from '../showcase/discovery/DiscoveryScene'
import { interactiveIds as findInteractive } from '../showcase/discovery/interactive'
import { Loader } from '../showcase/Loader'
import { availableModes, modeOf } from '../showcase/modes'
import { DEFAULT_SETTINGS, parseShowcaseSettings, resolveOpening, roundPose } from '../showcase/opening'
import { cameraPose, frameRendered, registerPlacement, registerPoseReader, resetPresentation, usePresented } from '../showcase/presentation'
import { ShowcaseOverlay } from '../showcase/ShowcaseOverlay'
import { features } from '../features'
import { ShowcaseCamera } from '../showcase/ShowcaseCamera'
import { SEE_DISTANCE, WALK_SPEEDS } from '../showcase/WalkHud'
import { introAhead } from '../showcase/useIntro'
import { currentMood, followSiteLocation, glideTarget } from '../showcase/time'
import { applyOpeningView, modelBounds, shareDaylightSite } from '../showcase/viewer-actions'
import { ErrorBoundary } from './ErrorBoundary'

/**
 * The showcase: the `pascal` template's assembly of Pascal's hosted viewer, from the public
 * packages, with the /next page's chrome (`ShowcaseOverlay`) in place of the hosted header and
 * controls bar. The tree below follows the hosted assembly; keep the two shaped alike.
 *
 * The behaviour is the template's own (`showcase/discovery`, `ShowcaseCamera`, `showcase/time`):
 * /next's orbit, room discovery and item callouts replace the stock selection routing, room
 * highlight, hover pill and outline; the viewer draws, the template decides what a pointer does.
 *
 * Two sources, as on the hosted viewer: with a ready bake, the GLB draws the building while
 * interactive items, scans/guides and `bake: 'replace'` plugin kinds are rebuilt live from the
 * published graph; without one, the whole graph is rebuilt live.
 */
type SceneGraphInput = Parameters<typeof buildGlbInteractiveItems>[0]
type SetSceneArgs = Parameters<ReturnType<typeof useScene.getState>['setScene']>

// The showcase is 3D only: no 2D plan, so no stage switcher, compass or floor picker.
const THREE_D_ONLY_STAGE_MODES = ['3d'] as const
const NO_OBJECTS: ReadonlyMap<string, Object3D> = new Map()

/**
 * Inside the canvas: instant camera placement for the first view (no controls glide behind the
 * loader), and a count of rendered frames so the loader lifts only once that view is drawn.
 */
function PresentationBridge() {
  const controls = useThree((state) => state.controls) as CameraControlsImpl | null
  useEffect(() => {
    registerPlacement(controls ? (position, target) => { void controls.setLookAt(...position, ...target, false) } : null)
    registerPoseReader(controls ? () => ({
      position: controls.getPosition(new Vector3()).toArray(),
      target: controls.getTarget(new Vector3()).toArray(),
    }) : null)
    return () => {
      registerPlacement(null)
      registerPoseReader(null)
    }
  }, [controls])
  // The viewer draws at priority 1; count completed draws, not the frame's pre-render tick.
  useFrame(() => frameRendered(), 2)
  return null
}

/** The loader fades out over 250 ms once the scene may show (at once under reduced motion). */
function useLoaderFade(showing: boolean): 'showing' | 'leaving' | 'gone' {
  const [phase, setPhase] = useState<'showing' | 'leaving' | 'gone'>(showing ? 'showing' : 'gone')
  useEffect(() => {
    if (showing) { setPhase('showing'); return }
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) { setPhase('gone'); return }
    setPhase('leaving')
    const timer = setTimeout(() => setPhase('gone'), 260)
    return () => clearTimeout(timer)
  }, [showing])
  return phase
}

function ViewerSceneCrashFallback({ projectName }: { projectName: string | null }) {
  return (
    <Loader
      error={{ title: 'The 3D scene failed to render', detail: `${projectName ? `"${projectName}" ` : 'This project '}hit a rendering error.` }}
      onRetry={() => window.location.reload()}
    />
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
  /** Blob URL of the downloaded bake, or null to rebuild the graph live. */
  glbUrl: string | null
  /** Bumped when a plugin arrives after the loading deadline: rebuild what it draws. */
  runtimeRevision: number
  /** The credential the scene was read with: a configure one saves viewer settings. */
  token?: string
}) {
  const flags = useMemo(() => viewerFlagsFromLocation(), [])
  const { project, revision } = scene
  const levelCount = useMemo(() => listLevels(scene.graph).length, [scene.graph])
  // X-ray's families; the render plugins are registered before this mounts (`useProjectScene`).
  const families = useMemo(() => sceneFamilies(scene.graph as unknown as Parameters<typeof sceneFamilies>[0]), [scene.graph, runtimeRevision])
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
  // The bake keeps interactive items, scans/guides and `bake: 'replace'` kinds live.
  const glbInteractive = useMemo(() => (glbUrl ? buildGlbInteractiveItems(graph) : []), [glbUrl, graph])
  // The public read already removed scans and guides the owner keeps private.
  const glbReference = useMemo(() => (glbUrl ? buildGlbReferenceNodes(graph, { scans: true, guides: true }) : []), [glbUrl, graph])
  const glbReplace = useMemo(() => (glbUrl ? buildGlbReplaceNodes(graph) : []), [glbUrl, graph, runtimeRevision])
  // Doors, windows and switches operated from a callout make their sound; the interface ticks
  // (hover, press, pin, dismiss) are the showcase's own (`showcase/sounds.ts`).
  useEffect(() => initInteractionSounds(), [])
  const bakedPresentation = useMemo(
    () => Object.values(floorplanScene.nodes).find((node) => node.type === 'site')?.presentation ?? null,
    [floorplanScene],
  )
  const openingCamera = useMemo(() => {
    const parsed = parseOpeningCamera(flags.camera)
    return parsed === 'saved' ? savedSceneCamera(floorplanScene.nodes) : parsed
  }, [flags.camera, floorplanScene])
  // Viewer settings: the saved opening view, a manager's draft in Customize mode. A camera in the
  // link (`?camera=`) still wins over the saved one; its mode and time apply either way.
  const settings = useViewerSettings({
    settings: scene.settings, token, baseUrl: PASCAL_BASE_URL, projectId: project.id,
    parse: parseShowcaseSettings, defaults: DEFAULT_SETTINGS,
  })
  const offeredModes = useMemo(() => availableModes(features, {
    coarsePointer: matchMedia('(pointer: coarse)').matches, familyCount: families.length,
  }).map((mode) => mode.id), [families])
  const opening = useMemo(() => resolveOpening(settings.value.opening, levelCount, offeredModes),
    [settings.value.opening, levelCount, offeredModes])
  // The page opens on the view it was read with; a manager's later changes apply on Reset view.
  const [arrival] = useState(() => opening)
  const walking = useViewer((s) => s.walkthroughMode)
  const [openingCameraApplied, setOpeningCameraApplied] = useState(false)
  const markOpeningCameraApplied = useCallback(() => setOpeningCameraApplied(true), [])
  const walkingOnFoot = useViewer((s) => s.walkthroughMode && s.walkthroughMovement === 'walk')
  const parametricWalkthroughActive = walkingOnFoot && !glbUrl
  useViewerFloorDisplay()

  // A mood on a sun height is an explicit minute: keep it at its height once the site's location
  // is known (shared below for a bake, mounted with the graph when live).
  useEffect(() => followSiteLocation(), [])

  useEffect(() => {
    document.title = projectName || 'Pascal showcase'
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
    // Rooms show through discovery, never as drawn zone fills.
    viewer.setShowZones(false)
    // Open on the /next view: exploded floors at dusk (one floor stays together, see `defaultView`),
    // or the whole house when the intro is about to reveal it.
    applyOpeningView(levelCount, { introAhead: introAhead(features.intro && !flags.camera), opening: arrival })
    return () => useViewer.getState().setProjectId(null)
  }, [project.id, projectName, levelCount, flags.camera, arrival])

  // A bake never loads its graph into the scene store: give the sun the site's north and location.
  useEffect(() => (glbUrl ? shareDaylightSite(floorplanScene.nodes) : undefined), [glbUrl, floorplanScene])

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
  // Doors, windows and items with controls: a click on one pins its callout.
  const interactiveIds = useMemo(() => findInteractive(graph), [graph])
  // The orbit's far limit grows with the model, once its bounds are known.
  const [modelRadius, setModelRadius] = useState(0)
  useEffect(() => {
    if (glbUrl ? !glbReady : !sceneReady) return
    const bounds = modelBounds({ nodes: floorplanScene.nodes, source: viewerSource, bakedObjects: glbUrl ? glbObjects : undefined, families })
    if (bounds) setModelRadius(bounds.max.clone().sub(bounds.min).length() / 2)
  }, [glbUrl, glbReady, sceneReady, glbObjects, floorplanScene, viewerSource, families])

  // Each scene holds the loader until its first view is staged and drawn (`presentation.ts`).
  const presentedIdentity = useRef<string | null>(null)
  if (presentedIdentity.current !== sceneIdentity) {
    presentedIdentity.current = sceneIdentity
    resetPresentation()
  }
  const presented = usePresented()

  const embedReady = flags.embed && !loading && (glbUrl ? glbReady : sceneReady) &&
    (openingCamera === null || openingCameraApplied) && presented
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
  // Stage under the loader only after the opening pose is applied, including on the presentedScene path.
  const sceneDrawn = !loading && !waitingForOpeningCamera && (presentedScene || !waitingFor3D)
  const showSceneLoader = !sceneDrawn || !presented
  const loaderLeaving = useLoaderFade(showSceneLoader)

  return (
    <main className="sc" data-scene-ready={!showSceneLoader}
      data-source={glbUrl ? 'baked' : 'live'} data-state={showSceneLoader ? 'loading' : 'ready'}>
      {loaderLeaving !== 'gone' && <Loader leaving={loaderLeaving === 'leaving'} progress={{ label: 'Setting the scene', value: 92 }} />}

      {!loading && (
        <>
          {/* The chrome mounts once the scene has drawn, under the loader: it stages the first
              view (the intro's start, or the settled view), and the loader lifts once that is
              on screen. No owner line, no "Get started" prompt: this is the project's own page. */}
          {sceneDrawn && (
            <ShowcaseOverlay
              hideControls={flags.hideBottomBar}
              bakedObjects={glbUrl ? glbObjects : undefined}
              families={families}
              introAllowed={!flags.camera}
              levelCount={levelCount}
              nodes={floorplanScene.nodes}
              opening={opening}
              source={viewerSource}
            />
          )}
          {!showSceneLoader && (
            <SettingsBar settings={settings}>
              <button className="pascal-settings-button" disabled={walking} type="button"
                title={walking ? 'Leave the walkthrough to set the opening view' : undefined}
                onClick={() => {
                  const pose = cameraPose()
                  const mode = modeOf(useViewer.getState())
                  const time = glideTarget() ?? currentMood()
                  settings.set((current) => ({ ...current, opening: {
                    ...(pose ? { camera: roundPose(pose) } : {}),
                    ...(time ? { time } : {}),
                    ...(mode && mode !== 'walkthrough' ? { mode } : {}),
                  } }))
                }}>
                Set current view as opening view
              </button>
              <button aria-label="Reset opening view" className="pascal-settings-button" disabled={!settings.value.opening}
                onClick={() => settings.set(({ opening: _, ...rest }) => rest)} type="button">
                Reset
              </button>
            </SettingsBar>
          )}

          <ViewerStage
            className="absolute inset-0"
            mode="3d"
            modes={THREE_D_ONLY_STAGE_MODES}
            scene={floorplanScene}
            showCompass={false}
            showLevelSelector={false}
            showSwitcher={false}
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
                <ShowcaseCamera glbActive={!!glbUrl} holdOpening={openingCamera !== null} modelRadius={modelRadius} />
                <PresentationBridge />
                {openingCamera && (
                  <ViewerOpeningCamera
                    onApplied={markOpeningCameraApplied}
                    pose={openingCamera}
                    ready={glbUrl ? glbReady : sceneReady}
                  />
                )}
                <DiscoveryScene baked={!!glbUrl} interactiveIds={interactiveIds} source={viewerSource} />
                <InteractiveSystem renderCallout={renderCallout} />
                {glbUrl && (
                  <Suspense fallback={null}>
                    <GlbReadySignal onReady={markGlbReady} />
                    <GlbScene
                      interactiveItems={glbInteractive}
                      key={runtimeRevision}
                      onObjectsChange={setGlbObjects}
                      onPick={reportBakedPick}
                      outlineSync={false}
                      renderCallout={renderCallout}
                      referenceNodes={glbReference}
                      replaceNodes={glbReplace}
                      sceneNodes={floorplanScene.nodes}
                      url={glbUrl}
                    />
                  </Suspense>
                )}
                {glbUrl && walkingOnFoot && (
                  <Suspense fallback={null}>
                    <GlbWalkthroughController seeDistance={SEE_DISTANCE} speeds={WALK_SPEEDS} url={glbUrl} />
                  </Suspense>
                )}
                {parametricWalkthroughActive && <LiveWalkthroughController seeDistance={SEE_DISTANCE} speeds={WALK_SPEEDS} />}
              </Viewer>
            </ErrorBoundary>
          </ViewerStage>
        </>
      )}
    </main>
  )
}
