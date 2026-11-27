import {
  buildFloorplanContext, floorplanLayerRank, hidesDescendants, isNodeKindEnabled, nodeRegistry,
} from '@pascal-app/core'
import { AnyNode as AnyNodeSchema } from '@pascal-app/core/schema'
import { SITE_GROUND, useViewer } from '@pascal-app/viewer'
import { FloorplanGeometryRenderer } from '@pascal-app/viewer/ui'
import type { ReactElement } from 'react'
import { flushSync } from 'react-dom'
import { createRoot } from 'react-dom/client'
import * as THREE from 'three'
import { MeshStandardNodeMaterial } from 'three/webgpu'
import { notWarmup, type WarmItem } from './warmup'

/**
 * The Blueprint build's paper: for each floor, a sheet the size of the building with that floor's
 * real 2D plan printed on it (the geometry Pascal's own 2D view draws, `def.floorplan` of every
 * node on the level), folded like a map. It drops in, opens out (an accordion across, then the
 * half folded over), and the floor extrudes out of it.
 */

// ---------------------------------------------------------------------------------------------
// The plan, as Pascal's 2D view draws it

type PlanNode = {
  id: string
  type: string
  parentId?: string | null
  children?: string[]
  visible?: boolean
  name?: string
  level?: number
}
type PlanNodes = Record<string, PlanNode>
type Geometry = Parameters<typeof FloorplanGeometryRenderer>[0]['geometry']

/** Read-only colours for the plan's handles (none are drawn in a document plan). */
const PALETTE = {
  selectedStroke: '#4f46e5',
  selectedFill: '#e0e7ff',
  selectedHatch: '#818cf8',
  wallHoverStroke: '#64748b',
  endpointHandleFill: '#ffffff',
  endpointHandleStroke: '#f97316',
  endpointHandleHoverStroke: '#fb923c',
  endpointHandleActiveFill: '#fed7aa',
  endpointHandleActiveStroke: '#ea580c',
  curveHandleFill: '#ffffff',
  curveHandleStroke: '#0d9488',
  curveHandleHoverStroke: '#14b8a6',
  measurementStroke: '#475569',
  measurementLabelBackground: '#ffffff',
  measurementLabelText: '#0f172a',
}

const normalized = new WeakMap<object, PlanNodes>()

/** The scene's nodes with their schema defaults, as the 2D view reads them. */
function planNodes(raw: Record<string, unknown>): PlanNodes {
  const known = normalized.get(raw)
  if (known) return known
  const out: PlanNodes = {}
  for (const [id, node] of Object.entries(raw)) {
    const builtin = AnyNodeSchema.safeParse(node)
    if (builtin.success) {
      out[builtin.data.id] = builtin.data as unknown as PlanNode
      continue
    }
    const type = node && typeof node === 'object' ? (node as { type?: unknown }).type : null
    const registered = typeof type === 'string' ? nodeRegistry.get(type as never)?.schema.safeParse(node) : null
    if (registered?.success) out[id] = registered.data as unknown as PlanNode
  }
  normalized.set(raw, out)
  return out
}

function visibleInPlan(node: PlanNode, nodes: PlanNodes): boolean {
  if (node.visible === false) return false
  const seen = new Set([node.id])
  let current = node.parentId ? nodes[node.parentId] : undefined
  while (current) {
    if (seen.has(current.id)) return true
    seen.add(current.id)
    if (current.visible === false && hidesDescendants(current as never)) return false
    current = current.parentId ? nodes[current.parentId] : undefined
  }
  return true
}

/** Every node's plan geometry on a level (Pascal's `buildFloorplanGeometries`, read-only). */
function levelGeometries(nodes: PlanNodes, level: PlanNode): Geometry[] {
  const tree: PlanNode[] = [level]
  const seen = new Set<string>()
  const queue = [...(level.children ?? [])]
  for (let i = 0; i < queue.length; i++) {
    const id = queue[i]!
    if (seen.has(id)) continue
    seen.add(id)
    const node = nodes[id]
    if (!node) continue
    tree.push(node)
    queue.push(...(node.children ?? []))
  }
  type Entry = { node: PlanNode; overrides?: Record<string, unknown> }
  const entries: Entry[] = tree.map((node) => ({ node }))
  const ids = new Set(tree.map((node) => node.id))
  const building = level.parentId ? nodes[level.parentId] : undefined
  for (const candidate of Object.values(nodes)) {
    if (ids.has(candidate.id)) continue
    const def = nodeRegistry.get(candidate.type as never) as unknown as {
      floorplanScope?: string
      floorplanLinkedLevelIds?: (node: unknown) => string[]
    } | undefined
    if (building && def?.floorplanScope === 'building' && candidate.parentId === building.id) {
      entries.push({ node: candidate, overrides: { children: [], siblings: [], parent: level } })
      ids.add(candidate.id)
    } else if (def?.floorplanLinkedLevelIds?.(candidate).includes(level.id)) {
      const children = (candidate.children ?? []).map((id) => nodes[id]).filter(Boolean)
      entries.push({ node: candidate, overrides: { children, siblings: [], parent: level } })
      ids.add(candidate.id)
    }
  }
  type Def = {
    floorplan?: (node: unknown, ctx: unknown) => Geometry | null
    computeFloorplanLevelData?: (input: { siblings: unknown[]; nodes: unknown }) => unknown
  }
  const defOf = (type: string) => nodeRegistry.get(type as never) as unknown as Def | undefined
  const renderable = entries
    .filter((e) => visibleInPlan(e.node, nodes) && isNodeKindEnabled(e.node.type as never, undefined) && defOf(e.node.type)?.floorplan)
    .sort((a, b) => floorplanLayerRank(a.node.type as never) - floorplanLayerRank(b.node.type as never))
  const byType = new Map<string, PlanNode[]>()
  for (const node of tree) {
    if (!defOf(node.type)?.computeFloorplanLevelData) continue
    const list = byType.get(node.type) ?? []
    list.push(node)
    byType.set(node.type, list)
  }
  const levelData = new Map<string, unknown>()
  for (const [type, siblings] of byType) levelData.set(type, defOf(type)!.computeFloorplanLevelData!({ siblings, nodes }))
  const { unit, metricNotation } = useViewer.getState()
  const out: Geometry[] = []
  for (const { node, overrides } of renderable) {
    const base = buildFloorplanContext(node as never, nodes as never, {
      automaticDimensions: false, selected: false, unit, metricNotation, purpose: 'document',
      highlighted: false, hovered: false, moving: false, palette: PALETTE,
    } as never, levelData.get(node.type) as never)
    try {
      const geometry = defOf(node.type)!.floorplan!(node, overrides ? { ...(base as object), ...overrides } : base)
      if (geometry) out.push(geometry)
    } catch {
      // A kind that can't draw its plan is left off the paper.
    }
  }
  return out
}

export type PlanBounds = { minX: number; minY: number; maxX: number; maxY: number }

const PAPER = '#f3efe4'
const INK = '#23262b'

/**
 * The plan as an SVG document: the paper, a metre grid, every node's plan geometry, a frame and
 * the floor's name in the corner. `bounds` are plan-local metres (the level's x and z).
 */
function planSvg(geometries: Geometry[], bounds: PlanBounds, px: number, title: string): string {
  const width = bounds.maxX - bounds.minX
  const height = bounds.maxY - bounds.minY
  const host = document.createElement('div')
  const root = createRoot(host)
  const inset = Math.min(width, height) * 0.035
  const grid: ReactElement[] = []
  for (let x = Math.ceil(bounds.minX); x <= bounds.maxX; x++) grid.push(<line key={`x${x}`} x1={x} x2={x} y1={bounds.minY} y2={bounds.maxY} />)
  for (let y = Math.ceil(bounds.minY); y <= bounds.maxY; y++) grid.push(<line key={`y${y}`} x1={bounds.minX} x2={bounds.maxX} y1={y} y2={y} />)
  const label = Math.max(0.28, Math.min(width, height) * 0.045)
  flushSync(() => root.render(
    <svg
      height={Math.round((px * height) / width)}
      viewBox={`${bounds.minX} ${bounds.minY} ${width} ${height}`}
      width={px}
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect fill={PAPER} height={height} width={width} x={bounds.minX} y={bounds.minY} />
      <g stroke="#9aa4b2" strokeOpacity={0.35} strokeWidth={0.012}>{grid}</g>
      {geometries.map((geometry, index) => (
        <g key={index}>
          <FloorplanGeometryRenderer geometry={geometry} pointerEventsOverride="none" renderMode="pdf" screenUnitsPerPixel={width / px} />
        </g>
      ))}
      <rect
        fill="none"
        height={height - inset * 2}
        stroke={INK}
        strokeWidth={0.035}
        width={width - inset * 2}
        x={bounds.minX + inset}
        y={bounds.minY + inset}
      />
      <text
        fill={INK}
        fontFamily="Barlow, Helvetica, Arial, sans-serif"
        fontSize={label}
        fontWeight={600}
        letterSpacing={label * 0.12}
        textAnchor="end"
        x={bounds.maxX - inset - label * 0.6}
        y={bounds.maxY - inset - label * 0.6}
      >
        {title.toUpperCase()}
      </text>
    </svg>,
  ))
  const svg = host.firstElementChild
  const text = svg ? new XMLSerializer().serializeToString(svg) : ''
  root.unmount()
  return text
}

type Sheet = { texture: THREE.CanvasTexture; front: MeshStandardNodeMaterial; back: MeshStandardNodeMaterial }

/**
 * A floor's printed sheet (its plan texture and the paper's two materials), drawn once for the page
 * and kept, so the precompiler can make it while the project loads and a replay finds it ready.
 */
const sheets = new Map<string, Sheet>()

function sheetKey(plan: PaperPlan): string {
  const b = plan.bounds
  return [plan.levelId, plan.title, b.minX, b.minY, b.maxX, b.maxY].map((v) => (typeof v === 'number' ? v.toFixed(3) : v)).join('|')
}

function sheetFor(plan: PaperPlan, nodes: Record<string, unknown>): Sheet {
  const key = sheetKey(plan)
  const known = sheets.get(key)
  if (known) return known
  const texture = planTexture(planNodes(nodes), plan.levelId, plan.bounds, plan.title)
  const front = new MeshStandardNodeMaterial({ map: texture, roughness: 0.92, metalness: 0, transparent: true })
  const back = new MeshStandardNodeMaterial({ color: '#d9d3c4', roughness: 0.95, metalness: 0, transparent: true })
  for (const material of [front, back]) {
    material.userData.__tourNoir = true
    material.maskNode = notWarmup()
    // Pulled forward in depth: lying flat on the ground (or a slab), the paper always wins.
    material.polygonOffset = true
    material.polygonOffsetFactor = -1
    material.polygonOffsetUnits = -4
  }
  const sheet = { texture, front, back }
  sheets.set(key, sheet)
  return sheet
}

const PANEL = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2)

/** Makes a floor's sheet ahead of its run, and returns what to draw to compile its materials. */
export function preparePaper(plan: PaperPlan, nodes: Record<string, unknown>): WarmItem[] {
  const { front, back } = sheetFor(plan, nodes)
  return [{ geometry: PANEL, material: front }, { geometry: PANEL, material: back }]
}

/** The floor's plan on a canvas texture; the paper shows blank until the image has loaded. */
function planTexture(nodes: PlanNodes, levelId: string, bounds: PlanBounds, title: string): THREE.CanvasTexture {
  const width = bounds.maxX - bounds.minX
  const height = bounds.maxY - bounds.minY
  const long = 2048
  const px = width >= height ? long : Math.round((long * width) / height)
  const canvas = document.createElement('canvas')
  canvas.width = px
  canvas.height = Math.max(2, Math.round((px * height) / width))
  const context = canvas.getContext('2d')!
  context.fillStyle = PAPER
  context.fillRect(0, 0, canvas.width, canvas.height)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 8
  const level = nodes[levelId]
  if (!level) return texture
  let svg = ''
  try {
    svg = planSvg(levelGeometries(nodes, level), bounds, px, title)
  } catch (error) {
    console.warn('[animation] could not draw the floor plan', error)
  }
  if (!svg) return texture
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }))
  const image = new Image()
  image.onload = () => {
    context.drawImage(image, 0, 0, canvas.width, canvas.height)
    texture.needsUpdate = true
    URL.revokeObjectURL(url)
  }
  image.onerror = () => URL.revokeObjectURL(url)
  image.src = url
  return texture
}

// ---------------------------------------------------------------------------------------------
// The sheet

/** When a sheet does what, in timeline seconds. `fadeStart` Infinity keeps it down for good. */
export type PaperPlan = {
  storey: number
  levelId: string
  title: string
  /** Plan-local bounds of the sheet (the whole building, with a margin). */
  bounds: PlanBounds
  /** World heights: where it opens out, and where it settles once its slab is down. */
  top: number
  rest: number
  appear: number
  land: number
  open: number
  flat: number
  sinkStart: number
  sinkEnd: number
  fadeStart: number
  fadeEnd: number
}

const FOLDED = Math.PI * 0.965
const DROP = 2.2

const clamp01 = (t: number) => (t < 0 ? 0 : t > 1 ? 1 : t)
const smooth = (t: number) => t * t * (3 - 2 * t)
const backOut = (t: number, s = 0.9) => 1 + (s + 1) * (t - 1) ** 3 + s * (t - 1) ** 2

/** One quad of the sheet, at y = 0 in its hinge's frame, facing up (or down for the back). */
function quad(x0: number, x1: number, z0: number, z1: number, u: [number, number], v: [number, number], up: boolean) {
  const geometry = new THREE.BufferGeometry()
  const a = [x0, 0, z0, x0, 0, z1, x1, 0, z1, x1, 0, z0]
  const uv = [u[0], v[0], u[0], v[1], u[1], v[1], u[1], v[0]]
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(a, 3))
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  const n = up ? 1 : -1
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute([0, n, 0, 0, n, 0, 0, n, 0, 0, n, 0], 3))
  geometry.setIndex(up ? [0, 1, 2, 0, 2, 3] : [0, 2, 1, 0, 3, 2])
  return geometry
}

const NO_RAYCAST = () => {}

export class PaperSheet {
  readonly group = new THREE.Group()
  readonly plan: PaperPlan
  /** World box of the sheet laid flat, for the dust where it lands. */
  readonly box = new THREE.Box3()
  private readonly lift = new THREE.Group()
  private readonly columns: THREE.Group[] = []
  private readonly hinges: THREE.Group[] = []
  private readonly front: MeshStandardNodeMaterial
  private readonly back: MeshStandardNodeMaterial
  private readonly level = new THREE.Matrix4()
  private readonly levelInverse = new THREE.Matrix4()
  private opacity = 1

  constructor(plan: PaperPlan, nodes: Record<string, unknown>, levelObject: THREE.Object3D) {
    this.plan = plan
    const { bounds } = plan
    const W = bounds.maxX - bounds.minX
    const D = bounds.maxY - bounds.minY
    const sheet = sheetFor(plan, nodes)
    this.front = sheet.front
    this.back = sheet.back
    // A kept sheet may have ended its last run faded out.
    for (const material of [this.front, this.back]) {
      material.opacity = 1
      if (!material.depthWrite) {
        material.depthWrite = true
        material.needsUpdate = true
      }
    }

    levelObject.updateWorldMatrix(true, false)
    this.level.copy(levelObject.matrixWorld)
    this.levelInverse.copy(this.level).invert()
    this.group.matrixAutoUpdate = false
    this.group.userData = { __tourNoir: true }
    this.group.add(this.lift)

    // Columns hinged one to the next across the sheet; each holds its front half and, on a hinge
    // along the sheet's middle, its back half (folded over onto the front).
    const count = W > 9 ? 4 : W > 4.5 ? 3 : 2
    const w = W / count
    let parent: THREE.Object3D = this.lift
    for (let i = 0; i < count; i++) {
      const column = new THREE.Group()
      column.position.x = i === 0 ? 0 : w
      parent.add(column)
      const u: [number, number] = [(i * w) / W, ((i + 1) * w) / W]
      this.addPanel(column, quad(0, w, D / 2, D, u, [0.5, 0], true), quad(0, w, D / 2, D, u, [0.5, 0], false))
      const hinge = new THREE.Group()
      hinge.position.z = D / 2
      column.add(hinge)
      this.addPanel(hinge, quad(0, w, -D / 2, 0, u, [1, 0.5], true), quad(0, w, -D / 2, 0, u, [1, 0.5], false))
      this.columns.push(column)
      this.hinges.push(hinge)
      parent = column
    }

    const corner = new THREE.Vector3()
    for (const x of [bounds.minX, bounds.maxX]) for (const z of [bounds.minY, bounds.maxY]) {
      this.box.expandByPoint(corner.set(x, 0, z).applyMatrix4(this.level).setY(plan.top))
    }
    this.group.visible = false
  }

  private addPanel(parent: THREE.Object3D, up: THREE.BufferGeometry, down: THREE.BufferGeometry) {
    for (const [geometry, material] of [[up, this.front], [down, this.back]] as const) {
      const mesh = new THREE.Mesh(geometry, material)
      mesh.castShadow = true
      mesh.receiveShadow = true
      mesh.raycast = NO_RAYCAST
      mesh.userData = { __tourNoir: true }
      parent.add(mesh)
    }
  }

  update(time: number) {
    const p = this.plan
    if (time < p.appear || time >= p.fadeEnd) {
      this.group.visible = false
      return
    }
    this.group.visible = true

    // Height: falls in, opens out at `top`, then settles to `rest` under its slab.
    const fall = clamp01((time - p.appear) / Math.max(0.01, p.land - p.appear))
    const sink = smooth(clamp01((time - p.sinkStart) / Math.max(0.01, p.sinkEnd - p.sinkStart)))
    const y = p.top + (p.rest - p.top) * sink
    this.lift.position.y = DROP * (1 - fall * fall)

    // The accordion across, then the half over. Each fold lands with the ease of its flap but
    // stops at flat: past flat a panel would swing down through the ground (or the floor below)
    // by a good part of its width, and vanish into it.
    const across = clamp01((time - p.land) / Math.max(0.01, p.open - p.land))
    const over = clamp01((time - p.open) / Math.max(0.01, p.flat - p.open))
    const accordion = Math.max(0, FOLDED * (1 - (across <= 0 ? 0 : backOut(across))))
    this.columns.forEach((column, i) => {
      column.rotation.z = i === 0 ? 0 : (i % 2 === 1 ? 1 : -1) * accordion
    })
    const half = Math.max(0, FOLDED * (1 - (over <= 0 ? 0 : backOut(over))))
    for (const hinge of this.hinges) hinge.rotation.x = half

    // Placed in the level's frame: plan x and y are the level's x and z.
    const local = new THREE.Vector3(0, y, 0).applyMatrix4(this.levelInverse).y
    _place.makeTranslation(p.bounds.minX, local, p.bounds.minY)
    this.group.matrix.multiplyMatrices(this.level, _place)
    this.group.matrixWorldNeedsUpdate = true

    // (a sheet that stays, the ground floor's, has no fade: Infinity maths would make it NaN)
    const fade = Number.isFinite(p.fadeStart)
      ? 1 - smooth(clamp01((time - p.fadeStart) / Math.max(0.01, p.fadeEnd - p.fadeStart)))
      : 1
    if (fade !== this.opacity) {
      this.opacity = fade
      this.front.opacity = fade
      this.back.opacity = fade
      // Fully there, it writes depth like any surface; fading, it lets what's under it through.
      const solid = fade >= 1
      if (this.front.depthWrite !== solid) {
        this.front.depthWrite = this.back.depthWrite = solid
        this.front.needsUpdate = this.back.needsUpdate = true
      }
    }
  }

  dispose() {
    this.group.removeFromParent()
    this.group.traverse((child) => (child as THREE.Mesh).geometry?.dispose())
    // The texture and materials are the page's (`sheets`): the next run uses them again.
  }
}

const _place = new THREE.Matrix4()
const _vertex = new THREE.Vector3()
const _meshBox = new THREE.Box3()

/**
 * The top of the site's ground under `box` (world x and z), or -Infinity where there is none: the
 * highest of its vertices inside the box, or, for a flat ground with no vertex inside (one big
 * quad), the ground's own height. A terrain that rises under the sheet would otherwise cover it.
 */
export function groundTopUnder(box: THREE.Box3, scene: THREE.Object3D): number {
  let top = -Infinity
  scene.traverse((object) => {
    const mesh = object as THREE.Mesh
    if (!mesh.isMesh || object.userData?.[SITE_GROUND] !== 'solid') return
    const position = mesh.geometry?.getAttribute('position')
    if (!position) return
    mesh.updateWorldMatrix(true, false)
    _meshBox.setFromObject(mesh)
    if (_meshBox.max.x < box.min.x || _meshBox.min.x > box.max.x || _meshBox.max.z < box.min.z || _meshBox.min.z > box.max.z) return
    let inside = false
    for (let i = 0; i < position.count; i++) {
      _vertex.fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld)
      if (_vertex.x < box.min.x || _vertex.x > box.max.x || _vertex.z < box.min.z || _vertex.z > box.max.z) continue
      inside = true
      if (_vertex.y > top) top = _vertex.y
    }
    // A flat ground (a few big triangles) has no vertex under the sheet: its height is its own.
    if (!inside && _meshBox.max.y - _meshBox.min.y < 0.5) top = Math.max(top, _meshBox.max.y)
  })
  return top
}
