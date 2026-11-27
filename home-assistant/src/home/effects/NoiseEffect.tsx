import { useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import { FIELDS, noiseOf, QUIET_DB, type Area, type HassEntities, type HomeDevice } from '../entities'
import { N, type Node, shader, worldPosition } from '../tsl'
import { approach, livePosition } from './common'

const { clamp, exp, float, length, log, max, mix, oneMinus, pow, sin, smoothstep, uniform, uv, varying, vec2, vec3 } = N

/* The noise map: unlike a room's temperature, noise comes from things, so it is worked out from
   every device making a sound. Each source is placed where the device is (a moving robot carries
   its noise with it) and falls off with distance the way sound does in the open (−6 dB per doubling);
   walls take a share out of what reaches the next room. Levels add as sound energy. */

/** How many sources one room's map takes into account (the loudest first). */
const MAX = 12
/** What a wall takes out of a sound passing into the next room, and the outside walls out of the garden's. */
const WALL_DB = 18
const OUTSIDE_DB = 24

const LN10 = Math.LN10

/** The noisy devices, at their level as heard from this room. */
export function noiseSources(area: Area, devices: HomeDevice[], entities: HassEntities, indoorIds: Set<string>) {
  const out: { x: number; z: number; db: number }[] = []
  for (const d of devices) {
    const e = entities[d.entityId]
    const db = e && noiseOf(e)
    if (db == null) continue
    const live = livePosition.get(d.entityId)
    const x = live?.x ?? d.anchor.position[0]
    const z = live?.z ?? d.anchor.position[2]
    const [x0, z0, x1, z1] = area.bounds
    const inside = x >= x0 && x <= x1 && z >= z0 && z <= z1
    const loss = inside ? 0 : indoorIds.has(d.anchor.area) ? WALL_DB : OUTSIDE_DB
    out.push({ x, z, db: db - loss })
  }
  return out.sort((a, b) => b.db - a.db).slice(0, MAX)
}

export function NoiseEffect({ area, floorY, devices, entities, indoorIds, visible }: {
  area: Area
  floorY: number
  devices: HomeDevice[]
  entities: HassEntities
  indoorIds: Set<string>
  visible: boolean
}) {
  const [x0, z0, x1, z1] = area.bounds
  const k = useRef(0)
  const latest = useRef(entities)
  latest.current = entities
  const mat = useMemo(() => {
    const src = Array.from({ length: MAX }, () => uniform(new THREE.Vector3(0, 0, -200)))
    const stops = FIELDS.sound_pressure.stops.map(([db, rgb]) => ({ db, c: uniform(new THREE.Color(`rgb(${rgb.join(',')})`)) }))
    return shader({ uA: uniform(0), uT: uniform(0), src, stops } as Record<string, Node>, (u) => {
      const w = varying(worldPosition)
      const p = vec2(w.x, w.z)
      const t = u.uT
      // sound energy from every source, falling with the square of the distance
      let energy: Node = exp(float((QUIET_DB / 10) * LN10))
      const parts: { e: Node; d: Node }[] = []
      for (const s of u.src as Node[]) {
        const d = length(p.sub(vec2(s.x, s.y)))
        const e = exp(s.z.mul(LN10 / 10)).div(max(d.mul(d), 0.35))
        parts.push({ e, d })
        energy = energy.add(e)
      }
      const db = log(energy).mul(10 / LN10)
      // the level's colour on the noise scale
      const st = u.stops as { db: number; c: Node }[]
      let col: Node = st[0]!.c
      for (let i = 1; i < st.length; i++) col = mix(col, st[i]!.c, clamp(db.sub(st[i - 1]!.db).div(st[i]!.db - st[i - 1]!.db), 0, 1))
      // ripples running off each source, strongest where that source is what you hear
      let ripple: Node = float(0)
      for (const { e, d } of parts) ripple = ripple.add(pow(sin(d.mul(7).sub(t.mul(5))).mul(0.5).add(0.5), 6).mul(e.div(energy)).mul(oneMinus(smoothstep(0.5, 4, d))))
      const q = uv()
      const edge = smoothstep(0, 0.05, q.x).mul(smoothstep(0, 0.05, oneMinus(q.x))).mul(smoothstep(0, 0.05, q.y)).mul(smoothstep(0, 0.05, oneMinus(q.y)))
      const loud = clamp(db.sub(30).div(45), 0, 1)
      return { color: vec3(col), opacity: float(0.22).add(loud.mul(0.3)).add(ripple.mul(0.35)).mul(edge).mul(u.uA) }
    }, { transparent: true, depthWrite: false })
  }, [])

  useFrame((st, dt) => {
    k.current = approach(k.current, visible ? 1 : 0, dt, 3)
    const u = mat.uniforms as unknown as { uA: { value: number }; uT: { value: number }; src: { value: THREE.Vector3 }[] }
    u.uA.value = k.current
    u.uT.value = st.clock.elapsedTime
    if (k.current < 0.01) return
    const sources = noiseSources(area, devices, latest.current, indoorIds)
    u.src.forEach((s, i) => {
      const v = sources[i]
      if (v) s.value.set(v.x, v.z, v.db)
      else s.value.set(0, 0, -200)
    })
  })

  return (
    <mesh position={[(x0 + x1) / 2, floorY + 0.032, (z0 + z1) / 2]} rotation-x={-Math.PI / 2} material={mat} renderOrder={4}>
      <planeGeometry args={[x1 - x0, z1 - z0]} />
    </mesh>
  )
}
