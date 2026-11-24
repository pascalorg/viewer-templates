import { expect, test } from '@playwright/test'
import { defaultView, type ModeId } from '../../src/showcase/modes'
import { cameraAzimuth, parseShowcaseSettings, resolveOpening, roundPose } from '../../src/showcase/opening'

const camera = { position: [8, 4, 6] as [number, number, number], target: [0, 1, 0] as [number, number, number] }
const offered: ModeId[] = ['exterior', 'exploded', 'cut', 'xray', 'walkthrough']

test('a saved opening view parses whole', () => {
  expect(parseShowcaseSettings({ v: 1, opening: { camera, time: 'night', mode: 'cut' } }))
    .toEqual({ v: 1, opening: { camera, time: 'night', mode: 'cut' } })
})

test('each field falls back on its own, and walkthrough is never an opening mode', () => {
  expect(parseShowcaseSettings({ v: 1, opening: { camera: { position: [1, 2], target: [0, 0, 0] }, time: 'noon', mode: 'walkthrough' } }))
    .toEqual({ v: 1, opening: {} })
  expect(parseShowcaseSettings({ v: 1, opening: { camera: { position: [0, 1, 0], target: [0, 1, 0] }, time: 'dawn' } }))
    .toEqual({ v: 1, opening: { time: 'dawn' } })
  expect(parseShowcaseSettings({ v: 1, opening: 'front' })).toEqual({ v: 1 })
})

test('another shape, or none, is the default settings; unknown keys survive', () => {
  expect(parseShowcaseSettings(null)).toEqual({ v: 1 })
  expect(parseShowcaseSettings({ v: 2, opening: { time: 'day' } })).toEqual({ v: 1 })
  expect(parseShowcaseSettings([1, 2])).toEqual({ v: 1 })
  expect(parseShowcaseSettings({ v: 1, tour: { rooms: ['zone_a'] } })).toEqual({ v: 1, tour: { rooms: ['zone_a'] } })
})

test('the opening view resolves over the default view, and a mode the page does not offer is the default', () => {
  expect(resolveOpening(undefined, 2, offered)).toEqual({ ...defaultView(2), camera: null })
  expect(resolveOpening({ time: 'day' }, 1, offered)).toEqual({ mode: 'exterior', mood: 'day', camera: null })
  expect(resolveOpening({ mode: 'xray', camera }, 2, offered)).toEqual({ mode: 'xray', mood: 'dusk', camera })
  expect(resolveOpening({ mode: 'xray' }, 2, ['exterior', 'exploded'])).toEqual({ mode: 'exploded', mood: 'dusk', camera: null })
})

test('a camera heading is measured as the framing measures it, and poses round to millimetres', () => {
  expect(cameraAzimuth(camera)).toBeCloseTo(Math.atan2(8, 6))
  expect(roundPose({ position: [1.23456, 2, 3], target: [0.0004, 0, -0.0006] })).toEqual({ position: [1.235, 2, 3], target: [0, 0, -0.001] })
})
