import { playSound } from '@pascal-app/viewer/sfx'
import { Clapperboard, Download, X } from 'lucide-react'
import { type ReactNode, useEffect, useRef, useState } from 'react'
import { downloadUrl } from '../animation/FrameRecorder'
import { isRendering, RESOLUTIONS, type RenderFps, renderPreview, useRenderStore } from '../animation/render'
import { useAnimationStore } from '../animation/store'
import { TEMPLATES, type TemplateId } from '../animation/templates'

/**
 * The Render dialog, opened from the mode dock: pick a build animation, a frame rate and a
 * resolution, and the build is rendered to an MP4 frame by frame (`FrameRecorder`), then downloaded.
 */

const FPS_OPTIONS: readonly RenderFps[] = [30, 60]

function formatBytes(bytes: number) {
  return bytes > 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="font-semibold text-[11px] text-[var(--glass-muted)] uppercase tracking-[0.12em]">{label}</span>
      {children}
    </label>
  )
}

const selectClass =
  'studio-interactive h-10 w-full cursor-pointer rounded-xl border border-[var(--glass-border)] bg-[var(--glass-raised-soft)] px-3 text-[13px] font-medium text-[var(--glass-ink)] transition-colors hover:border-[var(--glass-border-strong)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--glass-accent)]'

const primaryClass =
  'studio-interactive inline-flex h-10 items-center justify-center gap-2 rounded-full bg-[var(--glass-accent)] px-5 text-[13px] font-semibold text-white shadow-xs transition-all hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--glass-accent)] focus-visible:ring-offset-2 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-40'

const secondaryClass =
  'studio-interactive inline-flex h-10 items-center justify-center rounded-full px-4 text-[13px] font-medium text-[var(--glass-ink)]/85 transition-colors hover:bg-[var(--glass-bg-hover)] hover:text-[var(--glass-ink)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--glass-accent)]'

export function RenderDialog({ projectName, ready }: { projectName: string | null; ready: boolean }) {
  const open = useRenderStore((s) => s.dialogOpen)
  const phase = useRenderStore((s) => s.phase)
  const frame = useRenderStore((s) => s.frame)
  const total = useRenderStore((s) => s.total)
  const error = useRenderStore((s) => s.error)
  const result = useRenderStore((s) => s.result)
  const cancelRequested = useRenderStore((s) => s.cancelRequested)
  const currentTemplate = useAnimationStore((s) => s.template)

  const [template, setTemplate] = useState<TemplateId>(currentTemplate)
  const [fps, setFps] = useState<RenderFps>(30)
  const [resolution, setResolution] = useState('1080p')
  const previewRef = useRef<HTMLCanvasElement | null>(null)

  // Opening the dialog starts from the animation picked in the panel.
  useEffect(() => {
    if (open && phase === 'idle') setTemplate(useAnimationStore.getState().template)
  }, [open, phase])

  const busy = isRendering(phase)
  const size = RESOLUTIONS.find((r) => r.id === resolution) ?? RESOLUTIONS[1]!

  // The recorder draws a small copy of each frame here.
  useEffect(() => {
    renderPreview.canvas = busy ? previewRef.current : null
    return () => {
      renderPreview.canvas = null
    }
  }, [busy])

  useEffect(() => {
    if (!open || busy) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') useRenderStore.getState().closeDialog()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, busy])

  if (!open) return null

  const store = useRenderStore.getState()
  const progress = total > 0 ? frame / total : 0
  const previewWidth = 320
  const previewHeight = Math.round((previewWidth * size.height) / size.width)

  const start = () => {
    playSound('menuClick')
    store.start({ template, fps, width: size.width, height: size.height, projectName })
  }

  let body: ReactNode
  if (busy) {
    body = (
      <div className="flex flex-col gap-3">
        <div className="flex justify-center overflow-hidden rounded-xl border border-[var(--glass-border)] bg-[#0b0c0e]">
          <canvas
            className="block max-h-[40dvh] w-auto max-w-full"
            height={previewHeight}
            ref={previewRef}
            style={{ aspectRatio: `${size.width} / ${size.height}` }}
            width={previewWidth}
          />
        </div>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--glass-bg-subtle)]">
          <div className="h-full rounded-full bg-[var(--glass-accent)] transition-[width] duration-150" style={{ width: `${progress * 100}%` }} />
        </div>
        <div className="flex items-center justify-between font-mono text-[11px] text-[var(--glass-muted)] tabular-nums">
          <span>
            {phase === 'preparing' ? 'Getting the scene ready…' : phase === 'finishing' ? 'Writing the video…' : `Frame ${frame} / ${total}`}
          </span>
          <span>{Math.round(progress * 100)}%</span>
        </div>
        <p className="text-[var(--glass-muted)] text-xs leading-relaxed">
          Every frame is drawn one by one, so this can take longer than the animation itself. Keep this tab open and in front.
        </p>
        <div className="flex justify-end">
          <button className={secondaryClass} disabled={cancelRequested} onClick={() => store.cancel()} type="button">
            {cancelRequested ? 'Stopping…' : 'Cancel render'}
          </button>
        </div>
      </div>
    )
  } else if (phase === 'done' && result) {
    body = (
      <div className="flex flex-col gap-3">
        <p className="text-[13px] text-[var(--glass-ink)] leading-relaxed">
          Your video is ready and has been downloaded.
        </p>
        <div className="rounded-xl border border-[var(--glass-border)] bg-[var(--glass-bg-subtle)] px-3 py-2.5 font-mono text-[11px] text-[var(--glass-muted)]">
          <div className="truncate text-[var(--glass-ink)]">{result.name}</div>
          <div>{formatBytes(result.bytes)}</div>
        </div>
        <div className="flex justify-end gap-2">
          <button className={secondaryClass} onClick={() => store.closeDialog()} type="button">Close</button>
          <button className={primaryClass} onClick={() => downloadUrl(result.url, result.name)} type="button">
            <Download className="size-4" /> Download again
          </button>
        </div>
      </div>
    )
  } else {
    body = (
      <div className="flex flex-col gap-4">
        {phase === 'error' && error && (
          <p className="rounded-xl border border-red-500/25 bg-red-500/10 px-3 py-2.5 text-red-700 text-xs leading-relaxed dark:text-red-300" role="alert">
            {error}
          </p>
        )}
        <Field label="Animation">
          <select className={selectClass} onChange={(event) => setTemplate(event.target.value as TemplateId)} value={template}>
            {TEMPLATES.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
        </Field>
        <div className="flex flex-col gap-1.5">
          <span className="font-semibold text-[11px] text-[var(--glass-muted)] uppercase tracking-[0.12em]">Frame rate</span>
          <div className="flex items-center gap-0.5 self-start rounded-full border border-[var(--glass-border)] bg-[var(--glass-raised-soft)] p-1" role="radiogroup" aria-label="Frame rate">
            {FPS_OPTIONS.map((option) => (
              <button
                aria-checked={fps === option}
                className={`studio-interactive h-8 rounded-full px-4 font-mono text-xs font-medium tabular-nums transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--glass-accent)] ${
                  fps === option ? 'bg-[var(--glass-accent)] text-white' : 'text-[var(--glass-ink)]/85 hover:bg-[var(--glass-bg-hover)]'
                }`}
                key={option}
                onClick={() => setFps(option)}
                role="radio"
                type="button"
              >
                {option} fps
              </button>
            ))}
          </div>
        </div>
        <Field label="Resolution">
          <select className={selectClass} onChange={(event) => setResolution(event.target.value)} value={resolution}>
            {RESOLUTIONS.map((r) => (
              <option key={r.id} value={r.id}>{r.label}</option>
            ))}
          </select>
        </Field>
        <p className="text-[var(--glass-muted)] text-xs leading-relaxed">
          Uses the camera settings from the Animations panel (zoom, tilt, cinematic camera and speed). Saved as an MP4.
        </p>
        <div className="flex justify-end gap-2">
          <button className={secondaryClass} onClick={() => store.closeDialog()} type="button">Cancel</button>
          <button className={primaryClass} disabled={!ready} onClick={start} type="button">
            <Clapperboard className="size-4" /> Render
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <button
        aria-label="Close render"
        className="absolute inset-0 cursor-default bg-slate-950/35 backdrop-blur-[3px]"
        disabled={busy}
        onClick={() => store.closeDialog()}
        tabIndex={-1}
        type="button"
      />
      <section
        aria-label="Render video"
        aria-modal="true"
        className="corner-smooth studio-hud-light relative flex w-[380px] max-w-full flex-col overflow-hidden rounded-[20px]"
        role="dialog"
      >
        <div className="flex items-center justify-between gap-2 border-[var(--glass-border)] border-b px-4 py-2.5">
          <span className="flex items-center gap-2 font-semibold text-[13px] text-[var(--glass-ink)]">
            <Clapperboard aria-hidden className="size-4 text-[var(--glass-accent)]" />
            {busy ? 'Rendering' : 'Render video'}
          </span>
          {!busy && (
            <button
              aria-label="Close render"
              className="studio-interactive flex size-8 items-center justify-center rounded-full text-[var(--glass-muted)] transition-colors hover:bg-[var(--glass-bg-hover)] hover:text-[var(--glass-ink)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--glass-accent)]"
              onClick={() => store.closeDialog()}
              type="button"
            >
              <X className="size-4" />
            </button>
          )}
        </div>
        <div className="p-4">{body}</div>
      </section>
    </div>
  )
}
