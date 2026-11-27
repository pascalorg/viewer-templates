import { useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import type { Area } from '../entities'
import { N, shader, worldPosition } from '../tsl'
import { approach } from './common'

const { clamp, length, mix, oneMinus, sin, smoothstep, uniform, uv, varying } = N

/** What the field shows: the room's reading as a colour, and, when something in the room is
    changing it, the colour it is pushing towards and where that air comes from. */
export type FieldInput = { color: string; visible: boolean; source?: { at: [number, number]; color: string; strength: number } }

/** Family "field": a sensor's reading painted across its room's floor, on the reading's own colour
    scale. A climate unit or fan working on the room spreads its colour out from where it stands,
    with slow currents running through it. */
export function FieldEffect({ area, floorY, input }: { area: Area; floorY: number; input: FieldInput }) {
  const [x0, z0, x1, z1] = area.bounds
  const k = useRef(0)
  const src = useRef(0)
  const room = useRef(new THREE.Color(input.color))
  const push = useRef(new THREE.Color(input.source?.color ?? input.color))
  const want = useMemo(() => new THREE.Color(), [])
  const mat = useMemo(
    () =>
      shader(
        {
          uRoom: uniform(new THREE.Color('#fff')),
          uPush: uniform(new THREE.Color('#fff')),
          uSrc: uniform(new THREE.Vector2()),
          uReach: uniform(4),
          uS: uniform(0),
          uA: uniform(0),
          uT: uniform(0),
        },
        (u) => {
          const p = uv()
          const w = varying(worldPosition)
          const edge = (v: unknown) => smoothstep(0, 0.06, v).mul(smoothstep(0, 0.06, oneMinus(v)))
          const d = length(w.xz.sub(u.uSrc))
          const reach = oneMinus(smoothstep(0, u.uReach, d))
          const wave = sin(d.mul(5).sub(u.uT.mul(1.5)).add(sin(w.x.mul(1.7).add(w.z.mul(2.3)).add(u.uT.mul(0.6))).mul(1.6))).mul(0.5).add(0.5)
          const c = mix(u.uRoom, u.uPush, clamp(reach.mul(u.uS).mul(wave.mul(0.28).add(0.72)), 0, 1))
          return { color: c, opacity: u.uA.mul(edge(p.x)).mul(edge(p.y)).mul(wave.mul(0.1).add(0.34)) }
        },
        { transparent: true, depthWrite: false },
      ),
    [],
  )

  useFrame((st, dt) => {
    k.current = approach(k.current, input.visible ? 1 : 0, dt, 3)
    src.current = approach(src.current, input.source ? input.source.strength : 0, dt, 1.6)
    room.current.lerp(want.set(input.color), 1 - Math.exp(-dt * 3))
    if (input.source) push.current.lerp(want.set(input.source.color), 1 - Math.exp(-dt * 3))
    const u = mat.uniforms
    u.uRoom.value.copy(room.current)
    u.uPush.value.copy(push.current)
    if (input.source) u.uSrc.value.set(...input.source.at)
    u.uReach.value = Math.hypot(x1 - x0, z1 - z0) * 0.75
    u.uS.value = src.current
    u.uA.value = k.current
    u.uT.value = st.clock.elapsedTime
  })

  return (
    <mesh position={[(x0 + x1) / 2, floorY + 0.03, (z0 + z1) / 2]} rotation-x={-Math.PI / 2} material={mat} renderOrder={4} visible>
      <planeGeometry args={[x1 - x0, z1 - z0]} />
    </mesh>
  )
}
