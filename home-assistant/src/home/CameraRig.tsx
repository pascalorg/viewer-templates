import { emitter } from '@pascal-app/core'
import { framedLookAt } from '@pascal-app/viewer/ui'
import { OrbitControls } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import type { HomeDevice } from './entities'

/** Where the camera rests: looking from `position` at `target`. */
export type CameraView = { position: THREE.Vector3; target: THREE.Vector3 }

/** Orbit controls that fly to the chosen device (looking at it from in front) and back out again,
    close in on a group of pins until they separate, or frame what Pascal's viewer asks to frame (a
    room, a floor, the building, from the explore panel) with Pascal's own framing. Shared by the lab
    and the project viewer. */
export function CameraRig({ device, group, home }: { device: HomeDevice | null; group: THREE.Vector3[] | null; home: CameraView }) {
  const controls = useRef<OrbitControlsImpl>(null)
  const camera = useThree((s) => s.camera)
  const invalidate = useThree((s) => s.invalidate)
  const flying = useRef(0)
  const wantPos = useMemo(() => new THREE.Vector3(), [])
  const wantTgt = useMemo(() => new THREE.Vector3(), [])

  useEffect(() => {
    if (device) {
      const [x, y, z] = device.anchor.position
      const a = device.anchor.rotationY
      // stand in front of it, a little to the side and above, further back for ceiling fittings
      const dist = device.anchor.mount === 'ceiling' ? 4.2 : device.anchor.mount === 'wall' ? 3 : 3.4
      const side = a + 0.45
      wantTgt.set(x, device.anchor.mount === 'ceiling' ? y - 0.9 : y - 0.2, z)
      wantPos.set(x + Math.cos(side) * dist, Math.max(y, 1.2) + 1.1, z - Math.sin(side) * dist)
    } else {
      wantPos.copy(home.position)
      wantTgt.copy(home.target)
    }
    flying.current = 1.4
    invalidate()
  }, [device, home, wantPos, wantTgt, invalidate])

  useEffect(() => {
    const c = controls.current
    if (!group?.length || !c) return
    // keep looking from the same side, just closer: near enough that pins a few
    // centimetres apart sit a pin's width apart on screen
    const centre = group.reduce((s, p) => s.add(p), new THREE.Vector3()).divideScalar(group.length)
    const spread = Math.max(...group.map((p) => p.distanceTo(centre)))
    const dir = camera.position.clone().sub(c.target).normalize()
    wantTgt.copy(centre)
    wantPos.copy(centre).addScaledVector(dir, THREE.MathUtils.clamp(spread * 5 + 1.2, 1.4, 9))
    flying.current = 1.4
    invalidate()
  }, [group, camera, wantPos, wantTgt, invalidate])

  // Pascal's framing requests (`frameViewerNode`): this rig owns the camera, so it flies there itself
  useEffect(() => {
    const onFrame = (event: Parameters<typeof framedLookAt>[0]) => {
      const c = controls.current
      if (!c) return
      const fov = (camera as THREE.PerspectiveCamera).isPerspectiveCamera ? (camera as THREE.PerspectiveCamera).fov : undefined
      const pose = framedLookAt(event, { position: camera.position.toArray(), target: c.target.toArray() }, fov)
      if (!pose) return
      wantPos.set(...pose.position)
      wantTgt.set(...pose.target)
      flying.current = 1.4
      invalidate()
    }
    emitter.on('camera-controls:frame', onFrame)
    return () => emitter.off('camera-controls:frame', onFrame)
  }, [camera, wantPos, wantTgt, invalidate])

  useEffect(() => {
    camera.position.copy(home.position)
    controls.current?.target.copy(home.target)
    invalidate()
  }, [camera, home, invalidate])

  useFrame((_, delta) => {
    const c = controls.current
    if (!c || flying.current <= 0) return
    // the viewer draws on demand: without the daylight sky nothing else asks for frames, so the
    // flight asks for each one itself, and a long gap between frames is never one big jump
    const dt = Math.min(delta, 1 / 30)
    flying.current -= dt
    const k = 1 - Math.exp(-dt * 3.5)
    camera.position.lerp(wantPos, k)
    c.target.lerp(wantTgt, k)
    c.update()
    invalidate()
  })

  return <OrbitControls ref={controls} makeDefault maxPolarAngle={Math.PI / 2.05} minDistance={1} maxDistance={80} onStart={() => (flying.current = 0)} />
}
