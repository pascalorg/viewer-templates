import { create } from 'zustand'
import type { TemplateId } from './templates'

/**
 * Rendering a build to a video file, frame by frame, in the browser. The dialog (`RenderDialog`)
 * writes a job; `FrameRecorder`, inside the canvas, takes the clock over (Pascal's own frame loop
 * paused), steps the build exactly `1 / fps` at a time, captures every frame and encodes an MP4
 * with WebCodecs. Nothing is dropped: a slow GPU makes the render take longer, not the video choppy.
 */

export type RenderFps = 30 | 60

export type RenderResolution = { id: string; label: string; width: number; height: number }

export const RESOLUTIONS: readonly RenderResolution[] = [
  { id: '720p', label: '720p · 1280 × 720', width: 1280, height: 720 },
  { id: '1080p', label: '1080p · 1920 × 1080', width: 1920, height: 1080 },
  { id: '1440p', label: '1440p · 2560 × 1440', width: 2560, height: 1440 },
  { id: '4k', label: '4K · 3840 × 2160', width: 3840, height: 2160 },
  { id: 'vertical', label: 'Vertical · 1080 × 1920', width: 1080, height: 1920 },
  { id: 'square', label: 'Square · 1080 × 1080', width: 1080, height: 1080 },
]

export type RenderJob = {
  id: number
  template: TemplateId
  fps: RenderFps
  width: number
  height: number
  /** For the file name. */
  projectName: string | null
}

export type RenderPhase = 'idle' | 'preparing' | 'rendering' | 'finishing' | 'done' | 'error'

type RenderState = {
  dialogOpen: boolean
  /** The render asked for; `FrameRecorder` picks it up. */
  job: RenderJob | null
  phase: RenderPhase
  frame: number
  total: number
  error: string | null
  result: { url: string; name: string; bytes: number } | null
  cancelRequested: boolean

  openDialog: () => void
  closeDialog: () => void
  start: (job: Omit<RenderJob, 'id'>) => void
  cancel: () => void
}

let nextJobId = 1

export const useRenderStore = create<RenderState>((set, get) => ({
  dialogOpen: false,
  job: null,
  phase: 'idle',
  frame: 0,
  total: 0,
  error: null,
  result: null,
  cancelRequested: false,

  openDialog: () => set({ dialogOpen: true }),
  closeDialog: () => {
    if (isRendering(get().phase)) return
    const { result } = get()
    if (result) URL.revokeObjectURL(result.url)
    set({ dialogOpen: false, phase: 'idle', result: null, error: null, frame: 0, total: 0 })
  },
  start: (job) => {
    if (isRendering(get().phase)) return
    const { result } = get()
    if (result) URL.revokeObjectURL(result.url)
    set({
      job: { ...job, id: nextJobId++ }, phase: 'preparing', frame: 0, total: 0,
      error: null, result: null, cancelRequested: false,
    })
  },
  cancel: () => {
    if (isRendering(get().phase)) set({ cancelRequested: true })
  },
}))

export function isRendering(phase: RenderPhase): boolean {
  return phase === 'preparing' || phase === 'rendering' || phase === 'finishing'
}

/** Whether a render owns the canvas now (Pascal's frame loop paused, the look curtain held). */
export function useRendering(): boolean {
  return useRenderStore((state) => isRendering(state.phase))
}

/**
 * What a render holds steady for the animator. `step`: the time step while a render steps the clock
 * (seconds per frame), or null to follow the wall clock as usual; set by `FrameRecorder` around each
 * frame it draws. `aspect`: the on-screen view's shape (width over height) for the whole render, so
 * the camera frames the build exactly as it does on screen (the same distance and angle, so the same
 * Zoom and Tilt) even though the canvas has the video's shape meanwhile; null when not rendering.
 */
export const renderClock: { step: number | null; aspect: number | null } = { step: null, aspect: null }

/** Where the dialog shows the render as it goes: the recorder draws a small copy of each frame. */
export const renderPreview: { canvas: HTMLCanvasElement | null } = { canvas: null }
