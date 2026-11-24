import {
  findAncestorOfType,
  getNode,
  listLevels,
  type SceneGraph,
  type SceneNode,
  zoneArea,
  zoneContains,
  zoneInfo,
  type ZoneInfo,
} from './pascal'

/**
 * What the overlay lists and inspects, read from the scene graph alone, so the baked drawing and
 * the live rebuild show the same floors, rooms and contents.
 */

export type Room = {
  id: string
  name: string
  area: number
  levelId: string | null
  /** Width and depth of its outline's bounding box, metres. */
  size: [number, number]
  ceiling: number | null
  /** Pascal's room details, when its owner filled them in: [label, value]. */
  details: [string, string][]
  zone: ZoneInfo
  /** Where its tag pins, in the zone's own x/z plane: the middle of its floor, always inside it. */
  labelPoint: [number, number]
}

export type Floor = {
  id: string
  name: string
  area: number
  rooms: Room[]
}

export type Spaces = {
  /** Top floor first, the order a section reads. */
  floors: Floor[]
  rooms: Map<string, Room>
  area: number
}

/** An item in a room, with what its asset says about it. */
export type Thing = {
  id: string
  name: string
  category: string | null
  /** Width, depth and height, metres. */
  size: [number, number, number] | null
  /** The catalogue name, when the item was renamed. */
  model: string | null
}

const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '')
const number = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : null)
const vector = (value: unknown) =>
  Array.isArray(value) && value.length === 3 && value.every((n) => typeof n === 'number')
    ? (value as [number, number, number])
    : null

/** `living-room` or `living_room` as "Living room". */
export function sentence(value: string) {
  const words = value.replace(/[-_]+/g, ' ').trim()
  return words.charAt(0).toUpperCase() + words.slice(1)
}

function roomOf(graph: SceneGraph, node: SceneNode, zone: ZoneInfo, levelId: string | null): Room {
  const xs = zone.polygon.map(([x]) => x)
  const zs = zone.polygon.map(([, z]) => z)
  const fields = node as Record<string, unknown>
  const details: [string, string][] = []
  const role = text(fields.spaceRole)
  if (role && role !== 'generic' && role !== 'room') details.push(['Use', sentence(role)])
  const roomNumber = text(fields.roomNumber)
  if (roomNumber) details.push(['Number', roomNumber])
  for (const [key, label] of [['floorFinish', 'Floor'], ['wallFinish', 'Walls'], ['ceilingFinish', 'Ceiling']] as const) {
    const finish = text(fields[key])
    if (finish) details.push([label, finish])
  }
  const ceiling = number(fields.ceilingHeight)
  const level = levelId ? getNode(graph, levelId) : undefined
  return {
    id: node.id,
    name: zone.name ?? 'Room',
    area: zoneArea(zone),
    levelId,
    size: [Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs)],
    ceiling: ceiling && ceiling > 0 ? ceiling : number((level as Record<string, unknown> | undefined)?.height),
    details,
    zone,
    labelPoint: labelPoint(zone),
  }
}

/**
 * The middle of a room's floor for its tag: the outline's centroid, or, for an L or a U whose
 * centroid falls outside, the point of a grid over it nearest the centroid that lies inside.
 */
export function labelPoint(zone: Pick<ZoneInfo, 'polygon' | 'holes'>): [number, number] {
  const points = zone.polygon
  let twice = 0
  let cx = 0
  let cz = 0
  for (let i = 0; i < points.length; i++) {
    const [x1, z1] = points[i]!
    const [x2, z2] = points[(i + 1) % points.length]!
    const cross = x1 * z2 - x2 * z1
    twice += cross
    cx += (x1 + x2) * cross
    cz += (z1 + z2) * cross
  }
  const centroid: [number, number] =
    Math.abs(twice) > 1e-9
      ? [cx / (3 * twice), cz / (3 * twice)]
      : [points.reduce((sum, [x]) => sum + x, 0) / points.length, points.reduce((sum, [, z]) => sum + z, 0) / points.length]
  if (zoneContains(zone, centroid[0], centroid[1])) return centroid
  const xs = points.map(([x]) => x)
  const zs = points.map(([, z]) => z)
  const [minX, maxX, minZ, maxZ] = [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)]
  const step = Math.max(maxX - minX, maxZ - minZ) / 24
  let best: [number, number] = points[0]!
  let bestDistance = Number.POSITIVE_INFINITY
  for (let x = minX + step / 2; x < maxX; x += step) {
    for (let z = minZ + step / 2; z < maxZ; z += step) {
      const distance = Math.hypot(x - centroid[0], z - centroid[1])
      if (distance < bestDistance && zoneContains(zone, x, z)) {
        best = [x, z]
        bestDistance = distance
      }
    }
  }
  return best
}

export function readSpaces(graph: SceneGraph): Spaces {
  const rooms = new Map<string, Room>()
  const byLevel = new Map<string | null, Room[]>()
  for (const node of Object.values(graph.nodes)) {
    const zone = zoneInfo(node)
    if (!zone) continue
    const levelId = findAncestorOfType(graph, node.id, 'level')?.id ?? null
    const room = roomOf(graph, node, zone, levelId)
    rooms.set(room.id, room)
    byLevel.set(levelId, [...(byLevel.get(levelId) ?? []), room])
  }
  const floors = listLevels(graph)
    .map((level) => {
      const onLevel = (byLevel.get(level.id) ?? []).sort((a, b) => a.name.localeCompare(b.name))
      return {
        id: level.id,
        name: level.name,
        area: onLevel.reduce((sum, room) => sum + room.area, 0),
        rooms: onLevel,
      }
    })
    .reverse()
  const area = [...rooms.values()].reduce((sum, room) => sum + room.area, 0)
  return { floors, rooms, area }
}

/**
 * Furniture Pascal builds from its parameters rather than a catalogue model: a kitchen or
 * cabinet run (its countertop and plinth), the modules in it (a sink base, a dishwasher, a wall
 * cabinet on a base one), shelves, and procedural pieces. With `item`, these are the kinds
 * Pascal's node definitions file under the `furnish` category. A room lists them with its items.
 */
export const FURNITURE_KINDS = new Set(['cabinet', 'cabinet-module', 'shelf', 'procedural-item'])

/** What furniture is, in words, by kind. */
const FURNITURE_CATEGORY: Record<string, string> = {
  cabinet: 'Cabinet run',
  'cabinet-module': 'Cabinet module',
  shelf: 'Shelf',
  'procedural-item': 'Furniture',
}

/** What an item's or a piece of furniture's graph node says about it. */
export function thingOf(graph: SceneGraph, id: string): Thing | null {
  const node = getNode(graph, id)
  if (!node) return null
  const fields = node as Record<string, unknown>
  if (FURNITURE_KINDS.has(node.type)) {
    const width = number(fields.width)
    const depth = number(fields.depth)
    const height = number(fields.carcassHeight) ?? number(fields.height)
    return {
      id,
      name: text(node.name) || sentence(node.type),
      category: FURNITURE_CATEGORY[node.type] ?? null,
      // A run's own width is a stub: its modules make its length.
      size: node.type !== 'cabinet' && width !== null && depth !== null && height !== null ? [width, depth, height] : null,
      model: null,
    }
  }
  const asset = (fields.asset ?? {}) as Record<string, unknown>
  const dimensions = vector(asset.dimensions)
  const scale = vector(fields.scale) ?? [1, 1, 1]
  const catalogue = text(asset.name)
  const name = text(node.name) || catalogue || sentence(node.type)
  const category = text(asset.category)
  return {
    id,
    name,
    category: category ? sentence(category) : null,
    size: dimensions
      ? [dimensions[0] * Math.abs(scale[0]), dimensions[2] * Math.abs(scale[2]), dimensions[1] * Math.abs(scale[1])]
      : null,
    model: catalogue && catalogue !== name ? catalogue : null,
  }
}

/** Where a node sits in its parent's plane, and its turn about the vertical (radians). */
function placement(node: SceneNode): { x: number; z: number; turn: number } | null {
  const fields = node as Record<string, unknown>
  const position = vector(fields.position)
  if (!position) return null
  const rotation = fields.rotation
  const turn = typeof rotation === 'number' ? rotation : Array.isArray(rotation) ? (number(rotation[1]) ?? 0) : 0
  return { x: position[0], z: position[2], turn }
}

/**
 * Where a thing stands in its level's plane: its own position, or its position on the item or
 * furniture it sits in or on (a plate on a table, a microwave on a shelf, a module in a run).
 * Items hung on a wall are placed along the wall, so they have none here.
 */
function levelPoint(graph: SceneGraph, node: SceneNode): [number, number] | null {
  const own = placement(node)
  const parent = node.parentId ? getNode(graph, node.parentId) : undefined
  if (!own) return null
  if (!parent || parent.type === 'level' || parent.type === 'ceiling' || parent.type === 'slab' || parent.type === 'zone') {
    return [own.x, own.z]
  }
  if (parent.type !== 'item' && !FURNITURE_KINDS.has(parent.type)) return null
  const base = levelPoint(graph, parent)
  const frame = placement(parent)
  if (!base || !frame) return null
  // The parent's turn about the vertical, as three.js applies it.
  const cos = Math.cos(frame.turn)
  const sin = Math.sin(frame.turn)
  return [base[0] + own.x * cos + own.z * sin, base[1] - own.x * sin + own.z * cos]
}

/** The items and furniture whose footprint centre lies on a room's floor, by name. */
export function roomContents(graph: SceneGraph, room: Room): Thing[] {
  const things: Thing[] = []
  for (const node of Object.values(graph.nodes)) {
    if (node.type !== 'item' && !FURNITURE_KINDS.has(node.type)) continue
    if (findAncestorOfType(graph, node.id, 'level')?.id !== room.levelId) continue
    const point = levelPoint(graph, node)
    if (!point || !zoneContains(room.zone, point[0], point[1])) continue
    const thing = thingOf(graph, node.id)
    if (thing) things.push(thing)
  }
  return things.sort((a, b) => a.name.localeCompare(b.name))
}
