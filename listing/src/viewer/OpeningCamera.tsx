import { useThree } from '@react-three/fiber'
import { useEffect } from 'react'
import type { Vector3 } from 'three'
import type { OpeningCamera as Pose } from '../settings'
import { registerViewReader } from './openingView'

type Controls = { target: Vector3; update: () => void } | null

/** Lets the settings bar read the pose: the camera's position and the orbit controls' target. */
export function ViewReader() {
  const camera = useThree((state) => state.camera)
  const controls = useThree((state) => state.controls) as unknown as Controls
  useEffect(() => {
    if (!controls) return
    registerViewReader(() => ({ position: camera.position.toArray(), target: controls.target.toArray() }))
    return () => registerViewReader(null)
  }, [camera, controls])
  return null
}

/** Puts the camera on a saved opening view, once, when the controls are there. */
export function placeOpeningCamera(camera: { position: Vector3; updateProjectionMatrix: () => void }, controls: Controls, pose: Pose) {
  camera.position.set(...pose.position)
  camera.updateProjectionMatrix()
  controls?.target.set(...pose.target)
  controls?.update()
}

/** For a canvas that does no framing of its own (the live viewer). */
export function OpeningCamera({ pose }: { pose: Pose }) {
  const camera = useThree((state) => state.camera)
  const controls = useThree((state) => state.controls) as unknown as Controls
  const invalidate = useThree((state) => state.invalidate)
  useEffect(() => {
    if (!controls) return
    placeOpeningCamera(camera, controls, pose)
    invalidate()
    // Once per camera: the visitor moves it from there.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [camera, controls])
  return null
}
