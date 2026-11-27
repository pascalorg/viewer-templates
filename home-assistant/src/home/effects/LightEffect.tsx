import { useFrame, useThree } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import { lightColor, lightLevel, type Anchor, type HassEntity } from '../entities'
import { approach } from './common'

/** Family "light": a real light in the room, following brightness and colour. Nothing is drawn for
    it (no halo on the fitting, no beam, no pool on the floor): the wireframe shows the light it gives. */
export function LightEffect({ entity, anchor, floorY }: { entity: HassEntity; anchor: Anchor; floorY: number }) {
  const [x, y, z] = anchor.position
  const drop = Math.max(0.4, y - floorY)
  const ceiling = anchor.mount === 'ceiling'
  const k = useRef(0)
  const color = useRef(new THREE.Color(lightColor(entity)))
  const want = useMemo(() => new THREE.Color(), [])
  const light = useRef<THREE.PointLight>(null)
  const gl = useThree((s) => s.gl)

  useFrame((_, dt) => {
    k.current = approach(k.current, lightLevel(entity), dt, 5)
    color.current.lerp(want.set(lightColor(entity)), 1 - Math.exp(-dt * 5))
    if (light.current) {
      light.current.color.copy(color.current)
      // Pascal's daylight meters exposure for the time of day (several times brighter at dusk and
      // night); a real light has to stay the same lamp under it, so it divides the boost back out
      light.current.intensity = (k.current * (ceiling ? 9 : 6)) / Math.max(1, gl.toneMappingExposure)
    }
  })

  return (
    <group position={[x, y, z]} rotation-y={anchor.rotationY}>
      <pointLight ref={light} position={[0, -0.12, 0]} intensity={0} distance={ceiling ? drop * 3.2 : 5} decay={1.6} />
    </group>
  )
}
