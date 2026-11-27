import { isTypingTarget, useViewer } from '@pascal-app/viewer'
import { useIsMobile } from '@pascal-app/viewer/ui'
import { X } from 'lucide-react'
import { useEffect } from 'react'
import { AnimationsPanel } from '../animation/AnimationsTab'

/**
 * The build animations, on their own: docked on the right edge, opened by the mode dock's Animate
 * button (a bottom sheet on phones). Scene, look and light settings live in the Settings panel instead.
 */
export function AnimationStudio({ open, onOpenChange, ready }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The scene is on screen: a build can be measured. */
  ready: boolean
}) {
  const isMobile = useIsMobile()
  const walkthroughMode = useViewer((s) => s.walkthroughMode)

  useEffect(() => {
    if (!open || walkthroughMode) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !isTypingTarget(event.target)) onOpenChange(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, walkthroughMode, onOpenChange])

  if (!open || walkthroughMode) return null

  const panel = (
    <section
      aria-label="Animations"
      className={
        isMobile
          ? 'corner-smooth studio-hud-light relative z-10 mx-3 mb-3 flex max-h-[70dvh] w-full flex-col overflow-hidden rounded-[20px]'
          : 'corner-smooth studio-hud-light pointer-events-auto absolute top-1/2 right-4 z-40 flex max-h-[calc(100dvh-10rem)] w-[340px] max-w-[calc(100vw-2rem)] -translate-y-1/2 flex-col overflow-hidden rounded-[20px]'
      }
      data-animation-studio="open"
    >
      <div className="flex shrink-0 items-center justify-between gap-2 border-[var(--glass-border)] border-b px-4 py-2.5">
        <span className="font-semibold text-[13px] text-[var(--glass-ink)]">Animations</span>
        <button
          aria-label="Close animations"
          className="studio-interactive flex size-8 shrink-0 items-center justify-center rounded-full text-[var(--glass-muted)] transition-colors hover:bg-[var(--glass-bg-hover)] hover:text-[var(--glass-ink)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--glass-accent)]"
          onClick={() => onOpenChange(false)}
          title="Close animations"
          type="button"
        >
          <X className="size-4" />
        </button>
      </div>
      <AnimationsPanel ready={ready} />
    </section>
  )

  if (isMobile) {
    return (
      <div className="fixed inset-0 z-50 flex items-end">
        <button
          aria-label="Close animations"
          className="absolute inset-0 bg-slate-950/20 backdrop-blur-[2px]"
          onClick={() => onOpenChange(false)}
          type="button"
        />
        {panel}
      </div>
    )
  }

  return panel
}
