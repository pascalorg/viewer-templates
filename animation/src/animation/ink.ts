import { type Material, Vector4 } from 'three'
import { bool, Break, dot, float, Fn, fract, If, int, Loop, max, positionWorld, screenCoordinate, smoothstep, step, uniform, uniformArray, vec2 } from 'three/tsl'
import { MeshStandardNodeMaterial, type NodeMaterial, type WebGPURenderer } from 'three/webgpu'
import { notWarmup } from './warmup'

/**
 * Where the Noir look is in colour, for the Blueprint build (after the Home Assistant viewer's
 * `roomInk.ts`). Walls and glass always stay wireframe; furniture, doors, windows and floors draw
 * as ghosts until their floor develops: a circle of colour grows from the floor's centre, and the
 * ghosts dissolve into the viewer's own materials as it passes (one dither threshold per pixel, so
 * it is a dissolve, never a blend). `rest` colours everything at once, for the finale.
 *
 * The wireframe's materials draw where a point is not coloured (`notColoured`), the colour copies
 * (`colourMaterial`) exactly where it is.
 */

export const MAX_FLOORS = 16

export const floorInk = {
  /** Per floor: centre x, centre z, the radius the colour has reached, and the edge's softness. */
  circles: uniformArray(Array.from({ length: MAX_FLOORS }, () => new Vector4(0, 0, -1, 1)), 'vec4'),
  /** Per floor: the heights it claims, bottom and top. */
  heights: uniformArray(Array.from({ length: MAX_FLOORS }, () => new Vector4(-1e4, -1e4, 0, 0)), 'vec4'),
  count: uniform(0),
  /** 0 to 1: everything in colour, whatever its floor. */
  rest: uniform(0),
}

/** Puts a floor's circle and heights in its slot. */
export function setFloorInk(index: number, x: number, z: number, radius: number, bottom: number, top: number) {
  if (index >= MAX_FLOORS) return
  ;(floorInk.circles.array as Vector4[])[index]!.set(x, z, radius, 1.2)
  ;(floorInk.heights.array as Vector4[])[index]!.set(bottom, top, 0, 0)
}

/** Back to nothing in colour: the wireframe draws everything. */
export function clearFloorInk() {
  floorInk.count.value = 0
  floorInk.rest.value = 0
  for (const v of floorInk.circles.array as Vector4[]) v.set(0, 0, -1, 1)
  for (const v of floorInk.heights.array as Vector4[]) v.set(-1e4, -1e4, 0, 0)
}

/** Everything in colour (no run is driving the ink: the look at rest). */
export function fullFloorInk() {
  floorInk.rest.value = 1
}

// biome-ignore lint/suspicious/noExplicitAny: three's TSL typings can't follow this graph; the shaders are checked when built
type N = any

/** How coloured this point is, 0 wireframe to 1 colour. */
const colourAt: (w: N) => N = Fn(([w]: [N]) => {
  const c = float(floorInk.rest).toVar()
  Loop({ start: int(0), end: int(MAX_FLOORS), type: 'int', condition: '<' }, ({ i }: { i: N }) => {
    If(i.greaterThanEqual(int(floorInk.count)), () => {
      Break()
    })
    const circle: N = (floorInk.circles as N).element(i)
    const height: N = (floorInk.heights as N).element(i)
    const d = w.xz.sub(circle.xy).length()
    const inside = float(1).sub(smoothstep(circle.z.sub(circle.w), circle.z, d))
    const onFloor = step(height.x, w.y).mul(step(w.y, height.y))
    c.assign(max(c, inside.mul(onFloor)))
  })
  return c
}) as N

/** One threshold per pixel (interleaved gradient noise). */
const dither = (): N => fract(float(52.9829189).mul(fract(dot(screenCoordinate.xy, vec2(0.06711056, 0.00583715)))))

/** The wireframe's mask: true where this point is not in colour. */
export function notColoured(): N {
  return (colourAt(positionWorld) as N).lessThanEqual(dither())
}

function coloured(): N {
  return (colourAt(positionWorld) as N).greaterThan(dither())
}

/** Fields three's renderer manages per material, never copied. */
const OWN_KEYS = new Set(['uuid', 'id', 'type', 'version', '_listeners'])

/** The material as a node material of its own, as three's renderer converts it, never shared. */
export function nodeCopy(source: Material, renderer: WebGPURenderer | null): NodeMaterial {
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

/** The viewer's material as it is, drawn only where the home is in colour. */
export function colourMaterial(source: Material, renderer: WebGPURenderer | null): NodeMaterial {
  const material = nodeCopy(source, renderer)
  const own = (source as NodeMaterial).maskNode as N
  const seam: N = coloured().and(notWarmup())
  material.maskNode = own ? bool(own).and(seam) : seam
  material.userData = { ...material.userData, __tourNoir: true }
  material.needsUpdate = true
  return material
}
