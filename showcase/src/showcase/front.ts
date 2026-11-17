/**
 * Which way the house faces, from the published graph alone (pure, unit tested), so the arrival
 * view, the intro's end and Reset view look at its front on a diagonal rather than at a side.
 *
 * In order: the author's saved scene camera (its heading is used as is); the walkthrough spawn
 * (normally placed outside the entrance: the front faces from the building's centre to it); the
 * main entrance (an exterior door, preferring a double or the widest, never a garage door), else
 * the façade with the most openings; the longest façade.
 *
 * Headings are camera azimuths as the framing uses them: the camera sits at
 * `target + (sin a, cos a)` in world XZ.
 */

type Node = { id: string; type: string; parentId?: unknown; visible?: unknown } & Record<string, unknown>
type Nodes = Readonly<Record<string, unknown>>
export type XZ = [number, number]

export type FrontSignal = 'saved-camera' | 'spawn' | 'entrance' | 'openings' | 'longest-facade' | 'none'

export type Front = {
  signal: FrontSignal
  /** The direction out of the front, in world XZ (unit), or null with `signal: 'none'`. */
  normal: XZ | null
  /** The building's footprint centre in world XZ. */
  centre: XZ
  /** The heading the view arrives at: the saved camera's, or 35° off the front to the fuller side. */
  azimuth: number | null
}

/** How far off the front normal the arrival view turns (/next's three-quarter view). */
export const FRONT_OFFSET_DEGREES = 35

const xz = (value: unknown): XZ | null => Array.isArray(value) && typeof value[0] === 'number' && typeof value[1] === 'number' ? [value[0], value[1]] : null
const xyzToXz = (value: unknown): XZ | null => Array.isArray(value) && typeof value[0] === 'number' && typeof value[2] === 'number' ? [value[0], value[2]] : null
const length = ([x, z]: XZ) => Math.hypot(x, z)
const unit = (v: XZ): XZ => { const l = length(v) || 1; return [v[0] / l, v[1] / l] }
export const azimuthOf = ([x, z]: XZ) => Math.atan2(x, z)

function pointInPolygon([x, z]: XZ, points: XZ[]) {
  let inside = false
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [xi, zi] = points[i]!; const [xj, zj] = points[j]!
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside
  }
  return inside
}

/** A node's building transform (position and Y rotation), applied to points in its level's frame. */
function frameOf(nodes: Readonly<Record<string, Node>>, id: string): (p: XZ) => XZ {
  let building: Node | undefined
  for (let current: Node | undefined = nodes[id], guard = 0; current && guard < 32; guard++) {
    if (current.type === 'building') { building = current; break }
    current = typeof current.parentId === 'string' ? nodes[current.parentId] : undefined
  }
  const offset = xyzToXz(building?.position) ?? [0, 0]
  const rotation = Array.isArray(building?.rotation) && typeof building.rotation[1] === 'number' ? building.rotation[1] : 0
  const c = Math.cos(rotation); const s = Math.sin(rotation)
  // three.js Y rotation: x' = x cos + z sin, z' = −x sin + z cos.
  return ([x, z]) => [x * c + z * s + offset[0], -x * s + z * c + offset[1]]
}

function levelOf(nodes: Readonly<Record<string, Node>>, id: string): string | null {
  for (let current: Node | undefined = nodes[id], guard = 0; current && guard < 32; guard++) {
    if (current.type === 'level') return current.id
    current = typeof current.parentId === 'string' ? nodes[current.parentId] : undefined
  }
  return null
}

type Wall = { id: string; level: string | null; start: XZ; end: XZ; length: number }
type Facade = { wall: Wall; outward: XZ }

export function houseFront(input: Nodes): Front {
  const nodes = input as Readonly<Record<string, Node>>
  const all = Object.values(nodes).filter((node) => node && node.visible !== false)
  const walls: Wall[] = []
  for (const node of all) {
    if (node.type !== 'wall') continue
    const start = xz(node.start); const end = xz(node.end)
    if (!start || !end) continue
    const toWorld = frameOf(nodes, node.id)
    const a = toWorld(start); const b = toWorld(end)
    walls.push({ id: node.id, level: levelOf(nodes, node.id), start: a, end: b, length: Math.hypot(b[0] - a[0], b[1] - a[1]) })
  }
  const xs = walls.flatMap((w) => [w.start[0], w.end[0]]); const zs = walls.flatMap((w) => [w.start[1], w.end[1]])
  const centre: XZ = walls.length ? [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...zs) + Math.max(...zs)) / 2] : [0, 0]
  const result = (signal: FrontSignal, normal: XZ | null, azimuth?: number): Front => ({
    signal, normal, centre, azimuth: azimuth ?? (normal ? threeQuarter(normal, walls) : null),
  })

  // 1. The author's saved camera: its heading, as the author framed it.
  const site = all.find((node) => node.type === 'site') ?? all.find((node) => node.type === 'building')
  const camera = site?.camera as { position?: unknown; target?: unknown } | undefined
  const position = xyzToXz(camera?.position); const target = xyzToXz(camera?.target)
  if (position && target && length([position[0] - target[0], position[1] - target[1]]) > 0.1) {
    const heading = unit([position[0] - target[0], position[1] - target[1]])
    return result('saved-camera', heading, azimuthOf(heading))
  }

  // 2. The walkthrough spawn, outside the entrance.
  const spawn = all.find((node) => node.type === 'spawn')
  const spawnAt = spawn ? xyzToXz(spawn.position) : null
  if (spawn && spawnAt) {
    const world = frameOf(nodes, spawn.id)(spawnAt)
    const away: XZ = [world[0] - centre[0], world[1] - centre[1]]
    if (length(away) > 0.5) return result('spawn', unit(away))
  }

  // Exterior walls: one side of the wall is in a room of its level and the other is not (or,
  // with no rooms, the side facing away from the footprint's centre).
  const zones = all.filter((node) => node.type === 'zone').map((zone) => {
    const toWorld = frameOf(nodes, zone.id)
    const polygon = Array.isArray(zone.polygon) ? (zone.polygon as unknown[]).map(xz).filter((p): p is XZ => !!p).map(toWorld) : []
    return { level: levelOf(nodes, zone.id), polygon }
  }).filter((zone) => zone.polygon.length >= 3)
  const facades = new Map<string, Facade>()
  for (const wall of walls) {
    if (wall.length < 0.3) continue
    const d = unit([wall.end[0] - wall.start[0], wall.end[1] - wall.start[1]])
    const mid: XZ = [(wall.start[0] + wall.end[0]) / 2, (wall.start[1] + wall.end[1]) / 2]
    const sides: XZ[] = [[-d[1], d[0]], [d[1], -d[0]]]
    const levelZones = zones.filter((zone) => zone.level === wall.level)
    let outward: XZ | null = null
    if (levelZones.length) {
      const inside = sides.map((n) => levelZones.some((zone) => pointInPolygon([mid[0] + n[0] * 0.4, mid[1] + n[1] * 0.4], zone.polygon)))
      if (inside[0] !== inside[1]) outward = inside[0] ? sides[1]! : sides[0]!
    } else {
      const toCentre: XZ = [centre[0] - mid[0], centre[1] - mid[1]]
      outward = sides[0]![0] * toCentre[0] + sides[0]![1] * toCentre[1] < 0 ? sides[0]! : sides[1]!
    }
    if (outward) facades.set(wall.id, { wall, outward })
  }

  // 3. The main entrance: an exterior door, a double one or the widest, never a garage door.
  const doors = all.filter((node) => node.type === 'door' && typeof node.wallId === 'string' && facades.has(node.wallId as string))
    .filter((door) => !/garage/i.test(String(door.doorType ?? '')))
  if (doors.length) {
    const score = (door: Node) => (Number(door.leafCount) >= 2 || /double|french/i.test(String(door.doorType ?? '')) ? 10 : 0) + (Number(door.width) || 0)
    const best = doors.reduce((a, b) => (score(b) > score(a) ? b : a))
    return result('entrance', facades.get(best.wallId as string)!.outward)
  }
  // …else the façade with the most openings (doors and windows), by outward direction.
  const openings = new Map<string, { normal: XZ; count: number }>()
  for (const node of all) {
    if ((node.type !== 'door' && node.type !== 'window') || typeof node.wallId !== 'string') continue
    const facade = facades.get(node.wallId)
    if (!facade) continue
    const key = directionKey(facade.outward)
    const entry = openings.get(key) ?? { normal: facade.outward, count: 0 }
    entry.count++
    openings.set(key, entry)
  }
  if (openings.size) {
    const best = [...openings.values()].reduce((a, b) => (b.count > a.count ? b : a))
    return result('openings', best.normal)
  }
  // 4. The longest façade.
  const lengths = new Map<string, { normal: XZ; length: number }>()
  for (const { wall, outward } of facades.values()) {
    const key = directionKey(outward)
    const entry = lengths.get(key) ?? { normal: outward, length: 0 }
    entry.length += wall.length
    lengths.set(key, entry)
  }
  if (lengths.size) {
    const best = [...lengths.values()].reduce((a, b) => (b.length > a.length ? b : a))
    return result('longest-facade', best.normal)
  }
  return result('none', null)
}

/** Façades facing within 20° of each other count as one. */
function directionKey(n: XZ) {
  return String(Math.round(azimuthOf(n) / (Math.PI / 9)))
}

/**
 * 35° off the front, to the side where the building shows more: the larger extent of its walls
 * across the view (a long wing on one side reads better than its end on).
 */
export function threeQuarter(normal: XZ, walls: readonly { start: XZ; end: XZ }[]) {
  const front = azimuthOf(normal)
  const offset = (FRONT_OFFSET_DEGREES * Math.PI) / 180
  const candidates = [front + offset, front - offset]
  const width = (azimuth: number) => {
    const right: XZ = [Math.cos(azimuth), -Math.sin(azimuth)]
    const across = walls.flatMap((w) => [w.start, w.end]).map(([x, z]) => x * right[0] + z * right[1])
    return across.length ? Math.max(...across) - Math.min(...across) : 0
  }
  const [a, b] = candidates as [number, number]
  return width(b) > width(a) + 0.01 ? b : a
}
