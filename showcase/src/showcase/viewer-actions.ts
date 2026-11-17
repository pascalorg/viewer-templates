import { emitter, EXPLODED_GAP, getLevelElevations, type AnyNode } from '@pascal-app/core'
import { resolveLocation, sectionBounds, useViewer, type WallMode } from '@pascal-app/viewer'
import type { ViewerSource } from '@pascal-app/viewer/ui'
import { Box3, type Object3D, Vector3 } from 'three'
import { boxCorners, fitPoints, safeArea, type SafeArea, type Vec3 } from './framing'
import { houseFront } from './front'
import { placeCamera } from './presentation'
import { INTRO_ORBIT_DEGREES, introAzimuth, introCameraPose, introSectionPosition, type IntroFrame } from './intro'
import { firstXrayFamily } from './families'
import { setMoodNow } from './time'
import { walkingByTouch } from './touch'
import { cutEntryPosition, cutRange, defaultView, type CutRange, type ModeId, type MoodId } from './modes'

/** Every dial control ends here: one function per choice, all through the public viewer store. */

type Nodes = Readonly<Record<string, AnyNode>>
type Axis = 'x' | 'y' | 'z'

/** What the actions need to know about the scene on screen. */
export type SceneContext = {
  /** The published graph. */
  nodes: Nodes
  /** The scene the chrome frames: the published graph over a bake, or the live store. */
  source: ViewerSource
  /** The bake's objects by Pascal id; omitted for a live scene (the registry is used). */
  bakedObjects?: ReadonlyMap<string, Object3D>
  /** The X-ray families the published graph has, in display order (`sceneFamilies`). */
  families: readonly string[]
}

/** The model's unclipped bounds, as plain numbers (the viewer's box is a shared cache). */
export function modelBounds(context: SceneContext): { min: Vector3; max: Vector3 } | null {
  const box = context.bakedObjects ? sectionBounds(context.bakedObjects) : sectionBounds()
  return box ? { min: box.min.clone(), max: box.max.clone() } : null
}

const AXIS_INDEX = { x: 0, y: 1, z: 2 } as const
export function axisRange(bounds: { min: Vector3; max: Vector3 }, axis: Axis): CutRange {
  return cutRange(bounds.min.getComponent(AXIS_INDEX[axis]), bounds.max.getComponent(AXIS_INDEX[axis]))
}

/** World Y of the lowest floor, from the levels' stacked elevations. */
function lowestFloorY(nodes: Nodes): number | null {
  const elevations = [...getLevelElevations(nodes as Record<string, AnyNode>).values()].map((level) => level.baseY)
  return elevations.length ? Math.min(...elevations) : null
}

// What the house looked like before the Cut view or X-ray assembled it, for when they end.
let beforeOverlay: { levelMode: 'stacked' | 'exploded' | 'solo' | 'manual'; wallMode: WallMode } | null = null

/** Cut view and X-ray both show the house assembled; the first of them to open keeps what it was. */
function assemble() {
  const viewer = useViewer.getState()
  if (!viewer.sectionEnabled && viewer.xrayFamily === null) beforeOverlay = { levelMode: viewer.levelMode, wallMode: viewer.wallMode }
  viewer.setWalkthroughMode(false)
  viewer.setLevelMode('stacked')
  viewer.setWallMode('up')
}

function enterCut(context: SceneContext) {
  const viewer = useViewer.getState()
  assemble()
  viewer.setXrayFamily(null)
  viewer.setSectionAxis('y')
  viewer.setSectionFlipped(false)
  const bounds = modelBounds(context)
  if (bounds) viewer.setSectionPosition(cutEntryPosition(lowestFloorY(context.nodes) ?? bounds.min.y, bounds.min.y, bounds.max.y))
  viewer.setSectionEnabled(true)
}

function enterXray(context: SceneContext) {
  const viewer = useViewer.getState()
  assemble()
  viewer.setSectionEnabled(false)
  viewer.setXrayFamily(firstXrayFamily(context.families))
}

/** Ends the Cut view or X-ray and puts back the presentation they replaced. */
function leaveOverlays() {
  const viewer = useViewer.getState()
  if (!viewer.sectionEnabled && viewer.xrayFamily === null) return
  viewer.setSectionEnabled(false)
  viewer.setXrayFamily(null)
  if (beforeOverlay) {
    viewer.setLevelMode(beforeOverlay.levelMode)
    viewer.setWallMode(beforeOverlay.wallMode)
    beforeOverlay = null
  }
}

/** `context` is needed to open the Cut view or X-ray (they read the model); other modes ignore it. */
export function applyMode(mode: ModeId, context?: SceneContext) {
  const viewer = useViewer.getState()
  switch (mode) {
    case 'exterior':
      leaveOverlays()
      viewer.setWalkthroughMode(false)
      viewer.setLevelMode('stacked')
      viewer.setWallMode('up')
      viewer.resetSelection()
      return
    case 'exploded':
      leaveOverlays()
      viewer.setWalkthroughMode(false)
      viewer.setLevelMode('exploded')
      return
    case 'cut':
      if (context) enterCut(context)
      return
    case 'xray':
      if (context) enterXray(context)
      return
    case 'walkthrough':
      // A walk keeps a cut (the viewer lifts it while walking, and it is back afterwards) but ends
      // X-ray: the walk shows the whole house, and nothing stays hidden after it.
      if (viewer.xrayFamily !== null) {
        viewer.setXrayFamily(null)
        if (!viewer.sectionEnabled) beforeOverlay = null
      }
      // Walk the building assembled, not under a floating roof.
      viewer.setLevelMode('stacked')
      viewer.setWalkthroughMovement('walk')
      viewer.setWalkthroughInputMode(walkingByTouch() ? 'touch' : 'desktop')
      viewer.setWalkthroughMode(true)
      return
  }
}

/** Sets the time of day at once (the dial glides through `glideToMood` instead). */
export function applyMood(mood: MoodId) {
  setMoodNow(mood)
}

export function setXrayFamily(family: string) {
  useViewer.getState().setXrayFamily(family)
}

/**
 * What the page opens on, before the first frame: no section or X-ray, dusk, and the default mode,
 * or the house assembled when the intro is about to reveal it.
 */
export function applyOpeningView(levelCount: number, { introAhead }: { introAhead: boolean }) {
  const viewer = useViewer.getState()
  viewer.setSectionEnabled(false)
  viewer.setXrayFamily(null)
  beforeOverlay = null
  applyMode(introAhead ? 'exterior' : defaultView(levelCount).mode)
  applyMood(defaultView(levelCount).mood)
}

/** The arrival view, also what Reset view returns to (with the camera, see `frameSettled`). */
export function applyDefaultView(levelCount: number, context?: SceneContext) {
  const initial = defaultView(levelCount)
  applyMode(initial.mode, context)
  applyMood(initial.mood)
  useViewer.getState().resetSelection()
}

export function setCutAxis(axis: Axis, context: SceneContext) {
  const viewer = useViewer.getState()
  const bounds = modelBounds(context)
  viewer.setSectionAxis(axis)
  if (!bounds) return
  // Each axis opens where it shows most: through the ground floor on Y, mid-model across.
  const range = axisRange(bounds, axis)
  viewer.setSectionPosition(axis === 'y'
    ? cutEntryPosition(lowestFloorY(context.nodes) ?? bounds.min.y, bounds.min.y, bounds.max.y)
    : (range.low + range.high) / 2)
}

export function setCutFlipped(flipped: boolean) {
  useViewer.getState().setSectionFlipped(flipped)
}

/**
 * A baked scene never loads its graph into the scene store, so the sun gets the site's north and
 * location from the published graph here. Returns the cleanup.
 */
export function shareDaylightSite(nodes: Nodes): () => void {
  const site = Object.values(nodes).find((node) => node.type === 'site') as
    (Parameters<typeof resolveLocation>[0] & { northRotation?: number }) | undefined
  if (!site) return () => {}
  const { location, source } = resolveLocation(site, null)
  useViewer.getState().setDaylightSite({ northRotation: site.northRotation ?? 0, ...(source === 'site' ? location : {}) })
  return () => useViewer.getState().setDaylightSite(null)
}

// ── Framing and the intro ──────────────────────────────────────────────────

/** Points on the drawn building with its floors stacked, and the floor each one belongs to. */
type FramingSample = { points: Vec3[]; levels: (string | null)[] }
const partBox = new Box3()
const levelPosition = new Vector3()
// Framed: the building itself (walls, slabs, roofs, openings, stairs...). Not framed: helpers,
// containers, and the yard that can sit on a floor (items such as palms, fences, plugin parts
// such as pools and trees), which may run off screen.
const NOT_FRAMED = new Set(['zone', 'spawn', 'scan', 'guide', 'level', 'building', 'site', 'item', 'fence'])

/**
 * Samples what is drawn: the eight corners of each part's own box, for every part inside a floor
 * of the building. The site's ground, trees and fences are left out (they may run off screen), and
 * each part's height is taken relative to its floor, so a house measured mid-explosion still
 * yields its stacked shape. Measured each time it is asked for (the arrival, the intro, Reset view),
 * never cached: on a slow connection parts still stream in after the arrival, and Reset view must
 * frame them.
 */
function framingSample(context: SceneContext): FramingSample | null {
  const nodes = context.nodes as Record<string, AnyNode>
  const elevations = getLevelElevations(nodes)
  const sample: FramingSample = { points: [], levels: [] }
  for (const node of Object.values(nodes)) {
    if (NOT_FRAMED.has(node.type) || node.type.includes(':')) continue
    let levelId: string | null = null
    for (let parent = node.parentId ? nodes[node.parentId] : undefined; parent; parent = parent.parentId ? nodes[parent.parentId] : undefined) {
      if (parent.type === 'level') { levelId = parent.id; break }
    }
    if (!levelId) continue
    const object = context.source.objectFor(node.id)
    const level = context.source.objectFor(levelId)
    if (!object || !level) continue
    partBox.setFromObject(object)
    if (partBox.isEmpty()) continue
    level.getWorldPosition(levelPosition)
    const lift = (elevations.get(levelId)?.baseY ?? 0) - levelPosition.y
    for (const corner of boxCorners({ min: partBox.min.toArray(), max: partBox.max.toArray() })) {
      sample.points.push([corner[0], corner[1] + lift, corner[2]])
      sample.levels.push(levelId)
    }
  }
  // A bake can merge a part into its floor's batches (roof segments, for one), leaving its own
  // object nearly empty. So each floor also contributes its full height over the footprint of its
  // sampled parts: the roof's height counts even when its parts don't, the yard's width does not.
  const byLevel = new Map<string, { min: Vec3; max: Vec3 }>()
  sample.points.forEach((point, i) => {
    const id = sample.levels[i]!
    const range = byLevel.get(id) ?? { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] }
    for (let axis = 0; axis < 3; axis++) {
      range.min[axis] = Math.min(range.min[axis]!, point[axis]!)
      range.max[axis] = Math.max(range.max[axis]!, point[axis]!)
    }
    byLevel.set(id, range)
  })
  for (const [levelId, range] of byLevel) {
    const level = context.source.objectFor(levelId)
    if (!level) continue
    partBox.setFromObject(level)
    if (partBox.isEmpty()) continue
    level.getWorldPosition(levelPosition)
    const lift = (elevations.get(levelId)?.baseY ?? 0) - levelPosition.y
    const top = Math.max(range.max[1], partBox.max.y + lift)
    for (const corner of boxCorners({ min: range.min, max: [range.max[0], top, range.max[2]] })) {
      sample.points.push(corner)
      sample.levels.push(levelId)
    }
  }
  if (sample.points.length === 0) {
    // Nothing per floor to sample (an unusual graph): fall back to the model's box.
    const bounds = modelBounds(context)
    if (!bounds) return null
    sample.points = boxCorners({ min: bounds.min.toArray(), max: bounds.max.toArray() })
    sample.levels = sample.points.map(() => null)
  }
  return sample
}

/** The sampled points as the default view draws them: Exploded lifts each floor by its gap. */
function defaultViewPoints(context: SceneContext, levelCount: number, mode = defaultView(levelCount).mode): Vec3[] | null {
  const sample = framingSample(context)
  if (!sample) return null
  if (mode !== 'exploded') return sample.points
  const nodes = context.nodes as Record<string, AnyNode>
  const elevations = getLevelElevations(nodes)
  // The renderers lift a floor by its index: the level number live, its order in a bake.
  const gap = (levelId: string | null) => {
    if (!levelId) return 0
    const index = context.bakedObjects ? elevations.get(levelId)?.ordinal ?? 0 : (nodes[levelId] as { level?: number })?.level ?? 0
    return index * EXPLODED_GAP
  }
  return sample.points.map((point, i) => [point[0], point[1] + gap(sample.levels[i]!), point[2]])
}

const aspect = () => innerWidth / Math.max(1, innerHeight)

/** Where the chrome leaves room for the model; matches the layouts in `showcase.css`. */
function screenSafeArea(): SafeArea {
  const phone = matchMedia('(max-width: 600px) and (orientation: portrait)').matches
  return phone
    ? safeArea(innerWidth, innerHeight, { left: 12, right: 12, top: 80, bottom: 96 })
    : safeArea(innerWidth, innerHeight, { left: Math.min(240, innerWidth * 0.25), right: 72, top: 28, bottom: 24 })
}

/**
 * The heading the house is seen from on arrival, at the intro's end and after Reset view: its
 * front on a diagonal (`front.ts`), or the old three-quarter heading when nothing says where the
 * front is. Cached per published graph.
 */
const arrivalHeadings = new WeakMap<object, number>()
export function arrivalAzimuth(context: SceneContext) {
  let heading = arrivalHeadings.get(context.nodes)
  if (heading === undefined) {
    heading = houseFront(context.nodes).azimuth ?? Math.PI / 4
    arrivalHeadings.set(context.nodes, heading)
  }
  return heading
}

/**
 * The settled view of the default mode: the model fitted into the screen (both sizes) from the
 * arrival heading (`arrivalAzimuth`), or from `azimuth`. Camera controls are unmounted during a
 * walkthrough, so this waits two frames for them to come back.
 */
export function frameSettled(context: SceneContext | (() => SceneContext), levelCount: number, azimuth?: number,
  { instant = false, onPlaced }: {
    /** Put the camera there at once (arrival, behind the loader), not through the controls' glide. */
    instant?: boolean
    /** Called once the pose is set (or framing gave up), e.g. to lift the loader. */
    onPlaced?: () => void
  } = {}) {
  const read = typeof context === 'function' ? context : () => context
  let frames = 0
  const attempt = () => {
    // A bake reports its objects a few frames after it is drawn: wait up to a second and a half.
    const points = frames >= 2 ? defaultViewPoints(read(), levelCount) : null
    if (!points) {
      if (++frames < 90) requestAnimationFrame(attempt)
      else onPlaced?.()
      return
    }
    const { position, target } = fitPoints({ points, azimuth: azimuth ?? arrivalAzimuth(read()), aspect: aspect(), safe: screenSafeArea() })
    if (!instant || !placeCamera(position, target)) emitter.emit('camera-controls:frame', { bounds: null, pose: { position, target } })
    onPlaced?.()
  }
  requestAnimationFrame(attempt)
}

export type IntroStage = {
  /** What the camera frames: points on the stacked building. */
  points: Vec3[]
  /** The heights the plane sweeps. */
  reveal: { min: number; max: number }
  startAzimuth: number
}

/** Assembles the house and hides it below the plane; null until the model has bounds. */
export function startIntro(context: SceneContext, levelCount: number): IntroStage | null {
  // The opening view keeps the house stacked for the intro, so the model's bounds are stacked too.
  const points = defaultViewPoints(context, levelCount, 'exterior')
  const model = modelBounds(context)
  if (!points || !model) return null
  const reveal = { min: model.min.y, max: model.max.y }
  const viewer = useViewer.getState()
  viewer.setWalkthroughMode(false)
  viewer.setLevelMode('stacked')
  viewer.setWallMode('up')
  viewer.setXrayFamily(null)
  viewer.setSectionAxis('y')
  viewer.setSectionFlipped(false)
  viewer.setSectionPosition(introSectionPosition(0, reveal.min, reveal.max))
  viewer.setSectionEnabled(true)
  // The orbit ends on the arrival heading.
  return { points, reveal, startAzimuth: arrivalAzimuth(context) - (INTRO_ORBIT_DEGREES * Math.PI) / 180 }
}

/** One intro frame; `instant` places its camera at once (the first frame, behind the loader). */
export function applyIntroFrame(stage: IntroStage, frame: Pick<IntroFrame, 'reveal' | 'orbit'>, instant = false) {
  useViewer.getState().setSectionPosition(introSectionPosition(frame.reveal, stage.reveal.min, stage.reveal.max))
  if (frame.orbit === null) return
  const { position, target } = introCameraPose({ points: stage.points, startAzimuth: stage.startAzimuth, orbit: frame.orbit, aspect: aspect(), safe: screenSafeArea() })
  if (!instant || !placeCamera(position, target)) emitter.emit('camera-controls:frame', { bounds: null, pose: { position, target } })
}

/**
 * The intro's end state: no section, the default view, and the settled framing from where the
 * orbit ended (`stage`) or from the current heading. `frame: false` leaves the camera to the
 * visitor who took it.
 */
export function finishIntro(levelCount: number, context: SceneContext | (() => SceneContext), { stage = null, frame = true, instant = false, onPlaced }: {
  stage?: IntroStage | null
  frame?: boolean
  /** Behind the loader (no intro shown): set the settled view at once. */
  instant?: boolean
  onPlaced?: () => void
} = {}) {
  const read = typeof context === 'function' ? context : () => context
  useViewer.getState().setSectionEnabled(false)
  beforeOverlay = null
  applyDefaultView(levelCount, read())
  if (frame) frameSettled(read, levelCount, stage ? introAzimuth(stage.startAzimuth, 1) : undefined, { instant, onPlaced })
  else onPlaced?.()
}
