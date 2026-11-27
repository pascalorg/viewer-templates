import { expect, test } from '@playwright/test'
import { arrangeTour, moveRoom, parseImmersiveSettings, roundPose, toggleRoom, tourOrder, withOpening, withTour } from '../../src/settings/opening'

const camera = { position: [8, 4, 6] as [number, number, number], target: [0, 1, 0] as [number, number, number] }

test('saved settings parse whole', () => {
  const data = { v: 1, opening: { camera, time: 'night', walls: 'cutaway' }, tour: { order: ['b', 'a'], skip: ['c'], autostart: true } }
  expect(parseImmersiveSettings(data)).toEqual(data)
})

test('levels are not a setting: one saved by an earlier build is dropped', () => {
  expect(parseImmersiveSettings({ v: 1, opening: { time: 'night', levels: 'exploded' } })).toEqual({ v: 1, opening: { time: 'night' } })
})

test('each field falls back on its own', () => {
  expect(parseImmersiveSettings({
    v: 1,
    opening: { camera: { position: [1, 2], target: [0, 0, 0] }, time: 'dusk', walls: 'translucent' },
    tour: { order: 'a,b', skip: [1, 2], autostart: 'yes' },
  })).toEqual({ v: 1, opening: {}, tour: {} })
  expect(parseImmersiveSettings({ v: 1, opening: { camera: { position: [0, 1, 0], target: [0, 1, 0] }, time: 'golden' } }))
    .toEqual({ v: 1, opening: { time: 'golden' } })
  expect(parseImmersiveSettings({ v: 1, opening: 'front', tour: 3 })).toEqual({ v: 1 })
})

test('another shape, or none, is the default settings; unknown keys survive', () => {
  expect(parseImmersiveSettings(null)).toEqual({ v: 1 })
  expect(parseImmersiveSettings({ v: 2, opening: { time: 'night' } })).toEqual({ v: 1 })
  expect(parseImmersiveSettings([1, 2])).toEqual({ v: 1 })
  expect(parseImmersiveSettings({ v: 1, theme: { accent: 'teal' } })).toEqual({ v: 1, theme: { accent: 'teal' } })
})

test('fields change one at a time, and nothing left removes the group', () => {
  const start = { v: 1 as const, other: true, opening: { time: 'night' as const } }
  expect(withOpening(start, { walls: 'down' })).toEqual({ v: 1, other: true, opening: { time: 'night', walls: 'down' } })
  expect(withOpening(start, { time: undefined })).toEqual({ v: 1, other: true })
  expect(withTour(start, { autostart: true })).toEqual({ ...start, tour: { autostart: true } })
  expect(withTour({ v: 1, tour: { autostart: true } }, { autostart: undefined })).toEqual({ v: 1 })
})

test('a camera pose is kept to the millimetre', () => {
  expect(roundPose({ position: [1.23456, 2, -3.00049], target: [0, 0.0005, 0] }))
    .toEqual({ position: [1.235, 2, -3], target: [0, 0.001, 0] })
})

const stop = (zoneId: string) => ({ zoneId })
const route = [
  { levelId: 'ground', stops: ['hall', 'kitchen', 'living'].map(stop) },
  { levelId: 'first', stops: ['bed', 'bath'].map(stop) },
]
const ids = (floors: { levelId: string; stops: { zoneId: string }[] }[]) => floors.map((f) => [f.levelId, f.stops.map((s) => s.zoneId)])

test("with nothing saved the tour is the viewer's route, unchanged", () => {
  expect(ids(arrangeTour(route, undefined))).toEqual([['ground', ['hall', 'kitchen', 'living']], ['first', ['bed', 'bath']]])
  expect(ids(arrangeTour(route, { autostart: true }))).toEqual(ids(route))
})

test('the saved order sorts rooms within their floor; new rooms follow; skipped rooms and empty floors go', () => {
  const tour = { order: ['living', 'hall', 'bath', 'bed', 'gone'], skip: ['hall'] }
  expect(ids(arrangeTour(route, tour))).toEqual([['ground', ['living', 'kitchen']], ['first', ['bath', 'bed']]])
  expect(ids(arrangeTour(route, { skip: ['bed', 'bath'] }))).toEqual([['ground', ['hall', 'kitchen', 'living']]])
  // The panel lists skipped rooms too.
  expect(ids(tourOrder(route, tour))).toEqual([['ground', ['living', 'hall', 'kitchen']], ['first', ['bath', 'bed']]])
})

test("moving a room writes the whole route, and stops at its floor's ends", () => {
  expect(moveRoom(route, undefined, 'living', -1)).toEqual(['hall', 'living', 'kitchen', 'bed', 'bath'])
  expect(moveRoom(route, undefined, 'living', 1)).toEqual(['hall', 'kitchen', 'living', 'bed', 'bath'])
  expect(moveRoom(route, undefined, 'bed', -1)).toEqual(['hall', 'kitchen', 'living', 'bed', 'bath'])
  expect(moveRoom(route, { order: ['kitchen', 'hall'] }, 'bath', -1)).toEqual(['kitchen', 'hall', 'living', 'bath', 'bed'])
})

test('a room is skipped and brought back; none skipped is no list', () => {
  expect(toggleRoom(undefined, 'hall', false)).toEqual(['hall'])
  expect(toggleRoom({ skip: ['hall'] }, 'hall', true)).toBeUndefined()
  expect(toggleRoom({ skip: ['hall'] }, 'bed', false)).toEqual(['hall', 'bed'])
})
