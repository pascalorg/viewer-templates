import { emitter, sceneRegistry, useLocale, usePascalI18n } from '@pascal-app/core'
import { showInScene } from '@pascal-app/viewer'
import { localizedLevelName, type ViewerSource } from '@pascal-app/viewer/ui'
import type { CameraControlsImpl } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { BlueprintLines, DustPool, GroundWaves, RoomFloors } from './effects'
import { type BuildElement, type BuildSet, collectBuild } from './elements'
import { clearFloorInk, floorInk, setFloorInk } from './ink'
import { NoirLook } from './NoirLook'
import { groundTopUnder, PaperSheet } from './paper'
import { FrameRecorder } from './FrameRecorder'
import { Precompiler } from './Precompiler'
import { arrivalOf, createPose, poseAt, poseMatrix } from './poses'
import { renderClock } from './render'
import { useAnimationStore } from './store'
import { type Caption, type Timeline, templateById } from './templates'

type Controls = InstanceType<typeof CameraControlsImpl>

/**
 * Plays the chosen template over the live scene. A run measures the build at rest, plans the
 * template's timeline and then, every frame before the render, poses each piece for the moment
 * (any moment can be shown at once, so scrubbing is free). When the run ends or stops, every
 * piece gets its own transform back and Pascal's batching takes over again.
 *
 * Pascal draws a floor's walls and repeated furniture as merged batches once the scene settles;
 * a batch would hold a piece at rest while its own mesh moves. During a run the batch meshes are
 * hidden and each piece draws itself; afterwards the batches re-sew from scratch (the same
 * hand-back Pascal does around a thumbnail capture).
 */

type Run = {
  set: BuildSet
  timeline: Timeline
  elements: Array<{
    element: BuildElement
    /** The parent's world matrix at rest, inverted, and the piece's own at rest. */
    parentRestInverse: THREE.Matrix4
    restWorld: THREE.Matrix4
    meshes: THREE.Mesh[]
    arrival: number
  }>
  hiddenBatches: Set<THREE.Object3D>
  dust: DustPool
  lines: BlueprintLines | null
  waves: GroundWaves | null
  /** The Noir look's paper plans, one per floor. */
  papers: PaperSheet[]
  /** Slabs that build room by room: the tiles, and the slab hidden until they are down. */
  floors: Map<string, RoomFloors>
  cameraKey: number
  caption: Caption | null
  time: number
  clock: number
  /** The person took the camera: the cinematic orbit leaves it to them for this run. */
  cameraTaken: boolean
}

const _motion = new THREE.Matrix4()
const _local = new THREE.Matrix4()
const _pose = createPose()

function levelRoots(): THREE.Object3D[] {
  const roots: THREE.Object3D[] = []
  for (const id of sceneRegistry.byType.level ?? []) {
    const root = sceneRegistry.nodes.get(id)
    if (root) roots.push(root)
  }
  return roots
}

/** Pieces draw themselves for the run: merged batch meshes hidden, originals back on the scene layer. */
function handBackBatches(run: Run) {
  for (const root of levelRoots()) {
    root.traverse((child) => {
      if ((child.name === 'wall-batch' || child.name === 'item-batch') && child.visible) {
        child.visible = false
        run.hiddenBatches.add(child)
      }
    })
  }
  for (const entry of run.elements) {
    for (const mesh of entry.meshes) {
      if (mesh.layers.isEnabled(0)) continue
      showInScene(mesh, 'wall-batched')
      showInScene(mesh, 'batched')
    }
  }
}

const clamp01 = (t: number) => (t < 0 ? 0 : t > 1 ? 1 : t)
const smooth = (t: number) => t * t * (3 - 2 * t)

/** The Noir look at `time`: the papers' folds, and how far each floor has come into colour. */
function applyNoir(run: Run, time: number) {
  const noir = run.timeline.noir
  if (!noir) return
  for (const paper of run.papers) paper.update(time)
  floorInk.count.value = Math.min(noir.develop.length, 16)
  noir.develop.forEach((floor, index) => {
    const k = clamp01((time - floor.start) / floor.duration)
    const radius = k <= 0 ? -1 : floor.radius * (1 - (1 - k) ** 2)
    setFloorInk(index, floor.x, floor.z, radius, floor.bottom, floor.top)
  })
  floorInk.rest.value = smooth(clamp01((time - noir.rest[0]) / Math.max(0.01, noir.rest[1] - noir.rest[0])))
}

function captionAt(timeline: Timeline, time: number): Caption | null {
  if (!timeline.captions) return null
  for (const caption of timeline.captions) if (time >= caption.start && time < caption.end) return caption
  return null
}

function restore(run: Run) {
  for (const { element } of run.elements) {
    const { object, rest } = element
    object.position.copy(rest.position)
    object.quaternion.copy(rest.quaternion)
    object.scale.copy(rest.scale)
    object.visible = rest.visible
  }
  for (const batch of run.hiddenBatches) batch.visible = true
  run.hiddenBatches.clear()
  run.dust.dispose()
  run.lines?.dispose()
  run.waves?.dispose()
  for (const floors of run.floors.values()) floors.dispose()
  for (const paper of run.papers) paper.dispose()
  if (run.timeline.noir) clearFloorInk()
  useAnimationStore.setState({ caption: null })
  // Let the batching systems re-sew from a clean slate: the same hand-back and re-hold Pascal
  // runs around a thumbnail capture. Originals the batches still draw go back under them.
  emitter.emit('thumbnail:before-capture', undefined as never)
  emitter.emit('thumbnail:after-capture', undefined as never)
}

/** A level's name as the navigator shows it ("Ground floor", "Floor 1"), for the paper's corner. */
type LevelNamer = (levelId: string) => string | null

function startRun(source: ViewerSource, scene: THREE.Scene, levelName: LevelNamer): Run | null {
  const set = collectBuild(source)
  if (!set) return null
  const template = templateById(useAnimationStore.getState().template)
  const timeline = template.build(set)
  const elements: Run['elements'] = []
  for (const element of set.elements) {
    const object = element.object
    object.updateWorldMatrix(true, false)
    const parentRestInverse = new THREE.Matrix4()
    if (object.parent) parentRestInverse.copy(object.parent.matrixWorld).invert()
    const meshes: THREE.Mesh[] = []
    object.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) meshes.push(child as THREE.Mesh)
    })
    const track = timeline.tracks.get(element.id)
    elements.push({
      element,
      parentRestInverse,
      restWorld: object.matrixWorld.clone(),
      meshes,
      arrival: track ? track.start + track.duration * arrivalOf(track.motion) : Infinity,
    })
  }
  const dust = new DustPool()
  scene.add(dust.mesh)
  const lines = timeline.lines ? new BlueprintLines(set.elements, timeline.lines, template.accent) : null
  if (lines) scene.add(lines.group)
  const waves = timeline.waves ? new GroundWaves(timeline.waves) : null
  if (waves) scene.add(waves.group)

  // A slab that spreads in grows room by room, each from its own room's centre.
  const floors = new Map<string, RoomFloors>()
  for (const element of set.elements) {
    const track = timeline.tracks.get(element.id)
    if (!track || track.motion.kind !== 'spread' || element.phase !== 'ground') continue
    const on = set.rooms.filter((room) => {
      if (room.storey !== element.storey) return false
      const c = room.box.getCenter(new THREE.Vector3())
      return element.box.containsPoint(c.setY(element.center.y))
    })
    if (on.length === 0) continue
    // Give the rooms time to come in one after another.
    const duration = Math.max(track.duration, Math.min(2.4, 0.6 + on.length * 0.35))
    track.duration = duration
    const tiles = new RoomFloors(element, on, track.start, duration)
    if (tiles.count === 0) continue
    scene.add(tiles.group)
    floors.set(element.id, tiles)
  }

  // One paper per floor, printed with the floor's plan from the scene's own nodes.
  const papers: PaperSheet[] = []
  for (const plan of timeline.noir?.papers ?? []) {
    const level = set.levels[plan.storey]
    if (!level) continue
    const named = levelName(plan.levelId)
    if (named) plan.title = named
    const paper = new PaperSheet(plan, source.nodes as unknown as Record<string, unknown>, level.object)
    // The ground floor's sheet lies on the site: kept a little above the ground under it, terrain
    // included, so it never disappears beneath it.
    if (plan.storey === 0) {
      const ground = groundTopUnder(paper.box, scene)
      if (Number.isFinite(ground)) {
        plan.rest = Math.max(plan.rest, ground + 0.02)
        plan.top = Math.max(plan.top, plan.rest)
      }
    }
    scene.add(paper.group)
    papers.push(paper)
  }

  return {
    set, timeline, elements, hiddenBatches: new Set(), dust, lines, waves, papers, floors,
    cameraKey: -1, caption: null,
    time: 0, clock: 0, cameraTaken: false,
  }
}

function applyPoses(run: Run, time: number) {
  const tracks = run.timeline.tracks
  for (const entry of run.elements) {
    const { element } = entry
    const object = element.object
    const floors = run.floors.get(element.id)
    floors?.update(time)
    // The slab itself waits under its room tiles until the last one is down.
    const pose = floors && time < floors.end
      ? Object.assign(_pose, { visible: false })
      : poseAt(element, tracks.get(element.id), time, run.clock, _pose)
    if (!pose.visible) {
      object.visible = false
      continue
    }
    object.visible = element.rest.visible
    if (pose.rest) {
      object.position.copy(element.rest.position)
      object.quaternion.copy(element.rest.quaternion)
      object.scale.copy(element.rest.scale)
      continue
    }
    // local = parentRest⁻¹ · M · restWorld: the motion in world space, carried into the parent's
    // frame as it stood at rest, so anything the parent does on top still carries the piece.
    poseMatrix(pose, _motion)
    _local.multiplyMatrices(entry.parentRestInverse, _motion).multiply(entry.restWorld)
    _local.decompose(object.position, object.quaternion, object.scale)
  }
}

/** Frames the build and gives the orbit a good starting height. */
function frameBuild(controls: Controls, set: BuildSet, spread: number) {
  frameBox(controls, set.box.clone().expandByScalar(set.radius * spread), Math.PI * 0.32)
}

let lastFraming: { box: THREE.Box3; polar: number } | null = null
/** A framing's glide is under way: the camera moves, but not by the person's hand. */
let framing = false

const _sphere = new THREE.Sphere()

/**
 * Frames `box` from `polar` (radians from straight down), with the person's zoom and tilt from
 * the panel. The camera keeps the side it looks from (its azimuth): it only looks at the box's
 * centre, tilts to the angle and stands back far enough to hold the box's bounding sphere.
 * (camera-controls' `fitToBox` is not used: it snaps the view to the box's nearest face, so a
 * tilt either side of 45° would flip the whole view.)
 */
function frameBox(controls: Controls, box: THREE.Box3, polar: number) {
  lastFraming = { box: box.clone(), polar }
  framing = true
  const { zoom, tilt } = useAnimationStore.getState()
  const fit = fitDistance(controls, box)
  publishRanges(controls, fit)
  const distance = fit / Math.max(0.2, zoom)
  const angle = THREE.MathUtils.clamp(tilt !== null ? THREE.MathUtils.degToRad(tilt) : polar, 0.03, Math.PI / 2 - 0.02)
  controls.moveTo(_sphere.center.x, _sphere.center.y, _sphere.center.z, true)
  controls.rotatePolarTo(angle, true)
  controls.dollyTo(distance, true)
}

/**
 * How far back the camera stands to hold `box`'s bounding sphere at zoom 1 (leaves the sphere in
 * `_sphere`). Zoom is this over the camera's distance.
 */
function fitDistance(controls: Controls, box: THREE.Box3): number {
  box.getBoundingSphere(_sphere)
  const camera = controls.camera as THREE.PerspectiveCamera
  const vertical = THREE.MathUtils.degToRad(camera.isPerspectiveCamera ? camera.fov : 50)
  // A render frames as the screen does (`renderClock.aspect`), not as the video-shaped canvas would.
  const aspect = renderClock.aspect ?? camera.aspect ?? 1
  const horizontal = 2 * Math.atan(Math.tan(vertical / 2) * (aspect || 1))
  const fov = Math.min(vertical, horizontal)
  return (_sphere.radius / Math.sin(fov / 2)) * 1.05
}

/**
 * Tells the panel how far its Zoom and Tilt sliders reach: as far as the camera itself goes
 * (Pascal's `minDistance`/`maxDistance` and polar limits), measured against a framing that fits at
 * `fit`. The camera's limits stay Pascal's; the sliders follow them.
 */
function publishRanges(controls: Controls, fit: number) {
  if (!(fit > 0)) return
  const zoom: [number, number] = [
    Math.ceil((fit / Math.max(1e-3, controls.maxDistance)) * 100) / 100,
    Math.floor((fit / Math.max(1e-3, controls.minDistance)) * 100) / 100,
  ]
  const tilt: [number, number] = [
    Math.ceil(THREE.MathUtils.radToDeg(controls.minPolarAngle)),
    Math.floor(THREE.MathUtils.radToDeg(Math.min(controls.maxPolarAngle, Math.PI / 2 - 0.02))),
  ]
  if (zoom[1] < zoom[0]) zoom[1] = zoom[0]
  useAnimationStore.getState().setRanges(zoom, tilt)
}

/** Spread around the build that the opening framing leaves room for: the storm. */
const FRAMING_SPREAD: Record<string, number> = { magnetic: 0.6 }

function updateCamera(run: Run, controls: Controls | null, cinematic: boolean) {
  const keys = run.timeline.cameraKeys
  if (!keys || !controls || !cinematic || run.cameraTaken) return
  let index = -1
  for (let i = 0; i < keys.length; i++) if (keys[i]!.time <= run.time) index = i
  if (index === run.cameraKey || index < 0) return
  run.cameraKey = index
  frameBox(controls, keys[index]!.box, keys[index]!.polar)
}

/** The store's `runId` of the run on stage now (0 for none): a render waits for its own to start. */
let liveRunId = 0
export function startedRunId(): number {
  return liveRunId
}

export function BuildAnimator({ source, ready }: { source: ViewerSource; ready: boolean }) {
  const scene = useThree((state) => state.scene)
  const controls = useThree((state) => state.controls) as Controls | null
  const invalidate = useThree((state) => state.invalidate)
  const canvas = useThree((state) => state.gl.domElement)
  const runRef = useRef<Run | null>(null)
  const runId = useAnimationStore((state) => state.runId)
  const status = useAnimationStore((state) => state.status)
  const sourceRef = useRef(source)
  sourceRef.current = source
  const i18n = usePascalI18n()
  const locale = useLocale()
  const levelNameRef = useRef<LevelNamer>(() => null)
  levelNameRef.current = (levelId) => {
    const level = (sourceRef.current.nodes as unknown as Record<string, { level?: number; name?: string } | undefined>)[levelId]
    return level ? localizedLevelName(level, i18n, locale) : null
  }

  // A new run: put the last one back, measure at rest, plan, and go.
  useEffect(() => {
    if (!ready || runId === 0) return
    const previous = runRef.current
    if (previous) {
      restore(previous)
      runRef.current = null
    }
    const run = startRun(sourceRef.current, scene, (id) => levelNameRef.current(id))
    if (!run) {
      useAnimationStore.setState({ status: 'idle', pieceCount: 0, duration: 0 })
      return
    }
    runRef.current = run
    liveRunId = runId
    const store = useAnimationStore.getState()
    useAnimationStore.setState({ duration: run.timeline.duration, pieceCount: run.elements.length })
    if (store.seekTo !== null) run.time = store.seekTo
    applyPoses(run, run.time)
    handBackBatches(run)
    applyNoir(run, run.time)
    if (store.cinematic && controls) {
      if (run.timeline.cameraKeys) updateCamera(run, controls, true)
      else frameBuild(controls, run.set, FRAMING_SPREAD[store.template] ?? 0.15)
    }
    invalidate()
  }, [runId, ready, scene, controls, invalidate])

  // Stopping puts everything back where it was.
  useEffect(() => {
    if (status !== 'idle' && status !== 'finished') return
    const run = runRef.current
    if (!run) return
    // A Noir build holds its last frame (the batches still stepped aside, so everything keeps its
    // colour) until the curtain has switched the look back: then it is put back (below).
    if (status === 'finished' && run.timeline.noir && useAnimationStore.getState().appliedLook === 'noir') return
    restore(run)
    runRef.current = null
    invalidate()
  }, [status, invalidate])

  const appliedLook = useAnimationStore((state) => state.appliedLook)
  useEffect(() => {
    const run = runRef.current
    if (appliedLook !== 'default' || !run?.timeline.noir || useAnimationStore.getState().status !== 'finished') return
    restore(run)
    runRef.current = null
    invalidate()
  }, [appliedLook, invalidate])

  // Zoom or tilt changed in the panel: frame again at once, the build in progress or the house at rest.
  const framingId = useAnimationStore((state) => state.framingId)
  useEffect(() => {
    if (framingId === 0 || !controls || !ready) return
    if (lastFraming) {
      frameBox(controls, lastFraming.box, lastFraming.polar)
    } else {
      const set = collectBuild(sourceRef.current)
      if (set) frameBuild(controls, set, 0.15)
    }
    if (runRef.current) runRef.current.cameraTaken = false
    invalidate()
  }, [framingId, controls, ready, invalidate])

  // The person orbits, tilts or zooms the camera themselves (whenever its own input is on): the
  // panel's Zoom and Tilt follow it, read off the camera against the framing it last had (the
  // build's, at zoom 1). Every camera update counts except a framing's own glide (`framing`, until
  // it comes to rest or the person takes over) and the cinematic camera's, whose drag and wheel
  // already go through the sliders. (camera-controls sends no `controlstart` for the wheel, so
  // its control events can't tell the person's moves apart.)
  useEffect(() => {
    if (!controls || !ready) return
    let buildBox: THREE.Box3 | null = null
    // The framing Zoom is measured against: the last one, or the whole build at zoom 1.
    const currentFit = () => {
      let box = lastFraming?.box ?? null
      if (!box) {
        if (!buildBox) {
          const set = collectBuild(sourceRef.current)
          if (!set) return 0
          buildBox = set.box.clone().expandByScalar(set.radius * 0.15)
        }
        box = buildBox
      }
      return fitDistance(controls, box.clone())
    }
    const follow = () => {
      // A render moves the camera as the build plays; the panel keeps the person's own Zoom and Tilt.
      if (framing || renderClock.aspect !== null) return
      const state = useAnimationStore.getState()
      if (state.cinematic && (state.status === 'playing' || state.status === 'paused')) return
      const fit = currentFit()
      if (!(fit > 0)) return
      publishRanges(controls, fit)
      const { zoomRange, tiltRange } = useAnimationStore.getState()
      const zoom = THREE.MathUtils.clamp(Math.round((fit / Math.max(1e-3, controls.distance)) * 100) / 100, zoomRange[0], zoomRange[1])
      const tilt = THREE.MathUtils.clamp(Math.round(THREE.MathUtils.radToDeg(controls.polarAngle)), tiltRange[0], tiltRange[1])
      state.followCamera(zoom, tilt)
    }
    const settled = () => {
      framing = false
    }
    // The person's own input ends a framing's glide: from then on the camera is theirs.
    const takeOver = () => {
      framing = false
    }
    publishRanges(controls, currentFit())
    controls.addEventListener('update', follow)
    controls.addEventListener('rest', settled)
    controls.addEventListener('sleep', settled)
    canvas.addEventListener('pointerdown', takeOver, true)
    canvas.addEventListener('wheel', takeOver, { capture: true, passive: true })
    return () => {
      controls.removeEventListener('update', follow)
      controls.removeEventListener('rest', settled)
      controls.removeEventListener('sleep', settled)
      canvas.removeEventListener('pointerdown', takeOver, true)
      canvas.removeEventListener('wheel', takeOver, true)
    }
  }, [controls, ready, canvas])

  // While a build plays with the cinematic camera, the camera is the animation's: dragging up and
  // down only tilts it, and the wheel only zooms it (both through the panel's Tilt and Zoom, so the
  // sliders follow). Once the build has finished or stopped, the camera is free again.
  const cinematic = useAnimationStore((state) => state.cinematic)
  const locked = cinematic && (status === 'playing' || status === 'paused')
  useEffect(() => {
    if (!controls || !locked) return
    const wasEnabled = controls.enabled
    controls.enabled = false
    let dragging: { id: number; y: number; tilt: number; moved: boolean } | null = null
    let swallowClick = false
    const currentTilt = () => {
      const { tilt } = useAnimationStore.getState()
      return tilt ?? Math.round(THREE.MathUtils.radToDeg(controls.polarAngle))
    }
    const down = (event: PointerEvent) => {
      dragging = { id: event.pointerId, y: event.clientY, tilt: currentTilt(), moved: false }
      swallowClick = false
    }
    const move = (event: PointerEvent) => {
      if (!dragging || event.pointerId !== dragging.id) return
      if (Math.abs(event.clientY - dragging.y) > 4) dragging.moved = true
      // Down the screen looks from higher up, as an orbit drag does.
      const { tiltRange } = useAnimationStore.getState()
      const tilt = THREE.MathUtils.clamp(Math.round(dragging.tilt - (event.clientY - dragging.y) * 0.3), tiltRange[0], tiltRange[1])
      if (tilt !== useAnimationStore.getState().tilt) useAnimationStore.getState().setTilt(tilt)
    }
    const up = (event: PointerEvent) => {
      if (dragging && event.pointerId === dragging.id) {
        swallowClick = dragging.moved
        dragging = null
      }
    }
    // A tilt drag is not a click: the release must not select what is under the cursor.
    const click = (event: MouseEvent) => {
      if (!swallowClick) return
      swallowClick = false
      event.stopPropagation()
      event.preventDefault()
    }
    const wheel = (event: WheelEvent) => {
      event.preventDefault()
      const { zoom, setZoom, zoomRange } = useAnimationStore.getState()
      setZoom(THREE.MathUtils.clamp(Math.round(zoom * (1 - event.deltaY * 0.001) * 100) / 100, zoomRange[0], zoomRange[1]))
    }
    canvas.addEventListener('pointerdown', down)
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
    canvas.addEventListener('wheel', wheel, { passive: false })
    window.addEventListener('click', click, true)
    return () => {
      window.removeEventListener('click', click, true)
      controls.enabled = wasEnabled
      canvas.removeEventListener('pointerdown', down)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
      canvas.removeEventListener('wheel', wheel)
    }
  }, [controls, locked, canvas])

  // Unmounting (a new project, a crash fallback) must never leave the house half built.
  useEffect(() => () => {
    if (runRef.current) restore(runRef.current)
    runRef.current = null
  }, [])

  // Priority 0 runs before Pascal's render (priority 1), so every frame draws the pose it set.
  const lastFrameRef = useRef(0)
  useFrame(() => {
    const run = runRef.current
    const now = performance.now()
    // Wall-clock time, so a frame limiter or a slow GPU slows the picture, never the timeline. A
    // render (`FrameRecorder`) steps the clock itself, exactly one video frame at a time.
    const fixed = renderClock.step
    const dt = fixed !== null ? fixed : lastFrameRef.current ? Math.min((now - lastFrameRef.current) / 1000, 0.25) : 1 / 60
    lastFrameRef.current = fixed !== null ? 0 : now
    if (!run) return
    const state = useAnimationStore.getState()
    const previous = run.time
    let jumped = false
    if (state.seekTo !== null) {
      run.time = THREE.MathUtils.clamp(state.seekTo, 0, run.timeline.duration)
      useAnimationStore.setState({ seekTo: null })
      jumped = true
    } else if (state.status === 'playing') {
      run.time += dt * state.speed
    }
    run.clock += dt

    applyPoses(run, run.time)
    handBackBatches(run)
    applyNoir(run, run.time)
    updateCamera(run, controls, state.cinematic)
    const caption = captionAt(run.timeline, run.time)
    if (caption !== run.caption) {
      run.caption = caption
      useAnimationStore.setState({ caption: caption ? { title: caption.title, sub: caption.sub ?? null, key: `${caption.start}` } : null })
    }

    // Dust where pieces arrive, only while playing forward (a scrub shows no dust storm).
    if (!jumped && state.status === 'playing' && run.time > previous) {
      for (const entry of run.elements) {
        if (entry.arrival > previous && entry.arrival <= run.time) {
          const track = run.timeline.tracks.get(entry.element.id)
          if (track?.dust) run.dust.puff(entry.element.box, track.dust, run.clock)
        }
      }
    }
    run.dust.update(run.clock, dt)
    run.lines?.update(run.time)
    run.waves?.update(run.time)

    if (state.status === 'playing' && state.cinematic && !run.cameraTaken && controls) {
      controls.rotate((run.timeline.orbit / run.timeline.duration) * dt * state.speed, 0, false)
    }

    if (Math.abs(state.time - run.time) > 1 / 30) useAnimationStore.setState({ time: run.time })
    if (state.status === 'playing' && run.time >= run.timeline.duration) {
      useAnimationStore.setState({ time: run.timeline.duration, status: 'finished' })
    }
    invalidate()
  })

  // The Noir look (the Home Assistant viewer's wireframe) for the templates that ask for it, while
  // the curtain has it switched in (`LookCurtain`).
  const noir = useNoirActive() && ready
  return (
    <>
      {/* Gets the heavy animations ready while the project is on screen. */}
      <Precompiler ready={ready} source={source} />
      {/* Renders a build to a video, frame by frame, when the Render dialog asks. */}
      <FrameRecorder />
      {noir && <NoirLook source={source} />}
    </>
  )
}

/**
 * Whether the Noir look is drawn now (switched in behind the curtain). The viewer turns Pascal's
 * daylight off then, as the Home Assistant viewer does, so the sky and the day's ground give way to
 * the Noir background and its grey glow.
 */
export function useNoirActive(): boolean {
  return useAnimationStore((state) => state.appliedLook === 'noir')
}

/** Whether the build wants the Noir look: a Noir template playing or paused (not once it ends). */
export function useNoirWanted(): boolean {
  return useAnimationStore((state) =>
    (state.status === 'playing' || state.status === 'paused') && templateById(state.template).look === 'noir')
}
