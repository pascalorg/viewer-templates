import { heldReasons } from '@pascal-app/viewer'
import { DoubleSide, type Material, Matrix4, Mesh, MeshBasicMaterial, type Object3D, Shape, ShapeGeometry, Vector2 } from 'three'
import type { Room } from './membership'

/**
 * /next's discovery wash: a white veil over what is discovered, never a change to the model.
 * Separate meshes reference the source geometry (or a room's outline) with a private material,
 * so batches keep drawing underneath and nothing the model owns is touched.
 */
export const WASH_OPACITY = 0.11
export const WASH_IN_MS = 120
export const WASH_OUT_MS = 70
/** A floor wash floats this far above the finished floor (/next's lift). */
export const FLOOR_LIFT = 0.035
/** /next stops copying an area's meshes here. */
const MAX_MESHES = 400

/**
 * The veil's white, in scene light. /next blends its veil after tone mapping; ours is drawn with the
 * scene, before the viewer's exposure and grade, which leave a fixed white dimmer the higher the
 * exposure (night). Measured against /next at Night, Dusk and Day (an entrance and interior
 * rooms: the veil lifts a surface about 15% of the way to white, in linear display terms), the
 * white that matches grows with the square root of the exposure; a floor outline needs more than
 * an area's parts, whose lit sides already read brighter.
 */
export const WASH_GAIN = { floor: 1.25, parts: 0.7 } as const
export function washGain(exposure: number, kind: keyof typeof WASH_GAIN) {
  return Math.min(4, WASH_GAIN[kind] * Math.sqrt(Math.max(0.05, exposure)))
}

export const easeOutCubic = (t: number) => 1 - (1 - Math.min(1, Math.max(0, t))) ** 3

export function washMaterial(): MeshBasicMaterial {
  return new MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0,
    depthTest: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -3,
    polygonOffsetUnits: -3,
    toneMapped: false,
    side: DoubleSide,
    fog: false,
  })
}

const noRaycast = () => {}

/** One overlay mesh that follows `follow`'s world matrix (times `local`) each frame. */
export type WashMesh = { mesh: Mesh; follow: Object3D; local: Matrix4 | null; owned: boolean }

function overlay(geometry: Mesh['geometry'], material: Material, follow: Object3D, local: Matrix4 | null, owned: boolean): WashMesh {
  const mesh = new Mesh(geometry, material)
  mesh.matrixAutoUpdate = false
  mesh.renderOrder = 30
  mesh.raycast = noRaycast
  mesh.castShadow = false
  mesh.receiveShadow = false
  mesh.frustumCulled = false
  mesh.userData.discoveryWash = true
  return { mesh, follow, local, owned }
}

/** A room's outline as a flat mesh on its floor, in its level's frame. */
export function floorWash(room: Room, level: Object3D, material: Material): WashMesh {
  const shape = new Shape(room.polygon.map(([x, z]) => new Vector2(x, z)))
  for (const hole of room.holes) shape.holes.push(new Shape(hole.map(([x, z]) => new Vector2(x, z))))
  const geometry = new ShapeGeometry(shape)
  // The outline is drawn in XY; lay it on XZ (y = z of the plan), then lift it onto the floor.
  geometry.rotateX(Math.PI / 2)
  geometry.translate(0, room.floorY + FLOOR_LIFT, 0)
  return overlay(geometry, material, level, null, true)
}

function shown(object: Object3D): boolean {
  for (let node: Object3D | null = object; node; node = node.parent) if (!node.visible) return false
  return true
}

/** The visible meshes an area's parts draw with, stopping at other nodes they host. */
export function memberWash(roots: readonly Object3D[], material: Material, isNodeRoot: (object: Object3D) => boolean): WashMesh[] {
  const meshes: WashMesh[] = []
  const seen = new Set<object>()
  const visit = (object: Object3D, root: boolean) => {
    if (meshes.length >= MAX_MESHES) return
    if (!root && isNodeRoot(object)) return
    if (object.userData.discoveryWash) return
    const mesh = object as Mesh & { isInstancedMesh?: boolean; isBatchedMesh?: boolean }
    if (mesh.isMesh && !mesh.isInstancedMesh && !mesh.isBatchedMesh && mesh.geometry && !seen.has(mesh) &&
      !heldReasons(mesh)?.has('xray') && shown(mesh)) {
      seen.add(mesh)
      meshes.push(overlay(mesh.geometry, material, mesh, null, false))
    }
    for (const child of object.children) visit(child, false)
  }
  for (const root of roots) visit(root, true)
  return meshes
}

/** Each frame: copy each followed object's world matrix (they move with exploded floors). */
export function followWash(meshes: readonly WashMesh[]) {
  for (const { mesh, follow, local } of meshes) {
    mesh.matrix.copy(follow.matrixWorld)
    if (local) mesh.matrix.multiply(local)
    mesh.matrixWorldNeedsUpdate = true
  }
}

export function disposeWash(meshes: readonly WashMesh[]) {
  for (const { mesh, owned } of meshes) {
    mesh.removeFromParent()
    if (owned) mesh.geometry.dispose()
  }
}
