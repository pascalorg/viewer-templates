import { useScene } from '@pascal-app/core'
import { timeTargetMinutes, transitionTimeOfDay, useViewer } from '@pascal-app/viewer'
import { useSyncExternalStore } from 'react'
import { GLIDE_EASING } from './easing'
import { MOOD_TARGETS, moodOf, type MoodId, type SunHeight } from './modes'

/**
 * Time of day glides like /next's: 1 s, `cubic-bezier(.4,0,.2,1)`, the short way round the clock,
 * and a new choice mid-way restarts from where the sky is (`transitionTimeOfDay`). The dial shows
 * the mood it is going to from the press, so the chrome tracks the target here: the store holds
 * explicit minutes while the sky moves. A mood is a preset or a sun height (`MOOD_TARGETS`); a sun
 * height rests as an explicit minute in the store.
 */
export const GLIDE_MS = 1000

let target: MoodId | null = null
let cancelRunning: (() => void) | null = null
const listeners = new Set<() => void>()

function setTarget(next: MoodId | null) {
  if (target === next) return
  target = next
  for (const listener of listeners) listener()
}

/** The mood the sky is gliding to, or null when it is at rest. */
export function useGlideTarget(): MoodId | null {
  return useSyncExternalStore((listener) => {
    listeners.add(listener)
    return () => listeners.delete(listener)
  }, () => target, () => null)
}

function reducedMotion() {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
}

/** Stops a glide where it is. */
export function cancelGlide() {
  cancelRunning?.()
  cancelRunning = null
  setTarget(null)
}

/**
 * The minute a sun height falls on today at the site, cached until the site's location or the day
 * changes (the dial asks on every frame of a glide).
 */
const minutesCache = new Map<string, number>()
let minutesDay = ''

export function moodMinutes(target: SunHeight): number {
  const day = new Date().toDateString()
  if (day !== minutesDay) {
    minutesCache.clear()
    minutesDay = day
  }
  const key = `${target.side}:${target.elevation}`
  let minutes = minutesCache.get(key)
  if (minutes === undefined) {
    minutes = timeTargetMinutes(target)
    minutesCache.set(key, minutes)
  }
  return minutes
}

/** The mood the sky rests on now (none while it glides or after a time set elsewhere). */
export function currentMood(): MoodId | null {
  return target === null ? moodOf(useViewer.getState(), moodMinutes) : null
}

/** A sun height the sky is parked on, and the minute it was resolved to. */
let parked: { mood: MoodId; minutes: number } | null = null

function rest(mood: MoodId) {
  const goal = MOOD_TARGETS[mood]
  const minutes = useViewer.getState().timeOfDayMinutes
  parked = typeof goal === 'string' || minutes === null ? null : { mood, minutes }
}

/** Sets a mood at once: the opening view, Reset view, the intro's end and reduced motion. */
export function setMoodNow(mood: MoodId) {
  cancelGlide()
  transitionTimeOfDay(MOOD_TARGETS[mood], { durationMs: 0 })
  rest(mood)
}

/** Glides to a mood (at once under reduced motion). */
export function glideToMood(mood: MoodId) {
  if (reducedMotion()) return setMoodNow(mood)
  if (currentMood() === mood) return
  const goal = MOOD_TARGETS[mood]
  // A running glide hands over where the sky is: `transitionTimeOfDay` starts from the store.
  cancelRunning?.()
  cancelRunning = null
  parked = null
  setTarget(mood)
  const to = typeof goal === 'string' ? null : moodMinutes(goal)
  const arrived = (state: { timeOfDay: string; timeOfDayMinutes: number | null }) => typeof goal === 'string'
    ? state.timeOfDayMinutes === null && state.timeOfDay === goal
    : state.timeOfDayMinutes !== null && Math.abs(state.timeOfDayMinutes - to!) < 1e-6
  const done = () => {
    unsubscribe()
    if (cancelRunning === cancel) {
      cancelRunning = null
      setTarget(null)
      rest(mood)
    }
  }
  const unsubscribe = useViewer.subscribe((state) => {
    if (arrived(state)) done()
  })
  const cancel = () => {
    unsubscribe()
    stop()
  }
  cancelRunning = cancel
  const stop = transitionTimeOfDay(goal, { durationMs: GLIDE_MS, easing: GLIDE_EASING })
  // A glide shorter than a minute lands at once.
  if (arrived(useViewer.getState())) done()
}

function siteOf(state: ReturnType<typeof useScene.getState>) {
  return state.rootNodeIds.map((id) => state.nodes[id]).find((node) => node?.type === 'site')
}

/**
 * Keeps a parked sun height at its height when the site's location arrives or changes: the opening
 * view is set before a bake shares its site and before a live graph mounts, and a sun height is an
 * explicit minute in the store, which would otherwise keep the default location's sun.
 */
export function followSiteLocation(): () => void {
  const check = () => {
    minutesCache.clear()
    if (!parked || target !== null) return
    const viewer = useViewer.getState()
    // The time was set elsewhere since: leave it.
    if (viewer.timeOfDayMinutes === null || Math.abs(viewer.timeOfDayMinutes - parked.minutes) > 1e-6) {
      parked = null
      return
    }
    const minutes = moodMinutes(MOOD_TARGETS[parked.mood] as SunHeight)
    if (Math.abs(minutes - parked.minutes) < 1e-6) return
    viewer.setTimeOfDayMinutes(minutes)
    parked = { mood: parked.mood, minutes }
  }
  check()
  const stopViewer = useViewer.subscribe((state, previous) => {
    if (state.daylightSite !== previous.daylightSite || state.deviceLocation !== previous.deviceLocation) check()
  })
  let site = siteOf(useScene.getState())
  const stopScene = useScene.subscribe((state) => {
    const next = siteOf(state)
    if (next === site) return
    site = next
    check()
  })
  return () => {
    stopViewer()
    stopScene()
  }
}
