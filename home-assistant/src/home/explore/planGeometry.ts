import { type PascalI18n, polygonInteriorPoint } from '@pascal-app/core'
import { formatRoomArea, type ViewerNodes, viewerRooms, viewerSidebarSections } from '@pascal-app/viewer/ui'

type Point = readonly [number, number]
type ZoneLike = {
  id?: string
  type?: string
  polygon?: Point[]
  holes?: Point[][]
  color?: string
}

export type PlanRoomShape = {
  id: string
  label: string
  color: string
  areaM2: number
  /** SVG path (`M ... Z` plus any holes) fitted to the level viewBox. */
  path: string
  /** True outer perimeter length in SVG units, used for exact stroke-dashoffset draw-in. */
  perimeter: number
  /** Label anchor inside the room in SVG coordinates. */
  centroid: readonly [number, number]
  /** Outline in building-local plan metres (`x`, `z`), for hit tests. */
  polygon: readonly Point[]
  holes: readonly (readonly Point[])[]
}

/** Building-local plan metres ↔ SVG units: `svg = offset + (metres - min) * scale`. */
export type PlanFrame = { minX: number; minZ: number; scale: number; offsetX: number; offsetY: number }

export type LevelPlanGeometry = {
  width: number
  height: number
  rooms: PlanRoomShape[]
  frame?: PlanFrame
}

function ringBounds(points: readonly Point[], bounds: { minX: number; maxX: number; minZ: number; maxZ: number }) {
  for (const [x, z] of points) {
    if (x < bounds.minX) bounds.minX = x
    if (x > bounds.maxX) bounds.maxX = x
    if (z < bounds.minZ) bounds.minZ = z
    if (z > bounds.maxZ) bounds.maxZ = z
  }
}

function ringPathAndPerimeter(
  points: readonly Point[],
  mapX: (x: number) => number,
  mapY: (z: number) => number,
): { d: string; perimeter: number } {
  if (points.length < 3) return { d: '', perimeter: 0 }
  let d = ''
  let perimeter = 0
  let prevX = 0
  let prevY = 0
  for (let i = 0; i < points.length; i++) {
    const [x, z] = points[i]!
    const sx = mapX(x)
    const sy = mapY(z)
    d += i === 0 ? `M${sx.toFixed(2)},${sy.toFixed(2)}` : ` L${sx.toFixed(2)},${sy.toFixed(2)}`
    if (i > 0) perimeter += Math.hypot(sx - prevX, sy - prevY)
    prevX = sx
    prevY = sy
  }
  const [firstX, firstZ] = points[0]!
  perimeter += Math.hypot(mapX(firstX) - prevX, mapY(firstZ) - prevY)
  return { d: `${d} Z`, perimeter }
}

function polygonAnchor(polygon: readonly Point[], holes?: readonly (readonly Point[])[]): readonly [number, number] {
  try {
    const [x, z] = polygonInteriorPoint({
      polygon: polygon.map(([px, pz]) => [px, pz] as [number, number]),
      holes: holes?.map((h) => h.map(([px, pz]) => [px, pz] as [number, number])),
    })
    if (Number.isFinite(x) && Number.isFinite(z)) return [x, z]
  } catch {
    // Fall back to vertex mean if a degenerate polygon fails pole-of-inaccessibility.
  }
  let sx = 0
  let sz = 0
  for (const [x, z] of polygon) {
    sx += x
    sz += z
  }
  return [sx / polygon.length, sz / polygon.length]
}

/**
 * Extracts and normalises every room/zone outline on `levelId` into a north-up SVG plan
 * matching Pascal's 2D floorplan orientation (`+X` right, `-Z` up).
 * Chooses a frame aspect matching the plan's own proportions (clamped between 4:3 and 1:1)
 * with ~8% padding on the shorter side so rooms fill the drafting plate generously.
 */
export function buildLevelPlan(
  levelId: string,
  nodes: ViewerNodes,
  i18n: PascalI18n,
  width = 240,
): LevelPlanGeometry {
  const sections = viewerSidebarSections(levelId, nodes, i18n).filter((s) => s.kind !== 'units')
  const rows = sections.flatMap((s) => s.rows)
  if (rows.length === 0) return { width, height: Math.round(width * 0.75), rooms: [] }

  const detectedByZone = new Map(viewerRooms(levelId, nodes).map((room) => [room.zoneId, room]))
  const raw: { id: string; label: string; color: string; areaM2: number; polygon: Point[]; holes: Point[][] }[] = []
  const bounds = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity }

  for (const row of rows) {
    const zone = nodes[row.id] as unknown as ZoneLike | undefined
    const detected = detectedByZone.get(row.id)
    const polygon =
      zone?.polygon && zone.polygon.length >= 3
        ? zone.polygon
        : detected?.polygon && detected.polygon.length >= 3
          ? detected.polygon
          : null
    if (!polygon) continue
    const holes = zone?.holes ?? detected?.holes ?? []
    ringBounds(polygon, bounds)
    raw.push({ id: row.id, label: row.label, color: row.color, areaM2: row.areaM2, polygon, holes })
  }

  if (raw.length === 0 || !Number.isFinite(bounds.minX)) {
    return { width, height: Math.round(width * 0.75), rooms: [] }
  }

  const spanX = Math.max(bounds.maxX - bounds.minX, 0.5)
  const spanZ = Math.max(bounds.maxZ - bounds.minZ, 0.5)
  // Follow the plan's own aspect ratio, clamped between 1:1 (square) and 4:3 (landscape).
  const clampedAspect = Math.max(1, Math.min(4 / 3, spanX / spanZ))
  const height = Math.round(width / clampedAspect)
  const padding = Math.round(Math.min(width, height) * 0.08)
  const innerW = width - padding * 2
  const innerH = height - padding * 2
  const scale = Math.min(innerW / spanX, innerH / spanZ)
  const offsetX = padding + (innerW - spanX * scale) / 2
  const offsetY = padding + (innerH - spanZ * scale) / 2

  const mapX = (x: number) => offsetX + (x - bounds.minX) * scale
  const mapY = (z: number) => offsetY + (z - bounds.minZ) * scale

  const rooms: PlanRoomShape[] = raw.map((entry) => {
    const outer = ringPathAndPerimeter(entry.polygon, mapX, mapY)
    let path = outer.d
    for (const hole of entry.holes) {
      if (hole.length >= 3) path += ` ${ringPathAndPerimeter(hole, mapX, mapY).d}`
    }
    const [ax, az] = polygonAnchor(entry.polygon, entry.holes)
    return {
      id: entry.id,
      label: entry.label,
      color: entry.color,
      areaM2: entry.areaM2,
      path,
      perimeter: Math.max(1, Math.round(outer.perimeter)),
      centroid: [mapX(ax), mapY(az)],
      polygon: entry.polygon,
      holes: entry.holes,
    }
  })

  return { width, height, rooms, frame: { minX: bounds.minX, minZ: bounds.minZ, scale, offsetX, offsetY } }
}

/** Standalone silhouette SVG path of a single room, used as a miniature emblem in SelectionCard. */
export function buildRoomThumbnail(
  zoneId: string,
  levelId: string | null,
  nodes: ViewerNodes,
  size = 48,
  padding = 5,
): string | null {
  const zone = nodes[zoneId] as unknown as ZoneLike | undefined
  let polygon: readonly Point[] | null = zone?.polygon && zone.polygon.length >= 3 ? zone.polygon : null
  let holes: readonly (readonly Point[])[] = zone?.holes ?? []
  if (!polygon && levelId) {
    const detected = viewerRooms(levelId, nodes).find((room) => room.zoneId === zoneId)
    if (detected?.polygon && detected.polygon.length >= 3) {
      polygon = detected.polygon
      holes = detected.holes ?? []
    }
  }
  if (!polygon) return null

  const bounds = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity }
  ringBounds(polygon, bounds)
  const spanX = Math.max(bounds.maxX - bounds.minX, 0.25)
  const spanZ = Math.max(bounds.maxZ - bounds.minZ, 0.25)
  const inner = size - padding * 2
  const scale = Math.min(inner / spanX, inner / spanZ)
  const offsetX = padding + (inner - spanX * scale) / 2
  const offsetY = padding + (inner - spanZ * scale) / 2

  const mapX = (x: number) => offsetX + (x - bounds.minX) * scale
  const mapY = (z: number) => offsetY + (z - bounds.minZ) * scale

  let d = ringPathAndPerimeter(polygon, mapX, mapY).d
  for (const hole of holes) {
    if (hole.length >= 3) d += ` ${ringPathAndPerimeter(hole, mapX, mapY).d}`
  }
  return d
}

/** Splits formatted room area into the full numeric value and its unit for crisp typography. */
export function splitFormattedArea(
  areaM2: number,
  unit: 'metric' | 'imperial',
  locale: string,
): { value: string; unitText: string; hasSquare: boolean } {
  const formatted = formatRoomArea(areaM2, unit, locale).trim()
  const match = formatted.match(/^(\d+(?:[.,\s\u00a0]\d+)*)\s*(.*)$/)
  if (!match) return { value: formatted, unitText: '', hasSquare: false }
  const value = match[1]!.trim()
  const rawUnit = match[2]!.trim()
  if (rawUnit.endsWith('²')) {
    return { value, unitText: rawUnit.slice(0, -1), hasSquare: true }
  }
  return { value, unitText: rawUnit, hasSquare: false }
}
