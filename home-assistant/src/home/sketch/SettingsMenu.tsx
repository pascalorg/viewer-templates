import { Box, EyeOff, Moon, Settings, Sparkles, Square, Sun, Volume2, VolumeX } from 'lucide-react'
import { type ReactNode, useEffect, useRef, useState } from 'react'
import { useSoundsOn } from '../sound'
import { choosePlanEdges, chooseTheme, chooseUiStyle, isDark, planEdges, type UiStyle, uiStyle } from '../../theme'

/** The theme and the interface's style as they are now, following every change. */
function useLook() {
  const read = () => ({ dark: isDark(), style: uiStyle(), edges: planEdges() })
  const [look, setLook] = useState(read)
  useEffect(() => {
    const sync = () => setLook(read())
    addEventListener('pascal-theme', sync)
    const system = matchMedia('(prefers-color-scheme: dark)')
    system.addEventListener('change', sync)
    return () => {
      removeEventListener('pascal-theme', sync)
      system.removeEventListener('change', sync)
    }
  }, [])
  return look
}

/**
 * A round settings button, and over it the settings panel: light or dark plan and interface, the
 * interface's style, solid or glass, and the plan's edge lines, hidden or shown. The choices are
 * kept in this browser (`theme.ts`).
 */
export function SettingsMenu({ className = '' }: { className?: string }) {
  const [open, setOpen] = useState(false)
  const { dark, style, edges } = useLook()
  const [sounds, setSounds] = useSoundsOn()
  const root = useRef<HTMLDivElement>(null)

  // a click elsewhere or Escape closes the panel
  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        setOpen(false)
      }
    }
    addEventListener('pointerdown', onDown, true)
    addEventListener('keydown', onKey, true)
    return () => {
      removeEventListener('pointerdown', onDown, true)
      removeEventListener('keydown', onKey, true)
    }
  }, [open])

  return (
    <div className={`pointer-events-auto relative ${className}`} ref={root}>
      {open && (
        <div
          aria-label="Settings"
          className="absolute right-0 bottom-12 w-64 rounded-3xl border border-border/60 bg-background/95 p-4 text-foreground shadow-elevation-4 backdrop-blur-xl"
          role="dialog"
        >
          <p className="mb-3 font-semibold text-sm">Settings</p>
          <Choice label="Appearance">
            <Option active={!dark} icon={<Sun className="h-3.5 w-3.5" />} label="Light" onClick={() => chooseTheme(false)} />
            <Option active={dark} icon={<Moon className="h-3.5 w-3.5" />} label="Dark" onClick={() => chooseTheme(true)} />
          </Choice>
          <Choice label="Interface">
            <Option active={style === 'solid'} icon={<Square className="h-3.5 w-3.5" />} label="Solid" onClick={() => pick('solid')} />
            <Option active={style === 'glass'} icon={<Sparkles className="h-3.5 w-3.5" />} label="Glass" onClick={() => pick('glass')} />
          </Choice>
          <Choice label="Wireframe edges">
            <Option active={!edges} icon={<EyeOff className="h-3.5 w-3.5" />} label="Hidden" onClick={() => choosePlanEdges(false)} />
            <Option active={edges} icon={<Box className="h-3.5 w-3.5" />} label="Shown" onClick={() => choosePlanEdges(true)} />
          </Choice>
          <Choice label="Sounds">
            <Option active={sounds} icon={<Volume2 className="h-3.5 w-3.5" />} label="On" onClick={() => setSounds(true)} />
            <Option active={!sounds} icon={<VolumeX className="h-3.5 w-3.5" />} label="Off" onClick={() => setSounds(false)} />
          </Choice>
        </div>
      )}
      <button
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label="Settings"
        className="corner-smooth flex h-10 w-10 items-center justify-center rounded-full border border-border/60 bg-background/95 text-foreground shadow-elevation-4 backdrop-blur-xl transition-colors hover:bg-background focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2"
        onClick={() => setOpen((o) => !o)}
        type="button"
      >
        <Settings aria-hidden="true" className={`h-4 w-4 transition-transform duration-300 ${open ? 'rotate-90' : ''}`} />
      </button>
    </div>
  )
}

const pick = (style: UiStyle) => chooseUiStyle(style)

function Choice({ label, children }: { label: string; children: ReactNode }) {
  return (
    <fieldset className="mt-3 first-of-type:mt-0">
      <legend className="mb-1.5 text-muted-foreground text-xs">{label}</legend>
      <div className="grid grid-cols-2 gap-1 rounded-full bg-accent p-1">{children}</div>
    </fieldset>
  )
}

function Option({ active, icon, label, onClick }: { active: boolean; icon: ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      aria-pressed={active}
      className={`flex h-8 items-center justify-center gap-1.5 rounded-full font-medium text-xs transition-colors ${
        active ? 'bg-foreground text-background shadow' : 'text-muted-foreground hover:text-foreground'
      }`}
      onClick={onClick}
      type="button"
    >
      <span aria-hidden="true">{icon}</span>
      {label}
    </button>
  )
}
