import { type MouseEvent, useEffect, useId, useRef, useState } from 'react'
import { GestureIcon, type GestureName } from './gesture-icons'

// Ported from Pascal's /next demo (MIT). The content lists the Pascal viewer's own bindings:
// the showcase's orbit bindings (`camera.ts`) and the walkthrough controllers in `@pascal-app/viewer`.

type Gesture = [GestureName, string, string]

const ORBIT: Record<'mouse' | 'touch', Gesture[]> = {
  mouse: [
    ['mouse-rotate', 'Rotate', 'Left drag'],
    ['mouse-pan', 'Pan', 'Right drag'],
    ['mouse-zoom', 'Zoom', 'Scroll wheel'],
    ['mouse-select', 'Select', 'Click'],
  ],
  touch: [
    ['touch-rotate', 'Rotate', '1 finger'],
    ['touch-pan', 'Pan', '2 fingers'],
    ['touch-zoom', 'Zoom', 'Pinch'],
    ['tap', 'Select', 'Tap'],
  ],
}
const ORBIT_NOTE = { mouse: 'Or hold Shift and drag to pan.', touch: null }

// Walking by touch: the package's stick (left half) and look (right half), the walk HUD's buttons.
// /next's copy, except Interact: the package acts from the action button, not a tap on the object.
const WALK_TOUCH: Gesture[] = [
  ['joystick', 'Move', 'Drag left side'],
  ['touch-rotate', 'Look', 'Drag right side'],
  ['tap', 'Interact', 'Tap the action button'],
  ['tap', 'Shutters or Close', 'Tap the button when it shows'],
  ['tap-jump', 'Jump', 'Tap jump'],
  ['tap-exit', 'Leave', 'Return to view'],
]

// /next's walk keys, with Shift to go faster (1.8 → 2.8 m/s) and the package's crouch and free cursor.
const WALK: Gesture[] = [
  ['keys', 'Move', 'W A S D'],
  ['look', 'Look', 'Mouse'],
  ['key:E', 'Interact', 'E'],
  ['key:F', 'Shutters', 'F'],
  ['key:T', 'Close', 'T'],
  ['jump', 'Jump', 'Space'],
  ['key:Shift', 'Go faster', 'Shift'],
  ['key:Ctrl', 'Crouch', 'Ctrl'],
  ['key:P', 'Free cursor', 'P'],
  ['key:Esc', 'Return to view', 'Esc'],
]

/** A guide beside its button on desktop; a modal sheet for touch and small screens. */
export function InteractionHelp({ open, onOpenChange, walking, mobile, touchWalk = false }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  walking: boolean
  mobile: boolean
  /** Touch help also explains walking by touch. */
  touchWalk?: boolean
}) {
  const id = useId()
  const trigger = useRef<HTMLButtonElement>(null)
  const dialog = useRef<HTMLDialogElement>(null)
  const closeButton = useRef<HTMLButtonElement>(null)
  const pointer = useRef<string | null>(null)
  const change = useRef(onOpenChange)
  change.current = onOpenChange
  const [input, setInput] = useState<'mouse' | 'touch'>('mouse')
  const [modal, setModal] = useState(false)
  const items = walking ? (input === 'touch' ? WALK_TOUCH : WALK) : ORBIT[input]
  const note = walking ? null : ORBIT_NOTE[input]
  const walkByTouch = !walking && input === 'touch' && touchWalk

  function dismiss(restoreFocus = true) {
    dialog.current?.close()
    change.current(false)
    if (restoreFocus) trigger.current?.focus({ preventScroll: true })
  }
  function toggle(event: MouseEvent<HTMLButtonElement>) {
    if (open) {
      dismiss()
      return
    }
    const touchDevice = matchMedia('(any-pointer: coarse)').matches || navigator.maxTouchPoints > 0
    // Safari can label the synthesized click as mouse after a touch pointerdown.
    const kind = event.detail === 0 ? null : pointer.current || (event.nativeEvent as PointerEvent).pointerType
    pointer.current = null
    setInput(kind ? (kind === 'mouse' ? 'mouse' : 'touch') : touchDevice ? 'touch' : 'mouse')
    setModal(touchDevice || mobile || innerWidth < 620)
    change.current(true)
  }

  useEffect(() => {
    if (!open) return
    const node = dialog.current!
    if (modal) {
      node.style.removeProperty('left')
      node.style.removeProperty('top')
      node.showModal()
    } else {
      node.show()
    }
    const position = () => {
      if (modal || !trigger.current) return
      const anchor = trigger.current.getBoundingClientRect()
      const panel = node.getBoundingClientRect()
      const below = anchor.bottom + 8
      const fitsBelow = below + panel.height <= innerHeight - 12
      const left = fitsBelow ? anchor.left : anchor.right + 10
      node.style.left = `${Math.max(12, Math.min(left, innerWidth - panel.width - 12))}px`
      node.style.top = `${Math.max(12, Math.min(fitsBelow ? below : anchor.top, innerHeight - panel.height - 12))}px`
    }
    position()
    closeButton.current?.focus({ preventScroll: true })
    const outside = (event: Event) => {
      const target = event.target as Node
      if (!modal && !node.contains(target) && !trigger.current?.contains(target)) dismiss(false)
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopImmediatePropagation()
      dismiss()
    }
    let frame = 0
    const resize = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(position)
    }
    const observer = new ResizeObserver(resize)
    observer.observe(node)
    if (trigger.current) observer.observe(trigger.current)
    document.addEventListener('pointerdown', outside)
    document.addEventListener('focusin', outside)
    addEventListener('keydown', escape, true)
    addEventListener('resize', resize)
    return () => {
      observer.disconnect()
      cancelAnimationFrame(frame)
      document.removeEventListener('pointerdown', outside)
      document.removeEventListener('focusin', outside)
      removeEventListener('keydown', escape, true)
      removeEventListener('resize', resize)
      node.close()
    }
  }, [open, modal])

  return (
    <div className="sc-help">
      <button aria-controls={id} aria-expanded={open} aria-haspopup="dialog" aria-label="Help with controls" className="sc-help-toggle"
        onClick={toggle} onPointerDown={(event) => { pointer.current = event.pointerType }} ref={trigger} type="button">
        <svg aria-hidden="true" fill="none" focusable="false" stroke="currentColor" strokeLinecap="round" strokeWidth="1.7" viewBox="0 0 24 24">
          <path d="M8.6 8a3.5 3.5 0 0 1 6.8 1.1c0 2.6-3.4 2.5-3.4 5" /><circle cx="12" cy="18" fill="currentColor" r=".9" stroke="none" />
        </svg>
        <span className="sc-help-label">Help</span>
      </button>
      <dialog aria-labelledby={`${id}-title`} aria-modal={modal ? true : undefined} className="sc-help-panel" data-input={input}
        data-modal={modal} data-walking={walking} id={id} ref={dialog}
        onCancel={(event) => { event.preventDefault(); dismiss() }}
        onClick={(event) => {
          if (!modal || event.target !== event.currentTarget) return
          const rect = event.currentTarget.getBoundingClientRect()
          if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dismiss()
        }}>
        {open && <>
          <div className="sc-help-heading">
            <h2 id={`${id}-title`}>{walking ? 'Walkthrough' : input === 'touch' ? 'Touch controls' : 'Mouse controls'}</h2>
            <button aria-label="Close help" className="sc-help-close" onClick={() => dismiss()} ref={closeButton} type="button">
              <svg aria-hidden="true" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.6" viewBox="0 0 24 24"><path d="m7 7 10 10M17 7 7 17" /></svg>
            </button>
          </div>
          <ul className="sc-help-gestures">
            {items.map(([icon, label, hint]) => (
              <li key={label}><GestureIcon name={icon} /><strong>{label}</strong><span>{hint}</span></li>
            ))}
          </ul>
          {note && <p className="sc-help-note">{note}</p>}
          {walkByTouch && <>
            <h3 className="sc-help-subheading">Walkthrough</h3>
            <ul className="sc-help-gestures" data-walk-touch>
              {WALK_TOUCH.map(([icon, label, hint]) => (
                <li key={label}><GestureIcon name={icon} /><strong>{label}</strong><span>{hint}</span></li>
              ))}
            </ul>
          </>}
        </>}
      </dialog>
    </div>
  )
}
