import { expect, test } from '@playwright/test'
import { placeLabel, stemLength } from '../../src/showcase/discovery/placement'
import { GLIDE_EASING } from '../../src/showcase/easing'

const view = { viewWidth: 1440, viewHeight: 900, copyWidth: 150, copyHeight: 34, inFront: true }

test('the leader is max(copy + 12, clamp(.12 × height, 64, 104))', () => {
  expect(stemLength(34, 900)).toBe(104)
  expect(stemLength(34, 600)).toBe(72)
  expect(stemLength(34, 300)).toBe(64)
  expect(stemLength(120, 900)).toBe(132)
})

test('the label sits above-right, flips to stay inside and clear of the chrome, hides off screen', () => {
  expect(placeLabel({ ...view, x: 700, y: 500, obstacles: [] })).toMatchObject({ visible: true, left: false, below: false })
  // Near the right edge: the copy goes left of the leader.
  expect(placeLabel({ ...view, x: 1380, y: 500, obstacles: [] })).toMatchObject({ visible: true, left: true, below: false })
  // Near the top: the leader goes down.
  expect(placeLabel({ ...view, x: 700, y: 60, obstacles: [] })).toMatchObject({ visible: true, below: true })
  // A dial to the right of the anchor: the copy goes left.
  const dial = { left: 720, top: 300, right: 1000, bottom: 600 }
  expect(placeLabel({ ...view, x: 710, y: 500, obstacles: [dial] })).toMatchObject({ visible: true, left: true })
  // The anchor under the chrome, behind the camera or off screen: hidden.
  expect(placeLabel({ ...view, x: 800, y: 500, obstacles: [dial] }).visible).toBe(false)
  expect(placeLabel({ ...view, x: 700, y: 500, inFront: false, obstacles: [] }).visible).toBe(false)
  expect(placeLabel({ ...view, x: -5, y: 500, obstacles: [] }).visible).toBe(false)
})

test('the sky glides on cubic-bezier(.4, 0, .2, 1)', () => {
  expect(GLIDE_EASING(0)).toBe(0)
  expect(GLIDE_EASING(1)).toBe(1)
  // The standard curve: a quick start and a long settle.
  expect(GLIDE_EASING(0.5)).toBeCloseTo(0.7752, 3)
  for (let t = 0; t < 1; t += 0.05) expect(GLIDE_EASING(t + 0.05)).toBeGreaterThanOrEqual(GLIDE_EASING(t))
})
