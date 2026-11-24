import { type ThreeEvent, useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  type AnimationAction,
  type AnimationClip,
  AnimationMixer,
  type Box3,
  DoubleSide,
  type Intersection,
  Line,
  LoopOnce,
  type Material,
  Mesh,
  type Object3D,
  Quaternion,
  type Texture,
} from 'three'
import { type SceneGraph, zoneArea } from '../pascal'
import { GLAZING_LAYER, inkMaterials, OBJECT_LAYER, OWN_INK_LAYER } from './InkPass'
import { createGltfLoader } from './loaders'
import { FIT_MARGIN } from './AxoControls'
import { measure } from './measure'
import { RoomTagProjector } from './RoomTagProjector'
import { FURNITURE_KINDS } from '../spaces'
import { navigation } from './navigation'
import {
  applyLevelVisibility,
  firstVisibleHit,
  focusBounds,
  highlightAt,
  indexScene,
  kindOf,
  NEUTRAL_KINDS,
  openableAt,
  type PascalExtras,
  roomBounds,
  type PointerHover,
  roomMembers,
  levelBounds,
  type SceneIndex,
  obstructions,
  thingName,
  type WallEntry,
  zoneAt,
  type ZoneEntry,
} from './semantics'
import {
  accentMaterial,
  clippedMaterial,
  CUT_PLANE,
  type Cutout,
  cutoutMaterial,
  ghostMaterial,
  hairlineMaterial,
  inkNormalMaterial,
  maskedMaterial,
  roleOfKind,
  ROOM_MASK,
  setRoomMask,
  STYLE,
  surfaceMaterial,
  tintMaterial,
} from './style'

export type ModelInfo = {
  /** What the camera frames (the buildings). */
  bounds: Box3
  hasOpenables: boolean
}

/** What the overlay tells the drawing, and what the drawing tells it back. Shared by both renderers. */
export type FocusProps = {
  levelId: string | null
  /** The room picked: it stays open, framed, and everything else on its floor fades. */
  selectedRoomId: string | null
  /** The item picked inside it: drawn in the accent. */
  selectedThingId: string | null
  /** Items the pointer is on in the details panel (a row of identical ones): drawn in the accent while it is. */
  pointedThingIds: readonly string[]
  /** A room the pointer is on in the spaces panel: opened as if hovered on the drawing. */
  previewRoomId: string | null
  onHover: (hover: PointerHover | null) => void
  /** A floor picked on the drawing while every floor shows: it then shows alone. */
  onSelectLevel: (id: string) => void
  onSelectRoom: (id: string) => void
  onSelectThing: (id: string | null) => void
}

/** What a drawing is made from: a baked file, or a scene captured from Pascal's runtime (`LiveScene`). */
export type ModelSource = ArrayBuffer | { scene: Object3D; animations: AnimationClip[] }

type Loaded = { scene: Object3D; animations: AnimationClip[] }

type ModelProps = FocusProps & {
  source: ModelSource
  graph: SceneGraph
  onReady: (info: ModelInfo) => void
  onError: (error: unknown) => void
}

/** Kinds outlined as objects, lighter than structure. */
const OBJECT_KINDS = new Set(['item', 'door', 'window', ...FURNITURE_KINDS])

/** How long a room stays open after the pointer leaves it, so passing over a wall doesn't flicker. */
const CLOSE_DELAY_MS = 350
/** A camera turn smaller than this (radians) is rounding, not a new view. */
const TURN_EPSILON = 1e-4

export function Model({
  source,
  graph,
  levelId,
  selectedRoomId,
  selectedThingId,
  pointedThingIds,
  previewRoomId,
  onReady,
  onError,
  onHover,
  onSelectLevel,
  onSelectRoom,
  onSelectThing,
}: ModelProps) {
  const gl = useThree((state) => state.gl)
  const camera = useThree((state) => state.camera)
  const invalidate = useThree((state) => state.invalidate)
  const [gltf, setGltf] = useState<Loaded | null>(null)

  useEffect(() => {
    let cancelled = false
    const { loader, dispose } = createGltfLoader(gl)
    // Work on a copy: the source outlives this effect (StrictMode runs it twice in development),
    // the loaders may hand buffers to workers, and drawing changes the scene in place.
    const loaded: Promise<Loaded> =
      source instanceof ArrayBuffer
        ? loader.parseAsync(source.slice(0), '')
        : Promise.resolve(cloneLive(source))
    loaded
      .then((result) => {
        if (cancelled) {
          disposeMaterials(new Set(materialsOf(result.scene)))
          return
        }
        drawAsLines(result.scene)
        setGltf(result)
      })
      .catch((error) => !cancelled && onError(error))
    return () => {
      cancelled = true
      dispose()
    }
  }, [source, gl, onError])

  const index = useMemo(
    () => (gltf ? indexScene(gltf.scene, graph, gltf.animations) : null),
    [gltf, graph],
  )
  const mixer = useMemo(() => (gltf ? new AnimationMixer(gltf.scene) : null), [gltf])
  const zonesById = useMemo(() => new Map(index?.zones.map((zone) => [zone.id, zone])), [index])
  const locateZone = useMemo(
    () => (id: string) => {
      const zone = zonesById.get(id)
      return zone ? { object: zone.object, floor: zone.floor } : null
    },
    [zonesById],
  )
  // Every Pascal identity in the file, by graph id: what the overlay's ids point at.
  const things = useMemo(() => {
    const byId = new Map<string, Object3D>()
    gltf?.scene.traverse((object) => {
      const id = (object.userData as PascalExtras).pascalId
      if (id && !byId.has(id)) byId.set(id, object)
    })
    return byId
  }, [gltf])
  const open = useRef(new Map<string, boolean>())
  const playing = useRef(new Set<AnimationAction>())
  // The accent: the thing under the pointer, the one pointed at in the details panel, the one picked.
  const hovered = useRef<Object3D | null>(null)
  const painted = useRef(new Set<Object3D>())
  const handled = useRef<Event | null>(null)
  // The room cutaway: the open room, the walls cut in front of it, and the view they were
  // chosen for.
  const opened = useRef<{ room: ZoneEntry | null; walls: Set<WallEntry>; view: Quaternion }>({
    room: null,
    walls: new Set(),
    view: new Quaternion(),
  })
  const closing = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  // The selected room: kept open whatever the pointer does; the rest of its level fades.
  const selected = useRef<ZoneEntry | null>(null)
  const ghosts = useRef(new Set<Mesh>())
  // Faded things that stand between the selected room and the camera: hidden outright.
  const hidden = useRef(new Set<Mesh>())
  // The camera's turn last frame, to wait for it to settle before looking again.
  const lastView = useRef(new Quaternion())
  const level = useRef(levelId)
  level.current = levelId
  // The room the pointer is on, and the one a Spaces row or a tag points at: tinted.
  const pointerRoom = useRef<ZoneEntry | null>(null)
  const previewRoom = useRef<ZoneEntry | null>(null)
  const framedLevel = useRef<string | null | undefined>(undefined)
  // The floor the pointer is on while every floor shows: washed with the hover colour.
  const pointerLevel = useRef<string | null>(null)
  const levelMeshes = useMemo(() => (index ? meshesByLevel(index) : new Map<string, Mesh[]>()), [index])

  /**
   * Opens a room: cuts the walls that stand between it and the camera, and, when it is the
   * selected room, hides the faded things in the way too. `null` closes it.
   */
  const openRoom = (room: ZoneEntry | null) => {
    clearTimeout(closing.current)
    closing.current = undefined
    if (!index) return
    const state = opened.current
    const sees = room && navigation.projection !== 'plan'
    const inTheWay = sees
      ? obstructions(index, room, camera, room === selected.current ? ghosts.current : [])
      : { walls: new Set<WallEntry>(), things: new Set<Object3D>() }
    const walls = inTheWay.walls
    const hide = new Set<Mesh>()
    for (const mesh of ghosts.current) {
      if (inTheWay.things.has(index.meshes.get(mesh)?.anchor ?? mesh)) hide.add(mesh)
    }
    for (const mesh of hidden.current) if (!hide.has(mesh)) setHidden(mesh, false)
    for (const mesh of hide) setHidden(mesh, true)
    hidden.current = hide
    const height = room ? room.floor + STYLE.cutHeight : CUT_PLANE.constant
    const moved = height !== CUT_PLANE.constant
    CUT_PLANE.constant = height
    for (const wall of state.walls) if (!walls.has(wall)) cut(wall, false)
    for (const wall of walls) if (moved || !state.walls.has(wall)) cut(wall, true)
    state.room = room
    state.walls = walls
    state.view.copy(camera.quaternion)
    invalidate()
  }

  /** Frames the floor shown alone, or the whole building. */
  const frameLevel = (id: string | null) => {
    if (!index) return
    const box = id ? levelBounds(index, id) : null
    if (box) navigation.focus(box, FIT_MARGIN)
    else navigation.fit()
  }

  /**
   * Fades everything on the room's level that isn't part of it; `null` brings it all back. Walls
   * and floors run on into the next rooms, so they fade by the room's mask instead, past its
   * outline: they count as faded only when no part of them is the room's.
   */
  const focusRoom = (room: ZoneEntry | null) => {
    if (!index) return
    const members = room ? roomMembers(index, room) : null
    const next = new Set<Mesh>()
    const shared = new Set<Mesh>()
    if (room && members) {
      for (const [mesh, info] of index.meshes) {
        if (room.levelId !== null && info.levelId !== null && info.levelId !== room.levelId) continue
        if (drawnOf(mesh)?.structure) {
          if (members.has(mesh) || info.kind === 'slab' || info.kind === 'zone') shared.add(mesh)
          else next.add(mesh)
          continue
        }
        if (members.has(mesh) || (info.kind && NEUTRAL_KINDS.has(info.kind))) continue
        next.add(mesh)
      }
    }
    setRoomMask(ROOM_MASK.focus, room?.outline ?? null)
    for (const [mesh] of index.meshes) setShared(mesh, shared.has(mesh))
    for (const mesh of ghosts.current) if (!next.has(mesh)) setGhost(mesh, false)
    for (const mesh of next) if (!ghosts.current.has(mesh)) setGhost(mesh, true)
    ghosts.current = next
    syncTint()
    invalidate()
  }

  /** Tints the floor of the room pointed at (on the drawing, a tag or a Spaces row), not the selected one. */
  const syncTint = () => {
    const room = previewRoom.current ?? pointerRoom.current
    const outline = room && room !== selected.current ? room.outline : null
    if ((outline?.length ?? 0) === 0 && ROOM_MASK.hover.count === 0) return
    setRoomMask(ROOM_MASK.hover, outline)
    invalidate()
  }

  const pointAt = (room: ZoneEntry | null) => {
    if (pointerRoom.current === room) return
    pointerRoom.current = room
    syncTint()
  }

  /** Washes the floor pointed at while every floor shows; `null` takes it off. */
  const tintLevel = (id: string | null) => {
    if (pointerLevel.current === id) return
    for (const mesh of levelMeshes.get(pointerLevel.current ?? '') ?? []) setTint(mesh, false)
    for (const mesh of levelMeshes.get(id ?? '') ?? []) setTint(mesh, true)
    pointerLevel.current = id
    invalidate()
  }

  const closeSoon = () => {
    if (selected.current) return
    if (closing.current !== undefined || !opened.current.room) return
    closing.current = setTimeout(() => openRoom(null), CLOSE_DELAY_MS)
  }

  useEffect(() => {
    if (!gltf) return
    const scene = gltf.scene
    return () => {
      clearTimeout(closing.current)
      releaseInk(scene)
      setRoomMask(ROOM_MASK.focus, null)
      setRoomMask(ROOM_MASK.hover, null)
    }
  }, [gltf])

  useEffect(() => {
    if (!(gltf && index)) return
    onReady({
      bounds: focusBounds(gltf.scene),
      hasOpenables: index.hasOpenables,
    })
  }, [gltf, graph, index, onReady])

  useEffect(() => {
    if (!index) return
    tintLevel(null)
    openRoom(selected.current)
    applyLevelVisibility(index, levelId)
    // A floor change eases the camera onto that floor (not on the first frame: the controls frame it).
    if (framedLevel.current !== undefined && framedLevel.current !== levelId) frameLevel(levelId)
    framedLevel.current = levelId
    invalidate()
    // openRoom reads refs, the camera and the index.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, levelId, invalidate])

  // Selecting a room keeps it open, fades the rest and frames it; deselecting undoes both.
  useEffect(() => {
    if (!index) return
    const room = selectedRoomId ? (index.zones.find((zone) => zone.id === selectedRoomId) ?? null) : null
    const was = selected.current
    selected.current = room
    focusRoom(room)
    openRoom(room)
    const box = room && roomBounds(room)
    if (box) navigation.focus(box)
    else if (was) frameLevel(level.current)
    // openRoom and focusRoom read refs, the camera and the index.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, selectedRoomId])

  useEffect(
    () => () => {
      mixer?.stopAllAction()
    },
    [mixer],
  )

  /** Paints the accent on what is hovered, pointed at or picked, and takes it off the rest. */
  const syncAccent = () => {
    const next = new Set<Object3D>()
    for (const root of [
      hovered.current,
      ...pointedThingIds.map((id) => things.get(id)),
      selectedThingId ? things.get(selectedThingId) : undefined,
    ]) {
      if (root) next.add(root)
    }
    const before = painted.current
    if (next.size === before.size && [...next].every((root) => before.has(root))) return
    for (const root of before) if (!next.has(root)) paint(root, false)
    // Repaint them all: taking the accent off a table takes it off the vase on it too.
    for (const root of next) paint(root, true)
    painted.current = next
    invalidate()
  }

  useEffect(() => {
    syncAccent()
    // syncAccent reads refs and these ids.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [things, pointedThingIds, selectedThingId])

  // A room pointed at in the spaces panel opens as if hovered, when nothing is selected.
  useEffect(() => {
    if (!index) return
    const room = previewRoomId ? index.zones.find((zone) => zone.id === previewRoomId) : undefined
    const shown = room && (levelId === null || room.levelId === null || room.levelId === levelId) ? room : null
    previewRoom.current = shown
    syncTint()
    if (selected.current) return
    if (shown) openRoom(shown)
    else closeSoon()
    // openRoom and closeSoon read refs, the camera and the index.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, previewRoomId, levelId])

  // The canvas renders on demand; keep frames coming only while a clip moves. An open room
  // follows the camera: turning the view (or switching to plan) picks its walls again.
  useFrame((_, delta) => {
    // Rays are cast once the camera has settled, not on every frame of a turn.
    const state = opened.current
    // The eased camera's turn jitters in the last digits; only a real turn counts.
    const settled = lastView.current.angleTo(camera.quaternion) < TURN_EPSILON
    lastView.current.copy(camera.quaternion)
    if (state.room && state.view.angleTo(camera.quaternion) > TURN_EPSILON) {
      if (settled) openRoom(state.room)
      else invalidate()
    }
    if (!mixer || playing.current.size === 0) return
    mixer.update(delta)
    for (const action of playing.current) if (!action.isRunning()) playing.current.delete(action)
    invalidate()
  })

  if (!(gltf && index && mixer)) return null

  const highlight = (next: Object3D | null) => {
    if (hovered.current === next) return
    hovered.current = next
    syncAccent()
  }

  /**
   * The item, door or window under a hit, only inside the selected room: until a room is
   * picked, the drawing answers in rooms alone.
   */
  const thingAt = (hit: Intersection | null) =>
    hit && selected.current && !ghosts.current.has(hit.object as Mesh) ? highlightAt(hit, graph) : null

  // R3F calls these once per mesh under the pointer, all bubbling to this one object; each
  // handles a native event once. (Not stopPropagation: with every mesh sharing this object, it
  // drops R3F's hover record when the pointer crosses between meshes, and leaving the model
  // then never fires pointerout, so the highlight would stick.)
  const firstTime = (event: Event) => {
    if (handled.current === event) return false
    handled.current = event
    return true
  }

  /** The room under a hit, only on the floor shown alone, if one is. */
  const roomOnLevel = (hit: Intersection) => {
    const room = zoneAt(index, graph, hit)
    return room && (levelId === null || room.levelId === null || room.levelId === levelId) ? room : null
  }

  /** With every floor shown (and floors to go into), hover and clicks pick floors, not rooms. */
  const floorsFirst = levelId === null && levelMeshes.size > 0

  /** The level the hit mesh is on: a wall names its floor, the roof its roof level; the site none. */
  const floorAt = (hit: Intersection) => index.meshes.get(hit.object as Mesh)?.levelId ?? null

  const handleMove = (event: ThreeEvent<PointerEvent>) => {
    if (!firstTime(event.nativeEvent)) return
    // Orbiting or panning: leave the drawing alone.
    if (event.buttons) return
    // Measuring: the tool owns the pointer.
    if (measure.state.active) {
      highlight(null)
      pointAt(null)
      tintLevel(null)
      closeSoon()
      onHover(null)
      return
    }
    const hit = firstVisibleHit(event.intersections)
    // Every floor shown: the drawing answers in floors, and a click goes into one.
    if (floorsFirst) {
      const floor = hit ? floorAt(hit) : null
      tintLevel(floor)
      gl.domElement.style.cursor = floor ? 'pointer' : ''
      onHover(floor ? { kind: 'level', id: floor, label: '', x: event.clientX, y: event.clientY } : null)
      return
    }
    const room = hit ? roomOnLevel(hit) : null
    pointAt(room)
    const thing = thingAt(hit)
    gl.domElement.style.cursor = thing ? 'pointer' : ''
    highlight(thing)
    if (selected.current) {
      // A selected room stays open; hover only names the others.
    } else if (room) {
      if (room !== opened.current.room || closing.current !== undefined) openRoom(room)
    } else {
      closeSoon()
    }
    const at = { x: event.clientX, y: event.clientY }
    // The tag names the thing under the pointer, else another room (the picked one needs none).
    onHover(
      thing
        ? { label: thingName(graph, thing), kind: 'thing', ...at }
        : room && room !== selected.current
          ? { id: room.id, label: room.label, area: zoneArea(room), kind: 'room', ...at }
          : null,
    )
  }

  const handleClick = (event: ThreeEvent<MouseEvent>) => {
    if (!firstTime(event.nativeEvent)) return
    if (event.delta > 4) return // an orbit drag, not a click
    if (measure.state.active) return
    const hit = firstVisibleHit(event.intersections)
    if (floorsFirst) {
      const floor = hit ? floorAt(hit) : null
      if (floor) onSelectLevel(floor)
      return
    }
    const thing = thingAt(hit)
    const target = thing && hit && openableAt(index, hit)
    if (!target) {
      const room = hit && roomOnLevel(hit)
      // Inside the picked room: pick the item, or drop it on a click on the floor.
      if (thing) onSelectThing((thing.userData as PascalExtras).pascalId ?? null)
      else if (room && room !== selected.current) onSelectRoom(room.id)
      else if (room) onSelectThing(null)
      return
    }
    const willOpen = !open.current.get(target.id)
    open.current.set(target.id, willOpen)
    const action = mixer.clipAction(target.clip)
    action.setLoop(LoopOnce, 1)
    action.clampWhenFinished = true
    action.timeScale = willOpen ? 1 : -1
    action.paused = false
    action.play()
    playing.current.add(action)
    invalidate()
  }

  return (
    <>
      <RoomTagProjector locate={locateZone} />
      <primitive
        object={gltf.scene}
        onClick={handleClick}
        onPointerMove={handleMove}
        onPointerOut={() => {
          gl.domElement.style.cursor = ''
          highlight(null)
          pointAt(null)
          tintLevel(null)
          closeSoon()
          onHover(null)
        }}
      />
    </>
  )
}

/** What a mesh is drawn with, and what hover, the cutaway and selection currently do to it. */
type Drawn = {
  surface: Material | Material[]
  /** Its layers when the ink needs nothing of its own: default or glazing. */
  layers: number
  glazing: boolean
  /** A leaf: the texture whose alpha cuts its outline. */
  cutout?: Cutout
  accent: boolean
  cut: boolean
  ghost: boolean
  /** A wall or floor: room masks apply to it (`maskedMaterial`). Floors always take the hover tint. */
  structure: 'wall' | 'floor' | null
  /** Shared with the selected room: in focus inside its outline, faded beyond it. */
  shared: boolean
  /** In front of the selected room: not drawn, not hit. */
  hidden: boolean
  /** The site (ground, parcel): inked lightly. */
  soft: boolean
  /** Furniture, a door or a window: outlined lighter than structure (`OBJECT_LAYER`). */
  object: boolean
  /** On the floor pointed at while every floor shows: washed with the hover colour. */
  tint: boolean
}

const drawnOf = (mesh: Mesh) => (mesh.userData as { drawn?: Drawn }).drawn

const each = (material: Material | Material[], map: (material: Material) => Material) =>
  Array.isArray(material) ? material.map(map) : map(material)

/**
 * Applies a mesh's state: its tone, faded or not, the accent, the cut, and the layers and
 * normal-pass material the ink then needs. The only place a drawn mesh's material changes.
 */
function refresh(mesh: Mesh) {
  const drawn = drawnOf(mesh)
  if (!drawn) return
  let material = drawn.surface
  const structure = drawn.structure
  if (structure && (structure === 'floor' || drawn.shared)) {
    material = each(material, (surface) => maskedMaterial(surface, structure))
  }
  if (drawn.ghost && !drawn.glazing) material = each(material, ghostMaterial)
  if (drawn.tint && !drawn.glazing && !drawn.cutout) material = each(material, tintMaterial)
  if (drawn.accent && !drawn.glazing) material = each(material, accentMaterial)
  if (drawn.cut) material = each(material, clippedMaterial)
  mesh.material = material
  const userData = mesh.userData as { cutAbove?: number }
  if (drawn.cut) userData.cutAbove = CUT_PLANE.constant
  else delete userData.cutAbove
  if (drawn.hidden) {
    mesh.layers.disableAll()
    inkMaterials.delete(mesh)
    return
  }
  // Floors always bring their own: they tag the room pointed at, whose edge inks in the accent.
  const floor = structure === 'floor'
  const ownInk = !drawn.glazing && (floor || drawn.cut || drawn.ghost || drawn.shared || drawn.soft || drawn.cutout)
  if (ownInk) {
    mesh.layers.set(OWN_INK_LAYER)
    inkMaterials.set(
      mesh,
      inkNormalMaterial({ clipped: drawn.cut, ghost: drawn.ghost, soft: drawn.soft, object: drawn.object, masked: floor ? 'floor' : (drawn.shared && structure) || false, cutout: drawn.cutout }),
    )
  } else {
    mesh.layers.mask = drawn.layers
    inkMaterials.delete(mesh)
  }
}

function setHidden(mesh: Mesh, hidden: boolean) {
  const drawn = drawnOf(mesh)
  if (!drawn || drawn.hidden === hidden) return
  drawn.hidden = hidden
  refresh(mesh)
}

function setShared(mesh: Mesh, shared: boolean) {
  const drawn = drawnOf(mesh)
  if (!drawn || drawn.shared === shared) return
  drawn.shared = shared
  refresh(mesh)
}

function setTint(mesh: Mesh, tint: boolean) {
  const drawn = drawnOf(mesh)
  if (!drawn || drawn.tint === tint) return
  drawn.tint = tint
  refresh(mesh)
}

/** The meshes of each level (a floor, a roof), for the wash that marks the one pointed at. */
function meshesByLevel(index: SceneIndex): Map<string, Mesh[]> {
  const groups = new Map<string, Mesh[]>()
  for (const [mesh, info] of index.meshes) {
    if (info.levelId === null) continue
    const list = groups.get(info.levelId) ?? []
    list.push(mesh)
    groups.set(info.levelId, list)
  }
  return groups
}

function setGhost(mesh: Mesh, ghost: boolean) {
  const drawn = drawnOf(mesh)
  if (!drawn || drawn.ghost === ghost) return
  drawn.ghost = ghost
  refresh(mesh)
}

/**
 * Throws away the file's materials and textures: every surface becomes a flat tone for its
 * role (wall, floor, joinery, furnishing…). See-through ones move to the glazing layer so the
 * ink passes through them; textured cutouts (leaves) keep their texture's alpha, so each leaf
 * keeps its outline.
 */
function drawAsLines(root: Object3D) {
  const kept = new Set<Texture>()
  const originals = new Set<Material>()
  root.traverse((object) => {
    // Lines the file draws itself (the site's property line, in Pascal's amber): a light hairline
    // in the ink, kept out of the ink's normal pass so the ink doesn't trace them again.
    if (object instanceof Line) {
      for (const material of [object.material].flat()) originals.add(material)
      object.material = hairlineMaterial()
      object.layers.set(GLAZING_LAYER)
      // Nothing to point at, and a line's pick reaches a metre either side.
      object.raycast = () => {}
      return
    }
    if (!(object instanceof Mesh)) return
    const kind = kindOf(object)
    const role = roleOfKind(kind)
    const materials: Material[] = Array.isArray(object.material) ? object.material : [object.material]
    for (const material of materials) originals.add(material)
    const glazing = materials.some((material) => material.transparent && material.opacity < 0.95)
    const first = materials[0]!
    const map = (first as { map?: Texture | null }).map
    // Leaves are textured planes, and bakes may export them opaque: a double-sided textured
    // surface is treated as a cutout too (a texture without alpha then simply draws whole).
    const cutout =
      !glazing &&
      materials.length === 1 &&
      !!map &&
      (first.alphaTest > 0 || first.transparent || first.side === DoubleSide)
    const drawn: Drawn = {
      surface: first,
      layers: 1,
      glazing,
      accent: false,
      cut: false,
      ghost: false,
      hidden: false,
      structure: glazing || cutout ? null : kind === 'wall' ? 'wall' : kind === 'slab' || kind === 'zone' ? 'floor' : null,
      shared: false,
      soft: kind === 'site',
      object: !glazing && !cutout && !!kind && OBJECT_KINDS.has(kind),
      tint: false,
    }
    if (drawn.object) drawn.layers = 1 << OBJECT_LAYER
    if (cutout && map) {
      const alphaTest = first.alphaTest > 0 ? first.alphaTest : 0.5
      kept.add(map)
      drawn.surface = cutoutMaterial(STYLE.surfaces[role], map, alphaTest, first.side)
      drawn.cutout = { map, alphaTest }
    } else {
      const surfaces = materials.map((material) => surfaceMaterial(glazing ? 'glazing' : role, material.side))
      drawn.surface = Array.isArray(object.material) ? surfaces : surfaces[0]!
      if (glazing) drawn.layers = 1 << GLAZING_LAYER
    }
    ;(object.userData as { drawn?: Drawn }).drawn = drawn
    object.castShadow = false
    object.receiveShadow = false
    refresh(object)
  })
  disposeMaterials(originals, kept)
}

/** Fills an item, door or window with the accent colour, or gives it back its tone. */
function paint(root: Object3D, accent: boolean) {
  root.traverse((object) => {
    const drawn = object instanceof Mesh ? drawnOf(object) : undefined
    if (!drawn) return
    drawn.accent = accent
    refresh(object as Mesh)
  })
}

/** Cuts a wall (and what is set in it) open at `CUT_PLANE`, or closes it again. */
function cut(wall: WallEntry, open: boolean) {
  for (const mesh of wall.meshes) {
    const drawn = drawnOf(mesh)
    if (!drawn) continue
    drawn.cut = open
    refresh(mesh)
  }
}

/** Forgets a scene's meshes in the ink's own-material list. */
function releaseInk(root: Object3D) {
  root.traverse((object) => {
    if (object instanceof Mesh) inkMaterials.delete(object)
  })
}

/** The file's own materials are never shown; free them, and every texture no cutout keeps. */
function disposeMaterials(materials: Iterable<Material>, kept: Set<Texture> = new Set()) {
  for (const material of materials) {
    if (material.userData.drawing) continue
    for (const value of Object.values(material)) {
      if (value && typeof value === 'object' && 'isTexture' in value && !kept.has(value as Texture)) {
        ;(value as Texture).dispose()
      }
    }
    material.dispose()
  }
}

/** Every material in a scene, for disposal. */
function materialsOf(root: Object3D): Material[] {
  const materials: Material[] = []
  root.traverse((object) => {
    if (object instanceof Mesh) materials.push(...(Array.isArray(object.material) ? object.material : [object.material]))
  })
  return materials
}

/**
 * A copy of a captured scene and its clips. The clips name their tracks by the parts' uuids (as
 * Pascal's exporter does before writing a file), and a clone has new ones: point them at the copy.
 */
function cloneLive(source: { scene: Object3D; animations: AnimationClip[] }): Loaded {
  const scene = source.scene.clone(true)
  const uuids = new Map<string, string>()
  const walk = (from: Object3D, to: Object3D) => {
    uuids.set(from.uuid, to.uuid)
    from.children.forEach((child, i) => walk(child, to.children[i]!))
  }
  walk(source.scene, scene)
  const animations = source.animations.map((clip) => {
    const copy = clip.clone()
    for (const track of copy.tracks) {
      const dot = track.name.indexOf('.')
      const target = uuids.get(track.name.slice(0, dot))
      if (target) track.name = target + track.name.slice(dot)
    }
    return copy
  })
  return { scene, animations }
}
