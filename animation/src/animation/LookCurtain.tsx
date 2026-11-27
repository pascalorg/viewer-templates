import { useEffect, useRef, useState } from 'react'
import { useNoirWanted } from './BuildAnimator'
import { useRendering } from './render'
import { useAnimationStore } from './store'

/**
 * The transition between the viewer's own look and a template's (Blueprint's Noir). The scene can't
 * blend two looks (the lights, the sky and every surface change at once), so the switch happens
 * behind a curtain of the Noir background. Into the template's look, a circle of it grows from the
 * middle of the stage until it covers it; back out at the end, it fades in over the finished
 * building instead, so the house dissolves into the background. Either way the look switches
 * while covered (the new shaders build unseen) and the curtain fades away. Plain CSS over the
 * canvas: it costs the 3D nothing.
 */

const COVER_MS = 420
/** The fade in over the finished building, on the way back to the viewer's own look. */
const FADE_COVER_MS = 650
/** Held covered after the switch: the new look's first frames (and its shaders) draw unseen. */
const SETTLE_MS = 160
const REVEAL_MS = 420
/** The fade back out onto the viewer's own look. */
const FADE_REVEAL_MS = 900
/**
 * Back to the viewer's own look, the curtain stays shut until the scene has really come back:
 * Pascal's daylight (its sky, lights and the materials' shaders) takes a while to build after the
 * switch, and a curtain lifted early showed the Noir background, then the scene popping in. It waits
 * at least `BACK_MIN_MS`, then for `BACK_SMOOTH_FRAMES` frames in a row drawn without a stall, and
 * never longer than `BACK_MAX_MS`.
 */
const BACK_MIN_MS = 700
const BACK_SMOOTH_FRAMES = 12
const BACK_MAX_MS = 3000
/** A frame slower than this is the scene still building (shaders, the sky). */
const STALL_MS = 45

/** Calls `done` once the page has drawn smoothly for a while after the look switched back. */
function whenSettled(alive: () => boolean, done: () => void) {
  const start = performance.now()
  let last = start
  let smooth = 0
  const frame = (now: number) => {
    if (!alive()) return
    smooth = now - last < STALL_MS ? smooth + 1 : 0
    last = now
    const waited = now - start
    if ((waited >= BACK_MIN_MS && smooth >= BACK_SMOOTH_FRAMES) || waited >= BACK_MAX_MS) done()
    else requestAnimationFrame(frame)
  }
  requestAnimationFrame(frame)
}

type Phase = 'open' | 'closing' | 'closed' | 'opening'

const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

export function LookCurtain() {
  const wanted = useNoirWanted() ? 'noir' : 'default'
  const applied = useAnimationStore((state) => state.appliedLook)
  const [phase, setPhase] = useState<Phase>('open')
  // Into the template's look the curtain is a growing circle; back out, a plain fade.
  const [fade, setFade] = useState(false)
  const token = useRef(0)
  // A render switches the look itself, with no curtain (the video starts in the template's look).
  const rendering = useRendering()

  useEffect(() => {
    if (rendering) {
      token.current++
      setPhase('open')
      return
    }
    if (wanted === applied) return
    const mine = ++token.current
    if (reducedMotion()) {
      useAnimationStore.setState({ appliedLook: wanted })
      return
    }
    const later = (ms: number, run: () => void) => window.setTimeout(() => token.current === mine && run(), ms)
    const fading = wanted === 'default'
    setFade(fading)
    setPhase('closing')
    later(fading ? FADE_COVER_MS : COVER_MS, () => {
      setPhase('closed')
      useAnimationStore.setState({ appliedLook: wanted })
      const reveal = () => {
        setPhase('opening')
        later(fading ? FADE_REVEAL_MS : REVEAL_MS, () => setPhase('open'))
      }
      if (fading) whenSettled(() => token.current === mine, reveal)
      else later(SETTLE_MS, reveal)
    })
    // No cleanup: switching the look re-runs this effect, and the curtain must still open. A newer
    // switch takes over through `token` (the old timers then do nothing).
  }, [wanted, applied, rendering])

  if (phase === 'open') return null
  const covered = phase === 'closed' || phase === 'opening'
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0"
      style={{
        zIndex: 5,
        background: 'radial-gradient(circle at 50% 50%, #3a3e44 0%, #16181b 45%, #08090a 85%)',
        clipPath: fade || covered || phase === 'closing' ? undefined : 'circle(0% at 50% 50%)',
        animation: phase === 'closing'
          ? fade
            ? `look-curtain-fade-in ${FADE_COVER_MS}ms ease-in-out both`
            : `look-curtain-close ${COVER_MS}ms cubic-bezier(0.55, 0, 0.75, 0.4) both`
          : phase === 'opening'
            ? `look-curtain-open ${fade ? FADE_REVEAL_MS : REVEAL_MS}ms ease-out both`
            : undefined,
      }}
    >
      <style>{`
        @keyframes look-curtain-close { from { clip-path: circle(0% at 50% 50%) } to { clip-path: circle(75% at 50% 50%) } }
        @keyframes look-curtain-fade-in { from { opacity: 0 } to { opacity: 1 } }
        @keyframes look-curtain-open { from { opacity: 1 } to { opacity: 0 } }
      `}</style>
    </div>
  )
}
