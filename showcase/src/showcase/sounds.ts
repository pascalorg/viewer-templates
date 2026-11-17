import { playSound, preloadSounds } from '@pascal-app/viewer/sfx'
import { useEffect } from 'react'

/**
 * /next's interface sounds, on the cues the viewer package ships (modelled on /next's "Minimal"
 * kit): a light tick when the pointer reaches a control or the room under it changes, a click
 * when a control is pressed or an item's callout pins, a soft fall when the callout is dismissed.
 * `playSound` honours the sound toggle and rate-limits each cue (hover 95 ms, select 90 ms, as
 * /next does); nothing plays before the visitor's first gesture.
 */
export type Cue = 'hover' | 'select' | 'dismiss'
const SOUND = { hover: 'viewerHover', select: 'viewerSelect', dismiss: 'viewerDeselect' } as const

function activated() {
  return globalThis.navigator?.userActivation?.hasBeenActive ?? false
}

export function cue(kind: Cue) {
  if (activated()) playSound(SOUND[kind])
}

/** What counts as a control, as on /next; disabled controls and the sound toggle stay silent. */
const CONTROL = 'button:not(:disabled), a[href], input[type="range"], [role="button"]'
const SILENT = '[disabled], [aria-disabled="true"], [inert], [hidden], [data-sound-toggle]'
/** Controls with sounds of their own: the callout's pills and dismiss, the walk's action and Jump. */
const OWN_SOUND = '.sc-zone-action, .sc-zone-dismiss, .sc-walk-action, .sc-walk-jump'
const NAVIGATION_KEYS = new Set(['Tab', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'])

function controlOf(target: EventTarget | null) {
  const control = (target as Element | null)?.closest?.(CONTROL)
  return control && !control.closest(SILENT) ? control : null
}

/**
 * Hover and press cues for every control in the chrome: the dial (views, times of day, reset,
 * layers), the top bar, the phone bar, the cut controls, help. A hover ticks once per control
 * entered (moving within it stays quiet); keyboard focus moves tick like hovers.
 */
export function useChromeSounds(root: HTMLElement | null) {
  useEffect(() => preloadSounds(), [])
  useEffect(() => {
    if (!root) return
    let keyboard = false
    let pressedAt = -Infinity
    const over = (event: PointerEvent) => {
      if (event.pointerType === 'touch') return
      const control = controlOf(event.target)
      if (control && !control.contains(event.relatedTarget as Node | null)) cue('hover')
    }
    const key = (event: KeyboardEvent) => { keyboard = NAVIGATION_KEYS.has(event.key) }
    const pointer = () => { keyboard = false }
    const focus = (event: FocusEvent) => {
      // Focus that follows a press is the press itself; only keyboard navigation ticks.
      if (!keyboard || performance.now() - pressedAt < 180) return
      if (controlOf(event.target)) cue('hover')
    }
    const click = (event: MouseEvent) => {
      if (!event.isTrusted || event.button !== 0) return
      const control = controlOf(event.target)
      if (!control || control.matches(OWN_SOUND)) return
      pressedAt = performance.now()
      cue('select')
    }
    root.addEventListener('pointerover', over)
    root.addEventListener('focusin', focus)
    root.addEventListener('click', click)
    addEventListener('keydown', key, true)
    addEventListener('pointerdown', pointer, true)
    return () => {
      root.removeEventListener('pointerover', over)
      root.removeEventListener('focusin', focus)
      root.removeEventListener('click', click)
      removeEventListener('keydown', key, true)
      removeEventListener('pointerdown', pointer, true)
    }
  }, [root])
}
