import { type RootState, useThree } from '@react-three/fiber'
import {
  BufferTarget,
  CanvasSource,
  getFirstEncodableVideoCodec,
  Mp4OutputFormat,
  Output,
  QUALITY_HIGH,
} from 'mediabunny'
import { useEffect } from 'react'
import { startedRunId } from './BuildAnimator'
import { isRendering, renderClock, type RenderJob, renderPreview, useRenderStore } from './render'
import { useAnimationStore } from './store'
import { templateById } from './templates'

/**
 * Renders a build to an MP4, every frame. Mounted inside the canvas by `BuildAnimator`.
 *
 * While it works, Pascal's own frame loop is paused (`ProjectViewer` passes `renderPaused`) and the
 * recorder advances R3F itself with a fixed step, so every `useFrame` (the animator, the camera's
 * glides, the post-processing) sees exactly `1 / fps` per frame. Each frame is copied out of the
 * canvas in the same task it was drawn in (a WebGPU canvas only holds its picture until then),
 * the title card drawn over it, and handed to the encoder.
 */

type R3FGet = () => RootState

/** Seconds the finished house is held at the end of the video. */
const HOLD_SECONDS = 1.5
/** A Noir build (Blueprint): seconds held in the Noir look, then the cross-fade back to daylight. */
const NOIR_HOLD_SECONDS = 0.8
const CROSSFADE_SECONDS = 1.2
/** Frames drawn and thrown away before the first one is kept: the new size and look build their shaders. */
const WARMUP_FRAMES = 24

class Cancelled extends Error {}

const nextTask = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

async function waitFor(test: () => boolean, timeoutMs: number): Promise<boolean> {
  const start = performance.now()
  while (!test()) {
    if (performance.now() - start > timeoutMs) return false
    await new Promise((resolve) => setTimeout(resolve, 16))
  }
  return true
}

type GpuQueueHolder = { backend?: { device?: { queue?: { onSubmittedWorkDone?: () => Promise<void> } } } }

/** Waits for the GPU to finish what was sent, so frames never pile up ahead of it. */
async function gpuIdle(gl: unknown) {
  const queue = (gl as GpuQueueHolder).backend?.device?.queue
  if (queue?.onSubmittedWorkDone) await queue.onSubmittedWorkDone()
  else await nextTask()
}

function fileName(job: RenderJob): string {
  const slug = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  const parts = [job.projectName ? slug(job.projectName) : '', slug(templateById(job.template).name), `${job.width}x${job.height}`, `${job.fps}fps`]
  return `${parts.filter(Boolean).join('-')}.mp4`
}

/** A template's title card, drawn as `AnimationCaption` shows it, scaled to the video. */
function drawCaption(ctx: CanvasRenderingContext2D, width: number, height: number, time: number) {
  const caption = useAnimationStore.getState().caption
  if (!caption) return
  const start = Number(caption.key)
  const k = Number.isFinite(start) ? Math.min(1, Math.max(0, (time - start) / 0.45)) : 1
  const ease = 1 - (1 - k) ** 3
  const unit = Math.min(width, height) / 1080
  const titleSize = Math.round(46 * unit)
  const subSize = Math.round(15 * unit)
  ctx.save()
  ctx.globalAlpha = ease
  ctx.font = `500 ${titleSize}px Barlow, system-ui, sans-serif`
  const titleWidth = ctx.measureText(caption.title).width
  ctx.font = `500 ${subSize}px "Geist Mono Variable", ui-monospace, monospace`
  const sub = caption.sub?.toUpperCase() ?? null
  const subWidth = sub ? ctx.measureText(sub).width + sub.length * subSize * 0.18 : 0
  const padX = 34 * unit
  const boxWidth = Math.max(titleWidth, subWidth) + padX * 2
  const boxHeight = (sub ? 120 : 92) * unit
  const x = (width - boxWidth) / 2
  const y = height * 0.16 + (1 - ease) * 10 * unit
  ctx.shadowColor = 'rgb(15 23 42 / 0.16)'
  ctx.shadowBlur = 28 * unit
  ctx.shadowOffsetY = 8 * unit
  ctx.fillStyle = 'rgb(255 255 255 / 0.88)'
  ctx.beginPath()
  ctx.roundRect(x, y, boxWidth, boxHeight, 22 * unit)
  ctx.fill()
  ctx.shadowColor = 'transparent'
  ctx.fillStyle = '#2649c4'
  ctx.beginPath()
  ctx.roundRect(width / 2 - 18 * unit, y + 16 * unit, 36 * unit, 3 * unit, 2 * unit)
  ctx.fill()
  ctx.textAlign = 'center'
  ctx.textBaseline = 'alphabetic'
  ctx.fillStyle = '#14161a'
  ctx.font = `500 ${titleSize}px Barlow, system-ui, sans-serif`
  ctx.fillText(caption.title, width / 2, y + 30 * unit + titleSize * 0.9)
  if (sub) {
    ctx.fillStyle = '#525763'
    ctx.font = `500 ${subSize}px "Geist Mono Variable", ui-monospace, monospace`
    ctx.letterSpacing = `${(subSize * 0.18).toFixed(1)}px`
    ctx.fillText(sub, width / 2, y + boxHeight - 20 * unit)
  }
  ctx.restore()
}

async function record(job: RenderJob, get: R3FGet) {
  const renderStore = useRenderStore
  const anim = useAnimationStore
  const cancelled = () => renderStore.getState().cancelRequested
  const check = () => {
    if (cancelled()) throw new Cancelled()
  }
  const width = job.width
  const height = job.height

  const codec = await getFirstEncodableVideoCodec(['avc', 'hevc', 'vp9', 'av1'], { width, height, quality: QUALITY_HIGH })
  if (!codec) throw new Error(`This browser can't encode ${width} × ${height} video. Try a smaller resolution, or Chrome or Edge.`)

  // Pascal's frame loop stops once React has passed `renderPaused` down.
  for (let i = 0; i < 2; i++) await new Promise<void>((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)))
  check()

  const state = get()
  const previousSize = { ...state.size }
  const gl = state.gl
  const glCanvas = gl.domElement as HTMLCanvasElement
  const background = getComputedStyle(glCanvas).backgroundColor || '#fafafa'

  // Our own clock, carried on from R3F's so time only moves forward.
  const startClock = state.clock.elapsedTime
  let clock = startClock
  const step = (seconds: number) => {
    clock += seconds
    renderClock.step = seconds
    try {
      get().advance(clock)
    } finally {
      renderClock.step = null
    }
  }

  // A clean start: the build put back, the template's look switched in (no curtain in a video).
  anim.getState().stop()
  const template = templateById(job.template)
  anim.setState({ template: job.template, appliedLook: template.look === 'noir' ? 'noir' : 'default' })
  await nextTask()

  const out = document.createElement('canvas')
  out.width = width
  out.height = height
  const ctx = out.getContext('2d', { alpha: false })
  if (!ctx) throw new Error('Could not set up the video frame.')

  try {
    // The video's size, in CSS pixels at the screen's pixel ratio, so the drawing buffer is the video's.
    const dpr = get().viewport.dpr || 1
    // The camera keeps framing for the screen's shape, so Zoom and Tilt come out as they look in the viewer.
    renderClock.aspect = previousSize.width / Math.max(1, previousSize.height)
    get().setSize(width / dpr, height / dpr, previousSize.top, previousSize.left)
    for (let i = 0; i < WARMUP_FRAMES; i++) {
      check()
      step(1 / job.fps)
      await gpuIdle(gl)
      await nextTask()
    }

    // The build, from its first frame.
    const expectedRun = anim.getState().runId + 1
    anim.getState().select(job.template)
    const started = await waitFor(() => startedRunId() === expectedRun || anim.getState().status === 'idle', 5000)
    if (!started || startedRunId() !== expectedRun) throw new Error('The build could not be measured for this project.')
    check()

    const speed = anim.getState().speed || 1
    const noir = template.look === 'noir'
    const seconds = (s: number) => Math.ceil(s * job.fps)
    // An estimate for the progress bar: the build runs until it says it has finished, however long that is.
    const outro = noir ? NOIR_HOLD_SECONDS + CROSSFADE_SECONDS + HOLD_SECONDS : HOLD_SECONDS
    let total = Math.max(1, seconds(anim.getState().duration / speed + outro))
    renderStore.setState({ phase: 'rendering', frame: 0, total })

    const output = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target: new BufferTarget() })
    const source = new CanvasSource(out, { codec, bitrate: QUALITY_HIGH, keyFrameInterval: 2, sizeChangeBehavior: 'contain' })
    output.addVideoTrack(source, { frameRate: job.fps })
    await output.start()

    try {
      const preview = renderPreview.canvas?.getContext('2d') ?? null
      let frame = 0
      /** Draws one frame (`fadeFrom` laid over it at `fadeAlpha`) and hands it to the encoder. */
      const emit = async (dt: number, fadeFrom: HTMLCanvasElement | null = null, fadeAlpha = 0) => {
        check()
        step(dt)
        // Copied out in the task it was drawn in.
        ctx.globalAlpha = 1
        ctx.fillStyle = background
        ctx.fillRect(0, 0, width, height)
        ctx.drawImage(glCanvas, 0, 0, width, height)
        drawCaption(ctx, width, height, anim.getState().time)
        if (fadeFrom && fadeAlpha > 0) {
          ctx.globalAlpha = fadeAlpha
          ctx.drawImage(fadeFrom, 0, 0)
          ctx.globalAlpha = 1
        }
        if (preview && renderPreview.canvas) {
          preview.drawImage(out, 0, 0, renderPreview.canvas.width, renderPreview.canvas.height)
        }
        await source.add(frame / job.fps, 1 / job.fps)
        await gpuIdle(gl)
        frame++
        if (frame > total) total = frame
        renderStore.setState({ frame, total })
        // Let the page breathe (progress, the Cancel button, React's effects) every few frames.
        if (frame % 4 === 0) await nextTask()
      }

      // The build, until the animator itself calls it finished (not a length worked out up front:
      // whatever the timeline does, the video plays it to the end). The first frame is its first moment.
      const step1 = 1 / job.fps
      const cap = seconds(anim.getState().duration / speed) * 3 + seconds(30)
      await emit(0)
      while (anim.getState().status === 'playing' && frame < cap) await emit(step1)
      if (anim.getState().status === 'idle') throw new Error('The build stopped before it finished.')

      if (noir) {
        // As it plays live: the finished build holds a beat in the Noir look, then the house fades
        // back into the viewer's own look. The look switches unseen between two frames; the last
        // Noir frame is kept and faded off over the first ones in daylight.
        for (let i = 0; i < seconds(NOIR_HOLD_SECONDS); i++) await emit(step1)
        const last = document.createElement('canvas')
        last.width = width
        last.height = height
        last.getContext('2d')?.drawImage(out, 0, 0)
        anim.setState({ appliedLook: 'default' })
        // Daylight's sky, lights and shaders build before any of it is shown.
        await nextTask()
        for (let i = 0; i < WARMUP_FRAMES * 2; i++) {
          check()
          step(0)
          await gpuIdle(gl)
          await nextTask()
        }
        const fade = Math.max(1, seconds(CROSSFADE_SECONDS))
        for (let i = 1; i <= fade; i++) {
          const k = i / fade
          await emit(step1, last, 1 - k * k * (3 - 2 * k))
        }
      }
      for (let i = 0; i < seconds(HOLD_SECONDS); i++) await emit(step1)
      check()
      renderStore.setState({ phase: 'finishing' })
      await output.finalize()
    } catch (error) {
      await output.cancel().catch(() => undefined)
      throw error
    }

    const buffer = output.target.buffer
    if (!buffer) throw new Error('The video came out empty.')
    const blob = new Blob([buffer], { type: 'video/mp4' })
    const url = URL.createObjectURL(blob)
    const name = fileName(job)
    renderStore.setState({ phase: 'done', result: { url, name, bytes: blob.size } })
    downloadUrl(url, name)
  } finally {
    renderClock.step = null
    renderClock.aspect = null
    get().setSize(previousSize.width, previousSize.height, previousSize.top, previousSize.left)
    // Hand R3F's clock back where Pascal's frame loop left it: its next frame must not step backwards.
    get().clock.elapsedTime = startClock
  }
}

export function downloadUrl(url: string, name: string) {
  const link = document.createElement('a')
  link.href = url
  link.download = name
  document.body.appendChild(link)
  link.click()
  link.remove()
}

export function FrameRecorder() {
  const get = useThree((state) => state.get)
  const job = useRenderStore((state) => state.job)

  useEffect(() => {
    if (!job) return
    let alive = true
    record(job, get)
      .catch((error: unknown) => {
        if (!alive) return
        // Stopped or failed half way: the build is put back as it was.
        useAnimationStore.getState().stop()
        if (error instanceof Cancelled) {
          useRenderStore.setState({ phase: 'idle', frame: 0, total: 0 })
        } else {
          console.error('[render] the render failed', error)
          useRenderStore.setState({ phase: 'error', error: error instanceof Error ? error.message : 'The render failed.' })
        }
      })
      .finally(() => {
        useRenderStore.setState({ job: null, cancelRequested: false })
      })
    return () => {
      alive = false
      // Unmounted mid-render (a new project, a crash fallback): stop where it is.
      if (isRendering(useRenderStore.getState().phase)) useRenderStore.setState({ cancelRequested: true })
    }
  }, [job, get])

  return null
}
