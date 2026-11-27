/* Ported from home-assistant/frontend (Apache-2.0):
   - src/components/ha-control-select.ts */

import {
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
  useRef,
  useState,
} from 'react'
import { MdiIcon } from './MdiIcon'
import { HA_COLORS } from './stateColors'

export type ControlSelectOption = {
  value: string
  label?: string
  ariaLabel?: string
  icon?: ReactNode
  path?: string
}

export type ControlSelectProps = {
  options: ControlSelectOption[]
  value?: string
  vertical?: boolean
  hideOptionLabel?: boolean
  disabled?: boolean
  label?: string
  color?: string
  background?: string
  backgroundOpacity?: number
  borderRadius?: number
  padding?: number
  className?: string
  style?: CSSProperties
  onValueChanged: (value: string) => void
}

export function ControlSelect({
  options,
  value,
  vertical = false,
  hideOptionLabel = false,
  disabled = false,
  label,
  color = HA_COLORS.primary,
  background = HA_COLORS.inactive,
  backgroundOpacity = 0.2,
  borderRadius,
  padding = 4,
  className = '',
  style,
  onValueChanged,
}: ControlSelectProps) {
  const [activeIndex, setActiveIndex] = useState<number | undefined>(undefined)
  const optionRefs = useRef<(HTMLDivElement | null)[]>([])

  const selectedIndex = value != null ? options.findIndex((o) => o.value === value) : -1
  const tabbableIndex = selectedIndex === -1 ? 0 : selectedIndex

  const focusOption = (index: number) => {
    setActiveIndex(index)
    optionRefs.current[index]?.focus()
  }

  const handleKeyDown = (ev: KeyboardEvent<HTMLDivElement>) => {
    if (disabled || options.length === 0) return
    let idx = activeIndex ?? tabbableIndex

    switch (ev.key) {
      case ' ':
      case 'Enter': {
        const picked = options[idx]
        if (picked) onValueChanged(picked.value)
        break
      }
      case 'ArrowUp':
      case 'ArrowLeft':
        idx = idx <= 0 ? options.length - 1 : idx - 1
        focusOption(idx)
        break
      case 'ArrowDown':
      case 'ArrowRight':
        idx = (idx + 1) % options.length
        focusOption(idx)
        break
      default:
        return
    }
    ev.preventDefault()
  }

  const effectiveRadius = borderRadius ?? (vertical ? 36 : 12)
  const itemRadius = Math.max(6, effectiveRadius - padding)

  return (
    <div
      role="radiogroup"
      aria-label={label}
      aria-disabled={disabled || undefined}
      onKeyDown={handleKeyDown}
      className={`relative box-border flex select-none outline-none ${
        vertical ? 'w-[130px] flex-col' : 'h-10 w-full flex-row'
      } ${disabled ? 'opacity-50' : ''} ${className}`}
      style={{
        borderRadius: effectiveRadius,
        padding,
        gap: padding,
        ...style,
      }}
    >
      {/* Container tinted backdrop */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          background,
          opacity: backgroundOpacity,
          borderRadius: effectiveRadius,
        }}
      />

      {options.map((opt, index) => {
        const selected = opt.value === value
        const title = opt.ariaLabel ?? opt.label
        return (
          <div
            key={opt.value}
            ref={(el) => {
              optionRefs.current[index] = el
            }}
            role="radio"
            aria-checked={selected}
            aria-label={title}
            title={title}
            tabIndex={disabled ? undefined : index === tabbableIndex ? 0 : -1}
            onClick={() => {
              if (!disabled) onValueChanged(opt.value)
            }}
            onFocus={() => {
              if (!disabled) setActiveIndex(index)
            }}
            className={`group relative z-0 flex flex-1 items-center justify-center overflow-hidden text-center text-sm font-medium outline-none transition-shadow duration-180 ease-in-out focus-visible:ring-2 ${
              disabled ? 'cursor-not-allowed' : 'cursor-pointer'
            } ${selected ? 'text-white' : 'text-foreground'}`}
            style={{
              borderRadius: itemRadius,
              minHeight: vertical ? 44 : undefined,
              ['--tw-ring-color' as string]: color,
            }}
          >
            {/* Option hover/selected fill */}
            <span
              aria-hidden="true"
              className={`pointer-events-none absolute inset-0 -z-10 transition-[background-color,opacity] duration-150 ease-in-out ${
                selected
                  ? 'opacity-100'
                  : disabled
                    ? 'opacity-0'
                    : 'opacity-0 group-hover:opacity-20'
              }`}
              style={{
                backgroundColor: color,
                borderRadius: itemRadius,
              }}
            />
            <span className="pointer-events-none flex w-full flex-col items-center justify-center gap-0.5 px-1 py-0.5">
              {opt.path ? <MdiIcon path={opt.path} size={20} /> : opt.icon}
              {opt.label && !hideOptionLabel && (
                <span className="w-full truncate text-xs leading-tight">{opt.label}</span>
              )}
            </span>
          </div>
        )
      })}
    </div>
  )
}
