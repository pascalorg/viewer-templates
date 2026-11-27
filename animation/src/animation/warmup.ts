import * as THREE from 'three'
import { uniform } from 'three/tsl'

/**
 * The animations' shader warm-up. three's WebGPU renderer builds a material's shader and pipeline
 * the first time it draws it, inside Pascal's scene pass (its MRT outputs, its lights), and that
 * build is the freeze when a piece first appears. `compileAsync` would build outside that pass, for
 * the wrong outputs; so a material is warmed up the way it will be drawn: a stand-in mesh with the
 * real geometry and material is drawn in the scene for a frame, and every one of our materials
 * discards a stand-in's every pixel (`notWarmup` in its mask), so nothing shows.
 */

// biome-ignore lint/suspicious/noExplicitAny: three's TSL typings can't follow onObjectUpdate's node
type N = any

/** 1 while three draws a warm-up stand-in, 0 for anything else. */
const warming: N = (uniform(0) as N).onObjectUpdate(({ object }: { object: THREE.Object3D }) => (object.userData.__warmup ? 1 : 0))

/** Put in every warmed material's mask: false (discard) for a stand-in. */
export function notWarmup(): N {
  return warming.lessThan(0.5)
}

export type WarmItem = {
  geometry: THREE.BufferGeometry
  material: THREE.Material | THREE.Material[]
  /** An instanced mesh draws through another shader variant. */
  instanced?: boolean
  lines?: boolean
  layers?: number
}

const NO_RAYCAST = () => {}

/** What decides a shader variant: the material and the geometry's attributes. */
function variantOf(item: WarmItem): string {
  const materials = Array.isArray(item.material) ? item.material : [item.material]
  const attributes = Object.keys(item.geometry.attributes).sort().join(',')
  return `${materials.map((m) => m.uuid).join('+')}|${attributes}|${item.instanced ? 'i' : ''}${item.lines ? 'l' : ''}`
}

/**
 * Draws stand-ins for what it is given, a batch a frame, in front of the camera so the frustum
 * keeps them. `step` is called from a `useFrame`; each variant is drawn once per page.
 */
export class Warmup {
  private static readonly seen = new Set<string>()
  private readonly queue: WarmItem[] = []
  private live: THREE.Object3D[] = []
  private readonly group = new THREE.Group()

  constructor(private readonly scene: THREE.Scene, private readonly perFrame = 12) {
    this.group.name = 'animation-warmup'
    this.group.userData.__tourNoir = true
  }

  add(items: Iterable<WarmItem>) {
    for (const item of items) {
      const key = variantOf(item)
      if (Warmup.seen.has(key)) continue
      Warmup.seen.add(key)
      this.queue.push(item)
    }
  }

  get pending(): number {
    return this.queue.length + this.live.length
  }

  /** Takes last frame's stand-ins away and puts the next batch in. True while there is more. */
  step(camera: THREE.Camera): boolean {
    for (const object of this.live) object.removeFromParent()
    this.live = []
    if (this.queue.length === 0) {
      this.group.removeFromParent()
      return false
    }
    if (!this.group.parent) this.scene.add(this.group)
    // In front of the camera: what a frustum keeps, every stand-in a frame.
    camera.updateMatrixWorld()
    camera.getWorldDirection(_ahead)
    this.group.position.copy(camera.position).addScaledVector(_ahead, 2)
    for (const item of this.queue.splice(0, this.perFrame)) {
      let object: THREE.Object3D
      if (item.lines) {
        object = new THREE.LineSegments(item.geometry, item.material)
      } else if (item.instanced) {
        const mesh = new THREE.InstancedMesh(item.geometry, item.material, 1)
        mesh.setMatrixAt(0, _identity)
        object = mesh
      } else {
        object = new THREE.Mesh(item.geometry, item.material)
      }
      object.frustumCulled = false
      object.raycast = NO_RAYCAST
      object.userData = { __warmup: true, __tourNoir: true }
      if (item.layers !== undefined) object.layers.mask = item.layers
      this.group.add(object)
      this.live.push(object)
    }
    return true
  }

  dispose() {
    for (const object of this.live) object.removeFromParent()
    this.live = []
    this.queue.length = 0
    this.group.removeFromParent()
  }
}

const _ahead = new THREE.Vector3()
const _identity = new THREE.Matrix4()
