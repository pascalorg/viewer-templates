import { create } from 'zustand'
import type { TemplateId } from './templates'

/**
 * What the Animations tab asks for and what the animator reports back. The animator owns the
 * clock while it plays; the tab only reads `time` and writes requests (play, pause, seek).
 */
export type AnimationStatus = 'idle' | 'playing' | 'paused' | 'finished'

type AnimationState = {
  template: TemplateId
  status: AnimationStatus
  /** Seconds into the timeline, at 1× speed. */
  time: number
  /** Timeline length in seconds, once the animator has planned it. */
  duration: number
  speed: number
  /** The camera orbits and frames the build while it plays. */
  cinematic: boolean
  /** Pieces the build moves (0 until the animator has measured the scene). */
  pieceCount: number
  /** Bumped to ask the animator to restart the timeline from 0. */
  runId: number
  /** A seek the animator should apply on its next frame. */
  seekTo: number | null
  /** The title card a template shows at this moment (a room's name, the time of day). */
  caption: { title: string; sub: string | null; key: string } | null
  /** The panel is open on the right. */
  panelOpen: boolean
  /** How close the cinematic camera frames the build: 1 as planned, above 1 closer. */
  zoom: number
  /** The camera's tilt in degrees from straight down, or null for each template's own. */
  tilt: number | null
  /**
   * How far the Zoom and Tilt sliders reach: as far as the camera itself goes (Pascal's distance and
   * angle limits, as zoom against the current framing, and in degrees). Kept up to date by the animator.
   */
  zoomRange: [number, number]
  tiltRange: [number, number]
  /** Bumped when zoom or tilt changes, so the animator frames again at once. */
  framingId: number
  /**
   * The scene's look as it is drawn now. A template's look (Blueprint's Noir) is switched in and
   * out behind `LookCurtain`, so this follows what the build wants a moment later.
   */
  appliedLook: 'default' | 'noir'

  select: (template: TemplateId) => void
  play: () => void
  pause: () => void
  replay: () => void
  stop: () => void
  seek: (time: number) => void
  setSpeed: (speed: number) => void
  setCinematic: (on: boolean) => void
  setZoom: (zoom: number) => void
  setTilt: (tilt: number | null) => void
  /** The person moved the camera themselves: Zoom and Tilt show where it is now, without framing again. */
  followCamera: (zoom: number, tilt: number) => void
  setRanges: (zoom: [number, number], tilt: [number, number]) => void
}

export const useAnimationStore = create<AnimationState>((set, get) => ({
  template: 'blueprint',
  status: 'idle',
  time: 0,
  duration: 0,
  speed: 1,
  cinematic: true,
  pieceCount: 0,
  runId: 0,
  seekTo: null,
  caption: null,
  panelOpen: false,
  zoom: 1,
  tilt: null,
  zoomRange: [0.5, 2],
  tiltRange: [5, 85],
  framingId: 0,
  appliedLook: 'default',

  select: (template) => set({ template, status: 'playing', time: 0, seekTo: null, runId: get().runId + 1 }),
  play: () => {
    const { status } = get()
    if (status === 'finished' || status === 'idle') {
      set({ status: 'playing', time: 0, seekTo: null, runId: get().runId + 1 })
    } else {
      set({ status: 'playing' })
    }
  },
  pause: () => {
    if (get().status === 'playing') set({ status: 'paused' })
  },
  replay: () => set({ status: 'playing', time: 0, seekTo: null, runId: get().runId + 1 }),
  stop: () => set({ status: 'idle', time: 0, seekTo: null }),
  seek: (time) => {
    const { status, runId } = get()
    // Scrubbing a finished or idle build starts it again, held where the scrubber is.
    if (status === 'idle' || status === 'finished') set({ status: 'paused', runId: runId + 1, seekTo: time, time })
    else set({ seekTo: time, time })
  },
  setSpeed: (speed) => set({ speed }),
  setCinematic: (cinematic) => set({ cinematic }),
  setZoom: (zoom) => set({ zoom, framingId: get().framingId + 1 }),
  setTilt: (tilt) => set({ tilt, framingId: get().framingId + 1 }),
  setRanges: (zoomRange, tiltRange) => {
    const { zoomRange: z, tiltRange: t } = get()
    if (z[0] !== zoomRange[0] || z[1] !== zoomRange[1] || t[0] !== tiltRange[0] || t[1] !== tiltRange[1]) {
      set({ zoomRange, tiltRange })
    }
  },
  followCamera: (zoom, tilt) => {
    if (zoom !== get().zoom || tilt !== get().tilt) set({ zoom, tilt })
  },
}))
