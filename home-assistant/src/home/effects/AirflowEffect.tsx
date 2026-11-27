import { useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import { climateColor, climateStrength, type Anchor, type HassEntity } from '../entities'
import { N, type Node, shader } from '../tsl'
import { approach } from './common'

const { Fn, float, floor, fract, min, mix, oneMinus, sin, smoothstep, uniform, uv, vec2, vec3 } = N

/* Family "airflow": conditioned air as curved sheets that leave the outlet, fan out and fall away,
   drawn as soft streaks running the way the air travels. Built in the device's own axes (out along
   +x, falling along -y, spread across z), so it follows the unit wherever it hangs. */

type Sheet = { seed: number; reach: number; drop: number; fan: number; gain: number }
const SHEETS: Sheet[] = [
  { seed: 0.13, reach: 1.42, drop: 1.26, fan: 0.72, gain: 0.66 },
  { seed: 0.58, reach: 1.74, drop: 1.02, fan: 0.95, gain: 0.36 },
  { seed: 0.91, reach: 1.12, drop: 1.46, fan: 0.5, gain: 0.44 },
]

const windShader = (s: Sheet, width: number) =>
  shader(
    {
      uColor: uniform(new THREE.Color('#fff')),
      uT: uniform(0),
      uA: uniform(0),
      uGrow: uniform(0),
      uSway: uniform(0),
      uPush: uniform(1),
      uSeed: uniform(s.seed),
      uReach: uniform(s.reach),
      uDrop: uniform(s.drop),
      uFan: uniform(s.fan),
      uWidth: uniform(width),
    },
    (u) => {
      const q = uv()
      const across0 = q.x.sub(0.5)
      const v = q.y
      // out of the vent quickly, then bending over and down; stronger air carries further
      const reach = u.uReach.mul(u.uPush)
      const out = reach.mul(v).mul(float(1.32).sub(v.mul(0.32)))
      const down = u.uDrop.mul(u.uSway.add(1)).mul(v).mul(v).mul(v.mul(0.28).add(0.72)).add(v.mul(0.1))
      const across = across0.mul(u.uWidth).mul(v.mul(u.uFan).add(1))
      // the sheet breathes further from the vent, where the air has lost its direction
      const drift = sin(across0.mul(7).add(u.uT.mul(0.9)).add(u.uSeed.mul(4)).add(v.mul(2.6))).mul(0.07).mul(v).mul(v)
      const p = vec3(out.add(drift), down.negate().add(drift.mul(0.6)), across.add(sin(v.mul(3).add(u.uT.mul(0.7)).add(across0.mul(5)).add(u.uSeed)).mul(0.05).mul(v)))

      const hash = (n: Node) => fract(sin(n.mul(91.345).add(u.uSeed.mul(17))).mul(47453.5453))
      const ease = (f: Node) => f.mul(f).mul(float(3).sub(f.mul(2)))
      const noise = (x: Node) => mix(hash(floor(x)), hash(floor(x).add(1)), ease(fract(x)))
      const noise2 = (p2: Node) => {
        const i = floor(p2)
        const f = ease(fract(p2))
        const at = (x: number, y: number) => hash(i.x.add(x).add(i.y.add(y).mul(57)))
        return mix(mix(at(0, 0), at(1, 0), f.x), mix(at(0, 1), at(1, 1), f.x), f.y)
      }
      const vP = uv()
      return {
        position: p,
        color: u.uColor,
        opacity: Fn(() => {
          const fu = vP.x
          const fv = vP.y
          // streak lines bend slowly along their length, so none reads as ruler straight
          const x = fu.add(noise(fv.mul(2.2).add(u.uSeed.mul(3))).sub(0.5).mul(0.05)).toVar()
          const wide = smoothstep(0.46, 0.94, noise(x.mul(18).add(u.uSeed.mul(9))))
          const fine = smoothstep(0.58, 0.98, noise(x.mul(41).add(u.uSeed.mul(23))))
          const lines = wide.mul(0.78).add(fine.mul(0.52))
          // brighter pulses travel down each streak
          const pulse = noise2(vec2(x.mul(13), fv.mul(2.6).sub(u.uT.mul(1.5)))).mul(0.72).add(0.5)
          // soft at the vent, fullest a third of the way along, dissolving at the far end
          const along = smoothstep(0, 0.2, fv).mul(oneMinus(smoothstep(0.26, 0.96, fv)))
          const edge = smoothstep(0, 0.14, fu).mul(oneMinus(smoothstep(0.86, 1, fu)))
          // switching on, the air pours out from the vent
          const grown = oneMinus(smoothstep(u.uGrow.sub(0.22), u.uGrow, fv))
          return min(lines.mul(pulse).mul(along).mul(edge).mul(grown).mul(u.uA), 1)
        })(),
      }
    },
    { transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending },
  )

export function AirflowEffect({ entity, anchor }: { entity: HassEntity; anchor: Anchor }) {
  const width = (anchor.size?.[2] ?? 1) * 0.9
  const outlet = anchor.outlet ?? [0.12, -0.15, 0]
  const k = useRef(0)
  const grow = useRef(0)
  const tint = useRef(new THREE.Color(climateColor(entity)))
  const want = useMemo(() => new THREE.Color(), [])
  const geo = useMemo(() => new THREE.PlaneGeometry(1, 1, 30, 36), [])
  const sheets = useMemo(() => SHEETS.map((s) => windShader(s, width)), [width])

  useFrame((st, dt) => {
    const t = st.clock.elapsedTime
    const strength = climateStrength(entity)
    const on = strength > 0
    k.current = approach(k.current, strength, dt, on ? 2.2 : 3.4)
    // the air pours out when it starts, and simply fades when it stops
    grow.current = on ? Math.min(1.25, grow.current + dt * 0.75) : k.current < 0.02 ? 0 : grow.current
    tint.current.lerp(want.set(climateColor(entity)), 1 - Math.exp(-dt * 4))
    const swing = Math.sin(t * 0.8)
    sheets.forEach((m, i) => {
      const u = m.uniforms
      u.uColor.value.copy(tint.current)
      u.uT.value = t
      u.uA.value = k.current * SHEETS[i]!.gain
      u.uGrow.value = grow.current
      u.uSway.value = swing * 0.09
      u.uPush.value = 0.75 + k.current * 0.35
    })
  })

  return (
    <group position={anchor.position} rotation-y={anchor.rotationY}>
      <group position={outlet}>
        {sheets.map((m, i) => (
          <mesh key={i} geometry={geo} material={m} frustumCulled={false} renderOrder={7} />
        ))}
      </group>
    </group>
  )
}
