/* Ported from home-assistant/frontend (Apache-2.0):
   - src/components/ha-control-button.ts
   - src/components/ha-control-button-group.ts */

import type { CSSProperties, MouseEventHandler, ReactNode } from 'react'

export type ControlButtonProps = {
  label?: string
  disabled?: boolean
  backgroundColor?: string
  backgroundOpacity?: number
  iconColor?: string
  borderRadius?: string
  ariaPressed?: boolean
  className?: string
  style?: CSSProperties
  onClick?: MouseEventHandler<HTMLButtonElement>
  children?: ReactNode
}

export function ControlButton({
  label,
  disabled = false,
  backgroundColor = 'var(--foreground)',
  backgroundOpacity = 0.1,
  iconColor = 'var(--foreground)',
  borderRadius = '12px',
  ariaPressed,
  className = '',
  style,
  onClick,
  children,
}: ControlButtonProps) {
  const effectiveBg = disabled ? 'var(--foreground)' : backgroundColor
  const effectiveOpacity = disabled ? 0.08 : backgroundOpacity
  const effectiveIcon = disabled ? 'var(--muted-foreground)' : iconColor

  return (
    <button
      type="button"
      disabled={disabled}
      aria-label={label}
      title={label}
      aria-pressed={ariaPressed}
      onClick={onClick}
      className={`group relative z-0 flex h-10 w-10 items-center justify-center overflow-hidden border-0 bg-transparent p-2 text-center font-medium transition-[box-shadow,color] duration-180 ease-in-out outline-none select-none focus-visible:ring-2 focus-visible:ring-ring ${
        disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'
      } ${className}`}
      style={{
        borderRadius,
        color: effectiveIcon,
        ...style,
      }}
    >
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-10 transition-[background-color,opacity] duration-180 ease-in-out group-hover:opacity-35"
        style={{
          backgroundColor: effectiveBg,
          opacity: effectiveOpacity,
        }}
      />
      <span className="pointer-events-none flex items-center justify-center opacity-95">
        {children}
      </span>
    </button>
  )
}

export type ControlButtonGroupProps = {
  vertical?: boolean
  className?: string
  style?: CSSProperties
  children: ReactNode
}

export function ControlButtonGroup({
  vertical = false,
  className = '',
  style,
  children,
}: ControlButtonGroupProps) {
  return (
    <div
      className={`flex items-center justify-center gap-3 ${
        vertical ? 'flex-col' : 'flex-row'
      } ${className}`}
      style={style}
    >
      {children}
    </div>
  )
}
