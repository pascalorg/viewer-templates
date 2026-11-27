import { useAnimationStore } from './store'

/** A template's title card (a room's name, the time of day), centred near the top of the scene. */
export function AnimationCaption() {
  const caption = useAnimationStore((s) => s.caption)
  if (!caption) return null
  return (
    <div aria-live="polite" className="pointer-events-none absolute inset-x-0 top-[15%] z-30 flex justify-center px-4 sm:top-[16%]">
      <div
        className="anim-caption corner-smooth studio-hud-light flex max-w-[min(28rem,calc(100vw-2rem))] flex-col items-center rounded-2xl px-6 py-3 text-center"
        key={caption.key}
      >
        <span aria-hidden className="mb-2 h-[2px] w-7 rounded-full bg-[var(--glass-accent)]" />
        <span className="font-medium text-2xl text-[var(--glass-ink)] leading-[1.08] tracking-[-0.025em] sm:text-4xl">
          {caption.title}
        </span>
        {caption.sub ? (
          <span className="mt-1.5 font-medium font-mono text-[11px] text-[var(--glass-muted)] uppercase tracking-[0.18em] tabular-nums">
            {caption.sub}
          </span>
        ) : null}
      </div>
    </div>
  )
}
