/* Ported from home-assistant/frontend (Apache-2.0):
   - src/components/ha-control-select-menu.ts
   - src/components/ha-dropdown-item.ts
   - src/dialogs/more-info/components/ha-more-info-control-select-container.ts */

import { mdiMenuDown } from '@mdi/js'
import { type ReactNode, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { MdiIcon } from './MdiIcon'

export type SelectOption = {
  label: string
  value: string
  iconPath?: string
}

export type SelectMenuProps = {
  label: string
  value?: string
  options: SelectOption[]
  disabled?: boolean
  hideLabel?: boolean
  showArrow?: boolean
  fullWidth?: boolean
  defaultIconPath?: string
  onSelect: (value: string) => void
}

type MenuPos = {
  top?: number
  bottom?: number
  left: number
  minWidth: number
  maxHeight: number
}

export function SelectMenu({
  label,
  value,
  options,
  disabled = false,
  hideLabel = false,
  showArrow = false,
  fullWidth = false,
  defaultIconPath,
  onSelect,
}: SelectMenuProps) {
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)
  const [pos, setPos] = useState<MenuPos | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const labelId = useId()
  const menuId = useId()

  const selectedOption = options.find((o) => o.value === value)
  const triggerIconPath = selectedOption?.iconPath ?? defaultIconPath

  useEffect(() => {
    if (disabled && open) setOpen(false)
  }, [disabled, open])

  const updatePosition = () => {
    const btn = triggerRef.current
    if (!btn) return
    const rect = btn.getBoundingClientRect()
    const gap = 6
    const margin = 8
    const spaceBelow = window.innerHeight - rect.bottom - margin
    const spaceAbove = rect.top - margin
    const openUpward = spaceBelow < 180 && spaceAbove > spaceBelow
    const minWidth = Math.max(rect.width, 148)
    const left = Math.max(margin, Math.min(rect.left, window.innerWidth - minWidth - margin))
    if (openUpward) {
      setPos({
        bottom: window.innerHeight - rect.top + gap,
        left,
        minWidth,
        maxHeight: Math.min(260, Math.max(120, spaceAbove - gap)),
      })
    } else {
      setPos({
        top: rect.bottom + gap,
        left,
        minWidth,
        maxHeight: Math.min(260, Math.max(120, spaceBelow - gap)),
      })
    }
  }

  useLayoutEffect(() => {
    if (!open) return
    updatePosition()
    const idx = options.findIndex((o) => o.value === value)
    setActiveIndex(idx >= 0 ? idx : 0)
  }, [open, options, value])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (ev: PointerEvent) => {
      const target = ev.target as Node | null
      if (triggerRef.current?.contains(target) || menuRef.current?.contains(target)) return
      setOpen(false)
    }
    // Capture phase so Escape closes the dropdown first without closing the device card in HomePanel.
    const onKeyDown = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') {
        ev.preventDefault()
        ev.stopPropagation()
        ev.stopImmediatePropagation()
        setOpen(false)
        triggerRef.current?.focus()
        return
      }
      if (ev.key === 'ArrowDown') {
        ev.preventDefault()
        setActiveIndex((i) => (options.length ? (i + 1) % options.length : 0))
      } else if (ev.key === 'ArrowUp') {
        ev.preventDefault()
        setActiveIndex((i) => (options.length ? (i - 1 + options.length) % options.length : 0))
      } else if (ev.key === 'Home') {
        ev.preventDefault()
        setActiveIndex(0)
      } else if (ev.key === 'End') {
        ev.preventDefault()
        setActiveIndex(Math.max(0, options.length - 1))
      } else if (ev.key === 'Enter' || ev.key === ' ') {
        const picked = options[activeIndex]
        if (picked) {
          ev.preventDefault()
          setOpen(false)
          onSelect(picked.value)
          triggerRef.current?.focus()
        }
      }
    }
    const onScrollOrResize = (ev: Event) => {
      if (ev.type === 'scroll' && menuRef.current?.contains(ev.target as Node | null)) return
      updatePosition()
    }
    window.addEventListener('pointerdown', onPointerDown, true)
    window.addEventListener('keydown', onKeyDown, true)
    window.addEventListener('resize', onScrollOrResize)
    window.addEventListener('scroll', onScrollOrResize, true)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('keydown', onKeyDown, true)
      window.removeEventListener('resize', onScrollOrResize)
      window.removeEventListener('scroll', onScrollOrResize, true)
    }
  }, [open, options, activeIndex, onSelect])

  return (
    <div className={fullWidth ? 'w-full' : 'min-w-[120px] max-w-[140px] flex-1'}>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-labelledby={labelId}
        onClick={() => !disabled && setOpen((v) => !v)}
        className={`flex h-12 w-full items-center gap-2.5 overflow-hidden rounded-xl px-2.5 py-1.5 text-left transition-colors focus-visible:outline-2 focus-visible:outline-ring ${
          disabled
            ? 'cursor-not-allowed bg-foreground/[0.05] text-muted-foreground opacity-60'
            : 'cursor-pointer bg-foreground/[0.08] text-foreground hover:bg-foreground/[0.13]'
        }`}
      >
        {triggerIconPath && (
          <span className="grid size-5 shrink-0 place-items-center text-foreground/90">
            <MdiIcon path={triggerIconPath} size={20} />
          </span>
        )}
        <span className="flex min-w-0 flex-1 flex-col justify-center overflow-hidden">
          <span
            id={labelId}
            className={
              hideLabel
                ? 'sr-only'
                : selectedOption
                  ? 'truncate text-[12px] leading-[1.3] tracking-[0.2px] text-muted-foreground'
                  : 'truncate text-sm leading-[1.4]'
            }
          >
            {label}
          </span>
          {selectedOption && (
            <span className="truncate text-[14px] leading-[1.35] font-normal">
              {selectedOption.label}
            </span>
          )}
        </span>
        {showArrow && (
          <span className="grid size-5 shrink-0 place-items-center text-muted-foreground">
            <MdiIcon path={mdiMenuDown} size={20} />
          </span>
        )}
      </button>

      {open &&
        pos &&
        createPortal(
          <div
            ref={menuRef}
            id={menuId}
            role="listbox"
            aria-labelledby={labelId}
            className="ui-scroll pointer-events-auto fixed z-50 grid gap-0.5 overflow-y-auto rounded-xl border border-border/70 bg-background/95 p-1 shadow-xl backdrop-blur"
            style={{
              top: pos.top,
              bottom: pos.bottom,
              left: pos.left,
              minWidth: pos.minWidth,
              maxHeight: pos.maxHeight,
            }}
          >
            {options.map((opt, index) => {
              const selected = opt.value === value
              const highlighted = index === activeIndex
              const iconPath = opt.iconPath ?? defaultIconPath
              return (
                <button
                  key={opt.value}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => {
                    setOpen(false)
                    onSelect(opt.value)
                    triggerRef.current?.focus()
                  }}
                  className={`flex min-h-10 w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition-colors ${
                    selected
                      ? 'bg-[#009ac7]/15 font-medium text-[#009ac7]'
                      : highlighted
                        ? 'bg-foreground/[0.08] text-foreground'
                        : 'text-foreground hover:bg-foreground/[0.08]'
                  }`}
                >
                  {iconPath && (
                    <span className="grid size-5 shrink-0 place-items-center opacity-90">
                      <MdiIcon path={iconPath} size={20} />
                    </span>
                  )}
                  <span className="truncate">{opt.label}</span>
                </button>
              )
            })}
          </div>,
          document.body,
        )}
    </div>
  )
}

/** Port of `ha-more-info-control-select-container`: centered wrapping grid of select menu tiles. */
export function SelectContainer({ children }: { children: ReactNode }) {
  return (
    <div className="flex w-full flex-wrap justify-center gap-2">
      {children}
    </div>
  )
}
