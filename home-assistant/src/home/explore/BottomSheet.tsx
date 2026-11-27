import { X } from 'lucide-react'
import { type PointerEvent, type ReactNode, useEffect, useRef, useState } from 'react'

/**
 * Mobile bottom sheet with a swipe-down drag handle, click-outside backdrop dismissal, Escape
 * support (handled by parent/shortcuts), and focus restoration to the opening trigger.
 */
export function BottomSheet({ open, title, eyebrow, onClose, children }: {
  open: boolean
  title: string
  eyebrow?: string
  onClose: () => void
  children: ReactNode
}) {
  const closeRef = useRef<HTMLButtonElement>(null)
  const previousFocus = useRef<HTMLElement | null>(null)
  const dragStartY = useRef<number | null>(null)
  const [dragOffset, setDragOffset] = useState(0)

  useEffect(() => {
    if (!open) return
    setDragOffset(0)
    previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    closeRef.current?.focus({ preventScroll: true })
    return () => {
      previousFocus.current?.focus({ preventScroll: true })
    }
  }, [open])

  if (!open) return null

  const onHandlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    // A press on the close button isn't a drag: capturing the pointer here would retarget its
    // click to the handle, and the button would never close the sheet.
    if ((event.target as Element).closest('button')) return
    dragStartY.current = event.clientY
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const onHandlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (dragStartY.current === null) return
    const delta = Math.max(0, event.clientY - dragStartY.current)
    setDragOffset(delta)
  }

  const onHandlePointerUp = (event: PointerEvent<HTMLDivElement>) => {
    if (dragStartY.current === null) return
    const delta = event.clientY - dragStartY.current
    dragStartY.current = null
    if (delta >= 56) onClose()
    else setDragOffset(0)
  }

  return (
    // The overlay it renders in is `pointer-events-none`; without `auto` here every tap (the close
    // button, the backdrop, the sheet's own controls) falls through to the 3D canvas.
    <div
      aria-label={title}
      aria-modal="true"
      className="pointer-events-auto fixed inset-0 z-50 flex flex-col justify-end"
      role="dialog"
    >
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-black/28 backdrop-blur-[2px]"
        onClick={onClose}
      />
      <div
        className="ui-glass relative z-10 flex max-h-[76dvh] flex-col rounded-t-3xl text-foreground transition-transform duration-150 ease-out"
        style={{
          paddingBottom: 'max(1rem, env(safe-area-inset-bottom))',
          transform: dragOffset > 0 ? `translateY(${dragOffset}px)` : undefined,
        }}
      >
        <div
          className="flex cursor-grab touch-none flex-col items-center px-4 pt-2.5 pb-3 active:cursor-grabbing"
          onPointerCancel={onHandlePointerUp}
          onPointerDown={onHandlePointerDown}
          onPointerMove={onHandlePointerMove}
          onPointerUp={onHandlePointerUp}
        >
          <span aria-hidden="true" className="mb-2.5 h-1 w-10 rounded-full bg-foreground/20" />
          <div className="flex w-full items-center justify-between gap-3">
            <div className="min-w-0">
              {eyebrow ? <p className="ui-eyebrow">{eyebrow}</p> : null}
              <h2 className="truncate font-normal text-lg tracking-[-0.02em]">{title}</h2>
            </div>
            <button
              aria-label={`Close ${title.toLowerCase()}`}
              className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-accent/70 hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2"
              onClick={onClose}
              ref={closeRef}
              type="button"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
        <div className="ui-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain border-foreground/10 border-t px-4 pt-3">
          {children}
        </div>
      </div>
    </div>
  )
}
