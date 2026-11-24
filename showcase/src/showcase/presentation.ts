import { useSyncExternalStore } from 'react'

/**
 * When the scene may be shown. The loader stays over the canvas until the chrome has staged what
 * the visitor should see first (the intro's start: the plane below the model and the intro camera
 * in place; or the settled default view) AND the renderer has drawn that state: two rendered
 * frames after staging, so no frame of another view, a whole house before the reveal, or the
 * canvas's clear colour is ever on screen.
 */
type Placement = (position: [number, number, number], target: [number, number, number]) => void
type Pose = { position: [number, number, number]; target: [number, number, number] }

const state = { stagedAt: null as number | null, frames: 0, presented: false }
let place: Placement | null = null
let readPose: (() => Pose) | null = null
const listeners = new Set<() => void>()
const notify = () => { for (const listener of listeners) listener() }

/** Frames the renderer has to draw the staged state before the loader lifts. */
const PRESENT_AFTER_FRAMES = 2

/** The canvas registers instant camera placement (no controls transition) and counts frames. */
export function registerPlacement(placement: Placement | null) {
  place = placement
}

/** The canvas registers how to read the orbit camera's pose (for the opening view setting). */
export function registerPoseReader(reader: (() => Pose) | null) {
  readPose = reader
}

/** The orbit camera's position and target; null while the controls are unmounted (walking). */
export function cameraPose(): Pose | null {
  return readPose?.() ?? null
}

/** Puts the camera at a pose at once; false when the controls are not mounted yet. */
export function placeCamera(position: [number, number, number], target: [number, number, number]) {
  if (!place) return false
  place(position, target)
  return true
}

/** Called once per rendered frame, after the render (from the canvas). */
export function frameRendered() {
  state.frames++
  if (!state.presented && state.stagedAt !== null && state.frames >= state.stagedAt + PRESENT_AFTER_FRAMES) {
    state.presented = true
    notify()
  }
}

/** The first view is in place in the store and on the camera. */
export function markStaged() {
  if (state.stagedAt === null) state.stagedAt = state.frames
}

export function isPresented() {
  return state.presented
}

/** A new scene: hold the loader again until its first view is staged and drawn. */
export function resetPresentation() {
  state.stagedAt = null
  state.presented = false
  notify()
}

export function usePresented() {
  return useSyncExternalStore((listener) => {
    listeners.add(listener)
    return () => listeners.delete(listener)
  }, () => state.presented, () => false)
}
