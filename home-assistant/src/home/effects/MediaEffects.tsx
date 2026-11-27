import { useFrame, useThree } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import { ALERT, tripped, type HomeDevice } from '../entities'
import { additiveSprite, approach } from './common'
import { beamMaterial, ringsMaterial } from './materials'
import type { FamilyProps } from './SafetyEffects'

/* The media, camera, voice and network families. */

const setColor = (m: { uniforms: Record<string, { value: unknown }> }, v: string) => (m.uniforms.uColor!.value as THREE.Color).set(v)

/* ---------------- TVs and speakers ---------------- */

/** Family "media": a TV's screen shows what is playing (art, title, progress) and casts its colour
    into the room; sound rings pulse off speakers and TVs with the volume while they play. */
export function MediaEffect({ entity, device }: FamilyProps) {
  const tv = entity.attributes.device_class === 'tv'
  const { size = [0.1, 0.6, 1] } = device.anchor
  const [, h, w] = size
  const gl = useThree((s) => s.gl)
  const rings = useMemo(() => ringsMaterial(), [])
  const light = useRef<THREE.PointLight>(null)
  const k = useRef(0)
  const art = useRef(new THREE.Color())
  const screen = useMemo(() => {
    const c = document.createElement('canvas')
    c.width = 512
    c.height = Math.round((512 * h) / w)
    const t = new THREE.CanvasTexture(c)
    t.colorSpace = THREE.SRGBColorSpace
    return { c, t, last: -1 }
  }, [h, w])

  useFrame((st, dt) => {
    const t = st.clock.elapsedTime
    const playing = entity.state === 'playing'
    const muted = !!entity.attributes.is_volume_muted
    const vol = Number(entity.attributes.volume_level ?? 0.4)
    const [c1, c2] = (entity.attributes._art as [string, string] | undefined) ?? ['#5b6cff', '#ff5fa2']
    k.current = approach(k.current, playing && !muted ? vol : 0, dt, 4)
    setColor(rings, c1)
    rings.uniforms.uT.value = t
    rings.uniforms.uA.value = k.current * 1.4
    rings.uniforms.uSpeed.value = 7
    rings.uniforms.uFreq.value = 8
    rings.uniforms.uSharp.value = 5
    rings.uniforms.uHalf.value = tv ? 1.3 : Math.PI
    if (!tv) return
    // the screen redraws ten times a second
    if (Math.floor(t * 10) !== screen.last) {
      screen.last = Math.floor(t * 10)
      drawScreen(screen.c, entity.state, entity.attributes, c1, c2, t)
      screen.t.needsUpdate = true
    }
    const lit = entity.state === 'off' ? 0 : entity.state === 'playing' ? 1 : 0.35
    art.current.set(c1).lerp(new THREE.Color(c2), Math.sin(t * 0.7) * 0.5 + 0.5)
    if (light.current) {
      light.current.color.copy(art.current)
      light.current.intensity = (lit * 3.5) / Math.max(1, gl.toneMappingExposure)
    }
  })

  return (
    <group position={device.anchor.position} rotation-y={device.anchor.rotationY}>
      {tv && (
        <>
          <mesh position={[0.035, 0, 0]} rotation-y={Math.PI / 2}>
            <planeGeometry args={[w * 0.96, h * 0.92]} />
            <meshBasicMaterial map={screen.t} toneMapped={false} />
          </mesh>
          <pointLight ref={light} position={[0.8, 0, 0]} intensity={0} distance={5} decay={1.7} />
        </>
      )}
      {/* sound runs out along the floor in front of a TV, and all round a speaker */}
      <mesh position={tv ? [0, -0.7, 0] : [0, 0, 0]} rotation-x={-Math.PI / 2} material={rings} renderOrder={5}>
        <planeGeometry args={tv ? [5, 5] : [2.6, 2.6]} />
      </mesh>
    </group>
  )
}

function drawScreen(c: HTMLCanvasElement, state: string, a: Record<string, unknown>, c1: string, c2: string, t: number) {
  const g = c.getContext('2d')!
  const { width: W, height: H } = c
  g.fillStyle = '#05070a'
  g.fillRect(0, 0, W, H)
  if (state === 'off') return
  const grad = g.createLinearGradient(0, 0, W, H)
  const s = Math.sin(t * 0.6) * 0.5 + 0.5
  grad.addColorStop(0, c1)
  grad.addColorStop(0.35 + s * 0.3, c2)
  grad.addColorStop(1, '#0b0e14')
  g.globalAlpha = state === 'playing' ? 1 : 0.35
  g.fillStyle = grad
  g.fillRect(0, 0, W, H)
  g.globalAlpha = 1
  g.fillStyle = 'rgba(0,0,0,.35)'
  g.fillRect(0, H * 0.62, W, H * 0.38)
  g.fillStyle = '#fff'
  g.textBaseline = 'alphabetic'
  g.font = `700 ${Math.round(H * 0.11)}px system-ui, sans-serif`
  g.fillText(String(a.media_title ?? a.source ?? 'Home'), W * 0.06, H * 0.78)
  g.font = `400 ${Math.round(H * 0.07)}px system-ui, sans-serif`
  g.fillStyle = 'rgba(255,255,255,.75)'
  g.fillText(`${a.media_artist ?? ''}${a.source ? `  ·  ${a.source}` : ''}`, W * 0.06, H * 0.88)
  const dur = Number(a.media_duration ?? 1)
  const pos = Number(a.media_position ?? 0)
  g.fillStyle = 'rgba(255,255,255,.25)'
  g.fillRect(W * 0.06, H * 0.93, W * 0.88, 4)
  g.fillStyle = '#fff'
  g.fillRect(W * 0.06, H * 0.93, W * 0.88 * Math.min(1, pos / dur), 4)
  if (state === 'paused') {
    g.fillStyle = 'rgba(255,255,255,.9)'
    g.fillRect(W / 2 - 26, H * 0.25, 16, 56)
    g.fillRect(W / 2 + 10, H * 0.25, 16, 56)
  }
}

/* ---------------- cameras ---------------- */

/** Family "camera": what the camera sees, as a fading frustum and its footprint on the ground —
    blue while it streams, red with a blinking dot while it records. */
export function CameraEffect({ entity, device, floorY }: FamilyProps) {
  const frustum = useMemo(() => beamMaterial(false), [])
  const ground = useMemo(() => ringsMaterial(), [])
  const dot = useMemo(() => additiveSprite(), [])
  const k = useRef(0)
  const fov = (Number(entity.attributes._fov ?? 70) * Math.PI) / 180
  const reach = Number(entity.attributes._reach ?? 7)
  const tilt = Number(entity.attributes._tilt ?? 0.45)
  const [x, y, z] = device.anchor.position
  useFrame((st, dt) => {
    const t = st.clock.elapsedTime
    const on = entity.state !== 'off'
    const rec = entity.state === 'recording'
    k.current = approach(k.current, on ? 1 : 0, dt, 4)
    const col = rec ? ALERT.danger : ALERT.info
    setColor(frustum, col)
    frustum.uniforms.uA.value = k.current * (rec ? 0.3 : 0.16)
    setColor(ground, col)
    ground.uniforms.uT.value = t
    ground.uniforms.uA.value = k.current * 0.7
    ground.uniforms.uHalf.value = fov / 2
    ground.uniforms.uFill.value = 0.3
    ground.uniforms.uRing.value = rec ? 0.8 : 0.25
    ground.uniforms.uSpeed.value = 4
    dot.color.set(ALERT.danger)
    dot.opacity = rec ? (Math.sin(t * 6) > 0 ? 1 : 0.2) : 0
  })
  // where the view lands on the ground, for the footprint
  const groundDist = Math.min(reach, (y - floorY) / Math.tan(tilt))
  return (
    <>
      <group position={[x, y, z]} rotation-y={device.anchor.rotationY}>
        <group rotation-z={-tilt}>
          {/* a four-sided cone turned square to the view, apex at the lens, opening along +x */}
          <group position={[reach / 2, 0, 0]} rotation-z={Math.PI / 2}>
            <mesh rotation-y={Math.PI / 4} material={frustum}>
              <coneGeometry args={[Math.tan(fov / 2) * reach * 1.41, reach, 4, 1, true]} />
            </mesh>
          </group>
        </group>
        <sprite position={[0.12, 0.08, 0]} scale={0.16} material={dot} />
      </group>
      <group position={[x, floorY + 0.04, z]} rotation-y={device.anchor.rotationY}>
        <mesh rotation-x={-Math.PI / 2} material={ground} renderOrder={5}>
          <planeGeometry args={[groundDist * 2.6, groundDist * 2.6]} />
        </mesh>
      </group>
    </>
  )
}

/* ---------------- voice assistants ---------------- */

const VOICE: Record<string, { color: string; speed: number; spin: boolean }> = {
  listening: { color: ALERT.info, speed: -6, spin: false },
  processing: { color: '#b48cff', speed: 0, spin: true },
  responding: { color: ALERT.ok, speed: 5, spin: false },
}

/** Family "voice": rings draw in while it listens, an arc turns while it thinks, and rings run out
    while it answers. */
export function VoiceEffect({ entity, device }: FamilyProps) {
  const rings = useMemo(() => ringsMaterial(), [])
  const k = useRef(0)
  useFrame((st, dt) => {
    const t = st.clock.elapsedTime
    const v = VOICE[entity.state]
    k.current = approach(k.current, v ? 1 : 0.2, dt, 5)
    setColor(rings, v?.color ?? '#dfe7ef')
    rings.uniforms.uT.value = t
    rings.uniforms.uA.value = k.current
    rings.uniforms.uSpeed.value = v?.speed ?? 1
    rings.uniforms.uFreq.value = 9
    rings.uniforms.uSharp.value = 4
    rings.uniforms.uRing.value = v ? 1 : 0.2
    rings.uniforms.uFill.value = v?.spin ? 0.9 : 0.15
    rings.uniforms.uHalf.value = v?.spin ? 0.6 : Math.PI
    rings.uniforms.uDir.value = t * 5
    rings.uniforms.uInner.value = 0.18
  })
  return (
    <mesh position={[device.anchor.position[0], device.anchor.position[1] + 0.02, device.anchor.position[2]]} rotation-x={-Math.PI / 2} material={rings} renderOrder={6}>
      <planeGeometry args={[1.8, 1.8]} />
    </mesh>
  )
}

/* ---------------- routers and connectivity ---------------- */

function Link({ from, to, on }: { from: THREE.Vector3; to: THREE.Vector3; on: boolean }) {
  const { line, curve, mat } = useMemo(() => {
    const curve = new THREE.QuadraticBezierCurve3(from, new THREE.Vector3((from.x + to.x) / 2, Math.max(from.y, to.y) + 1.4, (from.z + to.z) / 2), to)
    const mat = new THREE.LineBasicMaterial({ color: '#5ce1c6', transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending })
    return { line: new THREE.Line(new THREE.BufferGeometry().setFromPoints(curve.getPoints(40)), mat), curve, mat }
  }, [from, to])
  const dots = useRef<(THREE.Mesh | null)[]>([])
  const k = useRef(0)
  useFrame((st, dt) => {
    k.current = approach(k.current, on ? 1 : 0, dt, 4)
    mat.opacity = k.current * 0.4
    dots.current.forEach((d, i) => {
      if (!d) return
      d.visible = k.current > 0.03
      curve.getPoint((st.clock.elapsedTime * 0.3 + i / 3) % 1, d.position)
      d.scale.setScalar(k.current)
    })
  })
  return (
    <>
      <primitive object={line} />
      {[0, 1, 2].map((i) => (
        <mesh key={i} ref={(m) => void (dots.current[i] = m)}>
          <sphereGeometry args={[0.022, 8, 6]} />
          <meshBasicMaterial color="#5ce1c6" toneMapped={false} />
        </mesh>
      ))}
    </>
  )
}

/** Family "network": coverage rings run out across the floor from the router, and data runs along
    arcs to every device in reach. Both stay faint until the router is selected, so a home full of
    connected devices doesn't disappear under its links. */
export function NetworkEffect({ entity, device, floorY, devices, focused }: FamilyProps & { devices: HomeDevice[]; focused: boolean }) {
  const rings = useMemo(() => ringsMaterial(), [])
  const k = useRef(0)
  const reach = Number(entity.attributes._reach ?? 9)
  const [x, y, z] = device.anchor.position
  const from = useMemo(() => new THREE.Vector3(x, y + 0.12, z), [x, y, z])
  const targets = useMemo(
    () => devices.filter((d) => d !== device && Math.hypot(d.anchor.position[0] - x, d.anchor.position[2] - z) <= reach).map((d) => ({ id: d.entityId, to: new THREE.Vector3(...d.anchor.position) })),
    [devices, device, x, z, reach],
  )
  const on = tripped(entity)
  useFrame((st, dt) => {
    // quiet unless the router is the one looked at: a faint pulse round it, its links only when chosen
    k.current = approach(k.current, !on ? 0.15 : focused ? 1 : 0.22, dt, 3)
    setColor(rings, on ? '#5ce1c6' : ALERT.danger)
    rings.uniforms.uT.value = st.clock.elapsedTime
    rings.uniforms.uA.value = k.current * 0.6
    rings.uniforms.uFreq.value = reach * 2.6
    rings.uniforms.uSpeed.value = 3.4
    rings.uniforms.uSharp.value = 10
    rings.uniforms.uFill.value = 0.12
  })
  return (
    <>
      <mesh position={[x, floorY + 0.05, z]} rotation-x={-Math.PI / 2} material={rings} renderOrder={4}>
        <planeGeometry args={[reach * 2, reach * 2]} />
      </mesh>
      {targets.map((t) => <Link key={t.id} from={from} to={t.to} on={on && focused} />)}
    </>
  )
}
