/* Ported from home-assistant/frontend (Apache-2.0):
   - src/components/ha-control-slider.ts */

import {
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from 'react'
import type { EntityFormatters } from '../hass/names'
import { HA_COLORS } from './stateColors'

export type SliderMode = 'start' | 'end' | 'cursor'
export type TooltipMode = 'never' | 'always' | 'interaction'
export type TooltipPosition = 'top' | 'bottom' | 'left' | 'right'

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

export type ControlSliderProps = {
  value?: number
  min?: number
  max?: number
  step?: number
  mode?: SliderMode
  vertical?: boolean
  inverted?: boolean
  showHandle?: boolean
  roundValue?: boolean
  disabled?: boolean
  label?: string
  unit?: string
  tooltipMode?: TooltipMode
  tooltipPosition?: TooltipPosition
  formatters?: EntityFormatters
  color?: string
  background?: string
  backgroundOpacity?: number
  thickness?: number
  borderRadius?: number
  className?: string
  style?: CSSProperties
  backgroundSlot?: ReactNode
  onSliderMoved?: (value: number | undefined) => void
  onValueChanged?: (value: number) => void
}

export function ControlSlider({
  value,
  min = 0,
  max = 100,
  step = 1,
  mode = 'start',
  vertical = false,
  inverted = false,
  showHandle = false,
  roundValue = false,
  disabled = false,
  label,
  unit,
  tooltipMode = 'interaction',
  tooltipPosition,
  formatters,
  color = HA_COLORS.primary,
  background = HA_COLORS.inactive,
  backgroundOpacity = 0.2,
  thickness,
  borderRadius,
  className = '',
  style,
  backgroundSlot,
  onSliderMoved,
  onValueChanged,
}: ControlSliderProps) {
  const [pressed, setPressed] = useState(false)
  const [tooltipVisible, setTooltipVisible] = useState(false)
  const [localValue, setLocalValue] = useState<number | undefined>(value)
  const sliderRef = useRef<HTMLDivElement>(null)
  const pointerIdRef = useRef<number | null>(null)
  const savedValueRef = useRef<number | undefined>(value)
  const currentValueRef = useRef<number | undefined>(value)
  const tooltipTimerRef = useRef<number | undefined>(undefined)

  useEffect(() => {
    if (!pressed) {
      setLocalValue(value)
      currentValueRef.current = value
    }
  }, [value, pressed])

  useEffect(
    () => () => {
      if (tooltipTimerRef.current !== undefined) {
        window.clearTimeout(tooltipTimerRef.current)
      }
    },
    [],
  )

  const isVisuallyInverted = () => {
    let inv = inverted
    if (!vertical && typeof document !== 'undefined' && document.dir === 'rtl') {
      inv = !inv
    }
    return inv
  }

  const boundedValue = (v: number) => Math.min(Math.max(v, min), max)

  const steppedValue = (v: number) => {
    const safeStep = step > 0 ? step : 1
    return boundedValue(Math.round(v / safeStep) * safeStep)
  }

  const displayedValue = (v: number) => {
    const snapped = steppedValue(v)
    return roundValue ? Math.round(snapped) : snapped
  }

  const valueToPercentage = (v: number) => {
    const span = max - min
    if (span === 0) return 0
    const pct = (boundedValue(v) - min) / span
    return isVisuallyInverted() ? 1 - pct : pct
  }

  const percentageToValue = (pct: number) => {
    const effective = isVisuallyInverted() ? 1 - pct : pct
    return (max - min) * effective + min
  }

  const getPercentageFromClient = (clientX: number, clientY: number) => {
    const el = sliderRef.current
    if (!el) return 0
    const rect = el.getBoundingClientRect()
    if (vertical) {
      if (rect.height <= 0) return 0
      return Math.max(0, Math.min(1, 1 - (clientY - rect.top) / rect.height))
    }
    if (rect.width <= 0) return 0
    return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
  }

  const showTooltip = () => {
    if (tooltipTimerRef.current !== undefined) {
      window.clearTimeout(tooltipTimerRef.current)
      tooltipTimerRef.current = undefined
    }
    setTooltipVisible(true)
  }

  const hideTooltip = (delayMs?: number) => {
    if (!delayMs) {
      setTooltipVisible(false)
      return
    }
    if (tooltipTimerRef.current !== undefined) window.clearTimeout(tooltipTimerRef.current)
    tooltipTimerRef.current = window.setTimeout(() => {
      tooltipTimerRef.current = undefined
      setTooltipVisible(false)
    }, delayMs)
  }

  const handlePointerDown = (ev: PointerEvent<HTMLDivElement>) => {
    if (disabled || (ev.pointerType === 'mouse' && ev.button !== 0)) return
    ev.currentTarget.setPointerCapture(ev.pointerId)
    pointerIdRef.current = ev.pointerId
    savedValueRef.current = currentValueRef.current
    setPressed(true)
    showTooltip()

    const pct = getPercentageFromClient(ev.clientX, ev.clientY)
    const raw = percentageToValue(pct)
    const snapped = steppedValue(raw)
    setLocalValue(raw)
    currentValueRef.current = snapped
    onSliderMoved?.(snapped)
  }

  const handlePointerMove = (ev: PointerEvent<HTMLDivElement>) => {
    if (disabled || pointerIdRef.current !== ev.pointerId) return
    const pct = getPercentageFromClient(ev.clientX, ev.clientY)
    const raw = percentageToValue(pct)
    const snapped = steppedValue(raw)
    setLocalValue(raw)
    currentValueRef.current = snapped
    onSliderMoved?.(snapped)
  }

  const handlePointerUp = (ev: PointerEvent<HTMLDivElement>) => {
    if (pointerIdRef.current !== ev.pointerId) return
    pointerIdRef.current = null
    if (ev.currentTarget.hasPointerCapture(ev.pointerId)) {
      ev.currentTarget.releasePointerCapture(ev.pointerId)
    }
    setPressed(false)
    hideTooltip()
    if (disabled) return

    const pct = getPercentageFromClient(ev.clientX, ev.clientY)
    const snapped = steppedValue(percentageToValue(pct))
    setLocalValue(snapped)
    currentValueRef.current = snapped
    onSliderMoved?.(undefined)
    onValueChanged?.(snapped)
  }

  const handlePointerCancel = (ev: PointerEvent<HTMLDivElement>) => {
    if (pointerIdRef.current !== ev.pointerId) return
    pointerIdRef.current = null
    setPressed(false)
    hideTooltip()
    setLocalValue(savedValueRef.current)
    currentValueRef.current = savedValueRef.current
    onSliderMoved?.(undefined)
  }

  const handleKeyDown = (ev: KeyboardEvent<HTMLDivElement>) => {
    if (disabled || !A11Y_KEY_CODES.has(ev.code)) return
    ev.preventDefault()

    const tenPercentStep = Math.max(step, (max - min) / 10)
    const base = currentValueRef.current ?? min
    let next: number

    if (ev.code === 'Home') {
      next = min
    } else if (ev.code === 'End') {
      next = max
    } else if (ev.code === 'PageUp') {
      next = steppedValue(base + tenPercentStep)
    } else if (ev.code === 'PageDown') {
      next = steppedValue(base - tenPercentStep)
    } else {
      const isRtl = typeof document !== 'undefined' && document.dir === 'rtl'
      let mult = 1
      if (ev.code === 'ArrowRight') mult = isRtl ? -1 : 1
      else if (ev.code === 'ArrowUp') mult = 1
      else if (ev.code === 'ArrowLeft') mult = isRtl ? 1 : -1
      else if (ev.code === 'ArrowDown') mult = -1
      next = boundedValue(base + step * mult)
    }

    setLocalValue(next)
    currentValueRef.current = next
    showTooltip()
    onSliderMoved?.(next)
  }

  const handleKeyUp = (ev: KeyboardEvent<HTMLDivElement>) => {
    if (disabled || !A11Y_KEY_CODES.has(ev.code)) return
    ev.preventDefault()
    hideTooltip(500)
    if (currentValueRef.current !== undefined) {
      onValueChanged?.(currentValueRef.current)
    }
  }

  const formatValueText = (v: number): string => {
    const numStr = formatters ? formatters.formatNumber(v) : String(v)
    if (!unit) return numStr
    const space = formatters ? formatters.blankBeforeUnit(unit) : unit === '%' || unit === '°' ? '' : '\u00A0'
    return `${numStr}${space}${unit}`
  }

  const effectiveThickness = thickness ?? (vertical ? 130 : 40)
  const effectiveRadius = borderRadius ?? (vertical ? 36 : 12)
  const handleSize = 4
  const handleMargin = effectiveThickness / 8
  const handleSpacing = 2 * handleMargin + handleSize
  const cursorSize = effectiveThickness / 4

  const pct = localValue != null ? valueToPercentage(localValue) : 0
  const valuenow = localValue != null ? displayedValue(localValue) : undefined
  const ariaValueText =
    localValue == null
      ? formatters?.localize('state.default.unknown') || 'Unknown'
      : formatValueText(displayedValue(localValue))

  const pos = tooltipPosition ?? (vertical ? 'left' : 'top')
  const isTooltipShown =
    tooltipMode !== 'never' &&
    (tooltipMode === 'always' || (tooltipVisible && tooltipMode === 'interaction'))

  // Compute bar transform matching ha-control-slider.ts
  const hasHandle = showHandle && localValue != null
  const sliderSizeExpr = hasHandle ? `calc(100% - ${handleSpacing}px)` : '100%'

  let barStyle: CSSProperties = {}
  if (mode !== 'cursor') {
    if (vertical) {
      if (mode === 'end') {
        barStyle = {
          top: 0,
          left: 0,
          transform: `translate3d(0, calc(${-pct} * ${sliderSizeExpr}), 0)`,
        }
      } else {
        barStyle = {
          bottom: 0,
          left: 0,
          transform: `translate3d(0, calc(${1 - pct} * ${sliderSizeExpr}), 0)`,
        }
      }
    } else if (mode === 'end') {
      barStyle = {
        top: 0,
        right: 0,
        transform: `translate3d(calc(${pct} * ${sliderSizeExpr}), 0, 0)`,
      }
    } else {
      barStyle = {
        top: 0,
        left: 0,
        transform: `translate3d(calc(${pct - 1} * ${sliderSizeExpr}), 0, 0)`,
      }
    }
  }

  const tooltipPosStyle: CSSProperties = (() => {
    const pctClamped = Math.max(0, Math.min(1, pct))
    if (vertical) {
      return {
        bottom: `${pctClamped * 100}%`,
        ...(pos === 'left'
          ? { left: -6, transform: 'translate3d(-100%, 50%, 0)' }
          : { right: -6, transform: 'translate3d(100%, 50%, 0)' }),
      }
    }
    return {
      left: `${pctClamped * 100}%`,
      ...(pos === 'top'
        ? { top: -6, transform: 'translate3d(-50%, -100%, 0)' }
        : { bottom: -6, transform: 'translate3d(-50%, 100%, 0)' }),
    }
  })()

  return (
    <div
      className={`relative select-none ${
        vertical ? 'h-[240px]' : 'w-full'
      } ${className}`}
      style={{
        width: vertical ? effectiveThickness : undefined,
        height: vertical ? undefined : effectiveThickness,
        ...style,
      }}
    >
      <div
        ref={sliderRef}
        role="slider"
        tabIndex={disabled ? undefined : 0}
        aria-label={label}
        aria-valuenow={valuenow}
        aria-valuetext={ariaValueText}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-orientation={vertical ? 'vertical' : 'horizontal'}
        aria-disabled={disabled || undefined}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        onKeyDown={handleKeyDown}
        onKeyUp={handleKeyUp}
        className={`relative h-full w-full touch-none overflow-hidden outline-none transition-shadow duration-180 ease-in-out focus-visible:ring-2 ${
          disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'
        }`}
        style={{
          borderRadius: effectiveRadius,
          ['--tw-ring-color' as string]: color,
        }}
      >
        {/* Track background */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0"
          style={{ background, opacity: backgroundOpacity }}
        />

        {backgroundSlot && (
          <div aria-hidden="true" className="pointer-events-none absolute inset-0">
            {backgroundSlot}
          </div>
        )}

        {/* Cursor mode */}
        {mode === 'cursor' ? (
          localValue != null && (
            <div
              aria-hidden="true"
              className={`pointer-events-none absolute flex items-center justify-center bg-white shadow-md ${
                pressed ? '' : 'transition-[left,bottom] duration-180 ease-in-out'
              }`}
              style={
                vertical
                  ? {
                      left: 0,
                      right: 0,
                      height: cursorSize,
                      bottom: `calc(${pct} * (100% - ${cursorSize}px))`,
                      borderRadius: Math.min(handleSize, effectiveRadius),
                    }
                  : {
                      top: 0,
                      bottom: 0,
                      width: cursorSize,
                      left: `calc(${pct} * (100% - ${cursorSize}px))`,
                      borderRadius: Math.min(handleSize, effectiveRadius),
                    }
              }
            >
              <span
                className="rounded-full bg-neutral-500/80"
                style={
                  vertical
                    ? { width: '50%', height: handleSize }
                    : { width: handleSize, height: '50%' }
                }
              />
            </div>
          )
        ) : (
          /* Filled bar mode */
          <div
            aria-hidden="true"
            className={`pointer-events-none absolute h-full w-full ${
              pressed ? '' : 'transition-[transform,background-color] duration-180 ease-in-out'
            }`}
            style={{
              backgroundColor: color,
              borderRadius: Math.min(effectiveRadius, 12),
              ...barStyle,
            }}
          >
            {/* White pill handle inside the bar */}
            <span
              className="absolute m-auto rounded-full bg-white"
              style={
                vertical
                  ? mode === 'end'
                    ? {
                        bottom: handleMargin,
                        left: 0,
                        right: 0,
                        width: '50%',
                        height: handleSize,
                      }
                    : {
                        top: handleMargin,
                        left: 0,
                        right: 0,
                        width: '50%',
                        height: handleSize,
                      }
                  : mode === 'end'
                    ? {
                        top: 0,
                        bottom: 0,
                        left: handleMargin,
                        height: '50%',
                        width: handleSize,
                      }
                    : {
                        top: 0,
                        bottom: 0,
                        right: handleMargin,
                        height: '50%',
                        width: handleSize,
                      }
              }
            />
          </div>
        )}
      </div>

      {/* Floating value tooltip */}
      {tooltipMode !== 'never' && (
        <span
          aria-hidden="true"
          className={`pointer-events-none absolute z-20 rounded-xl border border-border/60 bg-background/95 px-2 py-0.5 text-sm font-medium whitespace-nowrap text-foreground shadow-md transition-opacity duration-180 ease-in-out ${
            isTooltipShown ? 'opacity-100' : 'opacity-0'
          }`}
          style={tooltipPosStyle}
        >
          {formatValueText(displayedValue(localValue ?? min))}
        </span>
      )}
    </div>
  )
}
