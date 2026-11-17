import { createWalkthroughInput, useViewer } from '@pascal-app/viewer'
import { useFirstPersonHud } from '@pascal-app/viewer/ui'
import { type PointerEvent, useEffect, useRef } from 'react'
import { Icon } from './icons'
import { cue } from './sounds'

/**
 * The walkthrough, /next's way: walk 1.8 m/s and 2.8 m/s with Shift, targets named from 16 m.
 * One place for the numbers and the copy (they are /next's own).
 */
export const WALK_SPEEDS = { walk: 1.8, run: 2.8 } as const
/** How far the centre ray names what it sees (/next's range); activation keeps the package's reach. */
export const SEE_DISTANCE = 16
const COPY = {
  comeCloser: 'Come a little closer',
  jump: 'Jump',
  leave: 'Return to view',
  // The package's own words for its two extra actions.
  shutters: 'Shutters',
  close: 'Close',
} as const

/** "open", "turn off" → "Open", "Turn off", as /next's action button reads. */
const capitalise = (verb: string) => verb.charAt(0).toUpperCase() + verb.slice(1)

/**
 * The walkthrough HUD over the canvas: our centre dot (with /next's ready halo when something is in
 * reach), the target's name beside it ("Come a little closer" when it is seen but too far), the
 * action and Jump buttons bottom right, and Return to view at the top. Two more actions show while
 * the package offers them: Shutters (`F`, a baked window with shutters in reach) and Close (`T`, a
 * live door, window or mechanism in reach). Keycaps show for a keyboard; on touch the buttons act on
 * press, so a thumb can walk while the other jumps or opens a door. No crouch button, as on /next.
 */
export function WalkHud() {
  const interact = useFirstPersonHud((state) => state.interact)
  const seen = useFirstPersonHud((state) => state.seenInteract)
  const shuttersInView = useFirstPersonHud((state) => state.shuttersInView)
  const canClose = useFirstPersonHud((state) => state.canClose)
  const touch = useViewer((state) => state.walkthroughInputMode === 'touch')
  const target = interact ?? seen
  // A tick when the centre comes to rest on a new target, as /next's walk does.
  const lastTarget = useRef<string | null>(null)
  useEffect(() => {
    const key = target ? `${target.label}|${interact ? 'reach' : 'seen'}` : null
    if (key && target && lastTarget.current?.split('|')[0] !== target.label) cue('hover')
    lastTarget.current = key
  }, [target, interact])

  const input = createWalkthroughInput()
  /**
   * The controllers read the touch channel only in touch mode; with a keyboard they listen for the
   * keys, so a click on a button presses its key (the cursor is free when pointer lock failed).
   */
  const press = (code: string, key: string) => {
    document.dispatchEvent(new KeyboardEvent('keydown', { code, key, bubbles: true }))
    setTimeout(() => document.dispatchEvent(new KeyboardEvent('keyup', { code, key, bubbles: true })), 120)
  }
  const interactNow = () => (touch ? input.requestInteract() : press('KeyE', 'e'))
  const jumpNow = () => (touch ? input.requestJump() : press('Space', ' '))
  const shuttersNow = () => (touch ? input.requestShutters() : press('KeyF', 'f'))
  const closeNow = () => (touch ? input.requestClose() : press('KeyT', 't'))
  /** Touch acts on press (a second finger while the other walks); a mouse acts on click. */
  const act = (run: () => void) => touch
    ? { onPointerDown: (event: PointerEvent) => { event.stopPropagation(); event.preventDefault(); run() } }
    : { onClick: run }
  const leave = () => useViewer.getState().setWalkthroughMode(false)

  return (
    <div className="sc-walk" data-touch={touch} data-walkthrough-hud="">
      <span aria-hidden="true" className="sc-walk-dot" data-ready={!!interact} />
      {target && (
        <div className="sc-walk-target" role="status">
          <span>{target.label}</span>
          {!interact && <small>{COPY.comeCloser}</small>}
        </div>
      )}
      <div className="sc-walk-actions">
        {interact && (
          <button aria-label={`${capitalise(interact.verb)} ${interact.label}`} className="sc-glass sc-walk-action" data-walk-interact="" type="button"
            {...act(interactNow)}>
            <Icon name={/open|close/i.test(interact.verb) ? 'door' : 'spark'} /><span>{capitalise(interact.verb)}</span><kbd>E</kbd>
          </button>
        )}
        {shuttersInView && (
          <button className="sc-glass sc-walk-action" data-walk-shutters="" type="button" {...act(shuttersNow)}>
            <Icon name="shutters" /><span>{COPY.shutters}</span><kbd>F</kbd>
          </button>
        )}
        {canClose && (
          <button className="sc-glass sc-walk-action" data-walk-close="" type="button" {...act(closeNow)}>
            <Icon name="door" /><span>{COPY.close}</span><kbd>T</kbd>
          </button>
        )}
        <button aria-label={COPY.jump} className="sc-glass sc-walk-jump" title={`${COPY.jump} · Space`} type="button" {...act(jumpNow)}>
          <Icon name="jump" /><span>{COPY.jump}</span><kbd>Space</kbd>
        </button>
      </div>
      <button className="sc-glass sc-walk-leave" type="button" {...act(leave)}>
        <Icon name="arrow" /><span>{COPY.leave}</span><kbd>Esc</kbd>
      </button>
    </div>
  )
}
