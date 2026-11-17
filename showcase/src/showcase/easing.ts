/** Easing shared by the chrome's motion (pure, unit tested). */

/** CSS `cubic-bezier(x1, y1, x2, y2)` as a function of progress. */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number) {
  const curve = (a: number, b: number, t: number) => 3 * a * (1 - t) ** 2 * t + 3 * b * (1 - t) * t ** 2 + t ** 3
  const slope = (a: number, b: number, t: number) => 3 * a * (1 - t) ** 2 + 6 * (b - a) * (1 - t) * t + 3 * (1 - b) * t ** 2
  return (x: number) => {
    if (x <= 0) return 0
    if (x >= 1) return 1
    let t = x
    for (let i = 0; i < 8; i++) {
      const error = curve(x1, x2, t) - x
      const d = slope(x1, x2, t)
      if (Math.abs(error) < 1e-6 || d === 0) break
      t -= error / d
    }
    return curve(y1, y2, Math.min(1, Math.max(0, t)))
  }
}

/** /next's time-of-day glide. */
export const GLIDE_EASING = cubicBezier(0.4, 0, 0.2, 1)
