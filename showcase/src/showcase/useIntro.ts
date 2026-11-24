import { useEffect, useRef, useState } from 'react'
import { IntroSequence, steadyClock } from './intro'
import { isPresented, markStaged } from './presentation'
import type { OpeningView } from './opening'
import { applyIntroFrame, finishIntro, frameSettled, settleOpeningMode, startIntro, type SceneContext } from './viewer-actions'

// Once per page load: a late plugin or a bake that arrives later remounts the chrome, not the intro.
let played = false

/** Whether an intro is still to come on this page (the opening view then keeps the house whole). */
export function introAhead(enabled: boolean) {
  return enabled && !played && !matchMedia('(prefers-reduced-motion: reduce)').matches
}

/**
 * Plays the intro once the scene is on screen. Returns whether it is still playing and `skip`.
 * Any pointer or wheel input on the canvas hands the camera back to the visitor; the reveal goes on.
 * Time advances at most 50 ms per frame, so a slow scene plays the whole reveal, just longer.
 * `now` is injectable for tests; reduced motion goes straight to the end state.
 */
export function useIntro({ enabled, frameOnArrival, levelCount, context, opening = null, now = () => performance.now() }: {
  enabled: boolean
  /** Without an intro, still settle the camera on the default view once (not over `?camera=`). */
  frameOnArrival: boolean
  levelCount: number
  context: SceneContext
  /** The saved opening view (viewer settings) the page settles into; null for the template's. */
  opening?: OpeningView | null
  now?: () => number
}) {
  const [playing, setPlaying] = useState(() => enabled && !played)
  const sequence = useRef<IntroSequence | null>(null)
  const skipped = useRef(false)
  const latest = useRef({ levelCount, context, now })
  latest.current = { levelCount, context, now }
  // The view the page arrives on is the one it opened with, whatever a manager changes meanwhile.
  const arrival = useRef(opening).current

  useEffect(() => {
    // Without an intro: the settled default view, placed at once behind the loader; over a
    // `?camera=` link the camera is already where the link puts it.
    if (playing) return
    const read = () => latest.current.context
    settleOpeningMode(arrival, read, () => {
      if (frameOnArrival) frameSettled(read, latest.current.levelCount, undefined, { instant: true, onPlaced: markStaged, opening: arrival })
      else markStaged()
    })
    // Once, on arrival.
  }, [])

  useEffect(() => {
    if (!playing) return
    played = true
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
      finishIntro(latest.current.levelCount, () => latest.current.context, { instant: !isPresented(), onPlaced: markStaged, opening: arrival })
      setPlaying(false)
      return
    }
    let frame = 0
    let intro: IntroSequence | null = null
    let stage: ReturnType<typeof startIntro> = null
    let waited = 0
    let cameraHeld = true
    const finish = () => {
      // Played out: settle from where the orbit ended. Skipped: settle from here. Taken over by
      // the visitor: the camera is theirs.
      finishIntro(latest.current.levelCount, () => latest.current.context, {
        stage: skipped.current ? null : stage,
        frame: cameraHeld,
        // Ended before it was ever shown (no bounds): the settled view goes straight on screen.
        instant: !isPresented(),
        onPlaced: markStaged,
        opening: arrival,
      })
      setPlaying(false)
    }
    const release = () => {
      cameraHeld = false
      intro?.releaseCamera()
    }
    const canvas = document.querySelector('canvas')
    canvas?.addEventListener('pointerdown', release)
    canvas?.addEventListener('wheel', release, { passive: true })
    canvas?.addEventListener('touchstart', release, { passive: true })
    const tick = () => {
      if (skipped.current && !intro) {
        finish()
        return
      }
      if (!stage) {
        // A bake reports its objects a frame or two after it is drawn: wait up to a second for
        // the model's bounds, then give up and open on the end state.
        stage = startIntro(latest.current.context, latest.current.levelCount, arrival)
        if (!stage) {
          if (++waited > 60) finish()
          else frame = requestAnimationFrame(tick)
          return
        }
        // The start state goes on screen first: the plane below the model and the intro camera,
        // placed at once. The loader lifts once that has been drawn; then the reveal begins.
        applyIntroFrame(stage, { reveal: 0, orbit: 0 }, true)
        markStaged()
      }
      if (!intro) {
        if (!isPresented() && !skipped.current) {
          frame = requestAnimationFrame(tick)
          return
        }
        intro = new IntroSequence({ now: steadyClock(latest.current.now) })
        sequence.current = intro
        intro.start()
      }
      const next = intro!.frame()
      if (next.done) {
        finish()
        return
      }
      applyIntroFrame(stage, next)
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(frame)
      canvas?.removeEventListener('pointerdown', release)
      canvas?.removeEventListener('wheel', release)
      canvas?.removeEventListener('touchstart', release)
      sequence.current = null
    }
  }, [playing])

  return {
    playing,
    /** Ends the intro now, in its end state. */
    skip: () => {
      skipped.current = true
      sequence.current?.skip()
    },
  }
}
