import { useViewer } from '@pascal-app/viewer'
import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { binaryColor, isOn, skyFor, tripped, type Area, type HassEntity, type HomeDevice } from '../entities'
import { approach, livePosition, useFlow } from './common'
import { flowLineMaterial, ringsMaterial } from './materials'
import type { FamilyProps } from './SafetyEffects'

/* The families for humidifiers, people, the remaining binary sensors, remotes and IR/RF senders,
   doorbells, and the weather. */

type Mat = { uniforms: Record<string, { value: unknown }> }
const setColor = (m: Mat, v: string) => (m.uniforms.uColor!.value as THREE.Color).set(v)

/* ---------------- humidifiers ---------------- */

/** Family "mist": a soft column of mist rises and spreads while it humidifies, thin while it idles. */
export function MistEffect({ entity, device }: FamilyProps) {
  const mist = useFlow(120, 0.75)
  const k = useRef(0)
  const top = (device.anchor.size?.[1] ?? 0.4) / 2
  useFrame((st, dt) => {
    const want = !isOn(entity) ? 0 : entity.attributes.action === 'humidifying' ? 1 : 0.25
    k.current = approach(k.current, want, dt, 2)
    mist.mat.uniforms.uColor.value.set('#d8f1ff')
    mist.update((out, life, seed) => {
      const a = seed * 47 + life * 1.5
      const r = life * life * (0.3 + seed * 0.5)
      out.set(Math.cos(a) * r, top + life * 1.3 - life * life * 0.4, Math.sin(a) * r)
    }, st.clock.elapsedTime, 0.28, k.current * 0.4)
  })
  return (
    <group position={device.anchor.position}>
      <primitive object={mist.points} />
    </group>
  )
}

/* ---------------- people and phones ---------------- */

const PERSON_COLORS = ['#ff8a5c', '#7c9cff', '#5fd3a0', '#f5c84c', '#e07cff']

/** Family "presence": each person stands in the room Home Assistant says they're in, walks to the
    next one when they move, and leaves through the front door when they go out. Phones (device
    trackers) follow their person and show a small ring instead of a figure. */
export function PresenceEffect({ entity, device, areas, devices, entities }: FamilyProps & { areas: Area[]; devices: HomeDevice[] }) {
  const tracker = entity.entity_id.startsWith('device_tracker.')
  const owner = tracker ? Object.values(entities).find((p) => (p.attributes.device_trackers as string[] | undefined)?.includes(entity.entity_id)) : undefined
  const idx = Math.max(0, devices.filter((d) => d.entityId.startsWith('person.')).findIndex((d) => d.entityId === (owner?.entity_id ?? entity.entity_id)))
  const color = String(entity.attributes._color ?? owner?.attributes._color ?? PERSON_COLORS[idx % PERSON_COLORS.length])
  const room = (tracker ? owner?.attributes._room : entity.attributes._room) as string | null | undefined
  const away = (tracker ? owner?.state : entity.state) !== 'home'
  const door = device.path?.[0] ?? device.anchor.position
  // where they stand: their room's centre, offset so people don't overlap
  const spot = useMemo(() => {
    const a = areas.find((x) => x.id === room)
    if (!a || away) return new THREE.Vector3(door[0], 0, door[2] + 1.2)
    const [x0, z0, x1, z1] = a.bounds
    return new THREE.Vector3((x0 + x1) / 2 + (idx - 0.5) * 1.1, 0, (z0 + z1) / 2 + 0.8 + idx * 0.4)
  }, [areas, room, away, idx, door])
  const pos = useRef(spot.clone())
  const fig = useRef<THREE.Group>(null)
  const ring = useMemo(() => ringsMaterial(), [])
  const shown = useRef(away ? 0 : 1)
  const floorY = device.anchor.position[1]
  useFrame((st, dt) => {
    // walk at a person's pace, turning to face the way they go
    const step = spot.clone().sub(pos.current)
    const d = step.length()
    if (d > 0.02) pos.current.add(step.multiplyScalar(Math.min(1, (1.3 * dt) / d)))
    shown.current = approach(shown.current, away && d < 0.3 ? 0 : 1, dt, 3)
    if (fig.current) {
      fig.current.position.set(pos.current.x, floorY, pos.current.z)
      if (d > 0.05) fig.current.rotation.y = Math.atan2(-step.z, step.x)
      fig.current.scale.setScalar(Math.max(0.001, shown.current))
      fig.current.position.y = floorY + (d > 0.05 ? Math.abs(Math.sin(st.clock.elapsedTime * 9)) * 0.03 : 0)
    }
    setColor(ring, color)
    ring.uniforms.uT.value = st.clock.elapsedTime
    ring.uniforms.uA.value = shown.current * (tracker ? 0.6 : 0.8)
    ring.uniforms.uFill.value = 0.35
    ring.uniforms.uSpeed.value = 2
    ring.uniforms.uInner.value = tracker ? 0.55 : 0
    const live = livePosition.get(entity.entity_id) ?? new THREE.Vector3()
    livePosition.set(entity.entity_id, live.set(pos.current.x + (tracker ? 0.35 : 0), floorY + (tracker ? 1.1 : 1.95), pos.current.z))
  })
  return (
    <group ref={fig}>
      <mesh position={[0, 0.02, 0]} rotation-x={-Math.PI / 2} material={ring} renderOrder={5}>
        <planeGeometry args={tracker ? [0.7, 0.7] : [1.1, 1.1]} />
      </mesh>
      {tracker ? (
        <mesh position={[0.35, 1.1, 0]}>
          <boxGeometry args={[0.02, 0.15, 0.075]} />
          <meshStandardMaterial color="#1b1e22" emissive={color} emissiveIntensity={0.4} />
        </mesh>
      ) : (
        <>
          <mesh position={[0, 0.85, 0]}>
            <capsuleGeometry args={[0.2, 0.9, 6, 16]} />
            <meshStandardMaterial color={color} roughness={0.6} />
          </mesh>
          <mesh position={[0, 1.62, 0]}>
            <sphereGeometry args={[0.15, 20, 16]} />
            <meshStandardMaterial color="#f1d3bd" roughness={0.7} />
          </mesh>
        </>
      )}
    </group>
  )
}

/* ---------------- alert and status binary sensors ---------------- */

/** Family "alert" (vibration, glass break, sound, tamper, problem, safety, cold): rings pulse off the
    sensor while it is on, in the warning's colour. */
export function AlertEffect({ entity, device }: FamilyProps) {
  const rings = useMemo(() => ringsMaterial(), [])
  const k = useRef(0)
  const color = binaryColor(String(entity.attributes.device_class))
  useFrame((st, dt) => {
    k.current = approach(k.current, tripped(entity) ? 1 : 0, dt, 5)
    setColor(rings, color)
    rings.uniforms.uT.value = st.clock.elapsedTime
    rings.uniforms.uA.value = k.current
    rings.uniforms.uSpeed.value = entity.attributes.device_class === 'vibration' ? 14 : 7
    rings.uniforms.uFreq.value = entity.attributes.device_class === 'vibration' ? 16 : 7
  })
  return (
    <group position={device.anchor.position} rotation-y={device.anchor.rotationY}>
      <mesh rotation-y={Math.PI / 2} material={rings}>
        <planeGeometry args={[1.6, 1.6]} />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} material={rings}>
        <planeGeometry args={[1.6, 1.6]} />
      </mesh>
    </group>
  )
}

/* ---------------- remotes, infrared and radio senders ---------------- */

/** Family "signal": when a remote, an IR blaster or an RF bridge sends a command, a pulse runs from
    it to the device it controls. */
export function SignalEffect({ entity, device, devices }: FamilyProps & { devices: HomeDevice[] }) {
  const target = devices.find((d) => d.entityId === entity.attributes._target)
  const run = useMemo(() => {
    if (!target) return null
    const a = new THREE.Vector3(...device.anchor.position)
    const b = new THREE.Vector3(...target.anchor.position)
    const mid = a.clone().lerp(b, 0.5).add(new THREE.Vector3(0, 0.6, 0))
    const curve = new THREE.QuadraticBezierCurve3(a, mid, b)
    const geo = new THREE.TubeGeometry(curve, 40, 0.012, 6, false)
    const mat = flowLineMaterial()
    mat.uniforms.uLen.value = curve.getLength()
    return { geo, mat }
  }, [device, target])
  const color = domainOfColor(entity.entity_id)
  useFrame((st) => {
    if (!run) return
    const since = (Date.now() - Number(entity.attributes._sent ?? 0)) / 1000
    setColor(run.mat, color)
    run.mat.uniforms.uT.value = st.clock.elapsedTime
    run.mat.uniforms.uA.value = since < 1.6 ? 1 - since / 1.6 : 0
    run.mat.uniforms.uSpeed.value = -6
    run.mat.uniforms.uBase.value = 0.3
  })
  return run ? <mesh geometry={run.geo} material={run.mat} renderOrder={6} /> : null
}
const domainOfColor = (id: string) => (id.startsWith('infrared.') ? '#ff5d8f' : id.startsWith('radio_frequency.') ? '#b48cff' : '#ffd166')

/* ---------------- doorbells and other events ---------------- */

/** Family "doorbell": when the event fires (a ring, a press), chime rings run out from it. */
export function DoorbellEffect({ entity, device }: FamilyProps) {
  const rings = useMemo(() => ringsMaterial(), [])
  useFrame((st) => {
    const since = (Date.now() - Date.parse(entity.state)) / 1000
    const a = Number.isFinite(since) && since < 4 ? 1 - since / 4 : 0
    setColor(rings, '#ffd166')
    rings.uniforms.uT.value = st.clock.elapsedTime
    rings.uniforms.uA.value = a
    rings.uniforms.uSpeed.value = 8
    rings.uniforms.uFreq.value = 6
  })
  return (
    <group position={device.anchor.position} rotation-y={device.anchor.rotationY}>
      <mesh rotation-y={Math.PI / 2} material={rings}>
        <planeGeometry args={[2.2, 2.2]} />
      </mesh>
    </group>
  )
}

/* ---------------- the weather ---------------- */

const WET = ['rainy', 'pouring', 'lightning-rainy', 'snowy', 'snowy-rainy', 'hail']

/** The weather entity sets Pascal's sky (clear, fair, cloudy, overcast) and, when it is wet, rain or
    snow falls over the grounds; lightning flashes in a storm. */
export function WeatherEffect({ entity, bounds }: { entity: HassEntity; bounds: [number, number, number, number] }) {
  const condition = entity.state
  useEffect(() => {
    useViewer.getState().setWeather(skyFor(condition))
  }, [condition])
  const [x0, z0, x1, z1] = bounds
  const fall = useFlow(900, 0.22)
  const flash = useRef<THREE.AmbientLight>(null)
  const k = useRef(0)
  const snow = condition.startsWith('snowy')
  useFrame((st, dt) => {
    const t = st.clock.elapsedTime
    k.current = approach(k.current, WET.includes(condition) ? (condition === 'pouring' ? 1 : 0.6) : 0, dt, 1.5)
    fall.mat.uniforms.uColor.value.set(snow ? '#ffffff' : '#9fc6ff')
    fall.update((out, life, seed) => {
      const sx = (seed * 7.919) % 1
      const sz = (seed * 3.137) % 1
      const drift = snow ? Math.sin(t + seed * 30) * 0.4 : 0
      out.set(x0 + sx * (x1 - x0) + drift, 9 - life * 9, z0 + sz * (z1 - z0))
    }, t, snow ? 0.12 : 0.9, k.current * (snow ? 0.8 : 0.45))
    if (flash.current) flash.current.intensity = condition.startsWith('lightning') && Math.sin(t * 1.7) > 0.985 ? 6 : 0
  })
  return (
    <>
      <primitive object={fall.points} />
      <ambientLight ref={flash} intensity={0} color="#dfe8ff" />
    </>
  )
}
