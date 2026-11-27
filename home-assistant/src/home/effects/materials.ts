import * as THREE from 'three'
import { N, shader } from '../tsl'

const { abs, atan, clamp, float, fract, length, max, min, mod, oneMinus, pow, sin, smoothstep, uniform, uv, vec2 } = N

/* The shaders the device families share. Each returns a material whose uniforms the family drives
   every frame: colour, strength and time. All are unlit and additive unless they say otherwise. */

const ADD = { transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }

/**
 * Rings running out from (or, with a negative speed, into) the centre of a square plane, with an
 * optional soft fill and a wedge mask. Alerts, sound, coverage, voice and motion cones all use it.
 * `uHalf` is the wedge's half angle (π for a full circle), `uDir` the way the wedge points.
 */
export function ringsMaterial() {
  return shader(
    {
      uColor: uniform(new THREE.Color('#fff')),
      uA: uniform(0),
      uT: uniform(0),
      uSpeed: uniform(1),
      uFreq: uniform(6),
      uSharp: uniform(8),
      uRing: uniform(1),
      uFill: uniform(0),
      uInner: uniform(0),
      uHalf: uniform(Math.PI),
      uDir: uniform(0),
    },
    (u) => {
      const p = uv().sub(0.5).mul(2)
      const d = length(p)
      const ring = pow(sin(d.mul(u.uFreq).sub(u.uT.mul(u.uSpeed))).mul(0.5).add(0.5), u.uSharp)
      const fade = oneMinus(smoothstep(0.55, 1, d)).mul(smoothstep(u.uInner, u.uInner.add(0.08), d))
      const ang = atan(p.y, p.x).sub(u.uDir)
      const diff = abs(mod(ang.add(Math.PI), Math.PI * 2).sub(Math.PI))
      const wedge = oneMinus(smoothstep(u.uHalf.sub(0.06), u.uHalf, diff))
      const fill = u.uFill.mul(oneMinus(d))
      return { color: u.uColor, opacity: clamp(ring.mul(u.uRing).add(fill).mul(fade).mul(wedge).mul(u.uA), 0, 1) }
    },
    ADD,
  )
}

/** A glowing edge round a rectangle (a door left open, a moving blind, the armed house). */
export function frameMaterial() {
  return shader(
    { uColor: uniform(new THREE.Color('#fff')), uA: uniform(0), uT: uniform(0), uWidth: uniform(0.06), uPulse: uniform(0) },
    (u) => {
      const q = uv()
      const e = vec2(min(q.x, oneMinus(q.x)), min(q.y, oneMinus(q.y))).toVar()
      const edge = oneMinus(smoothstep(0, u.uWidth, min(e.x, e.y)))
      const beat = oneMinus(u.uPulse).add(u.uPulse.mul(sin(u.uT.mul(6)).mul(0.5).add(0.5)))
      return { color: u.uColor, opacity: edge.mul(u.uA).mul(beat) }
    },
    ADD,
  )
}

/**
 * A pipe or cable drawn as a tube whose length runs along uv.x: a faint core with brighter pulses
 * travelling along it. `uLen` is the run's length in metres, so pulses keep their spacing.
 */
export function flowLineMaterial() {
  return shader(
    { uColor: uniform(new THREE.Color('#fff')), uA: uniform(0), uT: uniform(0), uSpeed: uniform(1), uLen: uniform(1), uBase: uniform(0.25), uDone: uniform(1) },
    (u) => {
      const x = uv().x
      const s = x.mul(u.uLen)
      const dash = smoothstep(0.55, 1, fract(s.mul(2.2).sub(u.uT.mul(u.uSpeed))))
      const shown = oneMinus(smoothstep(u.uDone.sub(0.01), u.uDone, x))
      return { color: u.uColor, opacity: dash.add(u.uBase).mul(u.uA).mul(shown) }
    },
    ADD,
  )
}

/** A beam or shaft that fades along uv.y, strongest at the source (v = 1), soft at its sides. */
export function beamMaterial(sides = true) {
  return shader(
    { uColor: uniform(new THREE.Color('#fff')), uA: uniform(0), uT: uniform(0) },
    (u) => {
      const q = uv()
      const along = pow(q.y, float(1.6))
      const side = sides ? smoothstep(0, 0.25, q.x).mul(smoothstep(0, 0.25, oneMinus(q.x))) : float(1)
      return { color: u.uColor, opacity: along.mul(side).mul(u.uA) }
    },
    ADD,
  )
}

/** A filled vertical gauge on a cylinder shell (a tank's heat), its level at `uLevel`. */
export function gaugeMaterial() {
  return shader(
    { uColor: uniform(new THREE.Color('#fff')), uCold: uniform(new THREE.Color('#4fb3ff')), uA: uniform(0), uT: uniform(0), uLevel: uniform(0.5) },
    (u) => {
      const y = uv().y
      const below = oneMinus(smoothstep(u.uLevel.sub(0.04), u.uLevel, y))
      const shimmer = sin(y.mul(40).sub(u.uT.mul(3))).mul(0.15).add(0.85)
      return { color: u.uColor.mul(below).add(u.uCold.mul(oneMinus(below)).mul(0.5)), opacity: max(below.mul(0.55).mul(shimmer), float(0.08)).mul(u.uA) }
    },
    ADD,
  )
}
