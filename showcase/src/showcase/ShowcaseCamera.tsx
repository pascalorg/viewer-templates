import { CameraControlsImpl } from '@react-three/drei'
import { useThree } from '@react-three/fiber'
import { ViewerCameraControls, type ViewerCameraControlsProps } from '@pascal-app/viewer/ui'
import { useEffect, useMemo } from 'react'

/**
 * The showcase's orbit, /next's bindings on the viewer's camera controls: left drag orbits, right
 * drag pans, the wheel and a pinch dolly, one finger orbits, two fingers dolly and pan, and a
 * modifier (Shift, Ctrl or ⌘) with a left drag pans. A press that travels less than 7 px within
 * 350 ms is a tap: only a tap selects or dismisses, so a drag never does. The walkthrough keeps
 * its own controls (the viewer unmounts these while walking).
 */
export const MOUSE_BUTTONS: ViewerCameraControlsProps['mouseButtons'] = { left: 'rotate', middle: 'dolly', right: 'pan' }
export const TOUCHES: ViewerCameraControlsProps['touches'] = { one: 'rotate', two: 'dolly-pan', three: 'none' }
export const TAP = { maxTravelPx: 7, maxDurationMs: 350 }

/**
 * /next's limits: close enough to look into a room, never under the ground (its .47π polar cap),
 * and far enough out for the largest projects at any aspect.
 */
export function cameraLimits(aspect: number, modelRadius: number) {
  return {
    minDistance: 1,
    maxDistance: Math.max(300 * Math.max(1, 1.06 / Math.max(aspect, 0.01)), modelRadius * 4),
    minPolarAngle: 0,
    maxPolarAngle: 0.47 * Math.PI,
  }
}

export function ShowcaseCamera({ glbActive, holdOpening, modelRadius }: {
  glbActive: boolean
  holdOpening: boolean
  /** The model's bounding radius, once known (0 before). */
  modelRadius: number
}) {
  const aspect = useThree((state) => state.size.width / Math.max(1, state.size.height))
  const limits = useMemo(() => cameraLimits(aspect, modelRadius), [aspect, modelRadius])
  useModifierPan()
  return (
    <ViewerCameraControls glbActive={glbActive} holdOpening={holdOpening} limits={limits} mouseButtons={MOUSE_BUTTONS}
      tap={TAP} touches={TOUCHES} />
  )
}

/**
 * Shift, Ctrl or ⌘ with a left drag pans, as on /next. The controls read their bindings when a
 * press starts, so a capturing listener swaps the left button for that one press.
 */
function useModifierPan() {
  const controls = useThree((state) => state.controls) as CameraControlsImpl | null
  const canvas = useThree((state) => state.gl.domElement)
  useEffect(() => {
    if (!controls) return
    let restore: number | null = null
    const down = (event: PointerEvent) => {
      if (event.button !== 0 || event.pointerType !== 'mouse' || !canvas.contains(event.target as Node)) return
      if (!(event.shiftKey || event.ctrlKey || event.metaKey)) return
      restore = controls.mouseButtons.left
      controls.mouseButtons.left = CameraControlsImpl.ACTION.SCREEN_PAN
    }
    const up = () => {
      if (restore === null) return
      controls.mouseButtons.left = restore as typeof controls.mouseButtons.left
      restore = null
    }
    addEventListener('pointerdown', down, true)
    addEventListener('pointerup', up, true)
    addEventListener('pointercancel', up, true)
    return () => {
      up()
      removeEventListener('pointerdown', down, true)
      removeEventListener('pointerup', up, true)
      removeEventListener('pointercancel', up, true)
    }
  }, [controls, canvas])
}
