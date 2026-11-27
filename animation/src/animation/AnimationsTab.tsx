import { useViewer } from '@pascal-app/viewer'
import { Camera, Pause, Play, RotateCcw, Sparkles, Square } from 'lucide-react'
import { type CSSProperties, type ReactNode, useEffect } from 'react'
import { useAnimationStore } from './store'
import { type AnimationTemplate, TEMPLATES, type TemplateId } from './templates'

/**
 * Build animation controls rendered inside the Inspector's Animate tab, plus the lifecycle hook
 * (`useAnimationLifecycle`) that keeps walkthrough handoff and `?animation=<template>` active
 * even while the Inspector drawer is closed.
 */

const SPEEDS = [0.5, 1, 2] as const

/** Keeps walkthrough stop-on-enter and `?animation=<template>` autoplay active at the HUD root. */
export function useAnimationLifecycle(ready: boolean) {
  const status = useAnimationStore((s) => s.status)
  const walkthrough = useViewer((s) => s.walkthroughMode)
  const running = status === 'playing' || status === 'paused'

  // A walkthrough owns the screen and the camera: a build in progress steps aside.
  useEffect(() => {
    if (walkthrough && running) useAnimationStore.getState().stop()
  }, [walkthrough, running])

  // `?animation=<template>` plays that template once the scene is ready (handy for embeds).
  useEffect(() => {
    if (!ready) return
    const wanted = new URLSearchParams(window.location.search).get('animation') as TemplateId | null
    if (wanted && TEMPLATES.some((t) => t.id === wanted)) useAnimationStore.getState().select(wanted)
  }, [ready])
}

/** A tiny looping picture of each template, drawn in the card. */
function TemplateGlyph({ id, accent }: { id: TemplateId; accent: string }) {
  const common = { fill: 'none', stroke: accent, strokeWidth: 1.6, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }
  switch (id) {
    case 'blueprint':
      return (
        <svg aria-hidden className="anim-glyph" viewBox="0 0 40 28">
          <path {...common} className="anim-draw" d="M6 22 L6 12 L20 4 L34 12 L34 22 Z M14 22 L14 15 L20 15 L20 22 M24 14 L30 14 L30 18 L24 18 Z" />
        </svg>
      )
    case 'timelapse':
      return (
        <svg aria-hidden className="anim-glyph" viewBox="0 0 40 28">
          <path {...common} d="M4 24 H36" />
          <path {...common} d="M10 24 V8 H32 M30 8 V12" />
          <rect className="anim-tilt" fill={accent} height="2.5" opacity="0.85" rx="0.6" width="10" x="20" y="21.5" />
          <rect fill={accent} height="9" opacity="0.5" rx="0.6" width="2.5" x="14" y="15" />
        </svg>
      )
    case 'skydrop':
      return (
        <svg aria-hidden className="anim-glyph" viewBox="0 0 40 28">
          <path {...common} d="M4 25 H36" />
          <rect className="anim-fall" fill={accent} height="6" rx="1" width="9" x="15.5" y="2" />
          <rect fill={accent} height="5" opacity="0.5" rx="1" width="9" x="6" y="20" />
          <rect fill={accent} height="5" opacity="0.5" rx="1" width="9" x="25" y="20" />
        </svg>
      )
    case 'magnetic':
      return (
        <svg aria-hidden className="anim-glyph" viewBox="0 0 40 28">
          <rect className="anim-snap-a" fill={accent} height="7" opacity="0.9" rx="1" width="7" x="12" y="11" />
          <rect className="anim-snap-b" fill={accent} height="7" opacity="0.6" rx="1" width="7" x="21" y="11" />
          <rect className="anim-snap-c" fill={accent} height="5" opacity="0.4" rx="1" width="16" x="12" y="5" />
        </svg>
      )
    case 'tornado':
      return (
        <svg aria-hidden className="anim-glyph" viewBox="0 0 40 28">
          <path {...common} d="M8 4 H32 M11 9 H29 M14 14 H26 M17 19 H23 M19 24 H21" opacity="0.7" />
          <rect className="anim-orbit" fill={accent} height="3.5" rx="0.6" width="3.5" x="28" y="5" />
        </svg>
      )
    case 'popup':
      return (
        <svg aria-hidden className="anim-glyph" viewBox="0 0 40 28">
          <path {...common} d="M4 25 L20 22 L36 25 M20 22 V24.5" />
          <path className="anim-popup" d="M13 22 V14 L20 8 L27 14 V22 Z" fill={accent} opacity="0.75" />
        </svg>
      )
    case 'rooms':
      return (
        <svg aria-hidden className="anim-glyph" viewBox="0 0 40 28">
          <rect {...common} height="20" width="30" x="5" y="4" />
          <path {...common} d="M20 4 V24 M5 14 H20" />
          <rect className="anim-room" fill={accent} height="9" opacity="0.6" width="14" x="6" y="5" />
        </svg>
      )
    case 'ripple':
      return (
        <svg aria-hidden className="anim-glyph" viewBox="0 0 40 28">
          <ellipse {...common} className="anim-ring" cx="20" cy="18" rx="16" ry="6" />
          <ellipse {...common} className="anim-ring anim-ring-2" cx="20" cy="18" rx="16" ry="6" />
          <rect fill={accent} height="7" rx="1" width="6" x="17" y="10" />
        </svg>
      )
  }
}

function glyphInk(accent: string) {
  return `color-mix(in oklab, ${accent} 76%, #0f172a)`
}

function TemplateCard({ template, active, onPick }: { template: AnimationTemplate; active: boolean; onPick: () => void }) {
  const ink = glyphInk(template.accent)
  const activeStyle: CSSProperties | undefined = active
    ? {
        background: 'color-mix(in oklab, var(--glass-accent) 7%, #ffffff)',
        borderColor: 'var(--glass-accent-border)',
        boxShadow: '0 1px 3px rgb(38 73 196 / 0.12)',
      }
    : undefined
  return (
    <button
      aria-pressed={active}
      className={`anim-card studio-interactive group flex min-h-[48px] items-center gap-2 rounded-xl border p-1.5 text-left transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--glass-accent)] active:scale-[0.98] ${
        active
          ? 'text-[var(--glass-ink)]'
          : 'border-[var(--glass-border)] bg-[var(--glass-raised-soft)] text-[var(--glass-ink)]/90 hover:border-[var(--glass-border-strong)] hover:bg-[var(--glass-raised)] hover:text-[var(--glass-ink)]'
      }`}
      data-template={template.id}
      onClick={onPick}
      style={activeStyle}
      title={template.tagline}
      type="button"
    >
      <span
        className="flex h-8 w-10 shrink-0 items-center justify-center rounded-lg border transition-colors"
        style={{
          color: ink,
          background: `color-mix(in oklab, ${template.accent} ${active ? 18 : 11}%, #f5f7fb)`,
          borderColor: `color-mix(in oklab, ${template.accent} ${active ? 32 : 18}%, rgb(15 23 42 / 0.08))`,
        }}
      >
        <TemplateGlyph accent="currentColor" id={template.id} />
      </span>
      <span className={`min-w-0 flex-1 truncate text-xs leading-tight tracking-[-0.005em] ${active ? 'font-semibold' : 'font-medium'}`}>
        {template.name}
      </span>
    </button>
  )
}

function formatTime(seconds: number) {
  return `${seconds.toFixed(1)}s`
}

function IconButton({ label, onClick, children, disabled, primary = false }: {
  label: string
  onClick: () => void
  children: ReactNode
  disabled?: boolean
  primary?: boolean
}) {
  const sizeClass = primary ? 'size-9' : 'size-8'
  const toneClass = primary
    ? 'bg-[var(--glass-ink)] text-white shadow-sm hover:bg-[#252932]'
    : 'text-[var(--glass-ink)]/80 hover:bg-[var(--glass-bg-hover)] hover:text-[var(--glass-ink)]'
  return (
    <button
      aria-label={label}
      className={`studio-interactive flex ${sizeClass} shrink-0 items-center justify-center rounded-full transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--glass-accent)] active:scale-95 disabled:pointer-events-none disabled:opacity-40 ${toneClass}`}
      disabled={disabled}
      onClick={onClick}
      title={label}
      type="button"
    >
      {children}
    </button>
  )
}

/** Build animation templates, camera framing sliders, and timeline transport for the Inspector's Animate tab. */
export function AnimationsPanel({ ready }: {
  /** The scene is on screen: the build can be measured. */
  ready: boolean
}) {
  const template = useAnimationStore((s) => s.template)
  const status = useAnimationStore((s) => s.status)
  const time = useAnimationStore((s) => s.time)
  const duration = useAnimationStore((s) => s.duration)
  const speed = useAnimationStore((s) => s.speed)
  const cinematic = useAnimationStore((s) => s.cinematic)
  const pieceCount = useAnimationStore((s) => s.pieceCount)
  const zoom = useAnimationStore((s) => s.zoom)
  const tilt = useAnimationStore((s) => s.tilt)
  // As far as the camera itself goes, so the sliders and the wheel or drag always agree.
  const zoomRange = useAnimationStore((s) => s.zoomRange)
  const tiltRange = useAnimationStore((s) => s.tiltRange)
  const zoomMin = Math.round(zoomRange[0] * 100)
  const zoomMax = Math.max(zoomMin + 1, Math.round(zoomRange[1] * 100))
  const zoomValue = Math.min(zoomMax, Math.max(zoomMin, Math.round(zoom * 100)))
  const tiltValue = Math.min(tiltRange[1], Math.max(tiltRange[0], tilt ?? 58))
  const share = (value: number, min: number, max: number) => `${((value - min) / Math.max(1, max - min)) * 100}%`
  const store = useAnimationStore.getState()
  const running = status === 'playing' || status === 'paused'
  const active = TEMPLATES.find((t) => t.id === template) ?? TEMPLATES[0]!
  const progress = duration > 0 ? Math.min(1, time / duration) : 0

  const playPause = status === 'playing' ? (
    <IconButton label="Pause" onClick={store.pause} primary>
      <Pause className="size-4" />
    </IconButton>
  ) : (
    <IconButton
      disabled={!ready}
      label={status === 'paused' ? 'Resume' : `Play ${active.name}`}
      onClick={store.play}
      primary
    >
      <Play className="size-4 translate-x-[0.5px]" />
    </IconButton>
  )

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="anim-strip flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span
              aria-hidden
              className="flex size-6 shrink-0 items-center justify-center rounded-lg bg-[var(--glass-accent-soft)] text-[var(--glass-accent)]"
            >
              <Sparkles className="size-3.5" />
            </span>
            <span className="font-semibold text-[11px] text-[var(--glass-muted)] uppercase tracking-[0.12em]">
              Build templates
            </span>
            {status === 'playing' && (
              <span aria-hidden className="anim-live-dot size-1.5 shrink-0 rounded-full bg-[var(--glass-accent)]" />
            )}
          </div>
          {pieceCount > 0 && (
            <span className="rounded-full bg-[var(--glass-bg-subtle)] px-2 py-0.5 font-mono text-[11px] text-[var(--glass-muted)] tabular-nums">
              {pieceCount} pieces
            </span>
          )}
        </div>

        <div className="grid grid-cols-2 gap-2">
          {TEMPLATES.map((t) => (
            <TemplateCard active={t.id === template} key={t.id} onPick={() => ready && store.select(t.id)} template={t} />
          ))}
        </div>

        <div className="flex items-start gap-2.5 rounded-xl border border-[var(--glass-border)] bg-[var(--glass-bg-subtle)] px-3 py-2.5">
          <span aria-hidden className="mt-0.5 h-7 w-[2.5px] shrink-0 rounded-full bg-[var(--glass-accent)]" />
          <p className="text-[var(--glass-muted)] text-xs leading-relaxed">
            <span className="font-semibold text-[var(--glass-ink)]">{active.name}.</span> {active.tagline}
          </p>
        </div>

        <div className="flex flex-col gap-2 rounded-2xl border border-[var(--glass-border)] bg-[var(--glass-raised-soft)] p-3">
          <div className="flex items-center justify-between gap-2">
            <span className="font-semibold text-[11px] text-[var(--glass-muted)] uppercase tracking-[0.12em]">Camera</span>
            <span className="text-[11px] text-[var(--glass-muted)]">{tiltRange[0]}° top · {tiltRange[1]}° low</span>
          </div>
          <label className="flex items-center gap-2.5 text-xs">
            <span className="w-9 shrink-0 font-medium text-[var(--glass-muted)]">Zoom</span>
            <input
              aria-label="Camera zoom"
              className="anim-scrub w-full cursor-pointer"
              max={zoomMax}
              min={zoomMin}
              onChange={(event) => store.setZoom(Number(event.target.value) / 100)}
              style={{ ['--anim-accent' as string]: active.accent, ['--anim-progress' as string]: share(zoomValue, zoomMin, zoomMax) }}
              type="range"
              value={zoomValue}
            />
            <span className="min-w-[3.25rem] shrink-0 rounded-full bg-[var(--glass-bg-subtle)] px-2 py-0.5 text-center font-mono text-[11px] text-[var(--glass-muted)] tabular-nums">
              {zoomValue}%
            </span>
          </label>
          <label className="flex items-center gap-2.5 text-xs">
            <span className="w-9 shrink-0 font-medium text-[var(--glass-muted)]">Tilt</span>
            <input
              aria-label="Camera tilt"
              className="anim-scrub w-full cursor-pointer"
              max={tiltRange[1]}
              min={tiltRange[0]}
              onChange={(event) => store.setTilt(Number(event.target.value))}
              style={{ ['--anim-accent' as string]: active.accent, ['--anim-progress' as string]: share(tiltValue, tiltRange[0], tiltRange[1]) }}
              type="range"
              value={tiltValue}
            />
            <button
              className={`studio-interactive min-w-[3.25rem] shrink-0 rounded-full border px-2 py-0.5 text-center font-mono text-[11px] tabular-nums transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--glass-accent)] ${
                tilt === null
                  ? 'border-transparent bg-[var(--glass-bg-subtle)] text-[var(--glass-muted)] hover:text-[var(--glass-ink)]'
                  : 'border-[var(--glass-accent-border)] bg-[var(--glass-accent-soft)] font-semibold text-[var(--glass-accent)] hover:bg-[rgb(38_73_196/0.16)]'
              }`}
              onClick={() => store.setTilt(null)}
              title={tilt === null ? 'Each template picks its own tilt' : 'Back to each template’s own tilt'}
              type="button"
            >
              {tilt === null ? 'Auto' : `${tilt}°`}
            </button>
          </label>
        </div>
      </div>

      <div className="flex shrink-0 flex-col gap-2.5 border-[var(--glass-border)] border-t bg-[var(--glass-bg-subtle)] p-4">
        <div className="flex items-center gap-3">
          <input
            aria-label="Timeline"
            className="anim-scrub w-full cursor-pointer"
            disabled={!ready}
            max={1000}
            min={0}
            onChange={(event) => store.seek((Number(event.target.value) / 1000) * (duration || 1))}
            style={{ ['--anim-accent' as string]: active.accent, ['--anim-progress' as string]: `${progress * 100}%` }}
            type="range"
            value={Math.round(progress * 1000)}
          />
          <span className="shrink-0 whitespace-nowrap font-mono text-xs tabular-nums">
            <span className="text-[var(--glass-ink)]">{formatTime(time)}</span>
            <span className="text-[var(--glass-muted)]"> / {formatTime(duration)}</span>
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          {playPause}
          <IconButton disabled={!ready} label="Replay" onClick={store.replay}><RotateCcw className="size-4" /></IconButton>
          <IconButton disabled={!running} label="Stop and show the finished house" onClick={store.stop}>
            <Square className="size-3.5" />
          </IconButton>
          <span className="flex-1" />
          <div className="flex items-center gap-0.5 rounded-full border border-[var(--glass-border)] bg-[var(--glass-raised-soft)] p-0.5">
            <button
              className="studio-interactive h-7 shrink-0 rounded-full px-2.5 font-medium font-mono text-xs text-[var(--glass-ink)] tabular-nums transition-colors hover:bg-[var(--glass-bg-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--glass-accent)] active:scale-95"
              onClick={() => store.setSpeed(SPEEDS[(SPEEDS.indexOf(speed as (typeof SPEEDS)[number]) + 1) % SPEEDS.length]!)}
              title="Speed"
              type="button"
            >
              {speed}×
            </button>
            <button
              aria-label={cinematic ? 'Cinematic camera on' : 'Cinematic camera off'}
              aria-pressed={cinematic}
              className={`studio-interactive flex size-7 shrink-0 items-center justify-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--glass-accent)] active:scale-95 ${
                cinematic
                  ? 'bg-[var(--glass-accent-soft)] text-[var(--glass-accent)]'
                  : 'text-[var(--glass-muted)] hover:bg-[var(--glass-bg-hover)] hover:text-[var(--glass-ink)]'
              }`}
              onClick={() => store.setCinematic(!cinematic)}
              title={cinematic ? 'Cinematic camera on' : 'Cinematic camera off'}
              type="button"
            >
              <Camera className="size-3.5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
