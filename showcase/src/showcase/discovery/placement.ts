/**
 * Where a discovery label sits around its anchor, as /next places it: a dot on the anchor, a
 * leader rising from it, the copy 12 px beside the leader's top. It flips left or below to stay
 * 16 px inside the viewport and 8 px clear of the chrome, and hides when the anchor is off screen.
 */
export type Rect = { left: number; top: number; right: number; bottom: number }

export type Placement = {
  visible: boolean
  left: boolean
  below: boolean
  /** The leader's length in px. */
  stem: number
}

export const COPY_OFFSET = 12
export const VIEWPORT_MARGIN = 16
export const OBSTACLE_PADDING = 8

/** `max(copyHeight + 12, clamp(.12 × canvas height, 64, 104))`. */
export function stemLength(copyHeight: number, viewHeight: number) {
  return Math.max(copyHeight + 12, Math.min(104, Math.max(64, 0.12 * viewHeight)))
}

function copyRect(x: number, y: number, width: number, height: number, stem: number, left: boolean, below: boolean): Rect {
  const top = below ? y + stem - height : y - stem
  const l = left ? x - COPY_OFFSET - width : x + COPY_OFFSET
  return { left: l, top, right: l + width, bottom: top + height }
}

const overlaps = (a: Rect, b: Rect) => a.left < b.right + OBSTACLE_PADDING && a.right > b.left - OBSTACLE_PADDING &&
  a.top < b.bottom + OBSTACLE_PADDING && a.bottom > b.top - OBSTACLE_PADDING

function outside(rect: Rect, width: number, height: number) {
  const m = VIEWPORT_MARGIN
  return Math.max(0, m - rect.left) + Math.max(0, rect.right - (width - m)) + Math.max(0, m - rect.top) + Math.max(0, rect.bottom - (height - m))
}

export function placeLabel({ x, y, inFront, copyWidth, copyHeight, viewWidth, viewHeight, obstacles }: {
  x: number
  y: number
  /** False when the anchor is behind the camera. */
  inFront: boolean
  copyWidth: number
  copyHeight: number
  viewWidth: number
  viewHeight: number
  obstacles: readonly Rect[]
}): Placement {
  const stem = stemLength(copyHeight, viewHeight)
  const onScreen = inFront && x >= 0 && x <= viewWidth && y >= 0 && y <= viewHeight
  const hidden = { visible: false, left: false, below: false, stem }
  if (!onScreen) return hidden
  // The dot itself under the chrome: the label would point at nothing visible.
  if (obstacles.some((rect) => x > rect.left && x < rect.right && y > rect.top && y < rect.bottom)) return hidden
  let best: Placement | null = null
  let bestScore = Infinity
  // Above-right first (the reference), then above-left, below-right, below-left.
  for (const [left, below] of [[false, false], [true, false], [false, true], [true, true]] as const) {
    const rect = copyRect(x, y, copyWidth, copyHeight, stem, left, below)
    const leader: Rect = below ? { left: x, top: y, right: x + 1, bottom: y + stem } : { left: x, top: y - stem, right: x + 1, bottom: y }
    const blocked = obstacles.filter((obstacle) => overlaps(rect, obstacle) || overlaps(leader, obstacle)).length
    const score = blocked * 1000 + outside(rect, viewWidth, viewHeight)
    if (score < bestScore) {
      bestScore = score
      best = { visible: true, left, below, stem }
      if (score === 0) break
    }
  }
  return best ?? hidden
}
