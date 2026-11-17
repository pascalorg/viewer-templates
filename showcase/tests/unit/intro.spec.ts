import { expect, test } from '@playwright/test'
import { createFrameCoalescer } from '../../src/showcase/coalesce'
import { boxCorners, fitPoints } from '../../src/showcase/framing'
import { INTRO_DURATION_MS, introCameraPose, introSectionPosition, IntroSequence, steadyClock } from '../../src/showcase/intro'

function clock(start = 1000) {
  let now = start
  return { now: () => now, advance: (ms: number) => { now += ms } }
}

test('the intro starts below the model with the camera at its start', () => {
  const time = clock()
  const intro = new IntroSequence({ now: time.now })
  intro.start()
  expect(intro.frame()).toEqual({ done: false, t: 0, reveal: 0, orbit: 0 })
  expect(introSectionPosition(0, 0, 8)).toBeLessThan(0)
})

test('half way, the plane and the orbit are half way', () => {
  const time = clock()
  const intro = new IntroSequence({ now: time.now })
  intro.start()
  time.advance(INTRO_DURATION_MS / 2)
  const frame = intro.frame()
  expect(frame.done).toBe(false)
  expect(frame.t).toBeCloseTo(0.5)
  expect(frame.reveal).toBeCloseTo(0.5)
  expect(frame.orbit).toBeCloseTo(0.5)
  // Eased: slow at the ends.
  time.advance(-INTRO_DURATION_MS * 0.4)
  expect(intro.frame().reveal).toBeLessThan(0.1)
})

test('it ends after 4.5 s, the plane above the model', () => {
  const time = clock()
  const intro = new IntroSequence({ now: time.now })
  intro.start()
  time.advance(INTRO_DURATION_MS)
  expect(intro.frame()).toEqual({ done: true, t: 1, reveal: 1, orbit: 1 })
  expect(introSectionPosition(1, 0, 8)).toBeGreaterThan(8)
})

test('skip ends it at once; camera input stops only the orbit', () => {
  const time = clock()
  const intro = new IntroSequence({ now: time.now })
  intro.start()
  time.advance(1500)
  intro.releaseCamera()
  const released = intro.frame()
  expect(released.done).toBe(false)
  expect(released.orbit).toBeNull()
  expect(released.reveal).toBeGreaterThan(0)
  intro.skip()
  expect(intro.frame()).toMatchObject({ done: true, reveal: 1 })
})

test('reduced motion skips it entirely', () => {
  const intro = new IntroSequence({ now: clock().now, reducedMotion: true })
  intro.start()
  expect(intro.frame()).toMatchObject({ done: true, reveal: 1, orbit: null })
})

test('the orbit turns 35 degrees around the settled framing', () => {
  const points = boxCorners({ min: [-5, 0, -4], max: [5, 6, 4] })
  const start = introCameraPose({ points, startAzimuth: 0, orbit: 0, aspect: 16 / 9 })
  expect(start).toEqual(fitPoints({ points, azimuth: 0, aspect: 16 / 9 }))
  const end = introCameraPose({ points, startAzimuth: 0, orbit: 1, aspect: 16 / 9 })
  expect(Math.atan2(end.position[0] - end.target[0], end.position[2] - end.target[2]) * 180 / Math.PI).toBeCloseTo(35)
  expect(end.distance).toBeGreaterThan(0)
})

test('scrubbing writes the store once per frame, the last value winning', () => {
  const writes: number[] = []
  let queued: (() => void) | null = null
  const coalescer = createFrameCoalescer<number>((value) => writes.push(value), (run) => { queued = run; return 1 }, () => { queued = null })
  coalescer.push(1)
  coalescer.push(2)
  coalescer.push(3)
  expect(writes).toEqual([])
  queued!()
  expect(writes).toEqual([3])
  coalescer.push(4)
  coalescer.dispose()
  expect(queued).toBeNull()
  expect(writes).toEqual([3])
})

test('a stalled frame slows the intro down instead of skipping the reveal', () => {
  const time = clock()
  const steady = steadyClock(time.now, { maxStep: 50 })
  const intro = new IntroSequence({ now: steady })
  intro.start()
  time.advance(16); intro.frame()
  // A 2 s stall (shader compilation) counts as one 50 ms step.
  time.advance(2000)
  expect(intro.frame().t).toBeCloseTo(66 / INTRO_DURATION_MS)
})

test('on a slow device the intro still ends within twice its length', () => {
  const time = clock()
  const intro = new IntroSequence({ now: steadyClock(time.now) })
  intro.start()
  // Two frames a second: every step is capped, but the wall clock pulls it along.
  for (let elapsed = 0; elapsed < 2 * INTRO_DURATION_MS; elapsed += 500) {
    time.advance(500)
    if (intro.frame().done) break
  }
  expect(intro.frame().done).toBe(true)
})
