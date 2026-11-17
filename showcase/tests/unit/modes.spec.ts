import { expect, test } from '@playwright/test'
import type { Features } from '../../src/features'
import {
  availableModes, cutEntryPosition, cutRange, defaultView, modeOf, moodOf, positionOf, sliderOf, type ViewState,
} from '../../src/showcase/modes'

const flags = (overrides: Partial<Features> = {}): Features => ({ cutView: false, xray: false, touchWalk: false, intro: false, ...overrides })
const ids = (features: Features, coarsePointer = false, familyCount = 5) => availableModes(features, { coarsePointer, familyCount }).map((mode) => mode.id)
const view = (overrides: Partial<ViewState> = {}): ViewState => ({
  levelMode: 'stacked', walkthroughMode: false, walkthroughMovement: 'walk', sectionEnabled: false, xrayFamily: null, timeOfDay: 'golden',
  timeOfDayMinutes: null, ...overrides,
})

test('gated modes show only with their flag, in the dial order', () => {
  expect(ids(flags())).toEqual(['exterior', 'exploded', 'walkthrough'])
  expect(ids(flags({ cutView: true }))).toEqual(['exterior', 'exploded', 'cut', 'walkthrough'])
  expect(ids(flags({ xray: true }))).toEqual(['exterior', 'exploded', 'xray', 'walkthrough'])
  expect(ids(flags({ cutView: true, xray: true }))).toEqual(['exterior', 'exploded', 'cut', 'xray', 'walkthrough'])
})

test('X-ray needs at least two families to pick from', () => {
  expect(ids(flags({ xray: true }), false, 2)).toContain('xray')
  expect(ids(flags({ xray: true }), false, 1)).not.toContain('xray')
  expect(ids(flags({ xray: true }), false, 0)).not.toContain('xray')
})

test('touch devices get no walkthrough until walking by touch is on', () => {
  expect(ids(flags(), true)).toEqual(['exterior', 'exploded'])
  expect(ids(flags({ touchWalk: true }), true)).toEqual(['exterior', 'exploded', 'walkthrough'])
})

test('the active mode follows the viewer store', () => {
  expect(modeOf(view())).toBe('exterior')
  expect(modeOf(view({ levelMode: 'exploded' }))).toBe('exploded')
  expect(modeOf(view({ levelMode: 'exploded', walkthroughMode: true }))).toBe('walkthrough')
  expect(modeOf(view({ walkthroughMode: true, walkthroughMovement: 'drone' }))).toBeNull()
  expect(modeOf(view({ levelMode: 'solo' }))).toBeNull()
  // A section is the Cut view; during a walk the walk wins, and the cut is back after it.
  expect(modeOf(view({ sectionEnabled: true }))).toBe('cut')
  expect(modeOf(view({ sectionEnabled: true, walkthroughMode: true }))).toBe('walkthrough')
  expect(modeOf(view({ xrayFamily: 'walls' }))).toBe('xray')
  expect(modeOf(view({ xrayFamily: 'walls', walkthroughMode: true }))).toBe('walkthrough')
})

test('the active mood follows the presets and the sun heights', () => {
  // Today at the site: dawn's height at 07:10, dusk's at 17:00 (solar clock minutes).
  const minutesOf = (target: { elevation: number; side: 'rising' | 'setting' }) => (target.side === 'rising' ? 430 : 1020)
  expect(moodOf(view({ timeOfDay: 'night' }), minutesOf)).toBe('night')
  expect(moodOf(view({ timeOfDay: 'midday' }), minutesOf)).toBe('day')
  expect(moodOf(view({ timeOfDayMinutes: 430 }), minutesOf)).toBe('dawn')
  expect(moodOf(view({ timeOfDayMinutes: 1020.2 }), minutesOf)).toBe('dusk')
  // Presets that are no mood, and any other exact time (a sky slider, a glide on its way), match none.
  expect(moodOf(view({ timeOfDay: 'golden' }), minutesOf)).toBeNull()
  expect(moodOf(view({ timeOfDay: 'dawn' }), minutesOf)).toBeNull()
  expect(moodOf(view({ timeOfDayMinutes: 600 }), minutesOf)).toBeNull()
  // A preset name left in the store under explicit minutes does not count.
  expect(moodOf(view({ timeOfDay: 'night', timeOfDayMinutes: 1020 }), minutesOf)).toBe('dusk')
})

test('the cut slider spans the model with a small margin each side', () => {
  const range = cutRange(0, 10)
  expect(range).toEqual({ low: -0.2, high: 10.2 })
  expect(cutRange(0, 1)).toEqual({ low: -0.05, high: 1.05 })
  expect(sliderOf(-0.2, range)).toBe(0)
  expect(sliderOf(10.2, range)).toBe(1)
  expect(sliderOf(5, range)).toBeCloseTo(0.5)
  expect(sliderOf(99, range)).toBe(1)
  expect(positionOf(0.5, range)).toBeCloseTo(5)
  expect(positionOf(sliderOf(3.3, range), range)).toBeCloseTo(3.3)
})

test('the Cut view opens 1.2 m above the lowest floor, inside the model', () => {
  expect(cutEntryPosition(0, -0.3, 7)).toBeCloseTo(1.2)
  expect(cutEntryPosition(-3, -3.2, 6)).toBeCloseTo(-1.8)
  // A shed lower than 1.2 m: the plane stays just inside the top.
  expect(cutEntryPosition(0, 0, 1)).toBeCloseTo(0.95)
})

test('visitors arrive on exploded floors at dusk, or the whole house when it has one floor', () => {
  expect(defaultView(3)).toEqual({ mode: 'exploded', mood: 'dusk' })
  expect(defaultView(1)).toEqual({ mode: 'exterior', mood: 'dusk' })
})
