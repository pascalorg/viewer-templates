import { sceneRegistry } from '@pascal-app/core'
import { SCENE_LAYER } from '@pascal-app/viewer'
import type { ViewerSource } from '@pascal-app/viewer/ui'
import * as THREE from 'three'

/**
 * The pieces a build animation moves: one per scene node that draws something (a wall, a slab,
 * a door, a sofa), with its object, where it sits in the world and which construction phase it
 * belongs to. Containers (site, building, level) and helpers (rooms, guides, scans) stay put.
 */

export type BuildPhase =
  | 'ground' // slabs, floors, foundations
  | 'frame' // columns, beams
  | 'walls'
  | 'stairs'
  | 'ceilings'
  | 'roof'
  | 'openings' // doors, windows, skylights
  | 'exterior' // fences, gutters, solar panels and the like
  | 'items' // furniture, fixtures, plugin items

export const PHASE_ORDER: readonly BuildPhase[] = [
  'ground', 'frame', 'walls', 'stairs', 'ceilings', 'roof', 'openings', 'exterior', 'items',
]

export type BuildElement = {
  id: string
  kind: string
  phase: BuildPhase
  object: THREE.Object3D
  /** World bounds at rest. */
  box: THREE.Box3
  center: THREE.Vector3
  size: THREE.Vector3
  /** Index of its level from the ground up (0 for the ground floor). */
  storey: number
  /** The nearest animated ancestor, whose motion it already inherits. */
  parentId: string | null
  /** The rest transform, put back when the animation ends. */
  rest: {
    position: THREE.Vector3
    quaternion: THREE.Quaternion
    scale: THREE.Vector3
    visible: boolean
    matrix: THREE.Matrix4
  }
  /** Pivots in the object's own frame: the bottom centre and the centre of its drawn bounds. */
  basePivot: THREE.Vector3
  centerPivot: THREE.Vector3
  /** A stable per-element random in [0, 1), so a template looks the same on every replay. */
  seed: number
}

/** A room (zone) in world space: its outline on the ground, its storey and its floor area. */
export type BuildRoom = {
  id: string
  name: string
  outline: THREE.Vector2[]
  bottom: number
  top: number
  storey: number
  area: number
  box: THREE.Box3
}

export type BuildSet = {
  elements: BuildElement[]
  rooms: BuildRoom[]
  box: THREE.Box3
  center: THREE.Vector3
  size: THREE.Vector3
  /** Radius of the footprint around `center`, metres. */
  radius: number
  groundY: number
  storeys: number
  /** The levels from the ground up (index = storey), with their objects and names. */
  levels: Array<{ id: string; object: THREE.Object3D; name: string }>
}

const SKIP_KINDS = new Set([
  'site', 'building', 'level', 'zone', 'unit', 'spawn', 'guide', 'scan', 'measurement',
  'construction-dimension', 'structural-grid', 'floor-opening',
])

const PHASE_BY_KIND: Record<string, BuildPhase> = {
  slab: 'ground',
  floor: 'ground',
  block: 'ground',
  column: 'frame',
  beam: 'frame',
  wall: 'walls',
  separator: 'walls',
  'lean-to-extension': 'walls',
  elevator: 'stairs',
  stair: 'stairs',
  'stair-segment': 'stairs',
  ceiling: 'ceilings',
  roof: 'roof',
  'roof-segment': 'roof',
  dormer: 'roof',
  chimney: 'roof',
  cupola: 'roof',
  door: 'openings',
  window: 'openings',
  skylight: 'openings',
  fence: 'exterior',
  'fence-gate': 'exterior',
  'fence-opening': 'exterior',
  gutter: 'exterior',
  downspout: 'exterior',
  'box-vent': 'exterior',
  'ridge-vent': 'exterior',
  'turbine-vent': 'exterior',
  'eyebrow-vent': 'exterior',
  'solar-panel': 'exterior',
}

type NodeLike = {
  id?: string
  type?: string
  name?: string
  parentId?: string | null
  children?: string[]
  polygon?: Array<[number, number]>
  floor?: { elevation?: number }
  height?: number
}

function phaseOf(kind: string): BuildPhase {
  return PHASE_BY_KIND[kind] ?? 'items'
}

/** A cheap string hash to [0, 1): the same id always gets the same jitter. */
function hashSeed(id: string): number {
  let h = 2166136261
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return ((h >>> 0) % 100000) / 100000
}

const _inverse = new THREE.Matrix4()

/** The object's drawn bounds in world space: meshes on the scene layer only, no helpers. */
function drawnBounds(object: THREE.Object3D, out: THREE.Box3): THREE.Box3 {
  out.makeEmpty()
  object.updateWorldMatrix(true, true)
  const meshBox = new THREE.Box3()
  object.traverse((child) => {
    const mesh = child as THREE.Mesh
    if (!mesh.isMesh || !mesh.geometry) return
    const position = mesh.geometry.getAttribute('position')
    if (!position || position.count === 0) return
    // Batched originals sit on another layer but still draw once the animation hands them back.
    const material = mesh.material as THREE.Material | THREE.Material[]
    const list = Array.isArray(material) ? material : [material]
    if (list.length > 0 && list.every((m) => m && m.visible === false)) return
    if (/collision|collider|cutout|hitbox/i.test(mesh.name)) return
    if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox()
    meshBox.copy(mesh.geometry.boundingBox!).applyMatrix4(mesh.matrixWorld)
    if (Number.isFinite(meshBox.min.x) && Number.isFinite(meshBox.max.x)) out.union(meshBox)
  })
  return out
}

function storeyIndex(id: string, nodes: Record<string, NodeLike | undefined>, levelOrder: Map<string, number>): number {
  let current = nodes[id]
  for (let guard = 0; current && guard < 24; guard++) {
    if (current.type === 'level' && current.id) return levelOrder.get(current.id) ?? 0
    current = current.parentId ? nodes[current.parentId] : undefined
  }
  return 0
}

/**
 * Collects the build from the live registry (or the bake's objects through `source.objectFor`),
 * measuring each piece at rest. Call it while nothing is animated.
 */
export function collectBuild(source: ViewerSource): BuildSet | null {
  const nodes = source.nodes as unknown as Record<string, NodeLike | undefined>
  const objectFor = (id: string) => source.objectFor(id) ?? sceneRegistry.nodes.get(id)

  // Levels bottom-up by their world height.
  const levels: Array<{ id: string; y: number; object: THREE.Object3D }> = []
  for (const [id, node] of Object.entries(nodes)) {
    if (node?.type !== 'level') continue
    const object = objectFor(id)
    if (!object) continue
    object.updateWorldMatrix(true, false)
    levels.push({ id, y: object.matrixWorld.elements[13] ?? 0, object })
  }
  levels.sort((a, b) => a.y - b.y)
  const levelOrder = new Map(levels.map((level, index) => [level.id, index]))

  const picked = new Map<string, THREE.Object3D>()
  for (const [id, node] of Object.entries(nodes)) {
    if (!node?.type || SKIP_KINDS.has(node.type)) continue
    const object = objectFor(id)
    if (!object) continue
    picked.set(id, object)
  }

  const elements: BuildElement[] = []
  const all = new THREE.Box3()
  const objectToId = new Map<THREE.Object3D, string>()
  for (const [id, object] of picked) objectToId.set(object, id)

  for (const [id, object] of picked) {
    const node = nodes[id]!
    const box = drawnBounds(object, new THREE.Box3())
    if (box.isEmpty()) continue
    const size = box.getSize(new THREE.Vector3())
    // Skip anything absurd (a far-off helper plane) so it can't blow up the framing.
    if (size.x > 500 || size.z > 500) continue

    // The nearest picked ancestor through the object tree.
    let parentId: string | null = null
    for (let at = object.parent; at; at = at.parent) {
      const owner = objectToId.get(at)
      if (owner) {
        parentId = owner
        break
      }
    }

    object.updateWorldMatrix(true, false)
    _inverse.copy(object.matrixWorld).invert()
    const worldBase = new THREE.Vector3((box.min.x + box.max.x) / 2, box.min.y, (box.min.z + box.max.z) / 2)
    const worldCenter = box.getCenter(new THREE.Vector3())

    elements.push({
      id,
      kind: node.type!,
      phase: phaseOf(node.type!),
      object,
      box,
      center: worldCenter.clone(),
      size,
      storey: storeyIndex(id, nodes, levelOrder),
      parentId,
      rest: {
        position: object.position.clone(),
        quaternion: object.quaternion.clone(),
        scale: object.scale.clone(),
        visible: object.visible,
        matrix: object.matrix.clone(),
      },
      basePivot: worldBase.applyMatrix4(_inverse),
      centerPivot: worldCenter.clone().applyMatrix4(_inverse),
      seed: hashSeed(id),
    })
    if (node.type !== 'item' || size.y < 20) all.union(box)
  }

  if (elements.length === 0 || all.isEmpty()) return null

  const rooms: BuildRoom[] = []
  for (const [id, node] of Object.entries(nodes)) {
    if (node?.type !== 'zone' || !node.polygon || node.polygon.length < 3) continue
    const levelId = node.parentId ?? null
    const levelObject = levelId ? objectFor(levelId) : undefined
    const matrix = new THREE.Matrix4()
    if (levelObject) {
      levelObject.updateWorldMatrix(true, false)
      matrix.copy(levelObject.matrixWorld)
    }
    const floor = node.floor?.elevation ?? 0
    const height = (levelId ? nodes[levelId]?.height : undefined) ?? 2.7
    const p = new THREE.Vector3()
    const outline = node.polygon.map(([x, z]) => {
      p.set(x, floor, z).applyMatrix4(matrix)
      return new THREE.Vector2(p.x, p.z)
    })
    const bottom = p.set(node.polygon[0]![0], floor, node.polygon[0]![1]).applyMatrix4(matrix).y
    let area = 0
    const box = new THREE.Box3()
    for (let i = 0; i < outline.length; i++) {
      const a = outline[i]!
      const b = outline[(i + 1) % outline.length]!
      area += a.x * b.y - b.x * a.y
      box.expandByPoint(new THREE.Vector3(a.x, bottom, a.y))
    }
    box.min.y = bottom
    box.max.y = bottom + height
    rooms.push({
      id,
      name: node.name?.trim() || '',
      outline,
      bottom,
      top: bottom + height,
      storey: levelId ? levelOrder.get(levelId) ?? 0 : 0,
      area: Math.abs(area) / 2,
      box,
    })
  }

  const center = all.getCenter(new THREE.Vector3())
  const size = all.getSize(new THREE.Vector3())
  return {
    elements,
    rooms,
    box: all,
    center,
    size,
    radius: Math.max(1, Math.hypot(size.x, size.z) / 2),
    groundY: all.min.y,
    storeys: Math.max(1, levels.length),
    levels: levels.map((level, index) => ({
      id: level.id,
      object: level.object,
      name: nodes[level.id]?.name?.trim() || `Level ${index + 1}`,
    })),
  }
}

/** Every mesh under the element that draws on the scene layer at rest (or is a batched original). */
export function elementMeshes(element: BuildElement): THREE.Mesh[] {
  const meshes: THREE.Mesh[] = []
  element.object.traverse((child) => {
    const mesh = child as THREE.Mesh
    if (mesh.isMesh) meshes.push(mesh)
  })
  return meshes
}

export { SCENE_LAYER }

/** Whether the point (x, z) is inside the outline. */
export function insideOutline(outline: readonly THREE.Vector2[], x: number, z: number): boolean {
  let inside = false
  for (let i = 0, j = outline.length - 1; i < outline.length; j = i++) {
    const a = outline[i]!
    const b = outline[j]!
    if ((a.y > z) !== (b.y > z) && x < ((b.x - a.x) * (z - a.y)) / (b.y - a.y) + a.x) inside = !inside
  }
  return inside
}

/** Distance from (x, z) to the outline's edges. */
export function distanceToOutline(outline: readonly THREE.Vector2[], x: number, z: number): number {
  let best = Infinity
  for (let i = 0; i < outline.length; i++) {
    const a = outline[i]!
    const b = outline[(i + 1) % outline.length]!
    const abx = b.x - a.x
    const abz = b.y - a.y
    const t = Math.max(0, Math.min(1, ((x - a.x) * abx + (z - a.y) * abz) / Math.max(1e-9, abx * abx + abz * abz)))
    best = Math.min(best, Math.hypot(x - (a.x + abx * t), z - (a.y + abz * t)))
  }
  return best
}
