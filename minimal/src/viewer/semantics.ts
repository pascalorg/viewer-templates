import { type AnimationClip, Box3, type Camera, type Intersection, Mesh, type Object3D, Raycaster, Vector3 } from 'three'
import {
  findAncestorOfType,
  getNode,
  levelIdOf,
  type SceneGraph,
  type ZoneInfo,
  zoneContains,
  zoneInfo,
} from '../pascal'
import { FURNITURE_KINDS } from '../spaces'
import { pascalHover, pascalLabel } from './pascalRules'

/** What Pascal stamps on GLB nodes as glTF `extras` (three exposes them as `userData`). */
export type PascalExtras = {
  pascalId?: string
  kind?: string
  label?: string
  openable?: boolean
  clips?: string[]
  polygon?: [number, number][]
  color?: string
}

const extrasOf = (object: Object3D) => object.userData as PascalExtras

/** Kinds hidden while one floor is isolated, so the rooms read from above (a dollhouse). */
const CUTAWAY_KINDS = new Set(['ceiling', 'roof', 'roof-segment'])

/** The nearest object, itself included, that carries a Pascal identity. */
export function findIdentity(object: Object3D | null): Object3D | null {
  for (let current = object; current; current = current.parent) {
    if (extrasOf(current).pascalId) return current
  }
  return null
}

export type ZoneEntry = ZoneInfo & {
  object: Object3D
  label: string
  levelId: string | null
  /**
   * The world height of the room's floor surface. Pascal draws a zone at its level's base, but
   * the slab's top can stand well above it (half a metre on a raised ground floor), so this is
   * measured on the slabs under the room.
   */
  floor: number
  /** The outline in world x/z, for the drawing's room masks. */
  outline: [number, number][]
}

/** A wall with everything set in it (doors, windows): what the room cutaway cuts together. */
export type WallEntry = { id: string; levelId: string | null; box: Box3; meshes: Mesh[] }

export type MeshInfo = {
  levelId: string | null
  cutaway: boolean
  /** The Pascal kind it is part of. */
  kind: string | undefined
  /** The thing it belongs to as a whole (an item, a door…), or itself: what a room contains. */
  anchor: Object3D
}

export type SceneIndex = {
  meshes: Map<Mesh, MeshInfo>
  zones: ZoneEntry[]
  walls: WallEntry[]
  /** The wall each of its meshes belongs to. */
  wallOf: Map<Mesh, WallEntry>
  clips: Map<string, AnimationClip>
  hasOpenables: boolean
}

/** The level an identity belongs to: from the graph, else from the GLB hierarchy. */
function levelOf(graph: SceneGraph, identity: Object3D): string | null {
  const id = extrasOf(identity).pascalId!
  if (getNode(graph, id)) return levelIdOf(graph, id)
  for (let current: Object3D | null = identity; current; current = current.parent) {
    const extras = extrasOf(current)
    if (extras.kind === 'level' && extras.pascalId) return extras.pascalId
  }
  return null
}

function isCutaway(identity: Object3D | null): boolean {
  for (let current = identity; current; current = findIdentity(current.parent)) {
    const kind = extrasOf(current).kind
    if (kind === 'level') return false
    if (kind && CUTAWAY_KINDS.has(kind)) return true
  }
  return false
}

export function indexScene(root: Object3D, graph: SceneGraph, clips: AnimationClip[]): SceneIndex {
  const index: SceneIndex = {
    meshes: new Map(),
    zones: [],
    walls: [],
    wallOf: new Map(),
    clips: new Map(clips.map((clip) => [clip.name, clip])),
    hasOpenables: false,
  }
  root.traverse((object) => {
    const extras = extrasOf(object)
    if (extras.openable) index.hasOpenables = true
    if (object instanceof Mesh) {
      const identity = findIdentity(object)
      index.meshes.set(object, {
        levelId: identity ? levelOf(graph, identity) : null,
        cutaway: isCutaway(identity),
        kind: kindOf(object),
        anchor: anchorOf(object),
      })
    }
    if (extras.kind === 'zone' && extras.pascalId) {
      const node = getNode(graph, extras.pascalId) ?? {
        id: extras.pascalId,
        type: 'zone',
        name: extras.label,
      }
      const zone = zoneInfo(node, extras)
      if (zone) {
        index.zones.push({
          ...zone,
          object,
          label: zone.name ?? extras.label ?? 'Room',
          levelId: levelOf(graph, object),
          floor: 0,
          outline: [],
        })
      }
    }
  })
  indexWalls(index, root, graph)
  measureFloors(index)
  return index
}

/** Kinds a room's floor surface is made of: the slab, and the finish Pascal lays in the zone. */
const FLOOR_KINDS = new Set(['slab', 'zone'])
/** How far above a zone's base a floor surface is looked for (m). */
const FLOOR_REACH = 1.5

const down = new Raycaster()
down.layers.enableAll()

/** Each room's world outline and the height of its floor surface: the top of what lies under it. */
function measureFloors(index: SceneIndex) {
  const floors = new Map<string | null, Mesh[]>()
  for (const [mesh, info] of index.meshes) {
    if (!info.kind || !FLOOR_KINDS.has(info.kind)) continue
    const list = floors.get(info.levelId) ?? []
    list.push(mesh)
    floors.set(info.levelId, list)
  }
  const point = new Vector3()
  for (const zone of index.zones) {
    zone.object.updateWorldMatrix(true, false)
    zone.outline = zone.polygon.map(([x, z]) => {
      point.set(x, 0, z).applyMatrix4(zone.object.matrixWorld)
      return [point.x, point.z]
    })
    const base = zone.object.getWorldPosition(point).y
    zone.floor = base
    const meshes = floors.get(zone.levelId) ?? []
    if (!meshes.length) continue
    // The most common top across points spread over the room: a stray step or plinth doesn't count.
    const tops = new Map<number, number>()
    for (const [x, z] of floorSamples(zone)) {
      point.set(x, 0, z).applyMatrix4(zone.object.matrixWorld)
      point.y = base + FLOOR_REACH
      down.set(point, new Vector3(0, -1, 0))
      down.far = FLOOR_REACH + 0.25
      const hits: Intersection[] = []
      for (const mesh of meshes) mesh.raycast(down, hits)
      if (!hits.length) continue
      const top = Math.round(Math.max(...hits.map((hit) => hit.point.y)) * 100) / 100
      tops.set(top, (tops.get(top) ?? 0) + 1)
    }
    let best = 0
    for (const [top, count] of tops) {
      if (count > best) {
        best = count
        zone.floor = top
      }
    }
  }
}

/** Walls, each with its own meshes and those of the doors and windows set in it. */
function indexWalls(index: SceneIndex, root: Object3D, graph: SceneGraph) {
  root.updateWorldMatrix(true, true)
  const byId = new Map<string, WallEntry>()
  root.traverse((object) => {
    const extras = extrasOf(object)
    if (extras.kind !== 'wall' || !extras.pascalId || byId.has(extras.pascalId)) return
    const entry: WallEntry = { id: extras.pascalId, levelId: levelOf(graph, object), box: new Box3(), meshes: [] }
    object.traverse((child) => {
      if (child instanceof Mesh) entry.meshes.push(child)
    })
    byId.set(entry.id, entry)
  })
  // Doors and windows the file keeps outside their wall's subtree join it through the graph.
  const claimed = new Set(Array.from(byId.values(), (wall) => wall.meshes).flat())
  root.traverse((object) => {
    const extras = extrasOf(object)
    if ((extras.kind !== 'door' && extras.kind !== 'window') || !extras.pascalId) return
    const wall = findAncestorOfType(graph, extras.pascalId, 'wall')
    const entry = wall && byId.get(wall.id)
    if (!entry) return
    object.traverse((child) => {
      if (child instanceof Mesh && !claimed.has(child)) {
        entry.meshes.push(child)
        claimed.add(child)
      }
    })
  })
  for (const entry of byId.values()) {
    for (const mesh of entry.meshes) {
      entry.box.expandByObject(mesh)
      index.wallOf.set(mesh, entry)
    }
    if (!entry.box.isEmpty()) index.walls.push(entry)
  }
}

/** What the camera frames: the buildings, not the site's parcel around them. */
export function focusBounds(root: Object3D): Box3 {
  const bounds = new Box3()
  root.traverse((object) => {
    if (extrasOf(object).kind === 'building') bounds.expandByObject(object)
  })
  return bounds.isEmpty() ? bounds.setFromObject(root) : bounds
}

/** The top of the site's own ground meshes, or null when the scene has no ground. */
export function groundHeight(root: Object3D): number | null {
  const ground = new Box3()
  root.traverse((object) => {
    if (object instanceof Mesh && extrasOf(findIdentity(object) ?? object).kind === 'site') {
      ground.expandByObject(object)
    }
  })
  return ground.isEmpty() ? null : ground.max.y
}

/** Shows every floor (`null`) or isolates one, hiding the others and the isolated floor's ceilings and roof. */
export function applyLevelVisibility(index: SceneIndex, levelId: string | null) {
  // A level of rooms opens like a dollhouse; a level without rooms (a roof level) shows whole.
  const rooms = levelId !== null && index.zones.some((zone) => zone.levelId === levelId)
  for (const [mesh, { levelId: meshLevel, cutaway }] of index.meshes) {
    mesh.visible = levelId === null || meshLevel === null || (meshLevel === levelId && !(cutaway && rooms))
  }
}

function isShown(object: Object3D): boolean {
  for (let current: Object3D | null = object; current; current = current.parent) {
    if (!current.visible) return false
  }
  return true
}

/** Whether a hit lands on the part of a wall the cutaway took away (raycasts ignore clipping). */
export function isCutAway(hit: Intersection): boolean {
  const above = (hit.object.userData as { cutAbove?: number }).cutAbove
  return above !== undefined && hit.point.y > above
}

/** The nearest hit on something currently shown. */
export function firstVisibleHit(hits: readonly Intersection[]): Intersection | null {
  return hits.find((hit) => isShown(hit.object) && !isCutAway(hit)) ?? null
}

/**
 * What the pointer's tag names, and where the pointer is (CSS pixels): a floor (the overlay
 * names it), a room with its area, or a thing.
 */
export type PointerHover = {
  kind: 'level' | 'room' | 'thing'
  /** The floor's or the room's graph id. */
  id?: string
  label: string
  area?: number
  x: number
  y: number
}

const local = new Vector3()
const origin = new Vector3()

/** The zone whose outline holds a world point: on `levelId` when known, else the highest one at or below it. */
function zoneAtPoint(index: SceneIndex, point: Vector3, levelId: string | null): ZoneEntry | null {
  let best: ZoneEntry | null = null
  let bestY = Number.NEGATIVE_INFINITY
  for (const entry of index.zones) {
    if (levelId !== null && entry.levelId !== levelId) continue
    const y = entry.object.getWorldPosition(origin).y
    if (y > point.y + 0.25 || y <= bestY) continue
    local.copy(point)
    entry.object.worldToLocal(local)
    if (zoneContains(entry, local.x, local.z)) {
      best = entry
      bestY = y
    }
  }
  return best
}

/**
 * The room under a hit: the zone the hit node sits in by the graph, else the zone
 * whose outline contains the hit point (so floors, walls inside a room and
 * furniture all resolve to that room).
 */
export function zoneAt(index: SceneIndex, graph: SceneGraph, hit: Intersection): ZoneEntry | null {
  const identity = findIdentity(hit.object)
  if (!identity) return null
  const byGraph = findAncestorOfType(graph, extrasOf(identity).pascalId!, 'zone')
  const levelId = index.meshes.get(hit.object as Mesh)?.levelId ?? null
  return (
    (byGraph && index.zones.find((entry) => entry.id === byGraph.id)) ||
    zoneAtPoint(index, hit.point, levelId) ||
    // A level without rooms (a roof): the room under it.
    (levelId !== null && !index.zones.some((zone) => zone.levelId === levelId)
      ? zoneAtPoint(index, hit.point, null)
      : null)
  )
}

/** A storey's height, for framing a room whose outline is flat. */
const ROOM_HEIGHT = 2.7

/** A room as a world box: its outline, one storey tall from its floor. */
export function roomBounds(zone: ZoneEntry): Box3 | null {
  const bounds = new Box3()
  const point = new Vector3()
  for (const [x, z] of zone.outline) {
    bounds.expandByPoint(point.set(x, zone.floor, z))
    bounds.expandByPoint(point.set(x, zone.floor + ROOM_HEIGHT, z))
  }
  return bounds.isEmpty() ? null : bounds
}

/** How high above a room's floor a wall can stand in the way (m). */
const WALL_REACH = 3.2
/** How high above a room's floor a faded thing (a tree) can stand in the way (m). */
const THING_REACH = 15
/** Ray origins above the floor: the floor itself, and things standing on it. */
const SIGHT_HEIGHTS = [0.05, 1]

/** Points spread over a room's floor, in its own plane: a grid inside the outline, and its corners pulled in. */
function floorSamples(room: ZoneEntry): [number, number][] {
  const xs = room.polygon.map(([x]) => x)
  const zs = room.polygon.map(([, z]) => z)
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minZ = Math.min(...zs)
  const maxZ = Math.max(...zs)
  const step = Math.max(Math.max(maxX - minX, maxZ - minZ) / 8, 0.35)
  const points: [number, number][] = []
  for (let x = minX + step / 2; x < maxX; x += step) {
    for (let z = minZ + step / 2; z < maxZ; z += step) if (zoneContains(room, x, z)) points.push([x, z])
  }
  const cx = xs.reduce((sum, x) => sum + x, 0) / xs.length
  const cz = zs.reduce((sum, z) => sum + z, 0) / zs.length
  for (const [x, z] of room.polygon) {
    const length = Math.hypot(cx - x, cz - z) || 1
    const inset = Math.min(0.2, length / 2) / length
    points.push([x + (cx - x) * inset, z + (cz - z) * inset])
  }
  return points
}

const sight = new Raycaster()
sight.layers.enableAll()

/**
 * What stands between a room and the camera, found by casting rays from points on its floor
 * towards the camera: the walls they cross (cut by the cutaway), and, among `things`, every
 * whole thing they cross (hidden while the room is selected). The room's far walls are never
 * crossed, so they stay as its backdrop.
 */
export function obstructions(
  index: SceneIndex,
  room: ZoneEntry,
  camera: Camera,
  things: Iterable<Mesh> = [],
): { walls: Set<WallEntry>; things: Set<Object3D> } {
  const walls = new Set<WallEntry>()
  const hidden = new Set<Object3D>()
  const toCamera = camera.getWorldDirection(new Vector3()).negate()
  if (toCamera.y < 0.05) return { walls, things: hidden }
  const wallMeshes = index.walls
    .filter((wall) => room.levelId === null || wall.levelId === null || wall.levelId === room.levelId)
    .flatMap((wall) => wall.meshes)
  const thingMeshes = [...things].filter((mesh) => isShown(mesh))
  room.object.updateWorldMatrix(true, false)
  const origin = new Vector3()
  for (const [x, z] of floorSamples(room)) {
    for (const height of SIGHT_HEIGHTS) {
      origin.set(x, 0, z).applyMatrix4(room.object.matrixWorld)
      origin.y = room.floor + height
      sight.set(origin, toCamera)
      sight.far = WALL_REACH / toCamera.y
      for (const hit of sight.intersectObjects(wallMeshes, false)) {
        const wall = index.wallOf.get(hit.object as Mesh)
        if (wall) walls.add(wall)
      }
      if (thingMeshes.length) {
        sight.far = THING_REACH / toCamera.y
        // Straight to each mesh, past the layer test: a thing hidden by the last cast has no
        // layers, and must still count as in the way, or it would flicker back.
        const hits: Intersection[] = []
        for (const mesh of thingMeshes) mesh.raycast(sight, hits)
        for (const hit of hits) hidden.add(index.meshes.get(hit.object as Mesh)?.anchor ?? hit.object)
      }
    }
  }
  return { walls, things: hidden }
}

/** A room's floor as a thin world box. */
function roomFloor(zone: ZoneEntry): Box3 {
  const box = new Box3()
  const point = new Vector3()
  for (const [x, z] of zone.outline) {
    box.expandByPoint(point.set(x, zone.floor, z))
    box.expandByPoint(point.set(x, zone.floor + 0.1, z))
  }
  return box
}

/** Kinds a whole thing is made of, for what a room contains. */
const THING_KINDS = new Set(['item', 'door', 'window', 'stair', ...FURNITURE_KINDS])

/** The outermost thing (item, furniture, door, window, stair) a mesh is part of, below its level; else itself. */
function anchorOf(mesh: Mesh): Object3D {
  let anchor: Object3D = mesh
  for (let current = findIdentity(mesh); current; current = findIdentity(current.parent)) {
    const kind = extrasOf(current).kind
    if (kind === 'level' || kind === 'building' || kind === 'site') break
    if (kind && THING_KINDS.has(kind)) anchor = current
  }
  return anchor
}

/** Kinds a selected room never fades: the ground and floors everything stands on. */
export const NEUTRAL_KINDS = new Set(['slab', 'site', 'zone', 'level', 'building', 'stair-segment'])

/**
 * What belongs to a room: the walls around it (with their doors and windows) and every thing
 * whose middle lies inside its outline. Everything else on its level is what selection fades.
 */
export function roomMembers(index: SceneIndex, room: ZoneEntry): Set<Mesh> {
  const members = new Set<Mesh>()
  const around = roomFloor(room).expandByVector(new Vector3(0.35, 0, 0.35))
  around.max.y += 3
  for (const wall of index.walls) {
    if (room.levelId !== null && wall.levelId !== null && wall.levelId !== room.levelId) continue
    if (wall.box.intersectsBox(around)) for (const mesh of wall.meshes) members.add(mesh)
  }
  const inside = new Map<Object3D, boolean>()
  const center = new Vector3()
  for (const [mesh, info] of index.meshes) {
    if (members.has(mesh) || info.kind === 'wall') continue
    if (room.levelId !== null && info.levelId !== null && info.levelId !== room.levelId) continue
    let contained = inside.get(info.anchor)
    if (contained === undefined) {
      const box = new Box3().setFromObject(info.anchor)
      box.getCenter(center)
      room.object.worldToLocal(center)
      // A door or window sits on the room's edge, not inside it: touching its outline is enough.
      const kind = extrasOf(info.anchor).kind
      const opening = (kind === 'door' || kind === 'window') && box.intersectsBox(around)
      contained = opening || zoneContains(room, center.x, center.z)
      inside.set(info.anchor, contained)
    }
    if (contained) members.add(mesh)
  }
  return members
}

/**
 * A thing's name for the callout, as Pascal's viewer gives it (`pascalLabel`: its name, an item's
 * catalogue name, or a word for its kind); else its label in the file, or its kind.
 */
export function thingName(graph: SceneGraph, thing: Object3D): string {
  const extras = extrasOf(thing)
  const pascal = extras.pascalId ? pascalLabel(graph, extras.pascalId) : null
  if (pascal) return pascal
  const name = extras.label?.trim()
  if (name) return name
  const kind = (extras.kind ?? 'item').split(':').pop()!.replace(/[-_]/g, ' ')
  return kind.charAt(0).toUpperCase() + kind.slice(1)
}

/** What frames a level shown alone: its walls and floors, not the garden around them. */
const STRUCTURE_KINDS = new Set(['wall', 'slab', 'roof', 'roof-segment'])

/** A level's structure (else everything on it), for framing it when it is shown alone. */
export function levelBounds(index: SceneIndex, levelId: string): Box3 | null {
  const structure = new Box3()
  const all = new Box3()
  for (const [mesh, info] of index.meshes) {
    if (info.levelId !== levelId || !mesh.visible) continue
    all.expandByObject(mesh)
    if (info.kind && STRUCTURE_KINDS.has(info.kind)) structure.expandByObject(mesh)
  }
  const box = structure.isEmpty() ? all : structure
  return box.isEmpty() ? null : box
}

/** What the drawing answers with a room, not a thing: Pascal's viewer does the same for its rooms' surfaces. */
const ROOM_SURFACES = new Set(['wall', 'slab', 'ceiling'])

/**
 * The thing a hit belongs to, by Pascal's own viewer rule (`pascalHover`): the nearest Pascal node
 * above the hit, of any kind but the ones a click passes through (site, building, level, zone,
 * scans, guides) and the room's own surfaces, or the node it hands its selection to. So a cabinet
 * module names itself rather than its run, a microwave on a shelf itself, and a kind added to
 * Pascal later hovers without a change here.
 */
export function highlightAt(hit: Intersection, graph: SceneGraph): Object3D | null {
  const identity = findIdentity(hit.object)
  const id = identity && extrasOf(identity).pascalId
  if (!identity || !id) return null
  const hovered = pascalHover(graph, id)
  const node = hovered ? getNode(graph, hovered) : undefined
  if (!hovered || !node || ROOM_SURFACES.has(node.type)) return null
  for (let current: Object3D | null = identity; current; current = findIdentity(current.parent)) {
    if (extrasOf(current).pascalId === hovered) return current
  }
  return identity
}

/** The Pascal kind a mesh is part of: its nearest identity's, or a parent's for unnamed parts. */
export function kindOf(object: Object3D): string | undefined {
  for (let current = findIdentity(object); current; current = findIdentity(current.parent)) {
    const kind = extrasOf(current).kind
    if (kind) return kind
  }
  return undefined
}

/** The openable door or window a hit belongs to, with its open clip. */
export function openableAt(
  index: SceneIndex,
  hit: Intersection,
): { id: string; clip: AnimationClip } | null {
  for (let current = findIdentity(hit.object); current; current = findIdentity(current.parent)) {
    const extras = extrasOf(current)
    if (!extras.openable) continue
    const names = [...(extras.clips ?? []), `${extras.pascalId}: open`]
    const clip = names.map((name) => index.clips.get(name)).find(Boolean)
    return clip ? { id: extras.pascalId!, clip } : null
  }
  return null
}
