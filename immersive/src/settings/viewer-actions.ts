import { useViewer } from '@pascal-app/viewer'
import type { CameraControlsImpl } from '@react-three/drei'
import { useThree } from '@react-three/fiber'
import { useEffect } from 'react'
import { Vector3 } from 'three'
import {
  type CameraPose,
  OPENING_TIMES,
  OPENING_WALLS,
  type OpeningTime,
  type OpeningWalls,
  type SavedOpening,
  type Vec3,
} from './opening'

/** Shows a time of day the way the Light popover's presets do: a fixed preset, not the live sky. */
export function showTime(time: OpeningTime) {
  const viewer = useViewer.getState()
  viewer.setSkyLive(false)
  viewer.setTimeOfDayMinutes(null)
  viewer.setTimeOfDay(time)
}

export function showWalls(walls: OpeningWalls) {
  useViewer.getState().setWallMode(walls)
}

/**
 * Puts a saved opening's time and walls on screen; fields not saved keep what the visitor
 * had. Walls only where they are drawn live: a bake keeps its own walls (the Show popover hides
 * the choice there too). The camera goes through `ViewerOpeningCamera`, behind the loader.
 */
export function applyOpeningLook(opening: SavedOpening | undefined, { glbActive }: { glbActive: boolean }) {
  if (!opening) return
  if (opening.time) showTime(opening.time)
  if (opening.walls && !glbActive) showWalls(opening.walls)
}

const includes = <T extends string>(list: readonly T[], value: unknown): value is T =>
  typeof value === 'string' && (list as readonly string[]).includes(value)

/**
 * What the screen shows now, in the settings' terms; null where it is something the settings
 * can't hold (a dragged sun or the live sky, translucent walls).
 */
export function screenLook(view: {
  timeOfDay: string
  timeOfDayMinutes: number | null
  skyLive: boolean
  wallMode: string
}): { time: OpeningTime | null; walls: OpeningWalls | null } {
  const presetTime = !view.skyLive && view.timeOfDayMinutes === null
  return {
    time: presetTime && includes(OPENING_TIMES, view.timeOfDay) ? view.timeOfDay : null,
    walls: includes(OPENING_WALLS, view.wallMode) ? view.wallMode : null,
  }
}

let readPose: (() => CameraPose) | null = null

/** The orbit camera's position and target; null while the controls are unmounted (walking, VR). */
export function cameraPose(): CameraPose | null {
  return readPose?.() ?? null
}

/** Inside the canvas: lets Customize read the orbit camera for "Use current". */
export function CameraPoseBridge() {
  const controls = useThree((state) => state.controls) as CameraControlsImpl | null
  useEffect(() => {
    readPose = controls ? () => ({
      position: controls.getPosition(new Vector3()).toArray() as Vec3,
      target: controls.getTarget(new Vector3()).toArray() as Vec3,
    }) : null
    return () => {
      readPose = null
    }
  }, [controls])
  return null
}
