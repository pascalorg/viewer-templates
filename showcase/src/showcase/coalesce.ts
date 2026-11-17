/**
 * Scrubbing writes the plane at most once per animation frame: the last position asked for in a
 * frame wins, so a fast drag never queues store writes behind the renderer.
 */
export function createFrameCoalescer<T>(
  write: (value: T) => void,
  schedule: (run: () => void) => number = requestAnimationFrame,
  cancel: (frame: number) => void = cancelAnimationFrame,
) {
  let pending: { value: T } | null = null
  let frame: number | null = null
  return {
    push(value: T) {
      pending = { value }
      frame ??= schedule(() => {
        frame = null
        const next = pending
        pending = null
        if (next) write(next.value)
      })
    },
    dispose() {
      if (frame !== null) cancel(frame)
      frame = null
      pending = null
    },
  }
}
