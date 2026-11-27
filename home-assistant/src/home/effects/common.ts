import { useMemo } from 'react'
import * as THREE from 'three'
import { glowMrt, N, pointCoord, pointQuad, quadPoints, shader, W } from '../tsl'

const { attribute, cameraProjectionMatrix, float, length, min, modelViewMatrix, oneMinus, smoothstep, uniform, varying, vec4 } = N

/** Eases `from` towards `to`, frame-rate independent. Every effect responds through this, so a
    state change reads as the device reacting rather than a switch flipping. */
export const approach = (from: number, to: number, dt: number, rate = 4) => from + (to - from) * (1 - Math.exp(-dt * rate))

/** A soft round glow, shared by every sprite and light pool. */
let glowMap: THREE.CanvasTexture | null = null
export function glowTexture() {
  if (glowMap) return glowMap
  const c = document.createElement('canvas')
  c.width = c.height = 128
  const g = c.getContext('2d')!
  const r = g.createRadialGradient(64, 64, 0, 64, 64, 64)
  r.addColorStop(0, 'rgba(255,255,255,1)')
  r.addColorStop(0.35, 'rgba(255,255,255,.42)')
  r.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = r
  g.fillRect(0, 0, 128, 128)
  glowMap = new THREE.CanvasTexture(c)
  return glowMap
}
const glowParams = () => ({ map: glowTexture(), transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false })
/** A soft additive glow for planes (light pools). */
export function additive(color: string): THREE.MeshBasicMaterial {
  const m = new W.MeshBasicNodeMaterial({ ...glowParams(), color })
  m.mrtNode = glowMrt()
  return m
}
/** A soft additive glow for sprites (halos). */
export function additiveSprite(): THREE.SpriteMaterial {
  const m = new W.SpriteNodeMaterial(glowParams())
  m.mrtNode = glowMrt()
  return m
}

/** Where devices that move (robots) are right now, so their pins and press targets follow them. */
export const livePosition = new Map<string, THREE.Vector3>()

/** Where an oscillating fan's head points at time `t`, as a yaw offset. Fan bodies and their air share it. */
export const fanSwing = (t: number) => Math.sin(t * 0.45) * 0.62

/** Places one particle by its life (0..1), its random seed and the time. Positions are local to the stream. */
export type FlowFn = (out: THREE.Vector3, life: number, seed: number, t: number) => void

/** A stream of soft additive particles, as instanced quads. */
export function useFlow(count: number, size: number) {
  return useMemo(() => {
    const geo = quadPoints(count, {
      iPos: new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3).setUsage(THREE.DynamicDrawUsage),
      aA: new THREE.InstancedBufferAttribute(new Float32Array(count), 1).setUsage(THREE.DynamicDrawUsage),
    })
    const mat = shader(
      { uColor: uniform(new THREE.Color('#fff')), uSize: uniform(size) },
      (u) => {
        const mv = modelViewMatrix.mul(vec4(attribute('iPos', 'vec3'), 1))
        const vA = varying(attribute('aA', 'float'))
        const c = pointCoord()
        return {
          vertex: pointQuad(cameraProjectionMatrix.mul(mv), min(u.uSize.mul(float(90).div(mv.z.negate())), 22)),
          color: u.uColor,
          opacity: oneMinus(smoothstep(0.05, 0.5, length(c))).mul(vA),
        }
      },
      { transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide },
    )
    const points = new THREE.Mesh(geo, mat)
    points.frustumCulled = false
    points.renderOrder = 8
    const seeds = Float32Array.from({ length: count }, (_, i) => (i * 0.6180339887) % 1)
    const p = new THREE.Vector3()
    const update = (fn: FlowFn, t: number, rate: number, alpha: number) => {
      const pos = geo.getAttribute('iPos') as THREE.BufferAttribute
      const a = geo.getAttribute('aA') as THREE.BufferAttribute
      for (let i = 0; i < count; i++) {
        const life = (t * rate * (0.8 + seeds[i]! * 0.4) + seeds[i]!) % 1
        fn(p, life, seeds[i]!, t)
        pos.setXYZ(i, p.x, p.y, p.z)
        a.setX(i, Math.sin(life * Math.PI) * alpha)
      }
      pos.needsUpdate = true
      a.needsUpdate = true
    }
    return { points, mat, update }
  }, [count, size])
}
