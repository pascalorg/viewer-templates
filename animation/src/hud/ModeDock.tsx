import { useViewer } from '@pascal-app/viewer'
import { playSound } from '@pascal-app/viewer/sfx'
import type { ViewerStageMode } from '@pascal-app/viewer/ui'
import { Clapperboard, Orbit, Sparkles } from 'lucide-react'
import { useRenderStore } from '../animation/render'
import { useAnimationStore } from '../animation/store'
import { ViewMenu } from './ViewMenu'

/** Tiny circular progress ring shown around the Animate icon while a build plays. */
function ProgressRing({ progress }: { progress: number }) {
  const r = 9
  const c = 2 * Math.PI * r
  const offset = c * (1 - Math.max(0, Math.min(1, progress)))
  return (
    <svg aria-hidden className="pointer-events-none absolute -inset-1 size-[24px] -rotate-90" viewBox="0 0 24 24">
      <circle cx="12" cy="12" fill="none" r={r} stroke="rgb(38 73 196 / 0.18)" strokeWidth="2" />
      <circle
        cx="12"
        cy="12"
        fill="none"
        r={r}
        stroke="currentColor"
        strokeDasharray={c}
        strokeDashoffset={offset}
        strokeLinecap="round"
        strokeWidth="2"
      />
    </svg>
  )
}

export function ModeDock({ animateOpen, onOpenAnimate, stageMode, onStageModeChange, hasFloorplan, showModes, canRender }: {
  animateOpen: boolean
  onOpenAnimate: () => void
  stageMode: ViewerStageMode
  onStageModeChange: (mode: ViewerStageMode) => void
  /** The 2D plan can be drawn, so the 3D / 2D / Split menu shows. */
  hasFloorplan: boolean
  /** Orbit and Animate: 3D only, and not with hideBottomBar. */
  showModes: boolean
  /** The scene is on screen: a build can be rendered to video. */
  canRender: boolean
}) {
  const walkthroughMode = useViewer((s) => s.walkthroughMode)

  const animStatus = useAnimationStore((s) => s.status)
  const animTime = useAnimationStore((s) => s.time)
  const animDuration = useAnimationStore((s) => s.duration)

  if (walkthroughMode) return null
  if (!showModes && !hasFloorplan) return null

  const animRunning = animStatus === 'playing' || animStatus === 'paused'
  const animProgress = animDuration > 0 ? Math.min(1, animTime / animDuration) : 0
  const animateHighlighted = animateOpen || animRunning
  const orbitActive = !walkthroughMode && !animateHighlighted



  const segmentClass = (active: boolean) =>
    `studio-interactive inline-flex h-10 items-center gap-1.5 sm:gap-2 rounded-full px-2.5 sm:px-3.5 text-[13px] font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--glass-accent)] active:scale-[0.98] ${
      active
        ? 'bg-[var(--glass-accent)] text-white shadow-xs'
        : 'text-[var(--glass-ink)]/85 hover:bg-[var(--glass-bg-hover)] hover:text-[var(--glass-ink)]'
    }`

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-4 z-30 flex justify-center px-14 sm:px-4">
      <div className="flex max-w-full items-center gap-2">
        {hasFloorplan && <ViewMenu onStageModeChange={onStageModeChange} stageMode={stageMode} />}

        {showModes && (<>
        {/* Primary switch: Orbit (free camera) or Animate (the build animations) */}
        <div className="studio-hud-light pointer-events-auto flex items-center gap-0.5 rounded-full p-1" role="toolbar" aria-label="Viewer modes">
          <button
            aria-label="Orbit"
            aria-pressed={orbitActive}
            className={segmentClass(orbitActive)}
            onClick={() => {
              playSound('menuClick')
              // Orbit is the free camera: it closes the animations panel.
              if (animateOpen) onOpenAnimate()
            }}
            type="button"
          >
            <Orbit aria-hidden className="size-4 shrink-0" />
            <span className="hidden sm:inline">Orbit</span>
          </button>

          <button
            aria-label={animRunning ? 'Animate: Playing' : 'Animate'}
            aria-pressed={animateHighlighted}
            className={segmentClass(animateHighlighted)}
            onClick={() => {
              playSound('menuClick')
              onOpenAnimate()
            }}
            type="button"
          >
            <span className="relative flex size-4 shrink-0 items-center justify-center">
              {animRunning && <ProgressRing progress={animProgress} />}
              <Sparkles aria-hidden className="size-4" />
            </span>
            <span>Animate</span>
          </button>
        </div>

        {/* Render: a build animation to an MP4, every frame. */}
        <div className="studio-hud-light pointer-events-auto flex items-center rounded-full p-1">
          <button
            aria-label="Render video"
            className={`${segmentClass(false)} disabled:pointer-events-none disabled:opacity-40`}
            disabled={!canRender}
            onClick={() => {
              playSound('menuClick')
              useRenderStore.getState().openDialog()
            }}
            title="Render an animation to a video"
            type="button"
          >
            <Clapperboard aria-hidden className="size-4 shrink-0" />
            <span className="hidden sm:inline">Render</span>
          </button>
        </div>
        </>)}
      </div>
    </div>
  )
}
