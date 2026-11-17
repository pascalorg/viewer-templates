import { type PointerEvent, useEffect, useRef, useState } from 'react'
import { Icon } from './icons'

// Ported from Pascal's /next demo (MIT): the Cut view's axis switch, side and depth. The overlay
// (`useCutControls` in `ShowcaseOverlay.tsx`) maps it to the viewer's section state.

export type CutAxis = 'x' | 'y' | 'z'

export type CutState = {
  axis: CutAxis
  /** Where the section plane sits along the axis, 0 (start) to 1 (end) of the building. */
  position: number
  /** Keep the other side of the plane. */
  flipped: boolean
}

const STEP = 0.005
const AXES: [CutAxis, string][] = [['y', 'Top'], ['x', 'Side'], ['z', 'Front']]
const clamp = (value: number) => Math.max(0, Math.min(1, value))
const snap = (value: number) => clamp(Number((Math.round(clamp(value) / STEP) * STEP).toFixed(8)))

/** Axis switch, the section's depth and its side. `horizontal` lays the range out for the phone bar. */
export function CutSlider({ cut, horizontal = false, label = 'Slice through the building', readout, onAxisChange, onPositionChange, onFlipChange }: {
  cut: CutState
  horizontal?: boolean
  label?: string
  /** What the output shows; the position as a percentage by default. */
  readout?: string
  onAxisChange: (axis: CutAxis) => void
  onPositionChange: (position: number) => void
  onFlipChange: (flipped: boolean) => void
}) {
  return (
    <section aria-label="Section controls" className="sc-section">
      <div aria-label="Cut direction" className="sc-section-directions sc-glass" role="group">
        {AXES.map(([axis, name]) => (
          <button aria-label={`Cut from ${name.toLowerCase()}`} aria-pressed={cut.axis === axis} key={axis}
            onClick={() => onAxisChange(axis)} title={`Cut from ${name.toLowerCase()}`} type="button">
            <Icon name={`cut-${axis}`} />
          </button>
        ))}
        <button aria-label="Show the other side" aria-pressed={cut.flipped} onClick={() => onFlipChange(!cut.flipped)} title="Show the other side" type="button">
          <Icon name="flip" />
        </button>
      </div>
      <div className="sc-section-slider">
        <CutRange horizontal={horizontal} label={label} onChange={onPositionChange} value={cut.position} />
        <output>{readout ?? `${Math.round(cut.position * 100)} %`}</output>
      </div>
    </section>
  )
}

/** A native range for keyboard and assistive input; the whole control owns a captured pointer drag. */
function CutRange({ value: committed, horizontal, label, onChange }: {
  value: number
  horizontal: boolean
  label: string
  onChange: (value: number) => void
}) {
  const input = useRef<HTMLInputElement>(null)
  const pointer = useRef<number | null>(null)
  const frame = useRef<number | null>(null)
  const pending = useRef<number | null>(null)
  const latest = useRef(onChange)
  latest.current = onChange
  const [value, setValue] = useState(committed)
  const [dragging, setDragging] = useState(false)

  useEffect(() => { if (pointer.current === null) setValue(committed) }, [committed])
  useEffect(() => () => {
    if (frame.current !== null) cancelAnimationFrame(frame.current)
  }, [])

  function flush() {
    if (frame.current !== null) cancelAnimationFrame(frame.current)
    frame.current = null
    if (pending.current === null) return
    const next = pending.current
    pending.current = null
    latest.current(next)
  }
  function update(event: PointerEvent<HTMLDivElement>) {
    const rect = input.current!.getBoundingClientRect()
    const inset = horizontal ? 10 : 6
    const fraction = horizontal
      ? (event.clientX - rect.left - inset) / Math.max(1, rect.width - inset * 2)
      : (rect.bottom - event.clientY - inset) / Math.max(1, rect.height - inset * 2)
    const next = snap(fraction)
    input.current!.value = String(next)
    setValue(next)
    pending.current = next
    if (frame.current === null) frame.current = requestAnimationFrame(flush)
  }
  function end(event: PointerEvent<HTMLDivElement>) {
    if (event.pointerId !== pointer.current) return
    if (event.type === 'pointerup') update(event)
    pointer.current = null
    setDragging(false)
    flush()
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }

  return (
    <div className="sc-cut-range" data-dragging={dragging}
      onLostPointerCapture={end} onPointerCancel={end} onPointerUp={end}
      onPointerDown={(event) => {
        if (!event.isPrimary || event.button !== 0 || pointer.current !== null) return
        event.preventDefault()
        event.stopPropagation()
        pointer.current = event.pointerId
        setDragging(true)
        event.currentTarget.setPointerCapture(event.pointerId)
        input.current!.focus({ preventScroll: true })
        update(event)
      }}
      onPointerMove={(event) => {
        if (event.pointerId !== pointer.current) return
        event.preventDefault()
        event.stopPropagation()
        update(event)
      }}>
      <input aria-label={label} aria-orientation={horizontal ? 'horizontal' : 'vertical'} aria-valuetext={`${Math.round(value * 100)}%`}
        max={1} min={0} ref={input} step={STEP} title={label} type="range" value={value}
        onChange={(event) => { const next = Number(event.target.value); setValue(next); latest.current(next) }}
        onKeyDown={(event) => {
          const delta = ({ ArrowUp: STEP, ArrowRight: STEP, ArrowDown: -STEP, ArrowLeft: -STEP, PageUp: 0.1, PageDown: -0.1 } as Record<string, number>)[event.key]
          if (delta === undefined && !['Home', 'End'].includes(event.key)) return
          event.preventDefault()
          event.stopPropagation()
          const next = snap(event.key === 'Home' ? 0 : event.key === 'End' ? 1 : Number(input.current!.value) + (delta ?? 0))
          setValue(next)
          latest.current(next)
        }} />
    </div>
  )
}
