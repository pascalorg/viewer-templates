import { usePascalI18n } from '@pascal-app/core'
import { playSound } from '@pascal-app/viewer/sfx'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
  useIsMobile,
  type ViewerStageMode,
} from '@pascal-app/viewer/ui'
import { Box, ChevronUp, Columns2, Map as MapIcon } from 'lucide-react'

/**
 * The 3D / 2D / Split choice, as one button at the start of the mode dock that opens a menu
 * upward. Split is left out on phones, as Pascal's own switcher does.
 */
export function ViewMenu({ stageMode, onStageModeChange }: {
  stageMode: ViewerStageMode
  onStageModeChange: (mode: ViewerStageMode) => void
}) {
  const i18n = usePascalI18n()
  const isMobile = useIsMobile()
  const options = [
    { id: '3d' as const, label: '3D', icon: Box },
    { id: '2d' as const, label: '2D', icon: MapIcon },
    ...(isMobile ? [] : [{ id: 'split' as const, label: i18n._({ id: 'viewer.stage.split', message: 'Split' }), icon: Columns2 }]),
  ]
  const current = options.find((option) => option.id === stageMode) ?? options[0]!
  const CurrentIcon = current.icon
  const layoutLabel = i18n._({ id: 'viewer.stage.layout', message: 'Viewer layout' })

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          aria-label={`${layoutLabel}: ${current.label}`}
          className="studio-hud-light studio-interactive pointer-events-auto inline-flex h-12 items-center gap-1.5 rounded-full px-3.5 font-semibold text-[13px] text-[var(--glass-ink)] transition-colors hover:bg-[var(--glass-bg-strong)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--glass-accent)] data-[state=open]:bg-[var(--glass-bg-strong)]"
          type="button"
        >
          <CurrentIcon aria-hidden className="size-4 shrink-0 text-[var(--glass-accent)]" />
          <span>{current.label}</span>
          <ChevronUp aria-hidden className="size-3.5 shrink-0 text-[var(--glass-muted)]" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-40" side="top" sideOffset={8}>
        <DropdownMenuRadioGroup
          onValueChange={(value) => {
            playSound('menuClick')
            onStageModeChange(value as ViewerStageMode)
          }}
          value={stageMode}
        >
          {options.map((option) => {
            const Icon = option.icon
            return (
              <DropdownMenuRadioItem className="gap-2" key={option.id} value={option.id}>
                <Icon aria-hidden className="size-4" />
                <span>{option.label}</span>
              </DropdownMenuRadioItem>
            )
          })}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
