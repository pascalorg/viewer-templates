import { useFrame } from '@react-three/fiber'
import { useRef } from 'react'
import * as THREE from 'three'
import { isOn, type Anchor, type HassEntity } from '../entities'
import { approach, fanSwing, useFlow } from './common'

/** Family "rotor": the air a fan moves. A ceiling fan spirals air down to the floor (or draws it up
    when reversed); a standing, wall or desk fan pushes a cone of air the way it faces, sweeping
    with the head when it oscillates. Blade spin belongs to the fan's own model. */
export function RotorEffect({ entity, anchor, floorY }: { entity: HassEntity; anchor: Anchor; floorY: number }) {
  const [x, y, z] = anchor.position
  const ceiling = anchor.mount === 'ceiling'
  const drop = Math.max(0.6, y - floorY - 0.1)
  const radius = (anchor.size?.[2] ?? 1.2) / 2
  const flow = useFlow(ceiling ? 170 : 130, 0.3)
  const p = useRef(0)
  const head = useRef<THREE.Group>(null)
  const swing = useRef(0)

  useFrame((st, dt) => {
    const t = st.clock.elapsedTime
    const want = isOn(entity) ? Number(entity.attributes.percentage ?? 50) / 100 : 0
    p.current = approach(p.current, want, dt, want > p.current ? 1.4 : 0.9)
    const s = p.current
    flow.mat.uniforms.uColor.value.set('#bfe6ff')
    if (ceiling) {
      const up = entity.attributes.direction === 'reverse'
      const turn = t * (0.4 + s * 1.6)
      flow.update(
        (out, life, seed) => {
          const l = up ? 1 - life : life
          const r = (0.25 + seed * 0.8) * radius * 1.4 * (1 + l * 0.9)
          const a = seed * 40 + l * 5 + turn
          out.set(Math.cos(a) * r, -0.12 - l * drop, Math.sin(a) * r)
        },
        t,
        0.14 + s * 0.5,
        s * 0.55,
      )
    } else {
      const osc = !!entity.attributes.oscillating
      swing.current = approach(swing.current, osc ? fanSwing(t) : swing.current, dt, osc ? 30 : 0)
      if (head.current) head.current.rotation.y = swing.current
      const reach = 1.6 + s * 3.2
      flow.update(
        (out, life, seed) => {
          const a = seed * 61.3
          const r = (0.15 + (seed * 7.31) % 1) * radius * (0.8 + life * 1.8)
          out.set(0.1 + life * reach, Math.sin(a) * r - life * life * 0.25, Math.cos(a) * r)
        },
        t,
        0.25 + s * 0.6,
        s * 0.5,
      )
    }
  })

  return (
    <group position={[x, y, z]} rotation-y={anchor.rotationY}>
      <group ref={head}>
        <primitive object={flow.points} />
      </group>
    </group>
  )
}
