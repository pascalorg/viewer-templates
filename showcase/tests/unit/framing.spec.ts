import { expect, test } from '@playwright/test'
import { fitPoints, fittedPose, raised, safeArea, VIEW_FILL, type Box, type Vec3 } from '../../src/showcase/framing'
import { firstXrayFamily, familyLabel } from '../../src/showcase/families'

/** Where a world point lands on screen, -1..1 each way, for a camera looking at `target`. */
function project(point: Vec3, pose: { position: Vec3; target: Vec3 }, aspect: number, fov = 50) {
  const f = pose.target.map((v, i) => v - pose.position[i]!) as Vec3
  const fl = Math.hypot(...f)
  const forward = f.map((v) => v / fl) as Vec3
  const rl = Math.hypot(forward[2], forward[0])
  const right: Vec3 = [-forward[2] / rl, 0, forward[0] / rl]
  const up: Vec3 = [right[1] * forward[2] - right[2] * forward[1], right[2] * forward[0] - right[0] * forward[2], right[0] * forward[1] - right[1] * forward[0]]
  const d = point.map((v, i) => v - pose.position[i]!) as Vec3
  const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
  const t = Math.tan((fov * Math.PI) / 360)
  return [dot(d, right) / dot(d, forward) / (t * aspect), dot(d, up) / dot(d, forward) / t]
}
const corners = (box: Box): Vec3[] => [box.min[0], box.max[0]].flatMap((x) => [box.min[1], box.max[1]].flatMap((y) => [box.min[2], box.max[2]].map((z) => [x, y, z] as Vec3)))

for (const [name, aspect] of [['desktop', 1440 / 900], ['phone', 390 / 844]] as const) {
  test(`a long, low house fills the ${name} view without leaving it`, () => {
    const box: Box = { min: [-12, 0, -6], max: [12, 5, 6] }
    const pose = fittedPose({ box, azimuth: Math.PI / 4, aspect })
    const points = corners(box).map((corner) => project(corner, pose, aspect))
    const reach = Math.max(...points.flatMap(([x, y]) => [Math.abs(x!), Math.abs(y!)]))
    // Every corner inside the view, and the tightest one right at the fill line.
    expect(reach).toBeLessThanOrEqual(VIEW_FILL + 1e-3)
    expect(reach).toBeGreaterThan(VIEW_FILL - 0.01)
  })
}

test('the exploded box keeps the raised roof in view', () => {
  const box: Box = { min: [-6, 0, -5], max: [6, 6, 5] }
  const exploded = raised(box, 10)
  const pose = fittedPose({ box: exploded, azimuth: 0, aspect: 1.6 })
  for (const corner of corners(exploded)) {
    const [x, y] = project(corner, pose, 1.6)
    expect(Math.abs(x!)).toBeLessThanOrEqual(VIEW_FILL + 1e-3)
    expect(Math.abs(y!)).toBeLessThanOrEqual(VIEW_FILL + 1e-3)
  }
})

test('X-ray opens on the shell of the house and names every family', () => {
  expect(firstXrayFamily(['site', 'floors', 'walls', 'items'])).toBe('walls')
  expect(firstXrayFamily(['site', 'structure', 'floors'])).toBe('structure')
  expect(firstXrayFamily(['site', 'floors'])).toBe('floors')
  expect(firstXrayFamily(['items', 'other'])).toBe('items')
  expect(firstXrayFamily([])).toBeNull()
  expect(familyLabel('roof-services')).toBe('Roof fittings')
  expect(familyLabel('new-kind')).toBe('New kind')
})

test('fitting the drawn points never stands farther than fitting their box, and centres them', () => {
  // An L-shaped house: two wings, empty air in the box's far corner.
  const wings: Box[] = [{ min: [0, 0, 0], max: [20, 4, 6] }, { min: [0, 0, 6], max: [6, 4, 20] }]
  const points = wings.flatMap((box) => [box.min[0], box.max[0]].flatMap((x) => [box.min[1], box.max[1]].flatMap((y) => [box.min[2], box.max[2]].map((z) => [x, y, z] as Vec3))))
  const byBox = fittedPose({ box: { min: [0, 0, 0], max: [20, 4, 20] }, azimuth: Math.PI / 4, aspect: 1.6 })
  const byPoints = fitPoints({ points, azimuth: Math.PI / 4, aspect: 1.6 })
  expect(byPoints.distance).toBeLessThanOrEqual(byBox.distance + 1e-9)
  const projected = points.map((point) => project(point, byPoints, 1.6))
  const xs = projected.map(([x]) => x!), ys = projected.map(([, y]) => y!)
  expect((Math.min(...xs) + Math.max(...xs)) / 2).toBeCloseTo(0, 1)
  expect((Math.min(...ys) + Math.max(...ys)) / 2).toBeCloseTo(0, 1)
  expect(Math.max(...xs.map(Math.abs), ...ys.map(Math.abs))).toBeLessThanOrEqual(VIEW_FILL + 1e-3)
})

test('the model sits in the safe area, clear of the dial and the corner buttons', () => {
  const points = [-6, 6].flatMap((x) => [0, 7].flatMap((y) => [-5, 5].map((z) => [x, y, z] as Vec3)))
  const safe = safeArea(1440, 900, { left: 240, right: 72, top: 28, bottom: 24 })
  const pose = fitPoints({ points, azimuth: Math.PI / 5, aspect: 1440 / 900, safe })
  const projected = points.map((point) => project(point, pose, 1440 / 900))
  const xs = projected.map(([x]) => x!), ys = projected.map(([, y]) => y!)
  expect(Math.min(...xs)).toBeGreaterThanOrEqual(safe.left - 1e-3)
  expect(Math.max(...xs)).toBeLessThanOrEqual(safe.right + 1e-3)
  expect(Math.max(...ys)).toBeLessThanOrEqual(safe.top + 1e-3)
  expect(Math.min(...ys)).toBeGreaterThanOrEqual(safe.bottom - 1e-3)
  expect((Math.min(...xs) + Math.max(...xs)) / 2).toBeCloseTo((safe.left + safe.right) / 2, 1)
})
