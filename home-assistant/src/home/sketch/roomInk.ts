import type { ViewerSource } from '@pascal-app/viewer/ui'
import { type Material, Matrix4, Vector2, Vector3, Vector4 } from 'three'
import { bool, Break, clamp, dot, float, Fn, fract, If, int, length, Loop, max, positionWorld, screenCoordinate, select, smoothstep, step, uniform, uniformArray, vec2 } from 'three/tsl'
import { MeshStandardNodeMaterial, type NodeMaterial, type WebGPURenderer } from 'three/webgpu'

/**
 * The home in colour, for the Home Assistant wireframe: the furniture and floors draw in the
 * viewer's own materials (walls and the ground stay in the wireframe). When the visitor picks a
 * room, every other room fades back to the wireframe, a dissolve over the screen, and comes back
 * when the room is let go.
 *
 * How coloured a point is: `rest` everywhere, raised to each slot's `weight` inside its room. Two
 * slots, so the room let go fades out while the one picked fades in. The wireframe's materials draw
 * where the point is not coloured (`notColoured`), the colour copies (`colourMaterial`) where it is,
 * one dither threshold per pixel deciding between them.
 */

/** Room outlines with more corners than this fall back to their bounding box. */
export const MAX_OUTLINE = 32

/** A room the fade colours: its outline, its floor and ceiling heights in the world, its weight. */
const slot = () => ({
  // vec4s: arrays of vec2 pad differently between the WebGPU and WebGL2 backends.
  outline: uniformArray(Array.from({ length: MAX_OUTLINE }, () => new Vector4()), 'vec4'),
  corners: uniform(0),
  floor: uniform(new Vector2(-1e4, 1e4)),
  weight: uniform(0),
})
type Slot = ReturnType<typeof slot>

export const roomInk = {
  /** How coloured the home is outside the picked rooms: 1 with no room picked, 0 with one. */
  rest: uniform(1),
  slots: [slot(), slot()] as const,
}

/** A room's outline in world x/z into a slot: closed, at most `MAX_OUTLINE` corners (else its bounding box). */
export function setRoomOutline(index: 0 | 1, points: readonly [number, number][], floorY: number, height: number) {
  let shape = points
  if (shape.length > MAX_OUTLINE) {
    const xs = points.map((p) => p[0])
    const zs = points.map((p) => p[1])
    const [x0, x1, z0, z1] = [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)]
    shape = [[x0, z0], [x1, z0], [x1, z1], [x0, z1]]
  }
  const target = roomInk.slots[index]
  const array = target.outline.array as Vector4[]
  shape.forEach(([x, z], i) => array[i]!.set(x, z, 0, 0))
  target.corners.value = shape.length
  target.floor.value.set(floorY - 0.12, floorY + height + 0.2)
}

/** Copies slot 0 into slot 1: the room let go keeps fading out there. */
export function shiftRoomSlot() {
  const [a, b] = roomInk.slots
  ;(b.outline.array as Vector4[]).forEach((v, i) => v.copy((a.outline.array as Vector4[])[i]!))
  b.corners.value = a.corners.value
  b.floor.value.copy(a.floor.value)
  b.weight.value = a.weight.value
}

/**
 * A TSL node. three's TSL typings can't follow swizzles and mixed float/vec maths through
 * generic code like this, so the graph below is typed loosely; the shaders are checked when built.
 */
// biome-ignore lint/suspicious/noExplicitAny: see above
type N = any

/** Signed distance to a slot's outline, positive inside. */
const roomDistance = (s: Slot): ((p: N) => N) => Fn(([p]: [N]) => {
  const corners: N = int(s.corners)
  const inside = float(0).toVar()
  const d = float(1e4).toVar()
  Loop({ start: int(0), end: int(MAX_OUTLINE), type: 'int', condition: '<' }, ({ i }: { i: N }) => {
    If(i.greaterThanEqual(corners), () => {
      Break()
    })
    const j: N = select(i.equal(0), corners.sub(1), i.sub(1))
    const a: N = ((s.outline as N).element(i) as N).xy.toVar()
    const b: N = ((s.outline as N).element(j) as N).xy.toVar()
    const crosses = a.y.greaterThan(p.y).notEqual(b.y.greaterThan(p.y))
    const at = b.x.sub(a.x).mul(p.y.sub(a.y)).div(b.y.sub(a.y)).add(a.x)
    If(crosses.and(p.x.lessThan(at)), () => {
      inside.assign(float(1).sub(inside))
    })
    const pa = p.sub(a)
    const ba = b.sub(a)
    const h = clamp(dot(pa, ba).div(max(dot(ba, ba), 1e-6)), 0, 1)
    d.assign(d.min(length(pa.sub(ba.mul(h)))))
  })
  return select(corners.lessThan(3), float(-1e4), select(inside.greaterThan(0.5), d, d.negate()))
}) as N

const distances = roomInk.slots.map(roomDistance)

/** How far a slot's room claims this point: inside its outline up to its walls' inner faces, on its floor. */
const inSlot = (index: 0 | 1, w: N): N => {
  const s = roomInk.slots[index]
  return smoothstep(-0.06, 0, distances[index]!(w.xz)).mul(step((s.floor as N).x, w.y)).mul(step(w.y, (s.floor as N).y))
}

/** How coloured this point is, 0 wireframe to 1 colour. */
const colourAt: (w: N) => N = Fn(([w]: [N]) => {
  const a: N = inSlot(0, w).mul(roomInk.slots[0].weight)
  const b: N = inSlot(1, w).mul(roomInk.slots[1].weight)
  return max(roomInk.rest, max(a, b))
}) as N

/** One threshold per pixel (interleaved gradient noise): the fade is a dissolve, never a blend. */
const dither = (): N => fract(float(52.9829189).mul(fract(dot(screenCoordinate.xy, vec2(0.06711056, 0.00583715)))))

/** The wireframe's mask: true where this point is not in colour. */
export function notColoured(): N {
  return (colourAt(positionWorld) as N).lessThanEqual(dither())
}

/** The colour copies' mask: exactly where the wireframe's is not. */
function coloured(): N {
  return (colourAt(positionWorld) as N).greaterThan(dither())
}

/** Fields three's renderer manages per material, never copied. */
const OWN_KEYS = new Set(['uuid', 'id', 'type', 'version', '_listeners'])

/** The material as a node material of its own, as three's renderer converts it, never shared. */
function nodeCopy(source: Material, renderer: WebGPURenderer | null): NodeMaterial {
  if ((source as NodeMaterial).isNodeMaterial) return (source as NodeMaterial).clone()
  const library = (renderer as unknown as { library?: { getMaterialNodeClass(type: string): (new () => NodeMaterial) | null } } | null)?.library
  const NodeClass = library?.getMaterialNodeClass(source.type) ?? MeshStandardNodeMaterial
  const material = new NodeClass()
  const target = material as unknown as Record<string, unknown>
  for (const key in source) {
    if (OWN_KEYS.has(key)) continue
    const value = (source as unknown as Record<string, unknown>)[key]
    if (typeof value === 'function') continue
    target[key] = value
  }
  material.name = source.name
  return material
}

/**
 * The viewer's material as it is, drawn only where the home is in colour: everything of the
 * original (transparency, depth, sides, MRT), so it is the viewer's own render.
 */
export function colourMaterial(source: Material, renderer: WebGPURenderer | null): NodeMaterial {
  const material = nodeCopy(source, renderer)
  const own = (source as NodeMaterial).maskNode as N
  const seam: N = coloured()
  material.maskNode = own ? bool(own).and(seam) : seam
  material.userData = { ...material.userData, __tourNoir: true }
  material.needsUpdate = true
  return material
}

type GraphNode = { id: string; type: string; parentId?: string | null; polygon?: unknown; ceilingHeight?: unknown; height?: unknown }

export type DevelopRoom = {
  id: string
  levelId: string | null
  outline: [number, number][]
  centre: [number, number]
  floorY: number
  height: number
}

const num = (value: unknown, fallback: number) => (typeof value === 'number' && Number.isFinite(value) ? value : fallback)

function levelOf(nodes: Readonly<Record<string, GraphNode | undefined>>, id: string): string | null {
  let node = nodes[id]
  for (let guard = 0; node && guard < 32; guard++) {
    if (node.type === 'level') return node.id
    node = node.parentId ? nodes[node.parentId] : undefined
  }
  return null
}

/** A room (zone) in the world now: its outline through its level's transform. */
export function roomOf(source: ViewerSource, zoneId: string): DevelopRoom | null {
  const nodes = source.nodes as unknown as Readonly<Record<string, GraphNode | undefined>>
  const zone = nodes[zoneId]
  const raw = zone?.polygon as [number, number][] | { points?: [number, number][] } | undefined
  const polygon = Array.isArray(raw) ? raw : (raw?.points ?? [])
  if (!zone || polygon.length < 3) return null
  const levelId = levelOf(nodes, zoneId)
  const level = levelId ? source.objectFor(levelId) : undefined
  level?.updateWorldMatrix(true, false)
  const matrix = level?.matrixWorld ?? new Matrix4()
  const p = new Vector3()
  const outline = polygon.map(([x, z]) => {
    p.set(x, 0, z).applyMatrix4(matrix)
    return [p.x, p.z] as [number, number]
  })
  const floorY = p.set(0, 0, 0).applyMatrix4(matrix).y
  const centre = centroid(outline)
  return {
    id: zoneId,
    levelId,
    outline,
    centre,
    floorY,
    height: num(zone.ceilingHeight, num(levelId ? nodes[levelId]?.height : undefined, 2.7)),
  }
}

/** Whether a world point (x, z) is inside an outline. */
export function insideOutline(outline: readonly [number, number][], x: number, z: number): boolean {
  let inside = false
  for (let i = 0, j = outline.length - 1; i < outline.length; j = i++) {
    const [xi, zi] = outline[i]!
    const [xj, zj] = outline[j]!
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside
  }
  return inside
}

function centroid(outline: [number, number][]): [number, number] {
  let area = 0
  let x = 0
  let z = 0
  outline.forEach(([x1, z1], i) => {
    const [x2, z2] = outline[(i + 1) % outline.length]!
    const cross = x1 * z2 - x2 * z1
    area += cross
    x += (x1 + x2) * cross
    z += (z1 + z2) * cross
  })
  if (Math.abs(area) < 1e-6) {
    const n = outline.length
    return [outline.reduce((s, q) => s + q[0], 0) / n, outline.reduce((s, q) => s + q[1], 0) / n]
  }
  return [x / (3 * area), z / (3 * area)]
}
