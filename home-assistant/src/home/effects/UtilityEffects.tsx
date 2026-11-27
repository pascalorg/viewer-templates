import { useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import { ALERT, domainOf, isOn, openness, type V3 } from '../entities'
import { approach, livePosition, useFlow } from './common'
import { flowLineMaterial, gaugeMaterial, ringsMaterial } from './materials'
import type { FamilyProps } from './SafetyEffects'

/* The utility families: robots that move through the home, power running to a plug, the water
   heater and the water main. */

type Mat = { uniforms: Record<string, { value: unknown }> }
const setColor = (m: Mat, v: string) => (m.uniforms.uColor!.value as THREE.Color).set(v)

/** A run (cable, pipe, route) through `points`, as a tube with a travelling-pulse material. */
function useRun(points: V3[] | undefined, radius: number, closed = false) {
  return useMemo(() => {
    if (!points || points.length < 2) return null
    const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(...p)), closed, 'catmullrom', 0.02)
    const length = curve.getLength()
    const geo = new THREE.TubeGeometry(curve, Math.max(24, Math.round(length * 14)), radius, 8, closed)
    const mat = flowLineMaterial()
    mat.uniforms.uLen.value = length
    return { curve, length, geo, mat }
  }, [points, radius, closed])
}

/* ---------------- robot vacuums and mowers ---------------- */

/** Family "robot": the robot itself drives its route while it works, goes home to the dock when it
    returns, and leaves a glowing trail of what it has covered this run. Locate pings it. */
export function RobotEffect({ entity, device }: FamilyProps) {
  const mower = domainOf(entity.entity_id) === 'lawn_mower'
  const run = useRun(device.path, 0.035, true)
  const body = useRef<THREE.Group>(null)
  const ping = useMemo(() => ringsMaterial(), [])
  const s = useRef(0)
  const covered = useRef(0)
  const p = useMemo(() => new THREE.Vector3(), [])
  const tan = useMemo(() => new THREE.Vector3(), [])
  useFrame((st, dt) => {
    if (!run) return
    const working = entity.state === 'cleaning' || entity.state === 'mowing'
    const speed = (mower ? 0.55 : 0.38) / run.length
    if (working) {
      s.current = (s.current + dt * speed) % 1
      covered.current = Math.min(1, covered.current + dt * speed)
    } else if (entity.state === 'returning') {
      // the way home is whichever direction round the route is shorter
      const back = s.current < 0.5 ? -1 : 1
      s.current = Math.max(0, Math.min(1, s.current + back * dt * speed * 1.6))
      if (s.current === 1) s.current = 0
    } else if (entity.state === 'docked') {
      s.current = 0
      covered.current = approach(covered.current, 0, dt, 0.5)
    }
    run.curve.getPointAt(s.current, p)
    run.curve.getTangentAt(s.current, tan)
    if (body.current) {
      // the route's points sit just above the ground they run on
      body.current.position.set(p.x, p.y - 0.012, p.z)
      body.current.rotation.y = Math.atan2(-tan.z, tan.x)
    }
    const live = livePosition.get(entity.entity_id) ?? new THREE.Vector3()
    livePosition.set(entity.entity_id, live.set(p.x, p.y + 0.35, p.z))
    setColor(run.mat, mower ? '#9be36b' : '#7fd3ff')
    run.mat.uniforms.uT.value = st.clock.elapsedTime
    run.mat.uniforms.uA.value = 0.6
    run.mat.uniforms.uSpeed.value = working ? 1.5 : 0
    run.mat.uniforms.uBase.value = 0.35
    run.mat.uniforms.uDone.value = covered.current
    const since = (Date.now() - Number(entity.attributes._locate ?? 0)) / 1000
    setColor(ping, ALERT.info)
    ping.uniforms.uT.value = st.clock.elapsedTime
    ping.uniforms.uA.value = since < 4 ? 1 - since / 4 : 0
    ping.uniforms.uSpeed.value = 8
  })
  if (!run) return null
  return (
    <>
      {/* the route is laid on the ground, so its points carry the floor height */}
      <mesh geometry={run.geo} material={run.mat} renderOrder={5} />
      <group ref={body}>
        {mower ? (
          <>
            <mesh position={[0, 0.16, 0]}>
              <boxGeometry args={[0.62, 0.22, 0.44]} />
              <meshStandardMaterial color="#e9edf1" roughness={0.45} />
            </mesh>
            <mesh position={[0.05, 0.28, 0]}>
              <boxGeometry args={[0.36, 0.04, 0.3]} />
              <meshStandardMaterial color="#2c3136" />
            </mesh>
            {[-0.2, 0.2].flatMap((wx) => [-0.24, 0.24].map((wz) => (
              <mesh key={`${wx}${wz}`} position={[wx, 0.1, wz]} rotation-x={Math.PI / 2}>
                <cylinderGeometry args={[0.1, 0.1, 0.06, 18]} />
                <meshStandardMaterial color="#1b1e22" />
              </mesh>
            )))}
          </>
        ) : (
          <>
            <mesh position={[0, 0.05, 0]}>
              <cylinderGeometry args={[0.17, 0.17, 0.08, 36]} />
              <meshStandardMaterial color="#20242a" roughness={0.35} metalness={0.2} />
            </mesh>
            <mesh position={[0.02, 0.1, 0]}>
              <cylinderGeometry args={[0.045, 0.045, 0.025, 20]} />
              <meshStandardMaterial color="#d8dde3" />
            </mesh>
          </>
        )}
        <mesh position={[0, 0.03, 0]} rotation-x={-Math.PI / 2} material={ping}>
          <planeGeometry args={[2.4, 2.4]} />
        </mesh>
      </group>
    </>
  )
}

/* ---------------- smart plugs ---------------- */

/** Family "energy": power runs along the cable from the electrical panel to the plug, faster and
    hotter in colour the more it draws. */
export function EnergyEffect({ entity, device }: FamilyProps) {
  const run = useRun(device.path, 0.02)
  const k = useRef(0)
  useFrame((st, dt) => {
    const w = Number(entity.attributes.current_power_w ?? 0)
    k.current = approach(k.current, Math.min(1, w / 2000), dt, 3)
    const col = w < 300 ? '#3ddc97' : w < 1200 ? '#ffc247' : '#ff7a45'
    if (!run) return
    setColor(run.mat, col)
    run.mat.uniforms.uT.value = st.clock.elapsedTime
    run.mat.uniforms.uA.value = 0.25 + k.current * 0.75
    run.mat.uniforms.uSpeed.value = -(0.4 + k.current * 3)
    run.mat.uniforms.uBase.value = isOn(entity) ? 0.3 : 0.08
  })
  return run ? <mesh geometry={run.geo} material={run.mat} renderOrder={5} /> : null
}

/* ---------------- water heaters ---------------- */

/** Family "heater": the tank fills with colour from the bottom as it heats (blue cold, orange hot),
    steam rises while it is heating, and hot water pulses along its pipe while it is on. */
export function HeaterEffect({ entity, device }: FamilyProps) {
  const { size = [0.6, 1.5, 0.6] } = device.anchor
  const gauge = useMemo(() => gaugeMaterial(), [])
  const steam = useFlow(70, 0.5)
  const run = useRun(device.path, 0.03)
  const k = useRef(0)
  const level = useRef(0)
  useFrame((st, dt) => {
    const t = st.clock.elapsedTime
    const cur = Number(entity.attributes.current_temperature ?? 40)
    const target = Number(entity.attributes.temperature ?? 55)
    const on = entity.state !== 'off'
    const heating = on && cur < target - 0.5
    k.current = approach(k.current, heating ? 1 : 0, dt, 2)
    level.current = approach(level.current, Math.max(0, Math.min(1, (cur - 20) / 50)), dt, 2)
    const hot = new THREE.Color('#4fb3ff').lerp(new THREE.Color('#ff7a2e'), level.current)
    ;(gauge.uniforms.uColor!.value as THREE.Color).copy(hot)
    gauge.uniforms.uT.value = t
    gauge.uniforms.uA.value = 0.9
    gauge.uniforms.uLevel.value = level.current
    steam.mat.uniforms.uColor.value.set('#e6eef5')
    steam.update((out, life, seed) => out.set(Math.sin(seed * 40 + life * 3) * 0.15 * life, size[1] / 2 + life * 1.1, Math.cos(seed * 40) * 0.15 * life), t, 0.35, k.current * 0.35)
    if (run) {
      setColor(run.mat, '#ff8a3d')
      run.mat.uniforms.uT.value = t
      run.mat.uniforms.uA.value = on ? 0.4 + level.current * 0.5 : 0.1
      run.mat.uniforms.uSpeed.value = on ? 1.4 : 0
    }
  })
  return (
    <>
      <group position={device.anchor.position}>
        <mesh material={gauge} renderOrder={6}>
          <cylinderGeometry args={[size[0] / 2 + 0.015, size[0] / 2 + 0.015, size[1] * 0.92, 32, 1, true]} />
        </mesh>
        <primitive object={steam.points} />
      </group>
      {run && <mesh geometry={run.geo} material={run.mat} renderOrder={5} />}
    </>
  )
}

/* ---------------- water valves ---------------- */

/** Family "water": water flows along the pipe as far open as the valve is; a closed main shows a
    red ring at the valve. */
export function WaterEffect({ entity, device }: FamilyProps) {
  const run = useRun(device.path, 0.035)
  const stop = useMemo(() => ringsMaterial(), [])
  const k = useRef(0)
  useFrame((st, dt) => {
    const t = st.clock.elapsedTime
    k.current = approach(k.current, openness(entity), dt, 3)
    if (run) {
      setColor(run.mat, ALERT.water)
      run.mat.uniforms.uT.value = t
      run.mat.uniforms.uA.value = 0.15 + k.current * 0.85
      run.mat.uniforms.uSpeed.value = k.current * 2.2
      run.mat.uniforms.uBase.value = 0.2
    }
    setColor(stop, ALERT.danger)
    stop.uniforms.uT.value = t
    stop.uniforms.uA.value = (1 - k.current) * 0.9
    stop.uniforms.uSpeed.value = 3
    stop.uniforms.uFill.value = 0.3
    stop.uniforms.uInner.value = 0.3
  })
  return (
    <>
      {run && <mesh geometry={run.geo} material={run.mat} renderOrder={5} />}
      <mesh position={device.anchor.position} rotation-y={device.anchor.rotationY + Math.PI / 2} material={stop}>
        <planeGeometry args={[0.6, 0.6]} />
      </mesh>
    </>
  )
}
