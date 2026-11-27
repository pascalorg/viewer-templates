/* Ported from home-assistant/frontend (Apache-2.0):
   - src/components/ha-icon-button-group.ts
   - src/components/ha-icon-button-toggle.ts */

import { MdiIcon } from './MdiIcon'

export type IconToggleOption<T extends string> = {
  value: T
  label: string
  iconPath: string
  disabled?: boolean
}

export type IconToggleGroupProps<T extends string> = {
  value: T
  options: IconToggleOption<T>[]
  onChange: (value: T) => void
}

export function IconToggleGroup<T extends string>({
  value,
  options,
  onChange,
}: IconToggleGroupProps<T>) {
  const selectedIndex = options.findIndex((o) => o.value === value && !o.disabled)
  const showThumb = selectedIndex >= 0

  return (
    <div
      role="group"
      className="relative inline-flex h-12 items-center rounded-full bg-foreground/[0.08] p-1"
    >
      <div
        aria-hidden="true"
        className={`pointer-events-none absolute top-1 left-1 size-10 rounded-full bg-foreground transition-[transform,opacity] duration-150 ease-in-out ${
          showThumb ? 'opacity-100' : 'opacity-0'
        }`}
        style={{ transform: `translateX(${Math.max(0, selectedIndex) * 40}px)` }}
      />
      {options.map((opt) => {
        const selected = opt.value === value
        return (
          <button
            key={opt.value}
            type="button"
            disabled={opt.disabled}
            aria-label={opt.label}
            aria-pressed={selected}
            title={opt.label}
            onClick={() => !opt.disabled && onChange(opt.value)}
            className={`relative z-10 grid size-10 place-items-center rounded-full transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-40 ${
              selected && !opt.disabled
                ? 'text-background'
                : 'text-foreground/80 hover:text-foreground'
            }`}
          >
            <MdiIcon path={opt.iconPath} size={20} />
          </button>
        )
      })}
    </div>
  )
}
