import type { Features } from '../features'

/**
 * The dial's two rings, as data. Pure: no viewer import, so the rules are unit-tested in Node.
 * `viewer-actions.ts` turns a choice into store calls.
 */

export type ModeId = 'exterior' | 'exploded' | 'cut' | 'xray' | 'walkthrough'
export type MoodId = 'night' | 'dawn' | 'day' | 'dusk'

export type ModeDefinition = {
  id: ModeId
  label: string
  /** The phone bar's label. */
  short: string
  /** The capability that must be on for the mode to show. */
  feature?: keyof Features
}

export const MODES: readonly ModeDefinition[] = [
  { id: 'exterior', label: 'Exterior', short: 'Home' },
  { id: 'exploded', label: 'Exploded', short: 'Exploded' },
  { id: 'cut', label: 'Cut view', short: 'Cut', feature: 'cutView' },
  { id: 'xray', label: 'X-ray', short: 'X-ray', feature: 'xray' },
  { id: 'walkthrough', label: 'Walkthrough', short: 'Walk' },
]

export const MOODS: readonly { id: MoodId; label: string }[] = [
  { id: 'night', label: 'Night' },
  { id: 'dawn', label: 'Dawn' },
  { id: 'day', label: 'Day' },
  { id: 'dusk', label: 'Dusk' },
]

/**
 * The modes this build offers: gated ones need their flag. Without `touchWalk`, coarse-pointer
 * devices don't get a walk they can't move in; X-ray needs at least two families.
 */
export function availableModes(flags: Features, scene: { coarsePointer: boolean; familyCount: number }): ModeDefinition[] {
  return MODES.filter((mode) => {
    if (mode.feature && !flags[mode.feature]) return false
    if (mode.id === 'walkthrough' && scene.coarsePointer && !flags.touchWalk) return false
    // X-ray picks one family at a time: with one family there is nothing to pick.
    if (mode.id === 'xray' && scene.familyCount < 2) return false
    return true
  })
}

/** The part of the viewer store the dial reads. */
export type ViewState = {
  levelMode: string
  walkthroughMode: boolean
  walkthroughMovement: string
  sectionEnabled: boolean
  xrayFamily: string | null
  timeOfDay: string
  timeOfDayMinutes: number | null
}

/**
 * The mode the store is in; null when it matches none (a floor picked on its own, say). A section
 * left on during a walkthrough is the Cut view again once the walk ends.
 */
export function modeOf(state: ViewState): ModeId | null {
  if (state.walkthroughMode) return state.walkthroughMovement === 'walk' ? 'walkthrough' : null
  if (state.xrayFamily !== null) return 'xray'
  if (state.sectionEnabled) return 'cut'
  if (state.levelMode === 'exploded') return 'exploded'
  if (state.levelMode === 'stacked') return 'exterior'
  return null
}

/** A sun height on one side of noon, in degrees above the horizon (the viewer's `TimeTarget`). */
export type SunHeight = { elevation: number; side: 'rising' | 'setting' }
export type MoodTarget = 'night' | 'midday' | SunHeight

/**
 * Where the sun goes for each mood, matched to `/next` by measurement (frame brightness against
 * Day, lamps, sky). Night and Day keep the viewer presets. Dusk is blue hour, 5.5° below the
 * horizon on the setting side: the lamps are on (below −2°) at full strength, the frame about
 * half Day's, the sky still rose. Dawn is a low rising sun at +3°, lamps off, softer than Day.
 */
export const MOOD_TARGETS: Record<MoodId, MoodTarget> = {
  night: 'night',
  dawn: { elevation: 3, side: 'rising' },
  day: 'midday',
  dusk: { elevation: -5.5, side: 'setting' },
}

/** Minutes on the solar clock for a sun height today at the site (the viewer's `timeTargetMinutes`). */
export type TargetMinutes = (target: SunHeight) => number

/** Two clock times within half a minute of each other, across midnight too. */
function sameMinute(a: number, b: number) {
  const delta = Math.abs(a - b) % 1440
  return Math.min(delta, 1440 - delta) < 0.5
}

/**
 * The mood the store shows: a preset by name, a sun height by the explicit minute it leaves.
 * Any other time (a sky slider, a glide on its way) matches none.
 */
export function moodOf(state: ViewState, minutesOf: TargetMinutes): MoodId | null {
  for (const [mood, target] of Object.entries(MOOD_TARGETS) as [MoodId, MoodTarget][]) {
    if (typeof target === 'string') {
      if (state.timeOfDayMinutes === null && state.timeOfDay === target) return mood
    } else if (state.timeOfDayMinutes !== null && sameMinute(state.timeOfDayMinutes, minutesOf(target))) return mood
  }
  return null
}

/** Where the cut can go along an axis: the model's extent with a small margin past each end. */
export type CutRange = { low: number; high: number }

export function cutRange(min: number, max: number): CutRange {
  const margin = Math.max(0.05, (max - min) * 0.02)
  return { low: min - margin, high: max + margin }
}

/** The slider's 0..1 for a plane position (world metres), and back. */
export function sliderOf(position: number, range: CutRange): number {
  const span = range.high - range.low
  return span > 0 ? Math.min(1, Math.max(0, (position - range.low) / span)) : 0.5
}

export function positionOf(slider: number, range: CutRange): number {
  return range.low + Math.min(1, Math.max(0, slider)) * (range.high - range.low)
}

/** The Cut view opens 1.2 m above the lowest floor, through the ground floor's rooms. */
export const CUT_ENTRY_HEIGHT = 1.2

export function cutEntryPosition(floorY: number, min: number, max: number): number {
  const inset = Math.min(0.05, (max - min) / 2)
  return Math.min(max - inset, Math.max(min + inset, floorY + CUT_ENTRY_HEIGHT))
}

/** What a visitor sees on arrival and after Reset view. Exploded needs floors to spread apart. */
export function defaultView(levelCount: number): { mode: ModeId; mood: MoodId } {
  return { mode: levelCount > 1 ? 'exploded' : 'exterior', mood: 'dusk' }
}
