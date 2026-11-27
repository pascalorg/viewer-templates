/* Ported from home-assistant/frontend (Apache-2.0):
   - src/components/ha-control-circular-slider.ts */

import { type KeyboardEvent, type PointerEvent, useEffect, useRef, useState } from 'react'

const MAX_ANGLE = 270
const ROTATE_ANGLE = 360 - MAX_ANGLE / 2 - 90 // 135 deg
const RADIUS = 145
const TRACK_LENGTH = (RADIUS * 2 * Math.PI * MAX_ANGLE) / 360
// 270° clockwise arc from (RADIUS, 0) to (0, -RADIUS) in the rotated group coordinate system.
const TRACK_PATH = `M ${RADIUS} 0 A ${RADIUS} ${RADIUS} 0 1 1 0 ${-RADIUS}`

const A11Y_KEY_CODES = new Set([
  'ArrowRight',
  'ArrowUp',
  'ArrowLeft',
  'ArrowDown',
  'PageUp',
  'PageDown',
  'Home',
  'End',
])

type ActiveSlider = 'low' | 'high' | 'value'

export type CircularSliderMode = 'start' | 'end' | 'full'

export type CircularSliderProps = {
  disabled?: boolean
  readonly?: boolean
  dual?: boolean
  mode?: CircularSliderMode
  inactive?: boolean
  label?: string
  lowLabel?: string
  highLabel?: string
  formatValue?: (value: number) => string
  value?: number
  low?: number
  high?: number
  current?: number
  step?: number
  min?: number
  max?: number
  color?: string
  lowColor?: string
  highColor?: string
  onValueChanging?: (value: number | undefined) => void
  onValueChanged?: (value: number) => void
  onLowChanging?: (value: number | undefined) => void
  onLowChanged?: (value: number) => void
  onHighChanging?: (value: number | undefined) => void
  onHighChanged?: (value: number) => void
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(Math.max(v, min), max)
}

function roundToStep(v: number, step: number): number {
  const rounded = Math.round(v / step) * step
  return Number(rounded.toFixed(4))
}

export function CircularSlider({
  disabled = false,
  readonly = false,
  dual = false,
  mode,
  inactive = false,
  label,
  lowLabel,
  highLabel,
  formatValue,
  value,
  low,
  high,
  current,
  step = 1,
  min = 0,
  max = 100,
  color = '#2196f3',
  lowColor,
  highColor,
  onValueChanging,
  onValueChanged,
  onLowChanging,
  onLowChanged,
  onHighChanging,
  onHighChanged,
}: CircularSliderProps) {
  const svgRef = useRef<SVGSVGElement>(null)
  const [localValue, setLocalValue] = useState<number | undefined>(value)
  const [localLow, setLocalLow] = useState<number | undefined>(low)
  const [localHigh, setLocalHigh] = useState<number | undefined>(high)
  const [activeSlider, setActiveSlider] = useState<ActiveSlider | undefined>(undefined)

  const activeSliderRef = useRef<ActiveSlider | undefined>(undefined)
  const lastChangingRef = useRef<number | undefined>(undefined)
  const localRef = useRef({ value: localValue, low: localLow, high: localHigh })
  localRef.current = { value: localValue, low: localLow, high: localHigh }

  useEffect(() => {
    if (!activeSliderRef.current) setLocalValue(value)
  }, [value])

  useEffect(() => {
    if (!activeSliderRef.current) setLocalLow(low)
  }, [low])

  useEffect(() => {
    if (!activeSliderRef.current) setLocalHigh(high)
  }, [high])

  const valueToPct = (v: number): number => {
    if (max <= min) return 0
    return (clamp(v, min, max) - min) / (max - min)
  }

  const pctToValue = (pct: number): number => (max - min) * pct + min

  const boundedValue = (v: number, slider: ActiveSlider): number => {
    const lo = slider === 'high' ? Math.max(min, localRef.current.low ?? min) : min
    const hi = slider === 'low' ? Math.min(max, localRef.current.high ?? max) : max
    return clamp(v, lo, hi)
  }

  const findActiveSlider = (raw: number): ActiveSlider => {
    if (!dual) return 'value'
    const lo = Math.max(localRef.current.low ?? min, min)
    const hi = Math.min(localRef.current.high ?? max, max)
    if (lo >= raw) return 'low'
    if (hi <= raw) return 'high'
    return Math.abs(raw - lo) <= Math.abs(raw - hi) ? 'low' : 'high'
  }

  const setSliderLocal = (slider: ActiveSlider, next: number) => {
    if (slider === 'high') {
      localRef.current.high = next
      setLocalHigh(next)
    } else if (slider === 'low') {
      localRef.current.low = next
      setLocalLow(next)
    } else {
      localRef.current.value = next
      setLocalValue(next)
    }
  }

  const emitChanging = (slider: ActiveSlider, v: number | undefined) => {
    if (slider === 'high') onHighChanging?.(v)
    else if (slider === 'low') onLowChanging?.(v)
    else onValueChanging?.(v)
  }

  const emitChanged = (slider: ActiveSlider, v: number) => {
    if (slider === 'high') onHighChanged?.(v)
    else if (slider === 'low') onLowChanged?.(v)
    else onValueChanged?.(v)
  }

  const pctFromClientPoint = (clientX: number, clientY: number): number => {
    const el = svgRef.current
    if (!el) return 0
    const bound = el.getBoundingClientRect()
    if (!bound.width || !bound.height) return 0
    const x = (2 * (clientX - bound.left - bound.width / 2)) / bound.width
    const y = (2 * (clientY - bound.top - bound.height / 2)) / bound.height
    const phi = Math.atan2(y, x)
    const deg = (phi / (2 * Math.PI)) * 360
    const offset = (360 - MAX_ANGLE) / 2
    const angle = ((deg + offset - ROTATE_ANGLE + 360) % 360) - offset
    return clamp(angle / MAX_ANGLE, 0, 1)
  }

  const handlePointerDown = (e: PointerEvent<SVGPathElement>) => {
    if (disabled || readonly) return
    if (e.pointerType === 'mouse' && e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    const pct = pctFromClientPoint(e.clientX, e.clientY)
    const raw = pctToValue(pct)
    const slider = findActiveSlider(raw)
    activeSliderRef.current = slider
    setActiveSlider(slider)
    const bounded = boundedValue(raw, slider)
    setSliderLocal(slider, bounded)
    const stepped = clamp(roundToStep(bounded, step), min, max)
    lastChangingRef.current = stepped
    emitChanging(slider, stepped)
  }

  const handlePointerMove = (e: PointerEvent<SVGPathElement>) => {
    const slider = activeSliderRef.current
    if (!slider || disabled || readonly) return
    e.preventDefault()
    const pct = pctFromClientPoint(e.clientX, e.clientY)
    const raw = pctToValue(pct)
    const bounded = boundedValue(raw, slider)
    setSliderLocal(slider, bounded)
    const stepped = boundedValue(roundToStep(bounded, step), slider)
    if (stepped !== lastChangingRef.current) {
      lastChangingRef.current = stepped
      emitChanging(slider, stepped)
    }
  }

  const handlePointerUp = (e: PointerEvent<SVGPathElement>) => {
    const slider = activeSliderRef.current
    if (!slider || disabled || readonly) return
    e.preventDefault()
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId)
    }
    const pct = pctFromClientPoint(e.clientX, e.clientY)
    const raw = pctToValue(pct)
    const bounded = boundedValue(raw, slider)
    const stepped = boundedValue(roundToStep(bounded, step), slider)
    setSliderLocal(slider, stepped)
    activeSliderRef.current = undefined
    lastChangingRef.current = undefined
    setActiveSlider(undefined)
    emitChanging(slider, undefined)
    emitChanged(slider, stepped)
  }

  const handlePointerCancel = (e: PointerEvent<SVGPathElement>) => {
    const slider = activeSliderRef.current
    if (!slider) return
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId)
    }
    activeSliderRef.current = undefined
    lastChangingRef.current = undefined
    setActiveSlider(undefined)
    setLocalValue(value)
    setLocalLow(low)
    setLocalHigh(high)
    emitChanging(slider, undefined)
  }

  const tenPercentStep = Math.max(step, (max - min) / 10)

  const handleKeyDown = (slider: ActiveSlider) => (e: KeyboardEvent<SVGPathElement>) => {
    if (disabled || readonly || !A11Y_KEY_CODES.has(e.code)) return
    e.preventDefault()
    const cur =
      slider === 'high'
        ? localRef.current.high
        : slider === 'low'
          ? localRef.current.low
          : localRef.current.value
    let next = cur ?? min
    switch (e.code) {
      case 'ArrowRight':
      case 'ArrowUp':
        next = boundedValue(next + step, slider)
        break
      case 'ArrowLeft':
      case 'ArrowDown':
        next = boundedValue(next - step, slider)
        break
      case 'PageUp':
        next = boundedValue(roundToStep(next + tenPercentStep, step), slider)
        break
      case 'PageDown':
        next = boundedValue(roundToStep(next - tenPercentStep, step), slider)
        break
      case 'Home':
        next = boundedValue(min, slider)
        break
      case 'End':
        next = boundedValue(max, slider)
        break
    }
    next = boundedValue(roundToStep(next, step), slider)
    setSliderLocal(slider, next)
    emitChanging(slider, next)
  }

  const handleKeyUp = (slider: ActiveSlider) => (e: KeyboardEvent<SVGPathElement>) => {
    if (disabled || readonly || !A11Y_KEY_CODES.has(e.code)) return
    e.preventDefault()
    const cur =
      slider === 'high'
        ? localRef.current.high
        : slider === 'low'
          ? localRef.current.low
          : localRef.current.value
    if (cur == null) return
    emitChanging(slider, undefined)
    emitChanged(slider, cur)
  }

  const strokeDashArc = (from: number, to: number): [string, string] => {
    const start = valueToPct(from)
    const end = valueToPct(to)
    const arc = Math.max((end - start) * TRACK_LENGTH, 0)
    const arcOffset = start * TRACK_LENGTH - 0.5
    return [`${arc} ${Math.max(TRACK_LENGTH - arc, 0)}`, `${-arcOffset}`]
  }

  const strokeCircleDashArc = (v: number): [string, string] => strokeDashArc(v, v)

  const transitionStyle = activeSlider
    ? 'stroke-width 300ms ease-in-out, stroke 180ms ease-in-out, opacity 180ms ease-in-out'
    : 'stroke-width 300ms ease-in-out, stroke-dasharray 300ms ease-in-out, stroke-dashoffset 300ms ease-in-out, stroke 180ms ease-in-out, opacity 180ms ease-in-out'

  const renderArc = (
    id: ActiveSlider,
    arcValue: number | undefined,
    arcMode: CircularSliderMode,
    arcStrokeColor: string,
  ) => {
    if (disabled) return null

    const limit = arcMode === 'end' ? max : min
    const cur = current ?? limit
    const target = arcValue ?? limit

    const showActive =
      arcMode === 'end'
        ? target <= cur
        : arcMode === 'start'
          ? cur <= target
          : false

    const showTarget = arcValue != null

    const activeArc = showTarget
      ? showActive
        ? arcMode === 'end'
          ? strokeDashArc(target, cur)
          : strokeDashArc(cur, target)
        : strokeCircleDashArc(target)
      : undefined

    const coloredArc =
      arcMode === 'full'
        ? strokeDashArc(min, max)
        : arcMode === 'end'
          ? strokeDashArc(target, limit)
          : strokeDashArc(limit, target)

    const targetCircle = showTarget ? strokeCircleDashArc(target) : undefined

    const currentCircle =
      current != null && current <= max && current >= min && (showActive || mode === 'full')
        ? strokeCircleDashArc(current)
        : undefined

    const ariaLabel =
      id === 'low' ? (lowLabel ?? label) : id === 'high' ? (highLabel ?? label) : label
    const steppedAriaValue = arcValue != null ? roundToStep(arcValue, step) : undefined

    return (
      <g key={id}>
        <path
          d={TRACK_PATH}
          fill="none"
          strokeLinecap="round"
          strokeWidth={24}
          stroke="var(--background)"
          strokeDasharray={coloredArc[0]}
          strokeDashoffset={coloredArc[1]}
          opacity={inactive ? 0 : 1}
          style={{ transition: transitionStyle }}
        />
        <path
          d={TRACK_PATH}
          fill="none"
          strokeLinecap="round"
          strokeWidth={24}
          stroke={arcStrokeColor}
          strokeDasharray={coloredArc[0]}
          strokeDashoffset={coloredArc[1]}
          opacity={inactive ? 0 : 0.5}
          style={{ transition: transitionStyle }}
        />
        {activeArc && (
          <path
            d={TRACK_PATH}
            fill="none"
            strokeLinecap="round"
            strokeWidth={24}
            stroke={arcStrokeColor}
            strokeDasharray={activeArc[0]}
            strokeDashoffset={activeArc[1]}
            opacity={inactive ? 0 : 1}
            className="outline-none focus-visible:[stroke-width:28px]"
            style={{ transition: transitionStyle }}
            role="slider"
            tabIndex={disabled || readonly ? -1 : 0}
            aria-valuemin={min}
            aria-valuemax={max}
            aria-valuenow={steppedAriaValue}
            aria-valuetext={
              steppedAriaValue != null && formatValue ? formatValue(steppedAriaValue) : undefined
            }
            aria-disabled={disabled}
            aria-readonly={readonly}
            aria-label={ariaLabel}
            onKeyDown={handleKeyDown(id)}
            onKeyUp={handleKeyUp(id)}
          />
        )}
        {currentCircle && (
          <path
            d={TRACK_PATH}
            fill="none"
            strokeLinecap="round"
            strokeWidth={8}
            stroke="var(--background)"
            strokeDasharray={currentCircle[0]}
            strokeDashoffset={currentCircle[1]}
            opacity={inactive ? 0 : 0.75}
            style={{ transition: transitionStyle }}
          />
        )}
        {targetCircle && (
          <>
            <path
              d={TRACK_PATH}
              fill="none"
              strokeLinecap="round"
              strokeWidth={24}
              stroke={arcStrokeColor}
              strokeDasharray={targetCircle[0]}
              strokeDashoffset={targetCircle[1]}
              style={{ transition: transitionStyle }}
            />
            <path
              d={TRACK_PATH}
              fill="none"
              strokeLinecap="round"
              strokeWidth={18}
              stroke="#ffffff"
              strokeDasharray={targetCircle[0]}
              strokeDashoffset={targetCircle[1]}
              style={{ transition: transitionStyle }}
            />
          </>
        )}
      </g>
    )
  }

  const lowValue = dual ? localLow : localValue
  const highValue = localHigh
  const currentInRange = current != null && current >= min && current <= max
  const currentStroke = currentInRange ? strokeCircleDashArc(current) : undefined
  const interactive = !disabled && !readonly

  return (
    <svg
      ref={svgRef}
      viewBox="0 0 320 320"
      overflow="visible"
      className="block w-full select-none pointer-events-none"
    >
      <g transform={`translate(160 160) rotate(${ROTATE_ANGLE})`} fill="none">
        <path
          d={TRACK_PATH}
          fill="none"
          stroke="transparent"
          strokeLinecap="round"
          strokeWidth={48}
          className={interactive ? 'pointer-events-auto cursor-pointer touch-none' : 'pointer-events-none'}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerCancel}
        />
        <path
          d={TRACK_PATH}
          fill="none"
          strokeLinecap="round"
          strokeWidth={24}
          stroke="var(--muted-foreground)"
          opacity={0.25}
          style={{ transition: 'stroke 180ms ease-in-out, opacity 180ms ease-in-out' }}
        />
        {currentStroke && (
          <path
            d={TRACK_PATH}
            fill="none"
            strokeLinecap="round"
            strokeWidth={8}
            stroke="var(--foreground)"
            opacity={0.5}
            strokeDasharray={currentStroke[0]}
            strokeDashoffset={currentStroke[1]}
            style={{ transition: transitionStyle }}
          />
        )}
        {(lowValue != null || mode === 'full') &&
          renderArc(
            dual ? 'low' : 'value',
            lowValue,
            (!dual && mode) || 'start',
            dual ? (lowColor ?? color) : color,
          )}
        {dual &&
          highValue != null &&
          renderArc('high', highValue, 'end', highColor ?? color)}
      </g>
    </svg>
  )
}
