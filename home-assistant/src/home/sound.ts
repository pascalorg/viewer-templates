import { playSound, preloadSounds, type SoundDefinition, useAudioSettings } from '@pascal-app/viewer/sfx'
import { useEffect } from 'react'

/**
 * The interface's sounds: Pascal's own short cues, played quietly, and only for what the visitor
 * does in this browser. Nothing plays when Home Assistant reports a change, so a light switched from
 * a phone or another tablet is silent here: the sound stays on the device that was touched.
 *
 * Volume and mute are Pascal's shared audio settings (`useAudioSettings`), so they follow the
 * visitor's choice everywhere Pascal plays sound.
 */

/** A soft tick for buttons, rows and tabs: Pascal's menu click, well under its own level. */
const TAP: SoundDefinition = { src: 'menu_click.mp3', rateRange: [0.99, 1.01], volumeRange: [0.5, 0.55], minIntervalMs: 60 }
/** How loud each cue plays against Pascal's own level: quiet, never in the way. */
const LEVEL = { tap: 0.35, switch: 0.6, pick: 0.7 }

/** What makes a sound when clicked. A canvas click is the plan's own (`playPick`). */
const CLICKABLE = 'button, a[href], summary, [role="button"], [role="switch"], [role="radio"], [role="tab"], [role="menuitem"], [role="option"], input[type="checkbox"], input[type="radio"]'

/** Which cue a click on this element plays, read before the click changes it. */
function cueOf(el: Element): [cue: 'switchOn' | 'switchOff' | typeof TAP, level: number] {
  const toggle = el.getAttribute('role') === 'switch' || (el instanceof HTMLInputElement && el.type === 'checkbox')
  if (!toggle) return [TAP, LEVEL.tap]
  const on = el instanceof HTMLInputElement ? el.checked : el.getAttribute('aria-checked') === 'true'
  return [on ? 'switchOff' : 'switchOn', LEVEL.switch]
}

/**
 * Plays the interface's sounds for the visitor's own clicks and key presses on buttons, switches and
 * links: never for a click a script makes, nor for anything Home Assistant changes.
 */
export function useUiSounds() {
  useEffect(() => {
    preloadSounds([TAP])
    // The audio engine starts on the visitor's first press and reloads its sounds then: warm them on
    // the press, so the click that follows it is heard rather than dropped while they load.
    const warm = () => preloadSounds([TAP])
    const onClick = (e: MouseEvent) => {
      // the visitor's own input only (a keyboard Enter or Space on a button counts)
      if (!e.isTrusted) return
      const el = (e.target as Element | null)?.closest?.(CLICKABLE)
      if (!el || el.closest('[data-silent]')) return
      if (el.matches(':disabled') || el.getAttribute('aria-disabled') === 'true') return
      const [cue, level] = cueOf(el)
      playSound(cue, { source: 'local', volumeMultiplier: level })
    }
    // in the capture phase: before React updates a switch, so its state is still the one clicked
    addEventListener('pointerdown', warm, true)
    addEventListener('click', onClick, true)
    return () => {
      removeEventListener('pointerdown', warm, true)
      removeEventListener('click', onClick, true)
    }
  }, [])
}

/** A piece of furniture picked on the plan, or let go. */
export function playPick(picked: boolean) {
  playSound(picked ? 'viewerSelect' : 'viewerDeselect', { source: 'local', volumeMultiplier: LEVEL.pick })
}

/** Whether this tab plays sounds, and the switch for it (Pascal's own mute). */
export function useSoundsOn(): [boolean, (on: boolean) => void] {
  const muted = useAudioSettings((s) => s.muted)
  const setMuted = useAudioSettings((s) => s.setMuted)
  return [!muted, (on) => setMuted(!on)]
}
