/**
 * Camera framing for the showcase, as plain maths (unit-tested in Node): points sampled on the
 * drawn model are fitted into the view, so the house fills the screen instead of its bounding box.
 */

export type Vec3 = [number, number, number]
export type Box = { min: Vec3; max: Vec3 }

/** The viewer's perspective camera. */
export const VIEWER_FOV_DEGREES = 50
/**
 * Height of the settled view above the horizon, and how far toward the view's edge the drawn model
 * may reach.
 */
export const VIEW_ELEVATION_DEGREES = 25
export const VIEW_FILL = 0.96

const toRadians = (degrees: number) => (degrees * Math.PI) / 180

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]

function basis(azimuth: number, elevation: number) {
  const el = toRadians(elevation)
  // From the target towards the camera; the camera looks the other way.
  const back: Vec3 = [Math.sin(azimuth) * Math.cos(el), Math.sin(el), Math.cos(azimuth) * Math.cos(el)]
  const forward: Vec3 = [-back[0], -back[1], -back[2]]
  // right = forward × up, up' = right × forward (world up is +Y).
  const rightLength = Math.hypot(forward[2], forward[0]) || 1
  const right: Vec3 = [-forward[2] / rightLength, 0, forward[0] / rightLength]
  const up: Vec3 = [
    right[1] * forward[2] - right[2] * forward[1],
    right[2] * forward[0] - right[0] * forward[2],
    right[0] * forward[1] - right[1] * forward[0],
  ]
  return { back, forward, right, up }
}

/**
 * The camera from `azimuth` (radians, atan2(x, z) from the target) and `elevation` (degrees), as
 * close as possible with every point inside `fill` of the view, and the points centred on screen.
 * Give it points on what is drawn (corners of each part's own box), not one box around everything:
 * a model's box is mostly empty air at its corners.
 */
/** The part of the screen the model may use, in normalised device units (-1..1 each way). */
export type SafeArea = { left: number; right: number; bottom: number; top: number }
export const FULL_SCREEN: SafeArea = { left: -1, right: 1, bottom: -1, top: 1 }

export function fitPoints({ points, azimuth, elevation = VIEW_ELEVATION_DEGREES, aspect, fovDegrees = VIEWER_FOV_DEGREES, fill = VIEW_FILL, safe = FULL_SCREEN }: {
  points: readonly Vec3[]
  azimuth: number
  elevation?: number
  aspect: number
  fovDegrees?: number
  fill?: number
  /** Where the model goes: clear of the chrome (see `safeArea`). Centred in it. */
  safe?: SafeArea
}): { position: Vec3; target: Vec3; distance: number } {
  const { back, forward, right, up } = basis(azimuth, elevation)
  const tanV = Math.tan(toRadians(fovDegrees) / 2)
  const tanH = tanV * aspect
  // The safe area, shrunk by `fill` about its centre, in normalised device units.
  const centreX = (safe.left + safe.right) / 2
  const centreY = (safe.bottom + safe.top) / 2
  const loX = centreX - ((safe.right - safe.left) / 2) * fill
  const hiX = centreX + ((safe.right - safe.left) / 2) * fill
  const loY = centreY - ((safe.top - safe.bottom) / 2) * fill
  const hiY = centreY + ((safe.top - safe.bottom) / 2) * fill
  // How far back a point at screen offset `a` (in units of the view's half-size at depth 1) needs
  // the camera so it lands inside [lo, hi].
  const need = (a: number, depth: number, lo: number, hi: number) =>
    (a > 0 ? (hi > 0 ? a / hi : Infinity) : a < 0 ? (lo < 0 ? a / lo : Infinity) : 0) - depth
  const min = [0, 1, 2].map((i) => Math.min(...points.map((p) => p[i]!)))
  const max = [0, 1, 2].map((i) => Math.max(...points.map((p) => p[i]!)))
  let target: Vec3 = [0, 1, 2].map((i) => (min[i]! + max[i]!) / 2) as Vec3
  let distance = 1
  // Fit, slide the camera sideways so the points' screen extents are centred on the safe area's
  // centre, and fit again.
  for (let pass = 0; pass < 6; pass++) {
    distance = 1
    for (const p of points) {
      const d: Vec3 = [p[0] - target[0], p[1] - target[1], p[2] - target[2]]
      const depth = dot(d, forward)
      distance = Math.max(distance, need(dot(d, right) / tanH, depth, loX, hiX), need(dot(d, up) / tanV, depth, loY, hiY))
    }
    let left = Infinity, rightmost = -Infinity, bottom = Infinity, top = -Infinity
    for (const p of points) {
      const d: Vec3 = [p[0] - target[0], p[1] - target[1], p[2] - target[2]]
      const z = distance + dot(d, forward)
      const x = dot(d, right) / (z * tanH)
      const y = dot(d, up) / (z * tanV)
      left = Math.min(left, x); rightmost = Math.max(rightmost, x); bottom = Math.min(bottom, y); top = Math.max(top, y)
    }
    const shiftX = ((left + rightmost) / 2 - centreX) * distance * tanH
    const shiftY = ((bottom + top) / 2 - centreY) * distance * tanV
    if (Math.abs(shiftX) < 1e-4 && Math.abs(shiftY) < 1e-4) break
    target = [0, 1, 2].map((i) => target[i]! + right[i]! * shiftX + up[i]! * shiftY) as Vec3
  }
  return {
    position: [target[0] + back[0] * distance, target[1] + back[1] * distance, target[2] + back[2] * distance],
    target,
    distance,
  }
}

/**
 * The screen left for the model, from the chrome's footprint in pixels: the dial and the title on
 * wide screens, the title and the bottom bar on phones.
 */
export function safeArea(width: number, height: number, inset: { left: number; right: number; top: number; bottom: number }): SafeArea {
  return {
    left: -1 + (2 * inset.left) / width,
    right: 1 - (2 * inset.right) / width,
    bottom: -1 + (2 * inset.bottom) / height,
    top: 1 - (2 * inset.top) / height,
  }
}

export const boxCorners = (box: Box): Vec3[] =>
  [box.min[0], box.max[0]].flatMap((x) => [box.min[1], box.max[1]].flatMap((y) => [box.min[2], box.max[2]].map((z) => [x, y, z] as Vec3)))

/** `fitPoints` on the corners of one box. */
export function fittedPose({ box, ...rest }: { box: Box } & Omit<Parameters<typeof fitPoints>[0], 'points'>) {
  return fitPoints({ points: boxCorners(box), ...rest })
}

/** The box with its top raised by `rise` metres (Exploded lifts each floor by a fixed gap). */
export function raised(box: Box, rise: number): Box {
  return { min: box.min, max: [box.max[0], box.max[1] + rise, box.max[2]] }
}
