import {
  type AnyNodeId,
  closeDoorOpenState,
  closeWindowOpenState,
  openDoorOpenState,
  openWindowOpenState,
  setWindowShuttersOpenState,
  useScene,
} from '@pascal-app/core'
import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { ALERT, alarmColor, isOn, openness, tripped, type Area, type HassEntities, type HassEntity, type HomeDevice } from '../entities'
import { approach, useFlow } from './common'
import { beamMaterial, frameMaterial, ringsMaterial } from './materials'

/* The safety and security families: covers, locks, door and window contacts, smoke, leaks, motion,
   sirens and the alarm panel. Each takes the entity, its device placement and the floor height. */

export type FamilyProps = { entity: HassEntity; device: HomeDevice; entities: HassEntities; floorY: number }

const set = (m: { uniforms: Record<string, { value: unknown }> }, k: string, v: unknown) => {
  const u = m.uniforms[k] as { value: { set?: (v: unknown) => void } | unknown }
  if (u.value && typeof (u.value as THREE.Color).set === 'function' && typeof v === 'string') (u.value as THREE.Color).set(v)
  else u.value = v
}

/**
 * Opens or closes a Pascal door or window with the device, through Pascal's own open and close (as
 * a click on its viewer does), so each type moves its own way: a hinged door swings, a sliding or
 * pocket door slides, a garage door rolls up, a window opens its sash.
 * @param cover the device is a blind or shutter: on a window it moves the shutters, not the sash
 *   (and a window with none is left as it is: a blind open is not the window open)
 */
export function usePascalDoor(nodeId: string | undefined, open: boolean, cover = false) {
  useEffect(() => {
    if (!nodeId) return
    const id = nodeId as AnyNodeId
    // not persisted: that writes the scene, which the viewer holds read-only, and the model would
    // snap back as the write is refused. The open state stays in the viewer's own store
    const options = { persist: false }
    if (useScene.getState().nodes[id]?.type === 'window') {
      if (cover) setWindowShuttersOpenState(id, open, options)
      else if (open) openWindowOpenState(id, options)
      else closeWindowOpenState(id, options)
      return
    }
    if (open) openDoorOpenState(id, options)
    else closeDoorOpenState(id, options)
  }, [nodeId, open, cover])
}

/* ---------------- covers: blinds, curtains, shutters, garage doors ---------------- */

/** Family "model", for a device linked to a Pascal door or window: the model opens and closes with
    the device, through its own animation (a garage door rolls up, a door swings, shutters fold), and
    nothing else is drawn. A model with no such animation is left as it is. */
export function ModelOpening({ entity, device }: FamilyProps) {
  const domain = entity.entity_id.split('.')[0]
  const open = domain === 'cover' ? openness(entity) > 0
    : domain === 'lock' ? entity.state === 'open' || entity.state === 'opening'
    : domain === 'binary_sensor' ? tripped(entity)
    : isOn(entity)
  usePascalDoor(device.nodeId, open, domain === 'cover')
  return null
}

/** Family "opening": a blind, curtain or shutter moves in its own model (Pascal's animation); no
    light or glow is drawn on the opening. */
export function OpeningEffect(_props: FamilyProps) {
  return null
}

/* ---------------- locks ---------------- */

const LOCK_COLOR: Record<string, string> = { locked: ALERT.ok, unlocked: ALERT.warn, open: ALERT.warn, jammed: ALERT.danger, locking: ALERT.info, unlocking: ALERT.info, opening: ALERT.info }

/** Family "lock": a ring on the door at the lock, green locked, amber unlocked, red jammed, chasing
    while it turns; opening the lock swings its Pascal door. */
export function LockEffect({ entity, device }: FamilyProps) {
  const ring = useMemo(() => ringsMaterial(), [])
  const k = useRef(0)
  usePascalDoor(device.nodeId, entity.state === 'open' || entity.state === 'opening')
  useFrame((st, dt) => {
    const busy = entity.state.endsWith('ing')
    k.current = approach(k.current, busy ? 1 : 0, dt, 5)
    set(ring, 'uColor', LOCK_COLOR[entity.state] ?? ALERT.idle)
    ring.uniforms.uT.value = st.clock.elapsedTime
    ring.uniforms.uA.value = 0.9
    ring.uniforms.uFreq.value = 3
    ring.uniforms.uSpeed.value = 6
    ring.uniforms.uSharp.value = 2 + k.current * 10
    ring.uniforms.uRing.value = k.current
    ring.uniforms.uFill.value = 0.55 - k.current * 0.4
    ring.uniforms.uInner.value = 0.55
  })
  return (
    <group position={device.anchor.position} rotation-y={device.anchor.rotationY}>
      {[1, -1].map((s) => (
        <mesh key={s} position={[s * 0.06, 0, 0]} rotation-y={(s * Math.PI) / 2} material={ring}>
          <planeGeometry args={[0.36, 0.36]} />
        </mesh>
      ))}
    </group>
  )
}

/* ---------------- door and window contacts ---------------- */

/** Family "contact": a door sensor linked to a Pascal door swings it; nothing is drawn on the
    opening. */
export function ContactEffect({ entity, device }: FamilyProps) {
  usePascalDoor(device.nodeId, tripped(entity))
  return null
}

/* ---------------- smoke, gas and CO ---------------- */

/** Family "smoke": with smoke, red rings pulse out across the ceiling and a grey plume spreads down
    from the detector. */
export function SmokeEffect({ entity, device, floorY }: FamilyProps) {
  const rings = useMemo(() => ringsMaterial(), [])
  const plume = useFlow(160, 0.9)
  const k = useRef(0)
  const drop = device.anchor.position[1] - floorY
  useFrame((st, dt) => {
    const t = st.clock.elapsedTime
    k.current = approach(k.current, tripped(entity) ? 1 : 0, dt, 2)
    set(rings, 'uColor', ALERT.danger)
    rings.uniforms.uT.value = t
    rings.uniforms.uA.value = k.current
    rings.uniforms.uSpeed.value = 5
    rings.uniforms.uFreq.value = 4
    rings.uniforms.uSharp.value = 6
    plume.mat.uniforms.uColor.value.set('#8c8f94')
    plume.update(
      (out, life, seed) => {
        const a = seed * 53.1
        const r = life * (0.6 + seed * 2.2)
        out.set(Math.cos(a) * r, -0.15 - life * drop * 0.55 * ((seed * 3.7) % 1), Math.sin(a) * r)
      },
      t,
      0.12,
      k.current * 0.28,
    )
  })
  return (
    <group position={device.anchor.position}>
      <mesh position={[0, -0.06, 0]} rotation-x={Math.PI / 2} material={rings} renderOrder={6}>
        <planeGeometry args={[4.5, 4.5]} />
      </mesh>
      <primitive object={plume.points} />
    </group>
  )
}

/* ---------------- water leaks ---------------- */

/** Family "leak": water spreads across the floor from the sensor, with ripples, and shrinks back
    once it reads dry. */
export function LeakEffect({ entity, device, floorY }: FamilyProps) {
  const pool = useMemo(() => ringsMaterial(), [])
  const r = useRef(0)
  const mesh = useRef<THREE.Mesh>(null)
  useFrame((st, dt) => {
    r.current = approach(r.current, tripped(entity) ? 1 : 0, dt, tripped(entity) ? 0.35 : 0.8)
    set(pool, 'uColor', ALERT.water)
    pool.uniforms.uT.value = st.clock.elapsedTime
    pool.uniforms.uA.value = Math.min(1, r.current * 3)
    pool.uniforms.uFill.value = 0.55
    pool.uniforms.uFreq.value = 18
    pool.uniforms.uSpeed.value = 3
    pool.uniforms.uSharp.value = 3
    pool.uniforms.uRing.value = 0.5
    if (mesh.current) mesh.current.scale.setScalar(0.05 + r.current * 2.6)
  })
  const [x, , z] = device.anchor.position
  return (
    <mesh ref={mesh} position={[x, floorY + 0.035, z]} rotation-x={-Math.PI / 2} material={pool} renderOrder={5}>
      <planeGeometry args={[1, 1]} />
    </mesh>
  )
}

/* ---------------- motion and presence ---------------- */

/** Family "motion": the sensor's field of view on the floor, faint while it watches and flashing
    with rings when something moves in it. */
export function MotionEffect({ entity, device, floorY }: FamilyProps) {
  const cone = useMemo(() => ringsMaterial(), [])
  const k = useRef(0)
  const reach = Number(entity.attributes._reach ?? 6)
  useFrame((st, dt) => {
    k.current = approach(k.current, tripped(entity) ? 1 : 0, dt, 6)
    set(cone, 'uColor', tripped(entity) ? ALERT.warn : ALERT.info)
    cone.uniforms.uT.value = st.clock.elapsedTime
    cone.uniforms.uA.value = 0.35 + k.current * 0.65
    cone.uniforms.uHalf.value = 0.7
    cone.uniforms.uDir.value = 0
    cone.uniforms.uFill.value = 0.25 + k.current * 0.2
    cone.uniforms.uRing.value = 0.2 + k.current * 0.8
    cone.uniforms.uSpeed.value = 6
    cone.uniforms.uFreq.value = 9
  })
  const [x, y, z] = device.anchor.position
  return (
    <group position={[x, floorY + 0.04, z]} rotation-y={device.anchor.rotationY}>
      <mesh rotation-x={-Math.PI / 2} material={cone} renderOrder={5}>
        <planeGeometry args={[reach * 2, reach * 2]} />
      </mesh>
      <mesh position={[0, (y - floorY) / 2, 0]}>
        <cylinderGeometry args={[0.004, 0.004, y - floorY, 4]} />
        <meshBasicMaterial color={ALERT.info} transparent opacity={0.15} depthWrite={false} />
      </mesh>
    </group>
  )
}

/* ---------------- sirens ---------------- */

/** Family "siren": two red beams sweep the room, its light flashes and rings pulse off it. */
export function SirenEffect({ entity, device }: FamilyProps) {
  const beams = useRef<THREE.Group>(null)
  const beam = useMemo(() => beamMaterial(), [])
  const rings = useMemo(() => ringsMaterial(), [])
  const light = useRef<THREE.PointLight>(null)
  const gl = useThree((s) => s.gl)
  const k = useRef(0)
  useFrame((st, dt) => {
    const t = st.clock.elapsedTime
    k.current = approach(k.current, isOn(entity) ? 1 : 0, dt, 6)
    const col = entity.attributes.tone === 'fire' ? '#ff5a2a' : ALERT.danger
    if (beams.current) beams.current.rotation.y = t * 4
    set(beam, 'uColor', col)
    beam.uniforms.uA.value = k.current * 0.55
    set(rings, 'uColor', col)
    rings.uniforms.uT.value = t
    rings.uniforms.uA.value = k.current
    rings.uniforms.uSpeed.value = 9
    rings.uniforms.uFreq.value = 5
    if (light.current) {
      light.current.color.set(col)
      light.current.intensity = (k.current * (Math.sin(t * 12) > 0 ? 6 : 0.5)) / Math.max(1, gl.toneMappingExposure)
    }
  })
  return (
    <group position={device.anchor.position} rotation-y={device.anchor.rotationY}>
      <pointLight ref={light} intensity={0} distance={9} decay={1.6} />
      <group ref={beams}>
        {[0, Math.PI].map((a) => (
          <group key={a} rotation-y={a}>
            {/* apex at the siren, opening outwards along +x */}
            <mesh position={[2.5, 0, 0]} rotation-z={Math.PI / 2} material={beam}>
              <coneGeometry args={[1.2, 5, 24, 1, true]} />
            </mesh>
          </group>
        ))}
      </group>
      <mesh rotation-y={Math.PI / 2} material={rings}>
        <planeGeometry args={[3, 3]} />
      </mesh>
    </group>
  )
}

/* ---------------- the alarm panel ---------------- */

/** Family "alarm": the whole home's outline glows with the panel's state (green disarmed, amber at
    home or arming, red away or triggered), flashing on entry delay and when triggered. */
export function AlarmEffect({ entity, areas, floorY }: FamilyProps & { areas: Area[] }) {
  const frame = useMemo(() => frameMaterial(), [])
  const k = useRef(0)
  const x0 = Math.min(...areas.map((a) => a.bounds[0])) - 0.3
  const z0 = Math.min(...areas.map((a) => a.bounds[1])) - 0.3
  const x1 = Math.max(...areas.map((a) => a.bounds[2])) + 0.3
  const z1 = Math.max(...areas.map((a) => a.bounds[3])) + 0.3
  useFrame((st, dt) => {
    const s = entity.state
    k.current = approach(k.current, s === 'disarmed' ? 0.35 : 1, dt, 3)
    set(frame, 'uColor', alarmColor(s))
    frame.uniforms.uA.value = k.current
    frame.uniforms.uT.value = st.clock.elapsedTime * (s === 'triggered' ? 2 : 1)
    frame.uniforms.uPulse.value = s === 'triggered' || s === 'pending' || s === 'arming' ? 1 : 0
    frame.uniforms.uWidth.value = 0.025
  })
  return (
    <mesh position={[(x0 + x1) / 2, floorY + 0.045, (z0 + z1) / 2]} rotation-x={-Math.PI / 2} material={frame} renderOrder={5}>
      <planeGeometry args={[x1 - x0, z1 - z0]} />
    </mesh>
  )
}
