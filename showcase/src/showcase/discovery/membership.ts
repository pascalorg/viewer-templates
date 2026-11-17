import type { AnyNode } from '@pascal-app/core'

/**
 * Which room or outdoor area a node belongs to, from the published graph alone (no three.js), so
 * it is the same on the live and baked paths and can be unit tested. Semantic links come first:
 * a room's boundary walls and separators, the floor plates that name it, its ceiling, the porch
 * posts and beams made for it, then the hosts of openings and hosted items. Geometry (the room's
 * outline on its floor) only decides between several linked rooms, or places what has no link.
 */

export type XZ = readonly [number, number]
type Nodes = Readonly<Record<string, AnyNode>>
type Raw = { id: string; type: string; parentId?: unknown; visible?: unknown } & Record<string, unknown>

export type OutdoorType = 'porch' | 'deck' | 'patio'

export type Room = {
  id: string
  name: string
  levelId: string
  /** `area` for a porch, deck or patio. */
  kind: 'room' | 'area'
  outdoorType: OutdoorType | null
  /** The room's outline on its floor, in the level's XZ. */
  polygon: XZ[]
  holes: XZ[][]
  /** Square metres. */
  area: number
  /** The finished floor's height in the level's frame. */
  floorY: number
  /** An area's own parts (its floor plate, porch posts and beams), washed as they are. */
  members: string[]
  /** True when an area has no floor plate of its own: its floor is washed as an outline. */
  washFloor: boolean
}

export type Membership = {
  rooms: ReadonlyMap<string, Room>
  /** The rooms a node is linked to, before geometry decides. */
  linked(nodeId: string): readonly string[]
  levelOf(nodeId: string): string | null
}

const OUTDOOR = new Set<string>(['porch', 'deck', 'patio'])
/** Kinds that never reveal a room: the frame of the scene, roofs and what sits on them. */
const NEVER = new Set<string>(['site', 'building', 'level', 'roof', 'roof-segment', 'spawn', 'scan', 'guide', 'chimney', 'dormer', 'skylight', 'solar-panel', 'gutter', 'downspout', 'ridge-vent', 'box-vent', 'turbine-vent', 'eyebrow-vent', 'cupola', 'measurement', 'construction-dimension', 'structural-grid'])
/** Kinds whose own place says which room they are in when nothing links them. */
const PLACED = new Set<string>(['wall', 'door', 'window', 'slab', 'ceiling', 'column', 'beam', 'stair', 'stair-segment', 'separator', 'fence', 'block', 'shelf', 'cabinet', 'cabinet-module', 'elevator'])

export function polygonArea(points: readonly XZ[]): number {
  let sum = 0
  for (let i = 0; i < points.length; i++) {
    const [x1, z1] = points[i]!
    const [x2, z2] = points[(i + 1) % points.length]!
    sum += x1 * z2 - x2 * z1
  }
  return Math.abs(sum) / 2
}

export function pointInPolygon([x, z]: XZ, points: readonly XZ[]): boolean {
  let inside = false
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [xi, zi] = points[i]!
    const [xj, zj] = points[j]!
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside
  }
  return inside
}

export function inRoom(point: XZ, room: Pick<Room, 'polygon' | 'holes'>): boolean {
  return pointInPolygon(point, room.polygon) && !room.holes.some((hole) => pointInPolygon(point, hole))
}

/** The mean of a polygon's vertices (what /next anchors a room's label on). */
export function polygonCentre(points: readonly XZ[]): XZ {
  let x = 0
  let z = 0
  for (const [px, pz] of points) { x += px; z += pz }
  return [x / Math.max(1, points.length), z / Math.max(1, points.length)]
}

const ids = (value: unknown): string[] => (Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : [])
const xz = (value: unknown): XZ[] => (Array.isArray(value) ? value.filter((p): p is XZ => Array.isArray(p) && p.length >= 2 && typeof p[0] === 'number' && typeof p[1] === 'number').map((p) => [p[0], p[1]] as const) : [])

/** The porch a post or beam was made for (core's `porchPartOf`, inlined to stay three-free). */
function porchOf(node: Raw): string | null {
  if (node.type !== 'column' && node.type !== 'beam') return null
  const metadata = node.metadata as Record<string, unknown> | undefined
  return typeof metadata?.porchOf === 'string' && typeof metadata.porchPart === 'string' ? metadata.porchOf : null
}

export function buildMembership(nodes: Nodes): Membership {
  const raw = nodes as unknown as Readonly<Record<string, Raw>>
  const links = new Map<string, string[]>()
  const link = (nodeId: string, zoneId: string) => {
    const list = links.get(nodeId)
    if (!list) links.set(nodeId, [zoneId])
    else if (!list.includes(zoneId)) list.push(zoneId)
  }
  const levelCache = new Map<string, string | null>()
  const levelOf = (nodeId: string): string | null => {
    if (levelCache.has(nodeId)) return levelCache.get(nodeId)!
    let id: string | null | undefined = nodeId
    let found: string | null = null
    for (let guard = 0; id && guard < 64; guard++) {
      const node: Raw | undefined = raw[id]
      if (!node) break
      if (node.type === 'level') { found = node.id; break }
      id = node.parentId as string | null | undefined
    }
    levelCache.set(nodeId, found)
    return found
  }

  const zones = Object.values(raw).filter((node) => node.type === 'zone' && node.visible !== false && xz(node.polygon).length >= 3)
  const zoneIds = new Set(zones.map((zone) => zone.id))
  for (const zone of zones) {
    for (const id of [...ids(zone.boundaryWallIds), ...ids(zone.boundarySeparatorIds)]) link(id, zone.id)
    const floor = zone.floor as { sourceSlabId?: unknown } | undefined
    if (typeof floor?.sourceSlabId === 'string') link(floor.sourceSlabId, zone.id)
  }
  const slabs: Raw[] = []
  for (const node of Object.values(raw)) {
    if (node.type === 'slab') {
      slabs.push(node)
      for (const id of [...ids(node.zoneIds), ...ids(node.associatedZoneIds)]) if (zoneIds.has(id)) link(node.id, id)
    } else if (node.type === 'ceiling' && typeof node.zoneId === 'string' && zoneIds.has(node.zoneId)) {
      link(node.id, node.zoneId)
    } else {
      const porch = porchOf(node)
      if (porch && zoneIds.has(porch)) link(node.id, porch)
    }
  }

  const rooms = new Map<string, Room>()
  for (const zone of zones) {
    const levelId = levelOf(zone.id)
    if (!levelId) continue
    const polygon = xz(zone.polygon)
    const holes = Array.isArray(zone.holes) ? (zone.holes as unknown[]).map(xz).filter((hole) => hole.length >= 3) : []
    const outdoorType = typeof zone.roomType === 'string' && OUTDOOR.has(zone.roomType) ? zone.roomType as OutdoorType : null
    const centre = polygonCentre(polygon)
    // The floor plates under the room: its own plate wins over a shared base plate.
    const plates = slabs.filter((slab) => (links.get(slab.id) ?? []).includes(zone.id))
    const own = plates.filter((slab) => (links.get(slab.id) ?? []).length === 1)
    const under = plates.length ? plates : slabs.filter((slab) => levelOf(slab.id) === levelId && pointInPolygon(centre, xz(slab.polygon)))
    const floorPlate = own.find((slab) => slab.plateRole !== 'base') ?? own[0] ?? under.find((slab) => slab.plateRole !== 'base') ?? under[0]
    const members = outdoorType
      ? [...own.map((slab) => slab.id), ...Object.values(raw).filter((node) => porchOf(node) === zone.id).map((node) => node.id)]
      : []
    rooms.set(zone.id, {
      id: zone.id,
      name: typeof zone.name === 'string' && zone.name.trim() ? zone.name.trim() : 'Room',
      levelId,
      kind: outdoorType ? 'area' : 'room',
      outdoorType,
      polygon,
      holes,
      area: Math.max(0, polygonArea(polygon) - holes.reduce((sum, hole) => sum + polygonArea(hole), 0)),
      floorY: typeof floorPlate?.elevation === 'number' ? floorPlate.elevation : 0,
      members,
      washFloor: outdoorType ? own.length === 0 : true,
    })
  }

  return {
    rooms,
    linked: (nodeId) => (links.get(nodeId) ?? []).filter((id) => rooms.has(id)),
    levelOf,
  }
}

/** Where a pointer hit lands, in its level's XZ: the hit, and points a little off each face. */
export type Probe = {
  point: XZ
  /** The hit pushed .35 m out along its face normal, then pushed in: the room in front first. */
  aside?: readonly XZ[]
}

/**
 * The room a hit node reveals, or null. A room's floor, walls, ceiling, contents, or an area's
 * parts reveal it; a hit on nothing a room owns reveals nothing.
 */
export function resolveRoom(membership: Membership, nodes: Nodes, nodeId: string, probe: Probe | null): string | null {
  const raw = nodes as unknown as Readonly<Record<string, Raw>>
  const node = raw[nodeId]
  if (!node || NEVER.has(node.type)) return null
  if (node.type === 'zone') return membership.rooms.has(node.id) ? node.id : null
  const levelId = membership.levelOf(nodeId)
  // The node's own links, else its host's (a door's wall, a lamp's ceiling).
  let linked: readonly string[] = []
  let hostKind = node.type
  for (let id: string | null | undefined = nodeId, guard = 0; id && guard < 16; guard++) {
    linked = membership.linked(id)
    if (linked.length) break
    const parent = raw[id]?.parentId as string | null | undefined
    if (!parent || raw[parent]?.type === 'level' || raw[parent]?.type === 'zone') {
      if (parent && raw[parent]?.type === 'zone' && membership.rooms.has(parent)) linked = [parent]
      break
    }
    id = parent
    hostKind = raw[parent]?.type ?? hostKind
  }
  const points = probe ? [...(probe.aside ?? []), probe.point] : []
  const pick = (candidates: readonly Room[]) => {
    for (const point of points) {
      const inside = candidates.filter((room) => inRoom(point, room))
      if (inside.length) return inside.reduce((best, room) => (room.area < best.area ? room : best)).id
    }
    return null
  }
  if (linked.length === 1) return linked[0]!
  if (linked.length > 1) {
    const candidates = linked.map((id) => membership.rooms.get(id)!).filter(Boolean)
    return pick(candidates) ?? candidates[0]?.id ?? null
  }
  // Nothing links it: geometry places items (and walls of rooms drawn without boundaries).
  if (!levelId || !probe) return null
  if (!PLACED.has(hostKind) && !isContent(node)) return null
  return pick([...membership.rooms.values()].filter((room) => room.levelId === levelId))
}

/** Furniture, fixtures and plugin kinds: what a room holds. */
function isContent(node: Raw): boolean {
  return node.type === 'item' || node.type === 'procedural-item' || node.type === 'imported-mesh' || node.type.includes(':') ||
    /^(hvac|duct|pipe|lineset|liquid)/.test(node.type)
}
