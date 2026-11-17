import { expect, test } from '@playwright/test'
import { azimuthOf, FRONT_OFFSET_DEGREES, houseFront, threeQuarter } from '../../src/showcase/front'

type Node = Record<string, unknown> & { id: string; type: string }
const deg = (radians: number) => Math.round((radians * 180) / Math.PI)
/** Rounded, with −0 read as 0. */
const round = (v: number[]) => v.map((x) => Math.round(x) || 0)

/** A 10 × 6 box house on one level (x −5..5, z −3..3), one room inside, walls clockwise. */
function house(extra: Node[] = [], building: Partial<Node> = {}) {
  const list: Node[] = [
    { id: 'site', type: 'site', parentId: null },
    { id: 'building', type: 'building', parentId: 'site', position: [0, 0, 0], rotation: [0, 0, 0], ...building },
    { id: 'level', type: 'level', parentId: 'building' },
    { id: 'room', type: 'zone', parentId: 'level', polygon: [[-5, -3], [5, -3], [5, 3], [-5, 3]] },
    { id: 'w-north', type: 'wall', parentId: 'level', start: [-5, -3], end: [5, -3] },
    { id: 'w-east', type: 'wall', parentId: 'level', start: [5, -3], end: [5, 3] },
    { id: 'w-south', type: 'wall', parentId: 'level', start: [5, 3], end: [-5, 3] },
    { id: 'w-west', type: 'wall', parentId: 'level', start: [-5, 3], end: [-5, -3] },
    ...extra,
  ]
  return Object.fromEntries(list.map((node) => [node.id, node]))
}

test('the saved scene camera wins, its heading used as is', () => {
  const nodes = house([{ id: 'spawn', type: 'spawn', parentId: 'level', position: [0, 0, -9] }])
  ;(nodes.site as Node).camera = { position: [10, 5, 10], target: [0, 0, 0] }
  const front = houseFront(nodes)
  expect(front.signal).toBe('saved-camera')
  expect(deg(front.azimuth!)).toBe(45)
})

test('the walkthrough spawn says which way the front faces', () => {
  const front = houseFront(house([{ id: 'spawn', type: 'spawn', parentId: 'level', position: [0, 0, 9] }]))
  expect(front.signal).toBe('spawn')
  expect(round(front.normal!)).toEqual([0, 1])
  expect(Math.abs(deg(front.azimuth!))).toBe(FRONT_OFFSET_DEGREES)
})

test('else the main entrance: a double door beats a wider garage door and a single door', () => {
  const front = houseFront(house([
    { id: 'garage', type: 'door', parentId: 'w-east', wallId: 'w-east', position: [3, 1, 0], width: 3, doorType: 'garage-rollup' },
    { id: 'back', type: 'door', parentId: 'w-north', wallId: 'w-north', position: [5, 1, 0], width: 1.2, leafCount: 1 },
    { id: 'entry', type: 'door', parentId: 'w-south', wallId: 'w-south', position: [5, 1, 0], width: 1.0, leafCount: 2 },
  ]))
  expect(front.signal).toBe('entrance')
  expect(round(front.normal!)).toEqual([0, 1])
})

test('else the façade with the most openings, else the longest façade', () => {
  const windows = [1, 2, 3].map((i): Node => ({ id: `win-${i}`, type: 'window', parentId: 'w-west', wallId: 'w-west', position: [i, 1, 0] }))
  const byOpenings = houseFront(house([...windows, { id: 'win-n', type: 'window', parentId: 'w-north', wallId: 'w-north', position: [2, 1, 0] }]))
  expect(byOpenings.signal).toBe('openings')
  expect(round(byOpenings.normal!)).toEqual([-1, 0])
  const longest = houseFront(house())
  expect(longest.signal).toBe('longest-facade')
  // The north and south walls are the long ones; either reads as a front.
  expect(Math.abs(Math.round(longest.normal![1]))).toBe(1)
})

test('walls with no rooms still face away from the footprint', () => {
  const nodes = house([{ id: 'door', type: 'door', parentId: 'w-west', wallId: 'w-west', position: [3, 1, 0], width: 0.9 }])
  delete (nodes as Record<string, unknown>).room
  const front = houseFront(nodes)
  expect(front.signal).toBe('entrance')
  expect(round(front.normal!)).toEqual([-1, 0])
})

test('a rotated building turns its front with it', () => {
  const nodes = house([{ id: 'entry', type: 'door', parentId: 'w-south', wallId: 'w-south', position: [5, 1, 0], width: 1, leafCount: 2 }],
    { rotation: [0, Math.PI / 2, 0] })
  const front = houseFront(nodes)
  // +z rotated a quarter turn about Y faces +x.
  expect(round(front.normal!)).toEqual([1, 0])
})

test('the three-quarter view turns to the side where the building shows more', () => {
  // An L: a long wing running off to +x from a front facing +z.
  const walls = [{ start: [0, 0] as [number, number], end: [20, 0] as [number, number] }, { start: [0, 0] as [number, number], end: [0, 4] as [number, number] }]
  const azimuth = threeQuarter([0, 1], walls)
  expect(Math.abs(deg(azimuth - azimuthOf([0, 1])))).toBe(FRONT_OFFSET_DEGREES)
  // The same L mirrored (the wing off to −x) turns the other way.
  const mirrored = threeQuarter([0, 1], walls.map(({ start, end }) => ({ start: [-start[0], start[1]] as [number, number], end: [-end[0], end[1]] as [number, number] })))
  expect(Math.round(deg(mirrored) + deg(azimuth))).toBe(0)
})

test('nothing to go on: no front', () => {
  expect(houseFront({ site: { id: 'site', type: 'site' } }).signal).toBe('none')
})
