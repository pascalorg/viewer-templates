import { type KeyboardEvent, type ReactNode, useId, useRef } from 'react'

/**
 * Building blocks for a template's fields inside `SettingsPanel`, so every template's settings read
 * alike and stay accessible. Buttons take `className="pascal-settings-button"` (add
 * `pascal-settings-primary` for the one main action).
 */

/** A titled group of fields: "Opening view", "Room tour". */
export function SettingsSection({ title, description, children }: {
  title: string
  description?: ReactNode
  children: ReactNode
}) {
  const id = useId()
  return (
    <section aria-labelledby={id} className="pascal-settings-section">
      <h3 className="pascal-settings-section-title" id={id}>{title}</h3>
      {description ? <p className="pascal-settings-hint">{description}</p> : null}
      {children}
    </section>
  )
}

/**
 * One labelled field. `value` says in words what is set now ("Custom", "Default (frames the
 * house)"), so a manager always reads what Save will store; `children` are its controls.
 */
export function SettingsRow({ label, value, hint, children }: {
  label: string
  value?: ReactNode
  hint?: ReactNode
  children?: ReactNode
}) {
  const labelId = useId()
  const valueId = useId()
  return (
    <div aria-describedby={value !== undefined ? valueId : undefined} aria-labelledby={labelId}
      className="pascal-settings-row" role="group">
      <div className="pascal-settings-row-head">
        <span className="pascal-settings-label" id={labelId}>{label}</span>
        {value !== undefined ? <span className="pascal-settings-value" id={valueId}>{value}</span> : null}
      </div>
      {children ? <div className="pascal-settings-row-controls">{children}</div> : null}
      {hint ? <p className="pascal-settings-hint">{hint}</p> : null}
    </div>
  )
}

export type SettingsOption<V extends string> = { value: V; label: string; disabled?: boolean }

/**
 * A choice of one (radio-group semantics): arrow keys move the choice, Tab leaves the group.
 * Choosing applies at once; for a setting a visitor sees, also show it on screen.
 */
export function SettingsOptions<V extends string>({ label, options, value, onChange, disabled = false }: {
  /** The group's accessible name. */
  label: string
  options: readonly SettingsOption<V>[]
  value: V
  onChange: (value: V) => void
  disabled?: boolean
}) {
  const group = useRef<HTMLDivElement>(null)
  const enabled = options.filter((option) => !option.disabled)
  const focusable = enabled.some((option) => option.value === value) ? value : enabled[0]?.value

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = ({ ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 } as Record<string, number>)[event.key]
    if (step === undefined && event.key !== 'Home' && event.key !== 'End') return
    if (disabled || enabled.length === 0) return
    event.preventDefault()
    event.stopPropagation()
    const index = enabled.findIndex((option) => option.value === value)
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? enabled.length - 1
      : (Math.max(0, index) + step! + enabled.length) % enabled.length
    const choice = enabled[next]!
    onChange(choice.value)
    group.current?.querySelector<HTMLButtonElement>(`[data-value="${CSS.escape(choice.value)}"]`)?.focus()
  }

  return (
    <div aria-disabled={disabled || undefined} aria-label={label} className="pascal-settings-options"
      onKeyDown={onKeyDown} ref={group} role="radiogroup">
      {options.map((option) => (
        <button aria-checked={option.value === value} className="pascal-settings-option" data-value={option.value}
          disabled={disabled || option.disabled} key={option.value} onClick={() => onChange(option.value)} role="radio"
          tabIndex={option.value === focusable ? 0 : -1} type="button">
          {option.label}
        </button>
      ))}
    </div>
  )
}
