import { fitPoints, type SafeArea, type Vec3 } from './framing'

/**
 * The arrival intro as a clock-driven sequence, with no viewer or React import so it is unit-tested
 * in Node. `useIntro` runs it once per animation frame and applies each frame to the viewer.
 *
 * Over `duration` a horizontal section plane rises through the model (`reveal` 0 → 1) while the
 * camera orbits (`orbit` 0 → 1). Skipping ends it at once; user camera input stops the orbit but
 * lets the reveal finish; reduced motion skips it entirely.
 */

export const INTRO_DURATION_MS = 4500
/** Degrees the camera travels around the model. */
export const INTRO_ORBIT_DEGREES = 35

export type IntroFrame = {
  done: boolean
  /** Linear progress, 0..1. */
  t: number
  /** Eased progress of the section plane, 0..1. */
  reveal: number
  /** Eased progress of the orbit, 0..1; null once the visitor took the camera. */
  orbit: number | null
}

/**
 * A clock that never jumps more than `maxStep` ms between reads, so a stalled frame (a heavy scene
 * compiling shaders) slows the intro down instead of skipping most of the reveal. It never lags
 * the wall clock by more than `slack`, so on a slow device the intro still ends: at most
 * `duration + slack` after it began.
 */
export function steadyClock(now: () => number, { maxStep = 50, slack = INTRO_DURATION_MS } = {}): () => number {
  let first: number | null = null
  let last: number | null = null
  let elapsed = 0
  return () => {
    const time = now()
    first ??= time
    if (last !== null) elapsed += Math.min(maxStep, Math.max(0, time - last))
    last = time
    elapsed = Math.max(elapsed, time - first - slack)
    return elapsed
  }
}

const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2)

export class IntroSequence {
  private startedAt: number | null = null
  private skipped = false
  private cameraReleased = false

  constructor(private readonly options: {
    now: () => number
    duration?: number
    reducedMotion?: boolean
  }) {}

  start() {
    this.startedAt ??= this.options.now()
  }

  skip() {
    this.skipped = true
  }

  /** The visitor moved the camera: stop driving it, keep revealing. */
  releaseCamera() {
    this.cameraReleased = true
  }

  frame(): IntroFrame {
    const duration = this.options.duration ?? INTRO_DURATION_MS
    if (this.skipped || this.options.reducedMotion) return { done: true, t: 1, reveal: 1, orbit: null }
    const elapsed = this.startedAt === null ? 0 : this.options.now() - this.startedAt
    const t = Math.min(1, Math.max(0, elapsed / duration))
    return { done: t >= 1, t, reveal: easeInOut(t), orbit: this.cameraReleased ? null : easeInOut(t) }
  }
}

/**
 * The camera on its orbit: the settled framing of the model (`fitPoints`), turned by the orbit's
 * progress, so the intro ends exactly where the settled view starts.
 */
export function introCameraPose({ points, startAzimuth, orbit, aspect, safe }: {
  /** Points on the drawn model (see `fitPoints`). */
  points: readonly Vec3[]
  safe?: SafeArea
  /** Radians, measured as atan2(x, z) from the centre; the orbit starts where the camera is. */
  startAzimuth: number
  orbit: number
  aspect: number
}) {
  return fitPoints({ points, azimuth: introAzimuth(startAzimuth, orbit), aspect, safe })
}

export function introAzimuth(startAzimuth: number, orbit: number) {
  return startAzimuth + (orbit * INTRO_ORBIT_DEGREES * Math.PI) / 180
}

/** The section plane's height: from just below the model's lowest point to just above its top. */
export function introSectionPosition(reveal: number, minY: number, maxY: number) {
  const margin = Math.max(0.05, (maxY - minY) * 0.02)
  return minY - margin + reveal * (maxY - minY + 2 * margin)
}
