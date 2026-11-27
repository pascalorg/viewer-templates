import { sceneRegistry, useInteractive } from '@pascal-app/core'
import { BATCHED_LAYER, getSceneTheme, SCENE_LAYER, SITE_GROUND, useViewer } from '@pascal-app/viewer'
import type { ViewerSource } from '@pascal-app/viewer/ui'
import { useFrame, useThree } from '@react-three/fiber'
import { useLayoutEffect, useRef } from 'react'
import * as THREE from 'three'
import { length, mix, mrt, output, positionLocal, screenSize, screenUV, smoothstep, uniform, vec2, vec4 } from 'three/tsl'
import { LineBasicNodeMaterial, MeshStandardNodeMaterial, type Node, type NodeBuilder, type NodeMaterial, type WebGPURenderer } from 'three/webgpu'
import { colourMaterial, notColoured } from './ink'
import { notWarmup, type WarmItem, Warmup } from './warmup'

/**
 * The Blueprint build's look, ported from the Home Assistant viewer's `HomeNoir` (itself the
 * guided tour's `TourNoir`): a wireframe the way the Pascal Noir editor draws it. Frosted walls with
 * bright edges where the eye reads an outline (coplanar triangles merged, so no stray diagonals),
 * pale ghosts for the furniture, on a near-black ground lit grey in the middle of the screen.
 * Furniture, doors, windows and floors come into their own colours as their floor develops
 * (`ink.ts`): colour copies of the viewer's own materials draw there while the wireframe steps aside.
 *
 * Pascal's own renderer stays on (its lights, shadows, ink edges and post-processing): this swaps
 * the scene theme and the surface materials, and puts everything back on unmount.
 *
 * Every material here is single-sided: a double-sided node material inside Pascal's MRT scene pass
 * poisons the WebGPU render context (see `glassMaterial` in `@pascal-app/viewer`'s materials).
 */

const EDGE_THRESHOLD_DEG = 35
const RESCAN_INTERVAL_S = 0.25
const NO_RAYCAST = () => {}

type Palette = {
  bg: string
  ground: string
  /** The ground's light in the middle of the screen, behind the plan. */
  glow: string
  wall: string
  wallOpacity: number
  edge: string
  wallEdgeOpacity: number
  item: string
  itemOpacity: number
  itemEdgeOpacity: number
  floor: string
  floorOpacity: number
  glass: string
  glassOpacity: number
}

/** The Home Assistant viewer's dark X-ray: frosted walls, pale ghosts, ink edges on a grey glow. */
const NOIR: Palette = {
  bg: '#08090a',
  ground: '#0c0d0f',
  glow: '#3a3e44',
  wall: '#b9c2cc',
  wallOpacity: 0.1,
  edge: '#f1f3f6',
  wallEdgeOpacity: 0.6,
  item: '#cfd4da',
  itemOpacity: 0.2,
  itemEdgeOpacity: 0.45,
  floor: '#b9c2cc',
  floorOpacity: 0.1,
  glass: '#b9c2cc',
  glassOpacity: 0.1,
}

/** Pascal's scene theme for the look: the Noir editor's background, ground and light rig. */
function noirAppearance() {
  const base = getSceneTheme('night')
  return {
    ...base,
    background: NOIR.bg,
    backgroundSky: null,
    ground: NOIR.ground,
    ambient: { color: '#ffffff', intensity: 0.55 },
    hemi: { sky: '#ffffff', ground: '#0b0b0b', intensity: 0.9 },
    lights: [
      { position: [-9, 16, 8] as [number, number, number], color: '#ffffff', intensity: 2.2, castShadow: true },
      { position: [10, 6, -10] as [number, number, number], color: '#ffffff', intensity: 0.6 },
    ],
    toneMappingExposure: 1,
    postprocessing: { ambientOcclusion: true, colorGrading: false },
  }
}

/** 'none': a surface left out of the drawing, whose children still draw. */
type NoirRole = 'wall' | 'floor' | 'item' | 'glass' | 'ground' | 'none'

type NodeLike = {
  id?: string
  type?: string
  parentId?: string | null
}

/**
 * The outline of a mesh as the eye reads it: creases sharper than `thresholdDeg` and open borders,
 * without the lines between triangles of one flat surface. Like `EdgesGeometry`, but a seam where
 * flat triangles meet without sharing vertices (a wall cut around a window, a panel split into
 * strips) is dropped too: the far side of such an edge is checked for another triangle in the same
 * plane, and when it is covered all along, the surface simply continues there.
 */
function flatEdges(geometry: THREE.BufferGeometry, thresholdDeg: number): THREE.BufferGeometry {
  const result = new THREE.BufferGeometry()
  result.setAttribute('position', new THREE.Float32BufferAttribute(edgeLines(geometry, thresholdDeg), 3))
  return result
}

function positionVersion(geometry: THREE.BufferGeometry): number {
  const position = geometry.getAttribute('position')
  return 'isInterleavedBufferAttribute' in position ? position.data.version : position.version
}

function hasEdgeLines(geometry: THREE.BufferGeometry, thresholdDeg: number): boolean {
  const cached = EDGE_CACHE.get(geometry)
  return !!cached && cached.version === positionVersion(geometry) && cached.threshold === thresholdDeg
}

/** The edge segments, worked out once per geometry: baked batches and instanced items share theirs. */
function edgeLines(geometry: THREE.BufferGeometry, thresholdDeg: number): Float32Array {
  if (hasEdgeLines(geometry, thresholdDeg)) return EDGE_CACHE.get(geometry)!.lines
  const lines = computeFlatEdges(geometry, thresholdDeg)
  EDGE_CACHE.set(geometry, { version: positionVersion(geometry), threshold: thresholdDeg, lines })
  return lines
}

const EDGE_CACHE = new WeakMap<THREE.BufferGeometry, { version: number; threshold: number; lines: Float32Array }>()
const _v0 = new THREE.Vector3()
const _v1 = new THREE.Vector3()
const _v2 = new THREE.Vector3()
const _along = new THREE.Vector3()
const _out = new THREE.Vector3()
const _centroid = new THREE.Vector3()
const _toCentroid = new THREE.Vector3()

function computeFlatEdges(geometry: THREE.BufferGeometry, thresholdDeg: number): Float32Array {
  const position = geometry.getAttribute('position')
  const index = geometry.getIndex()
  const triangleCount = Math.floor((index ? index.count : position.count) / 3)
  const vertex = (i: number) => (index ? index.getX(i) : i)
  const precision = 1e4
  const weld = new Map<string, number>()
  const points: THREE.Vector3[] = []
  const welded = (i: number) => {
    const x = position.getX(i)
    const y = position.getY(i)
    const z = position.getZ(i)
    const key = `${Math.round(x * precision)},${Math.round(y * precision)},${Math.round(z * precision)}`
    let id = weld.get(key)
    if (id === undefined) {
      id = points.length
      points.push(new THREE.Vector3(x, y, z))
      weld.set(key, id)
    }
    return id
  }

  type Tri = { v: [number, number, number]; normal: THREE.Vector3; plane: string }
  const triangles: Tri[] = []
  const planes = new Map<string, number[]>()
  const ab = new THREE.Vector3()
  const ac = new THREE.Vector3()
  for (let t = 0; t < triangleCount; t++) {
    const v: [number, number, number] = [welded(vertex(t * 3)), welded(vertex(t * 3 + 1)), welded(vertex(t * 3 + 2))]
    if (v[0] === v[1] || v[1] === v[2] || v[0] === v[2]) continue
    ab.subVectors(points[v[1]]!, points[v[0]]!)
    ac.subVectors(points[v[2]]!, points[v[0]]!)
    const normal = new THREE.Vector3().crossVectors(ab, ac)
    if (normal.lengthSq() < 1e-14) continue
    normal.normalize()
    const d = normal.dot(points[v[0]]!)
    const plane = `${Math.round(normal.x * 50)},${Math.round(normal.y * 50)},${Math.round(normal.z * 50)},${Math.round(d * 100)}`
    const id = triangles.length
    triangles.push({ v, normal, plane })
    const group = planes.get(plane)
    if (group) group.push(id)
    else planes.set(plane, [id])
  }

  // Each edge with the triangles on it.
  const edges = new Map<string, { a: number; b: number; faces: number[] }>()
  for (let t = 0; t < triangles.length; t++) {
    const { v } = triangles[t]!
    for (let k = 0; k < 3; k++) {
      const a = v[k]!
      const b = v[(k + 1) % 3]!
      const key = a < b ? `${a}_${b}` : `${b}_${a}`
      const edge = edges.get(key)
      if (edge) edge.faces.push(t)
      else edges.set(key, { a, b, faces: [t] })
    }
  }

  // Each triangle's bounds, padded past its barycentric tolerance. `inTriangle` tests the point's
  // projection onto the triangle's plane, so the same projection is checked against the bounds:
  // most of a big flat group is ruled out without the full test, and the answer never changes.
  const bounds = new Float64Array(triangles.length * 6)
  for (let t = 0; t < triangles.length; t++) {
    const [ia, ib, ic] = triangles[t]!.v
    const a = points[ia]!
    const b = points[ib]!
    const c = points[ic]!
    const minX = Math.min(a.x, b.x, c.x)
    const minY = Math.min(a.y, b.y, c.y)
    const minZ = Math.min(a.z, b.z, c.z)
    const maxX = Math.max(a.x, b.x, c.x)
    const maxY = Math.max(a.y, b.y, c.y)
    const maxZ = Math.max(a.z, b.z, c.z)
    const pad = 1e-2 * (maxX - minX + maxY - minY + maxZ - minZ) + 1e-6
    bounds.set([minX - pad, minY - pad, minZ - pad, maxX + pad, maxY + pad, maxZ + pad], t * 6)
  }
  const nearTriangle = (p: THREE.Vector3, t: number) => {
    const tri = triangles[t]!
    const a = points[tri.v[0]]!
    const n = tri.normal
    const off = n.x * (p.x - a.x) + n.y * (p.y - a.y) + n.z * (p.z - a.z)
    const x = p.x - n.x * off
    const y = p.y - n.y * off
    const z = p.z - n.z * off
    const o = t * 6
    return x >= bounds[o]! && y >= bounds[o + 1]! && z >= bounds[o + 2]! &&
      x <= bounds[o + 3]! && y <= bounds[o + 4]! && z <= bounds[o + 5]!
  }

  const inTriangle = (p: THREE.Vector3, tri: Tri) => {
    const a = points[tri.v[0]]!
    const b = points[tri.v[1]]!
    const c = points[tri.v[2]]!
    const v0 = _v0.subVectors(c, a)
    const v1 = _v1.subVectors(b, a)
    const v2 = _v2.subVectors(p, a)
    const d00 = v0.dot(v0)
    const d01 = v0.dot(v1)
    const d02 = v0.dot(v2)
    const d11 = v1.dot(v1)
    const d12 = v1.dot(v2)
    const denominator = d00 * d11 - d01 * d01
    if (Math.abs(denominator) < 1e-18) return false
    const u = (d11 * d02 - d01 * d12) / denominator
    const w = (d00 * d12 - d01 * d02) / denominator
    const tolerance = -1e-4
    return u >= tolerance && w >= tolerance && u + w <= 1 - tolerance
  }

  /** True when the surface carries on flat past this border edge of `face`. */
  const continuesFlat = (a: THREE.Vector3, b: THREE.Vector3, face: number) => {
    const tri = triangles[face]!
    const group = planes.get(tri.plane)
    if (!group || group.length < 2 || group.length > 4096) return false
    const along = _along.subVectors(b, a)
    const length = along.length()
    if (length < 1e-6) return false
    const out = _out.crossVectors(tri.normal, along).normalize()
    // Point away from the face's own interior.
    const centroid = _centroid.copy(points[tri.v[0]]!).add(points[tri.v[1]]!).add(points[tri.v[2]]!).divideScalar(3)
    if (out.dot(_toCentroid.subVectors(centroid, a)) > 0) out.negate()
    const step = Math.min(0.002, length * 0.05)
    const sample = _sample
    for (const f of SAMPLE_AT) {
      sample.copy(a).addScaledVector(along, f).addScaledVector(out, step)
      let covered = false
      for (const other of group) {
        if (other !== face && nearTriangle(sample, other) && inTriangle(sample, triangles[other]!)) {
          covered = true
          break
        }
      }
      if (!covered) return false
    }
    return true
  }

  const crease = Math.cos(THREE.MathUtils.degToRad(thresholdDeg))
  const lines: number[] = []
  for (const { a, b, faces } of edges.values()) {
    let draw: boolean
    if (faces.length === 1) {
      draw = !continuesFlat(points[a]!, points[b]!, faces[0]!)
    } else {
      draw = false
      const first = triangles[faces[0]!]!.normal
      for (let i = 1; i < faces.length && !draw; i++) {
        if (first.dot(triangles[faces[i]!]!.normal) <= crease) draw = true
      }
    }
    if (!draw) continue
    const pa = points[a]!
    const pb = points[b]!
    lines.push(pa.x, pa.y, pa.z, pb.x, pb.y, pb.z)
  }
  return new Float32Array(lines)
}

const SAMPLE_AT = [0.1, 0.3, 0.5, 0.7, 0.9]
const _sample = new THREE.Vector3()

type MeshStash = {
  material: THREE.Material | THREE.Material[]
  castShadow: boolean
  receiveShadow: boolean
  role: NoirRole
  geometryUuid: string
  edge: THREE.LineSegments | null
}

type NodeOwner = {
  id: string
  kind: string
  levelId: string | null
}

function findNodeLevelId(nodeId: string, nodes: Record<string, NodeLike | undefined>): string | null {
  let current = nodes[nodeId]
  for (let guard = 0; current && guard < 16; guard++) {
    if (current.type === 'level') return current.id ?? nodeId
    if (!current.parentId) return null
    const nextId = current.parentId
    current = nodes[nextId]
    if (current?.type === 'level') return nextId
  }
  return null
}

function buildLiveOwnerMap(nodes: Record<string, NodeLike | undefined>): Map<THREE.Object3D, NodeOwner> {
  const map = new Map<THREE.Object3D, NodeOwner>()
  for (const [id, obj] of sceneRegistry.nodes) {
    const node = nodes[id]
    if (!node?.type) continue
    map.set(obj, { id, kind: node.type, levelId: node.type === 'level' ? id : findNodeLevelId(id, nodes) })
  }
  return map
}

const STRUCTURAL_KINDS = new Set([
  'wall',
  'ceiling',
  'roof',
  'roof-segment',
  'column',
  'beam',
  'chimney',
  'dormer',
  'cupola',
  'lean-to-extension',
  'stair',
  'stair-segment',
  'elevator',
  'door',
  'window',
  'skylight',
  'fence',
  'fence-gate',
  'fence-opening',
  'block',
  'gutter',
  'downspout',
  'box-vent',
  'ridge-vent',
  'turbine-vent',
  'eyebrow-vent',
  'solar-panel',
  'separator',
])

const FLOOR_KINDS = new Set(['slab', 'floor'])

const ITEM_KINDS = new Set([
  'item',
  'procedural-item',
  'cabinet',
  'cabinet-module',
  'shelf',
  'imported-mesh',
  'hvac-equipment',
  'duct-segment',
  'duct-fitting',
  'duct-terminal',
  'pipe-segment',
  'pipe-fitting',
  'pipe-trap',
  'lineset',
  'liquid-line',
])

/** Openings: in the walls, but drawn in colour as the furniture is. */
const OPENING_KINDS = new Set(['door', 'window', 'skylight', 'garage-door', 'fence-gate'])

const SKIP_KINDS = new Set([
  'zone',
  'spawn',
  'guide',
  'scan',
  'measurement',
  'construction-dimension',
  'structural-grid',
])

const HELPER_NAMES = new Set([
  'wall-collision',
  'curtain-wall-shadow',
  'ceiling-grid',
  'collider',
  'cutout',
])

function materialLooksGlass(mat: THREE.Material | THREE.Material[] | null | undefined, kind: string | null): boolean {
  if (!mat) return false
  const list = Array.isArray(mat) ? mat : [mat]
  if (list.length === 0) return false
  let hasGlass = false
  for (const entry of list) {
    if (!entry) continue
    if (entry.userData?.isGlass === true || /glass|glaz/i.test(entry.name)) {
      hasGlass = true
      continue
    }
    if (
      entry.transparent &&
      entry.opacity < 0.6 &&
      (kind === 'window' || kind === 'skylight' || kind === 'door' || kind === 'elevator' || kind === 'wall')
    ) {
      hasGlass = true
      continue
    }
    // Mixed multi-material mesh with opaque non-glass parts (e.g. a whole wall): not pure glass.
    return false
  }
  return hasGlass
}

/** One of the tour's own materials, never a mesh's own. */
function isTourMaterial(mat: THREE.Material | THREE.Material[] | null | undefined): boolean {
  const list = Array.isArray(mat) ? mat : mat ? [mat] : []
  return list.some((entry) => entry?.userData?.__tourNoir === true)
}

function materialIsInvisibleHitbox(mat: THREE.Material | THREE.Material[] | null | undefined): boolean {
  if (!mat) return true
  const list = Array.isArray(mat) ? mat : [mat]
  return list.length > 0 && list.every((entry) => entry && entry.visible === false)
}

function isUnderTourNoir(obj: THREE.Object3D): boolean {
  for (let at: THREE.Object3D | null = obj; at; at = at.parent) {
    if (at.userData?.__tourNoir || at.userData?.__tourNoirEdge) return true
  }
  return false
}

function isSiteEnvironmentObject(
  obj: THREE.Object3D,
  liveOwners: Map<THREE.Object3D, NodeOwner>,
): boolean {
  if (obj.userData?.[SITE_GROUND] === 'solid' || obj.userData?.[SITE_GROUND] === 'veil') return true
  // Direct ground/horizon/property-line children of a `site` group (live or baked GLB),
  // stopping before descending into buildings/levels/items hosted on the site.
  const parent = obj.parent
  if (!parent) return false
  const parentOwner = liveOwners.get(parent)
  if (parentOwner?.kind === 'site') {
    return !liveOwners.has(obj) && !(obj.type === 'Group' && obj.children.length > 0)
  }
  if (parent.userData?.kind === 'site' && !obj.userData?.pascalId) {
    return !(obj.type === 'Group' && obj.children.length > 0)
  }
  return false
}

function classifyMesh(
  mesh: THREE.Mesh,
  liveOwners: Map<THREE.Object3D, NodeOwner>,
): { role: NoirRole; levelId: string | null } | null {
  if (!mesh.layers.isEnabled(SCENE_LAYER)) return null
  if (HELPER_NAMES.has(mesh.name)) return null
  const pos = mesh.geometry?.getAttribute('position')
  if (!pos || pos.count === 0) return null

  const ud = mesh.userData as {
    glbBatch?: boolean
    role?: string
    slotId?: string
    __bakedMaterial?: THREE.Material | THREE.Material[]
    bakedMaterial?: THREE.Material | THREE.Material[]
    kind?: string
    pascalId?: string
  }

  // Find owning node (live registry or baked GLB extras) and enclosing level.
  let kind: string | null = ud.kind ?? null
  let levelId: string | null = null
  for (let at: THREE.Object3D | null = mesh; at; at = at.parent) {
    const live = liveOwners.get(at)
    if (live) {
      if (!kind && live.kind !== 'level' && live.kind !== 'building' && live.kind !== 'site') {
        kind = live.kind
      }
      if (!levelId && live.levelId) levelId = live.levelId
      if (live.kind === 'level') {
        levelId = live.id
        break
      }
    }
    const atUd = at.userData as { kind?: string; pascalId?: string } | undefined
    if (atUd?.kind === 'level' && atUd.pascalId) {
      levelId ??= atUd.pascalId
      break
    }
    if (!kind && atUd?.pascalId && atUd.kind && atUd.kind !== 'building' && atUd.kind !== 'site') {
      kind = atUd.kind
    }
  }

  if (kind && SKIP_KINDS.has(kind)) return null
  // Doors and windows are in colour like the furniture, glass and all: Home Assistant can open them.
  if (kind && OPENING_KINDS.has(kind)) return { role: 'item', levelId }

  // 1. Baked GLB merged batches carry Pascal's own `SurfaceRole` (`glb-merge.ts`).
  if (ud.glbBatch && ud.role) {
    if (ud.role === 'glazing') return { role: 'glass', levelId }
    if (ud.role === 'floor') return { role: 'floor', levelId }
    if (ud.role === 'furnishing') return { role: 'item', levelId }
    return { role: 'wall', levelId }
  }

  // 2. Glass check (slotId, baked original material, or live material).
  const sourceMat = ud.__bakedMaterial ?? ud.bakedMaterial ?? mesh.material
  if (ud.slotId === 'glass' || materialLooksGlass(sourceMat, kind)) {
    return { role: 'glass', levelId }
  }

  // 3. Kind classification (works identically for live `sceneRegistry` and baked GLB `userData.kind`).
  if (kind) {
    if (FLOOR_KINDS.has(kind)) return { role: 'floor', levelId }
    if (ITEM_KINDS.has(kind)) return { role: 'item', levelId }
    if (STRUCTURAL_KINDS.has(kind)) return { role: 'wall', levelId }
    // Plugin / custom architectural items default to furnishing so they read crisply with shadows.
    if (kind.includes(':')) return { role: 'item', levelId }
  }

  // 4. Fallback for unattributed meshes under the building: opaque items/fixtures.
  return { role: 'item', levelId }
}

/** Whether a mesh belongs to the scene graph, and to a node Home Assistant keeps in colour. */
function ownership(mesh: THREE.Object3D, owners: Map<THREE.Object3D, NodeOwner>, keep: ReadonlySet<string>): 'graph' | 'kept' | 'outside' {
  let graph = false
  for (let at: THREE.Object3D | null = mesh; at; at = at.parent) {
    const owner = owners.get(at)
    const id = owner?.id ?? (at.userData?.pascalId as string | undefined)
    if (id && keep.has(id)) return 'kept'
    if (id) graph = true
  }
  return graph ? 'graph' : 'outside'
}

/* ---------------- motion kept: what moves inside its own material ---------------- */

/** How a material moves its vertices, when it does: a tree's wind (`windNode`, applied before
    instancing) or a swaying grass blade (`positionNode`). */
type Motion = { wind: Node | null; position: Node | null }

function motionOf(material: THREE.Material | THREE.Material[]): Motion | null {
  for (const m of Array.isArray(material) ? material : [material]) {
    const moving = m as { windNode?: Node | null; positionNode?: Node | null }
    if (moving?.windNode || moving?.positionNode) return { wind: moving.windNode ?? null, position: moving.positionNode ?? null }
  }
  return null
}

/** The wireframe's surface with a mesh's own motion: its leaves still flutter, its grass still sways. */
class MovingSurface extends MeshStandardNodeMaterial {
  wind: Node | null = null
  setupPosition(builder: NodeBuilder): Node {
    // as the trees plugin's WindNodeMaterial: in geometry space, before the instance transform
    if (this.wind !== null) positionLocal.assign(this.wind)
    return super.setupPosition(builder)
  }
  customProgramCacheKey(): string {
    return `${super.customProgramCacheKey()}|wind:${this.wind ? this.wind.id : 'none'}`
  }
}

/** The wireframe's edges with the same motion, so the outline moves with the surface. */
class MovingLine extends LineBasicNodeMaterial {
  wind: Node | null = null
  setupPosition(builder: NodeBuilder): Node {
    if (this.wind !== null) positionLocal.assign(this.wind)
    return super.setupPosition(builder)
  }
  customProgramCacheKey(): string {
    return `${super.customProgramCacheKey()}|wind:${this.wind ? this.wind.id : 'none'}`
  }
}

/** Copies the look the palette paints (`paint` keeps the twins in step with their base). */
function copyLook(from: THREE.Material & { color?: THREE.Color }, to: THREE.Material & { color?: THREE.Color }) {
  to.color?.copy(from.color ?? new THREE.Color())
  to.opacity = from.opacity
  to.transparent = from.transparent
  to.depthWrite = from.depthWrite
  to.polygonOffset = from.polygonOffset
  to.polygonOffsetFactor = from.polygonOffsetFactor
  to.polygonOffsetUnits = from.polygonOffsetUnits
  to.visible = from.visible
}

function createKit(palette: Palette) {
  const wall = new MeshStandardNodeMaterial({
    color: palette.wall,
    roughness: 0.6,
    metalness: 0,
    transparent: true,
    opacity: palette.wallOpacity,
    depthWrite: false,
  })
  const item = new MeshStandardNodeMaterial({
    color: palette.item,
    roughness: 0.6,
    metalness: 0,
    transparent: true,
    opacity: palette.itemOpacity,
    depthWrite: false,
  })
  const floor = new MeshStandardNodeMaterial({
    color: palette.floor,
    roughness: 0.6,
    metalness: 0,
    transparent: true,
    opacity: palette.floorOpacity,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
  })
  // Glass is ghosted like a wall: no tint, no reflections.
  const glass = new MeshStandardNodeMaterial({
    color: palette.glass,
    roughness: 0.6,
    metalness: 0,
    transparent: true,
    opacity: palette.glassOpacity,
    depthWrite: false,
  })
  // The site's ground in the Noir near-black, whatever finish the project gives it, lighter in the
  // middle of the screen: a soft light the plan stands in front of, wherever the camera goes.
  const ground = new MeshStandardNodeMaterial({ color: palette.ground, roughness: 1, metalness: 0 })
  // Pushed back in depth as Pascal's own ground is, so what lies flat on it (the ground floor's
  // paper) never sinks into it.
  ground.polygonOffset = true
  ground.polygonOffsetFactor = 2
  ground.polygonOffsetUnits = 4
  const groundEdge = uniform(new THREE.Color(palette.ground))
  const groundGlow = uniform(new THREE.Color(palette.glow))
  const fromMiddle = length(screenUV.sub(0.5).mul(vec2(screenSize.x.div(screenSize.y), 1)))
  ground.colorNode = mix(groundGlow, groundEdge, smoothstep(0.05, 0.85, fromMiddle))
  const wallEdge = new LineBasicNodeMaterial({ color: palette.edge, transparent: true, opacity: palette.wallEdgeOpacity, depthWrite: false })
  const itemEdge = new LineBasicNodeMaterial({ color: palette.edge, transparent: true, opacity: palette.itemEdgeOpacity, depthWrite: false })
  // Draws nothing: the mesh stays in the scene (and visible), so what Pascal parents under it still draws.
  const none = new MeshStandardNodeMaterial({ visible: false })
  // Lines write nothing to the scene pass's normals and diffuse colour (as Pascal's own dust and
  // light glows do), so the screen-space ink doesn't double the edges.
  for (const line of [wallEdge, itemEdge]) line.mrtNode = mrt({ output, diffuseColor: vec4(0), normal: vec4(0) })
  for (const material of [wall, item, floor, glass, ground, wallEdge, itemEdge, none]) material.userData.__tourNoir = true
  // Furniture and floors are in colour (the copies draw them) wherever the home is: the wireframe
  // draws them only in the rooms faded out. Walls, glass and the ground are always the wireframe's.
  for (const material of [item, floor, itemEdge]) (material as unknown as NodeMaterial).maskNode = notColoured()
  // What has no colour copy (Pascal's batches, skinned models) keeps an unmasked wireframe, always drawn.
  const solid = { item: item.clone(), floor: floor.clone() }
  for (const material of Object.values(solid)) {
    ;(material as unknown as NodeMaterial).maskNode = null
    material.userData.__tourNoir = true
  }
  // A warm-up stand-in (`warmup.ts`) draws nothing in any of them.
  for (const material of [wall, item, floor, glass, wallEdge, itemEdge, solid.item, solid.floor]) {
    const node = material as unknown as NodeMaterial
    // biome-ignore lint/suspicious/noExplicitAny: TSL typings
    node.maskNode = node.maskNode ? (node.maskNode as any).and(notWarmup()) : notWarmup()
  }
  // Moving twins of the surfaces and edges, one per motion and base material.
  const twins = new Map<string, { base: THREE.Material; twin: THREE.Material }>()
  const twin = (base: THREE.Material, motion: Motion): THREE.Material => {
    const key = `${base.uuid}|${motion.wind?.id ?? '-'}|${motion.position?.id ?? '-'}`
    const known = twins.get(key)
    if (known) return known.twin
    const line = base instanceof LineBasicNodeMaterial
    const made = line ? new MovingLine() : new MovingSurface({ roughness: (base as MeshStandardNodeMaterial).roughness, metalness: 0 })
    made.wind = motion.wind
    if (motion.position) made.positionNode = motion.position
    if (line) made.mrtNode = (base as LineBasicNodeMaterial).mrtNode
    copyLook(base, made)
    ;(made as unknown as NodeMaterial).maskNode = (base as unknown as NodeMaterial).maskNode
    made.userData.__tourNoir = true
    twins.set(key, { base, twin: made })
    return made
  }
  // With the whole home in colour the wireframe's furniture and floors would draw nothing: they are
  // left out of the frame then, so a visit costs what Pascal's own viewer does.
  let ghosts = true
  // the edge lines: always on here (the Home Assistant viewer makes them a setting)
  let edges = true
  const sync = () => {
    const shown = new Map<THREE.Material, boolean>([[item, ghosts], [floor, ghosts], [itemEdge, ghosts && edges], [wallEdge, edges]])
    for (const [material, on] of shown) material.visible = on
    for (const { base, twin } of twins.values()) if (shown.has(base)) twin.visible = shown.get(base)!
  }
  sync()
  return {
    wall, item, floor, glass, ground, wallEdge, itemEdge, none, solid,
    /** Whether the wireframe draws furniture and floors at all (only while a room is picked). */
    ghosts(on: boolean) {
      if (on === ghosts) return
      ghosts = on
      sync()
    },
    /** Whether the wireframe draws its edge lines. */
    edges(on: boolean) {
      if (on === edges) return
      edges = on
      sync()
    },
    /** The base material, or its twin that keeps a mesh's own motion. */
    moving(base: THREE.Material, motion: Motion | null): THREE.Material {
      return motion && base !== none ? twin(base, motion) : base
    },
    paint(next: Palette) {
      wall.color.set(next.wall)
      wall.opacity = next.wallOpacity
      item.color.set(next.item)
      item.opacity = next.itemOpacity
      floor.color.set(next.floor)
      floor.opacity = next.floorOpacity
      copyLook(item, solid.item)
      copyLook(floor, solid.floor)
      solid.item.visible = solid.floor.visible = true
      ground.color.set(next.ground)
      groundEdge.value.set(next.ground)
      groundGlow.value.set(next.glow)
      glass.color.set(next.glass)
      glass.opacity = next.glassOpacity
      wallEdge.color.set(next.edge)
      wallEdge.opacity = next.wallEdgeOpacity
      itemEdge.color.set(next.edge)
      itemEdge.opacity = next.itemEdgeOpacity
      for (const { base, twin } of twins.values()) copyLook(base, twin)
    },
    dispose() {
      for (const material of [wall, item, floor, glass, ground, wallEdge, itemEdge, none, solid.item, solid.floor]) material.dispose()
      for (const { twin } of twins.values()) twin.dispose()
    },
  }
}

type Kit = ReturnType<typeof createKit>

/**
 * The look's materials, made once for the page and kept: a replay, or the next Blueprint, draws
 * with shaders already built. (`paint` with the one palette there is; nothing to dispose.)
 */
let pageKit: Kit | null = null
const kitForPage = () => (pageKit ??= createKit(NOIR))

/** Colour copies of the viewer's materials, by look, kept for the page as the kit is. */
const pageColours = new Map<string, THREE.Material>()

/** A mesh's edge lines, worked out now (they are remembered per geometry): for the precompiler. */
export function prepareEdges(geometry: THREE.BufferGeometry) {
  edgeLines(geometry, EDGE_THRESHOLD_DEG)
}

/** three's drawing pipeline, as far as this touches it: which objects a render skips. */
type CullingPipeline = { isCulled?: (object: THREE.Object3D, camera: THREE.Camera) => boolean }

function surfaceFor(kit: Kit, role: NoirRole): THREE.Material {
  if (role === 'ground') return kit.ground
  if (role === 'none') return kit.none
  return role === 'wall' ? kit.wall : role === 'item' ? kit.item : role === 'floor' ? kit.floor : kit.glass
}

/**
 * Puts the tour's surface on a mesh and keeps it there: Pascal and its plugins assign materials of
 * their own whenever they like (the pool its water, every frame), and an assignment now only
 * updates the material given back on unmount.
 */
function pinMaterial(mesh: THREE.Mesh, surface: THREE.Material, saved: MeshStash) {
  Object.defineProperty(mesh, 'material', {
    configurable: true,
    enumerable: true,
    get: () => surface,
    set: (next: THREE.Material | THREE.Material[]) => {
      if (!isTourMaterial(next)) saved.material = next
    },
  })
}

/** Gives a mesh its own material back, and its material property back to three. */
function unpinMaterial(mesh: THREE.Mesh, saved: MeshStash) {
  delete (mesh as { material?: unknown }).material
  mesh.material = saved.material
}

/**
 * What a colour copy of a material depends on: the material, its version and its textures. Pascal
 * gives a floor its texture once the texture has loaded, after the copy may have been made.
 */
function lookOf(material: THREE.Material): string {
  const textured = material as THREE.Material & Partial<Record<'map' | 'normalMap' | 'roughnessMap' | 'aoMap' | 'emissiveMap', THREE.Texture | null>>
  return [material.uuid, material.version, textured.map?.uuid, textured.normalMap?.uuid, textured.roughnessMap?.uuid, textured.aoMap?.uuid, textured.emissiveMap?.uuid].join(':')
}

const looksOf = (source: THREE.Material | THREE.Material[]) => (Array.isArray(source) ? source.map(lookOf).join('|') : lookOf(source))

/**
 * The copy's layers: its mesh's. A mesh Pascal draws through a batch (floors, items) sits on the
 * batch layer only, which the camera never draws: its copy goes on the scene layer, or it would be a hole.
 */
function copyLayers(mesh: THREE.Object3D): number {
  return mesh.layers.isEnabled(BATCHED_LAYER) ? (mesh.layers.mask | (1 << SCENE_LAYER)) & ~(1 << BATCHED_LAYER) : mesh.layers.mask
}


/**
 * The Noir look over the whole scene while it is mounted. `ink.ts` decides where the furniture and
 * floors are in colour; the Blueprint build drives it, floor by floor.
 */
export function NoirLook({ source }: { source: ViewerSource }) {
  const { scene, invalidate, gl, camera } = useThree()
  const liveSource = useRef(source)
  liveSource.current = source

  const kit = useRef<Kit | null>(null)
  kit.current ??= kitForPage()
  const warmup = useRef<Warmup | null>(null)
  const stash = useRef({
    meshes: new Map<THREE.Mesh, MeshStash>(),
    hidden: new Map<THREE.Object3D, boolean>(),
    /** Doors and windows in motion, and how many frames more to watch each. */
    moving: new Map<string, number>(),
    elapsed: 0,
  })
  const colour = useRef({
    copies: new Map<THREE.Mesh, { copy: THREE.Mesh; source: THREE.Material | THREE.Material[]; look: string }>(),
    materials: pageColours,
  })

  // The Noir theme and Pascal's ink edges, set on the store directly so nothing is written to the
  // visitor's saved preferences; the viewer's own look comes back on unmount.
  useLayoutEffect(() => {
    const appearance = noirAppearance()
    const before = useViewer.getState()
    const saved = { edges: before.edges, shadows: before.shadows, textures: before.textures, showGrid: before.showGrid }
    // As the Home Assistant viewer: no grid over the ground (the viewer also turns its daylight off).
    const apply = () => useViewer.setState({ edges: 'soft', shadows: true, textures: true, showGrid: false, sceneAppearance: appearance as never })
    apply()
    const unsubscribe = useViewer.subscribe((state) => {
      if (state.sceneAppearance !== (appearance as never) || !state.textures || state.showGrid) apply()
    })
    const leave = () => useViewer.setState({ textures: saved.textures })
    window.addEventListener('pagehide', leave)
    window.addEventListener('pageshow', apply)
    return () => {
      unsubscribe()
      window.removeEventListener('pagehide', leave)
      window.removeEventListener('pageshow', apply)
      useViewer.setState({ edges: saved.edges, shadows: saved.shadows, textures: saved.textures, showGrid: saved.showGrid })
      useViewer.getState().showSceneTheme(useViewer.getState().previewSceneTheme)
    }
  }, [])

  const addEdges = (mesh: THREE.Mesh, role: NoirRole, motion: Motion | null): THREE.LineSegments | null => {
    if (role !== 'wall' && role !== 'item') return null
    const edges = flatEdges(mesh.geometry, EDGE_THRESHOLD_DEG)
    if (!edges.getAttribute('position')?.count) {
      edges.dispose()
      return null
    }
    const k = kit.current!
    const line = new THREE.LineSegments(edges, k.moving(role === 'wall' ? k.wallEdge : k.itemEdge, motion))
    line.raycast = NO_RAYCAST
    line.userData = { __tourNoir: true }
    line.layers.mask = mesh.layers.mask
    mesh.add(line)
    return line
  }

  /** Restyles what is new under `roots` (the whole scene by default). */
  const scan = (roots: THREE.Object3D[] = [scene]) => {
    const k = kit.current!
    const nodes = liveSource.current.nodes as unknown as Record<string, NodeLike | undefined>
    const owners = buildLiveOwnerMap(nodes)
    const { meshes, hidden } = stash.current
    if (roots.length === 1 && roots[0] === scene) {
      for (const mesh of [...meshes.keys()]) if (!mesh.parent) meshes.delete(mesh)
    }
    for (const root of roots) root.traverse((obj) => {
      if (isUnderTourNoir(obj)) return
      if (isSiteEnvironmentObject(obj, owners)) {
        if ((obj as THREE.Line).isLine) {
          if (!hidden.has(obj)) hidden.set(obj, obj.visible)
          obj.visible = false
        }
        const ground = obj as THREE.Mesh
        if (ground.isMesh && obj.userData?.[SITE_GROUND] !== 'veil' && !meshes.has(ground)) {
          const saved: MeshStash = {
            material: ground.material,
            castShadow: ground.castShadow,
            receiveShadow: ground.receiveShadow,
            role: 'ground',
            geometryUuid: ground.geometry.uuid,
            edge: null,
          }
          meshes.set(ground, saved)
          pinMaterial(ground, k.ground, saved)
        }
        return
      }
      const mesh = obj as THREE.Mesh
      if (!mesh.isMesh) return
      const known = meshes.get(mesh)
      if (known) {
        if (mesh.geometry?.uuid !== known.geometryUuid) {
          known.edge?.removeFromParent()
          known.edge?.geometry.dispose()
          known.edge = addEdges(mesh, known.role, motionOf(known.material))
          known.geometryUuid = mesh.geometry.uuid
        }
        return
      }
      // A piece the build still holds back is hidden, not gone: it is restyled now, so it arrives
      // in the wireframe and never flashes in its own colours.
      if (materialIsInvisibleHitbox(mesh.material) || isTourMaterial(mesh.material)) return
      if (ownership(mesh, owners, NO_KEEP) !== 'graph') return
      const classified = classifyMesh(mesh, owners)
      if (!classified) return
      const { role } = classified
      const motion = motionOf(mesh.material)
      const saved: MeshStash = {
        material: mesh.material,
        castShadow: mesh.castShadow,
        receiveShadow: mesh.receiveShadow,
        role,
        geometryUuid: mesh.geometry.uuid,
        edge: addEdges(mesh, role, motion),
      }
      meshes.set(mesh, saved)
      const uncopied = (mesh as { isBatchedMesh?: boolean }).isBatchedMesh || (mesh as { isSkinnedMesh?: boolean }).isSkinnedMesh
      const surface = uncopied && (role === 'item' || role === 'floor') ? k.solid[role] : surfaceFor(k, role)
      pinMaterial(mesh, k.moving(surface, motion), saved)
      mesh.castShadow = false
      mesh.receiveShadow = role === 'floor'
    })
    invalidate()
  }

  const restore = (mesh: THREE.Mesh, saved: MeshStash) => {
    saved.edge?.removeFromParent()
    saved.edge?.geometry.dispose()
    unpinMaterial(mesh, saved)
    mesh.castShadow = saved.castShadow
    mesh.receiveShadow = saved.receiveShadow
  }

  const colourOf = (material: THREE.Material) => {
    const { materials } = colour.current
    const key = lookOf(material)
    let made = materials.get(key)
    if (!made) {
      made = colourMaterial(material, gl as unknown as WebGPURenderer)
      materials.set(key, made)
    }
    return made
  }
  const dress = (copy: THREE.Mesh, from: THREE.Material | THREE.Material[]) => {
    copy.material = Array.isArray(from) ? from.map(colourOf) : colourOf(from)
  }

  /** Copies the furniture and floors that have none yet. */
  const copyColour = () => {
    const { copies } = colour.current
    for (const [mesh, saved] of stash.current.meshes) {
      if (copies.has(mesh) || (saved.role !== 'item' && saved.role !== 'floor') || !mesh.parent) continue
      if ((mesh as { isBatchedMesh?: boolean }).isBatchedMesh || (mesh as { isSkinnedMesh?: boolean }).isSkinnedMesh) continue
      const instanced = mesh as THREE.InstancedMesh
      let copy: THREE.Mesh
      if (instanced.isInstancedMesh) {
        const twin = new THREE.InstancedMesh(instanced.geometry, undefined, instanced.count)
        twin.instanceMatrix = instanced.instanceMatrix
        twin.instanceColor = instanced.instanceColor
        twin.frustumCulled = false
        copy = twin
      } else {
        copy = new THREE.Mesh(mesh.geometry)
        copy.frustumCulled = mesh.frustumCulled
      }
      copy.raycast = NO_RAYCAST
      copy.userData = { __tourNoir: true }
      copy.layers.mask = copyLayers(mesh)
      copy.renderOrder = mesh.renderOrder
      copy.castShadow = false
      copy.receiveShadow = saved.receiveShadow
      dress(copy, saved.material)
      mesh.add(copy)
      copies.set(mesh, { copy, source: saved.material, look: looksOf(saved.material) })
    }
  }

  /** Keeps the copies on their meshes: new materials, rebuilt geometry, meshes let go. */
  const keepCopies = () => {
    const { copies } = colour.current
    for (const [mesh, entry] of copies) {
      const saved = stash.current.meshes.get(mesh)
      if (!saved || !mesh.parent) {
        entry.copy.removeFromParent()
        copies.delete(mesh)
        continue
      }
      const look = looksOf(saved.material)
      if (entry.source !== saved.material || entry.look !== look) {
        entry.source = saved.material
        entry.look = look
        dress(entry.copy, saved.material)
      }
      const layers = copyLayers(mesh)
      if (entry.copy.layers.mask !== layers) entry.copy.layers.mask = layers
      if (entry.copy.geometry !== mesh.geometry) entry.copy.geometry = mesh.geometry
      const instanced = mesh as THREE.InstancedMesh
      if (instanced.isInstancedMesh) (entry.copy as THREE.InstancedMesh).count = instanced.count
    }
  }

  // Pascal culls what its walls and slabs hide from the eye; with see-through walls that would
  // hide furniture in plain view, so this draws with frustum culling only while mounted.
  const pipeline = (gl as unknown as { drawingPipeline?: CullingPipeline }).drawingPipeline
  const culling = useRef<{ own: CullingPipeline['isCulled']; before: CullingPipeline['isCulled'] } | null>(null)

  useLayoutEffect(() => {
    const state = stash.current
    // (made again here when Strict Mode mounts twice: the first unmount disposed it)
    kit.current ??= kitForPage()
    scan()
    copyColour()
    // Build every shader the look will draw now, while the first paper drops in, rather than as
    // each piece first appears: the pieces held back are hidden, so stand-ins draw them unseen.
    const warm = new Warmup(scene, 16)
    const items: WarmItem[] = []
    for (const [mesh, saved] of state.meshes) {
      const instanced = (mesh as THREE.InstancedMesh).isInstancedMesh === true
      items.push({ geometry: mesh.geometry, material: mesh.material, instanced, layers: mesh.layers.mask })
      if (saved.edge) items.push({ geometry: saved.edge.geometry, material: saved.edge.material, lines: true, layers: saved.edge.layers.mask })
    }
    for (const [mesh, { copy }] of colour.current.copies) {
      items.push({ geometry: mesh.geometry, material: copy.material, instanced: (mesh as THREE.InstancedMesh).isInstancedMesh === true, layers: copy.layers.mask })
    }
    warm.add(items)
    warmup.current = warm
    const frustumOnly = pipeline && Object.getPrototypeOf(pipeline)?.isCulled
    if (pipeline && typeof frustumOnly === 'function') {
      const own: CullingPipeline['isCulled'] = function (this: unknown, object, camera) {
        return frustumOnly.call(this, object, camera)
      }
      culling.current = { own, before: pipeline.isCulled }
      pipeline.isCulled = own
    }
    return () => {
      if (pipeline && culling.current && pipeline.isCulled === culling.current.own) pipeline.isCulled = culling.current.before
      culling.current = null
      warmup.current?.dispose()
      warmup.current = null
      const { copies } = colour.current
      for (const { copy } of copies.values()) copy.removeFromParent()
      copies.clear()
      for (const [mesh, saved] of state.meshes) restore(mesh, saved)
      state.meshes.clear()
      for (const [obj, visible] of state.hidden) obj.visible = visible
      state.hidden.clear()
      invalidate()
    }
    // biome-ignore lint/correctness/useExhaustiveDependencies: mount and unmount only
  }, [])

  // Priority 0 with the animator: restyle before Pascal's render.
  useFrame((_, delta) => {
    const state = stash.current
    if (!kit.current) return
    if (warmup.current && !warmup.current.step(camera)) warmup.current = null
    for (const obj of state.hidden.keys()) obj.visible = false
    if (pipeline && culling.current && pipeline.isCulled !== culling.current.own) {
      culling.current.before = pipeline.isCulled
      pipeline.isCulled = culling.current.own
    }
    state.elapsed += delta
    if (state.elapsed >= RESCAN_INTERVAL_S) {
      state.elapsed = 0
      scan()
      keepCopies()
      copyColour()
      return
    }
    // A door or window in motion is rebuilt as new meshes every frame: restyle it every frame.
    const { doorAnimations, windowAnimations, skylightAnimations } = useInteractive.getState()
    for (const id of [...Object.keys(doorAnimations), ...Object.keys(windowAnimations), ...Object.keys(skylightAnimations)]) state.moving.set(id, 6)
    const moving: THREE.Object3D[] = []
    for (const [id, left] of state.moving) {
      if (left <= 0) {
        state.moving.delete(id)
        continue
      }
      state.moving.set(id, left - 1)
      const obj = sceneRegistry.nodes.get(id as never)
      if (obj) moving.push(obj)
    }
    if (moving.length) {
      scan(moving)
      copyColour()
    }
  })

  return null
}

const NO_KEEP: ReadonlySet<string> = new Set()
