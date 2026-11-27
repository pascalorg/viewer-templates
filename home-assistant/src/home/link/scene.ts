import type { V3 } from '../entities'
import { type CatalogAsset, type Classification, classify, type Mount, mountOf } from './classify'
import { telling } from './words'

/* The things in a Pascal scene graph that Home Assistant could drive, with where they are, which
   room they are in and which way they face. Reads the graph only (no three.js), so it runs the same
   in the viewer, in a test and on a saved scene file. A caller that has the drawn scene can pass
   `place` to use the drawn positions instead of the graph's arithmetic. */

/** The parts of a Pascal node this reads. */
export type GraphNode = {
  id: string
  type: string
  name?: string
  parentId?: string | null
  children?: string[]
  position?: V3
  rotation?: V3
  scale?: V3
  asset?: CatalogAsset & { dimensions?: V3 }
  polygon?: [number, number][] | { points?: [number, number][] }
  start?: [number, number]
  end?: [number, number]
  wallId?: string
  /** A door's or window's opening, in metres. */
  width?: number
  height?: number
}
export type GraphNodes = Record<string, GraphNode | undefined>

/** Where a node is on its level's plan: x and z in metres, y its height; yaw its turn about y. */
export type Placement = { position: V3; yaw: number }

export type Room = { id: string; name: string }

export type Thing = Classification & {
  id: string
  type: string
  /** What a person would call it: its own name, else its catalog name. */
  label: string
  mount: Mount
  levelId: string | null
  /** The rooms it is in: one, or both sides of a door or window. */
  rooms: Room[]
  /** On its level's plan (x, z) with its height (y). */
  position: V3
  /** Which way it faces, as an effect anchor turns (`Anchor.rotationY`: 0 faces +x, π/2 faces −z);
      null for what faces no way (a ceiling light, a sensor). */
  facing: number | null
  /** wall: away from the wall it hangs on, into its room. model: the model's own front, which
      assumes catalog models face +z (to confirm on real catalog items). */
  facingFrom: 'wall' | 'model' | null
  /** The telling words of the things around it ("sofa", "desk"), for telling two lamps apart. */
  near: string[]
  /** Its size in metres (x, y, z of the model), when the catalog gives it. */
  size?: V3
}

/** Pascal models are taken to face +z, the glTF convention. Flip here if real catalogs disagree. */
const MODEL_FRONT: [number, number] = [0, 1]
/** How far around a thing the words of its neighbours count. */
const NEAR_M = 1.6
/** Kinds whose facing matters to their effect: air, light cones, screens, cameras. */
const FACES = new Set(['ac', 'fan', 'heater', 'purifier', 'humidifier', 'tv', 'speaker', 'camera', 'light', 'blind', 'curtain', 'door', 'window', 'garage-door', 'gate'])

export const polygonOf = (n: GraphNode): [number, number][] => (Array.isArray(n.polygon) ? n.polygon : (n.polygon?.points ?? []))

function inside([x, z]: [number, number], poly: [number, number][]) {
  let hit = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i]!
    const [xj, zj] = poly[j]!
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) hit = !hit
  }
  return hit
}

/** The anchor turn (`rotationY`) that faces a plan direction (dx, dz). */
export const turnFacing = (dx: number, dz: number) => Math.atan2(-dz, dx)

/** The level a node stands on, through its parents. */
function levelOf(nodes: GraphNodes, id: string): string | null {
  for (let at = nodes[id]; at; at = at.parentId ? nodes[at.parentId] : undefined) if (at.type === 'level') return at.id
  return null
}

/** A wall's line on the plan: its start, its unit direction and its length. */
function wallLine(wall: GraphNode) {
  const [sx, sz] = wall.start ?? [0, 0]
  const [ex, ez] = wall.end ?? [0, 0]
  const length = Math.hypot(ex - sx, ez - sz) || 1
  return { sx, sz, dx: (ex - sx) / length, dz: (ez - sz) / length, length }
}

/** Where a node is on its level's plan, from the graph alone: a wall's children sit along the wall
    (x is the distance from its start), an item on an item moves and turns with it. */
export function graphPlacement(nodes: GraphNodes, id: string): Placement {
  const node = nodes[id]
  if (!node) return { position: [0, 0, 0], yaw: 0 }
  const [x, y, z] = node.position ?? [0, 0, 0]
  const own = node.rotation?.[1] ?? 0
  const parent = node.parentId ? nodes[node.parentId] : undefined
  if (parent?.type === 'wall') {
    const w = wallLine(parent)
    // along the wall, and z out of its face (the wall's left-hand normal)
    return { position: [w.sx + w.dx * x - w.dz * z, y, w.sz + w.dz * x + w.dx * z], yaw: Math.atan2(-w.dz, w.dx) + own }
  }
  if (parent?.type === 'item') {
    const base = graphPlacement(nodes, parent.id)
    const c = Math.cos(base.yaw)
    const s = Math.sin(base.yaw)
    return { position: [base.position[0] + c * x + s * z, base.position[1] + y, base.position[2] - s * x + c * z], yaw: base.yaw + own }
  }
  return { position: [x, y, z], yaw: own }
}

export type ReadOptions = {
  /** The drawn position and turn of a node on its level's plan, where the caller has them. */
  place?: (id: string) => Placement | null
  /** Items to read even where the word table finds no device in them: ones linked by hand. */
  include?: ReadonlySet<string>
}

/** Every thing in the graph Home Assistant could drive, and the rooms of every level. */
export function readThings(nodes: GraphNodes, options: ReadOptions = {}): { things: Thing[]; rooms: (Room & { levelId: string | null })[] } {
  const all = Object.values(nodes).filter((n): n is GraphNode => !!n)
  const zones = all.filter((n) => n.type === 'zone').map((z) => ({ id: z.id, name: z.name ?? z.id, levelId: levelOf(nodes, z.id), polygon: polygonOf(z) }))
  const walls = all.filter((n) => n.type === 'wall')
  const placeOf = (id: string) => options.place?.(id) ?? graphPlacement(nodes, id)

  const roomsAt = (levelId: string | null, x: number, z: number) =>
    zones.filter((r) => r.levelId === levelId && inside([x, z], r.polygon)).map(({ id, name }) => ({ id, name }))

  const distance = (w: GraphNode, x: number, z: number) => {
    const l = wallLine(w)
    const t = Math.max(0, Math.min(l.length, (x - l.sx) * l.dx + (z - l.sz) * l.dz))
    return Math.hypot(l.sx + l.dx * t - x, l.sz + l.dz * t - z)
  }

  /** The wall a thing hangs on: its parent, the wall it names, else the nearest one within half a metre. */
  const wallFor = (node: GraphNode, x: number, z: number, levelId: string | null) => {
    const named = [node.parentId, node.wallId].map((id) => (id ? nodes[id] : undefined)).find((n) => n?.type === 'wall')
    if (named) return named
    let best: GraphNode | undefined
    let bestD = 0.5
    for (const w of walls) {
      if (levelOf(nodes, w.id) !== levelId) continue
      const d = distance(w, x, z)
      if (d < bestD) [best, bestD] = [w, d]
    }
    return best
  }

  /** A second wall across the first, as close: the thing sits in a corner. */
  const cornerWith = (wall: GraphNode, x: number, z: number, levelId: string | null) => {
    const a = wallLine(wall)
    return walls.find((w) => {
      if (w === wall || levelOf(nodes, w.id) !== levelId || distance(w, x, z) > 0.35) return false
      const b = wallLine(w)
      return Math.abs(a.dx * b.dx + a.dz * b.dz) < 0.5
    })
  }

  /** Which way off a wall a point at (x, z) is: its unit normal, when it is clearly off the line. */
  const offWall = (w: GraphNode, x: number, z: number): [number, number] | null => {
    const l = wallLine(w)
    const offset = (x - l.sx) * -l.dz + (z - l.sz) * l.dx
    return Math.abs(offset) > 0.02 ? [Math.sign(offset) * -l.dz, Math.sign(offset) * l.dx] : null
  }

  const found: Thing[] = []
  for (const node of all) {
    const parent = node.parentId ? nodes[node.parentId] : undefined
    const kind = classify(node, parent?.type === 'item') ??
      (options.include?.has(node.id) && node.type === 'item' ? { kind: 'other' as const, confidence: 'likely' as const, why: 'linked by hand' } : null)
    if (!kind) continue
    const levelId = levelOf(nodes, node.id)
    const { position, yaw } = placeOf(node.id)
    const [x, , z] = position
    const mount = mountOf(node, parent?.type === 'item')
    let rooms = roomsAt(levelId, x, z)
    let facing: number | null = null
    let facingFrom: Thing['facingFrom'] = null

    const wall = mount === 'wall' ? wallFor(node, x, z, levelId) : undefined
    if (wall) {
      // on a wall: it hangs on one face and looks away from it. Which face: the side of the wall
      // its centre is on; on the wall's line itself, the side of the room it is in.
      const l = wallLine(wall)
      const left = [-l.dz, l.dx] as const
      const sides = [left, [l.dz, -l.dx] as const].map((n) => ({ n, rooms: roomsAt(levelId, x + n[0] * 0.3, z + n[1] * 0.3) }))
      const off = offWall(wall, x, z)
      if (node.type === 'door' || node.type === 'window') {
        rooms = [...new Map(sides.flatMap((s) => s.rooms).map((r) => [r.id, r])).values()]
        // it faces into a room: what comes through it (daylight past a blind) falls indoors
        const inward = sides.find((s) => s.rooms.length)
        if (inward) {
          facing = turnFacing(inward.n[0], inward.n[1])
          facingFrom = 'wall'
        }
      } else {
        const face = off
          ? sides[off[0] * left[0] + off[1] * left[1] > 0 ? 0 : 1]!
          : (sides.find((s) => s.rooms.some((r) => rooms.some((q) => q.id === r.id))) ?? sides.find((s) => s.rooms.length))
        if (face) {
          // in a corner it looks out between the two walls
          const corner = cornerWith(wall, x, z, levelId)
          const other = corner ? offWall(corner, x, z) : null
          const [nx, nz] = other ? [face.n[0] + other[0], face.n[1] + other[1]] : face.n
          facing = turnFacing(nx, nz)
          facingFrom = 'wall'
          if (!rooms.length) rooms = face.rooms
        }
      }
    }
    if (facing === null && mount !== 'ceiling' && FACES.has(kind.kind)) {
      const [fx, fz] = MODEL_FRONT
      const c = Math.cos(yaw)
      const s = Math.sin(yaw)
      facing = turnFacing(c * fx + s * fz, -s * fx + c * fz)
      facingFrom = 'model'
    }
    // a door or window has its opening's size; an item, its catalog model's
    const d: V3 | undefined = node.asset?.dimensions ?? (node.width && node.height ? [node.width, node.height, 0.1] : undefined)
    const k = node.scale ?? [1, 1, 1]
    found.push({
      ...kind, id: node.id, type: node.type, label: node.name || node.asset?.name || (node.type === 'door' ? 'Door' : node.type === 'window' ? 'Window' : node.id), mount, levelId, rooms, position, facing, facingFrom, near: [],
      ...(d ? { size: [d[0] * k[0], d[1] * k[1], d[2] * k[2]] as V3 } : {}),
    })
  }

  // the words of what stands around each thing, devices and furniture alike
  const named = all
    .filter((n) => n.type === 'item' || n.type === 'door' || n.type === 'window')
    .map((n) => ({ id: n.id, levelId: levelOf(nodes, n.id), at: placeOf(n.id).position, words: telling(n.name || n.asset?.name) }))
  for (const t of found) {
    const near = new Set<string>()
    for (const n of named) {
      if (n.id === t.id || n.levelId !== t.levelId) continue
      if (Math.hypot(n.at[0] - t.position[0], n.at[2] - t.position[2]) <= NEAR_M) for (const w of n.words) near.add(w)
    }
    t.near = [...near]
  }
  return { things: found, rooms: zones.map(({ id, name, levelId }) => ({ id, name, levelId })) }
}
