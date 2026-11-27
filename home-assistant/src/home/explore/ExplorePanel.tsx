import { useLocale, usePascalI18n } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import {
  localizedLevelName,
  frameViewerNode,
  selectViewerBuilding,
  selectViewerLevel,
  selectViewerUnit,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  viewerSidebarSections,
  type ViewerSource,
} from '@pascal-app/viewer/ui'
import { ArrowUpRight, Layers, MousePointerClick, PanelRightClose, PanelRightOpen } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef } from 'react'
import { OutreachLinks } from './OutreachLinks'
import { BottomSheet } from './BottomSheet'
import { FloorStack } from './FloorStack'
import { MiniPlan } from './MiniPlan'
import { useRoomHover } from './roomHover'
import { splitFormattedArea } from './planGeometry'

export type LevelEntry = {
  id: string
  level: number
  name: string
}

type LevelLike = { id: string; type?: string; level?: number; name?: string }

/** Extracts sorted floor entries (lowest to highest) from the viewer's scene nodes. */
export function useSceneLevels(source: ViewerSource): LevelEntry[] {
  const i18n = usePascalI18n()
  const locale = useLocale()
  return useMemo(() => {
    return (Object.values(source.nodes) as unknown as LevelLike[])
      .filter((node) => node.type === 'level')
      .sort((a, b) => (a.level ?? 0) - (b.level ?? 0))
      .map((node) => ({
        id: node.id,
        level: node.level ?? 0,
        name: localizedLevelName(node, i18n, locale),
      }))
  }, [source.nodes, i18n, locale])
}

function sectionTitle(kind: 'units' | 'rooms' | 'zones'): string {
  if (kind === 'units') return 'Units'
  if (kind === 'rooms') return 'Rooms'
  return 'Zones'
}

function AreaLabel({ areaM2, unit, locale }: { areaM2: number; unit: 'metric' | 'imperial'; locale: string }) {
  const { value, unitText, hasSquare } = splitFormattedArea(areaM2, unit, locale)
  return (
    <span className="shrink-0 font-mono text-[10px] text-muted-foreground tabular-nums">
      {value}
      {unitText ? <span className="ml-0.5 text-[9px] opacity-75">{unitText}</span> : null}
      {hasSquare ? <sup className="text-[7px] opacity-75">2</sup> : null}
    </span>
  )
}

/**
 * Editorial left Explore panel on desktop (collapsible to a slim rail) and compact top-left pill +
 * draggable bottom sheet on phones. Features the isometric FloorStack, interactive live MiniPlan,
 * synced room list (hover highlights in plan, list, and 3D), and `!embed` Guest CTA footer.
 */
export function ExplorePanel({
  projectName,
  ownerName,
  source,
  levels,
  embed,
  compact,
  open,
  onOpenChange,
  mobileOpen,
  onMobileOpenChange,
  selectedRoomId = null,
  onRoomSelect,
}: {
  projectName: string | null
  ownerName: string | null
  source: ViewerSource
  levels: readonly LevelEntry[]
  embed: boolean
  compact: boolean
  open: boolean
  onOpenChange: (open: boolean) => void
  mobileOpen: boolean
  onMobileOpenChange: (open: boolean) => void
  /** The room picked for linking: it stays lit (in colour, in 3D) until picked again or let go. */
  selectedRoomId?: string | null
  /** A room was picked, or let go (null). */
  onRoomSelect?: (zoneId: string | null) => void
}) {
  const i18n = usePascalI18n()
  const locale = useLocale()
  const selection = useViewer((s) => s.selection)
  const focusedUnitId = useViewer((s) => s.focusedUnitId)
  const hoveredId = useRoomHover((s) => s.id)
  const unit = useViewer((s) => s.unit)
  const hoveredZone = useRef<string | null>(null)

  const clearHover = useCallback((zoneId?: string) => {
    const activeHover = hoveredZone.current
    if (!activeHover) return
    if (zoneId && activeHover !== zoneId) return
    hoveredZone.current = null
    if (useRoomHover.getState().id === activeHover) useRoomHover.getState().set(null)
  }, [])

  const hoverRoom = useCallback((zoneId: string) => {
    // the room's label in 3D lights up, never Pascal's blue floor highlight
    hoveredZone.current = zoneId
    useRoomHover.getState().set(zoneId)
  }, [])

  // Never leave a room label lit when the panel collapses, closes, or unmounts.
  useEffect(() => () => clearHover(), [clearHover])
  useEffect(() => {
    if (compact ? !mobileOpen : !open) clearHover()
  }, [compact, open, mobileOpen, clearHover])

  const activeLevelId =
    (selection.levelId && levels.some((lvl) => lvl.id === selection.levelId) ? selection.levelId : null) ??
    levels[0]?.id ??
    null
  const activeLevelIndex = activeLevelId ? levels.findIndex((lvl) => lvl.id === activeLevelId) : -1
  const activeLevel = activeLevelIndex >= 0 ? levels[activeLevelIndex] : null

  const sections = useMemo(
    () => (activeLevelId ? viewerSidebarSections(activeLevelId, source.nodes, i18n) : []),
    [activeLevelId, source.nodes, i18n],
  )

  const selectLevel = useCallback(
    (id: string) => {
      clearHover()
      selectViewerLevel(id, source)
    },
    [clearHover, source],
  )

  // A click frames a room (its floor shown if it is another) and picks it for linking: it develops
  // into colour in 3D and stays picked, one at a time, until "Done" or Escape lets it go (a second
  // click, or a double click, never does). The viewer's own selection stays empty, so its highlight
  // is only ever the hover's.
  const selectRoom = useCallback(
    (zoneId: string) => {
      const zone = source.nodes[zoneId as keyof typeof source.nodes] as { type?: string; parentId?: string | null } | undefined
      const viewer = useViewer.getState()
      const levelId = (zone?.type === 'zone' && zone.parentId ? zone.parentId : viewer.selection.levelId) as typeof viewer.selection.levelId
      viewer.setSelection({ ...viewer.selection, levelId, zoneId: null, selectedIds: [] })
      frameViewerNode(zoneId, source)
      onRoomSelect?.(zoneId)
      if (compact) {
        clearHover()
        onMobileOpenChange(false)
      }
    },
    [clearHover, source, compact, onMobileOpenChange, onRoomSelect],
  )

  const selectBuilding = useCallback(() => {
    clearHover()
    selectViewerBuilding(source)
  }, [clearHover, source])

  const floorStack = (
    <FloorStack
      activeLevelId={activeLevelId}
      compact={compact}
      hasExplicitLevel={Boolean(selection.levelId)}
      levels={levels}
      onSelectBuilding={selectBuilding}
      onSelectLevel={selectLevel}
    />
  )

  const miniPlan =
    levels.length > 0 ? (
      <div className="mb-3.5">
        <div className="mb-1.5 flex items-center justify-between">
          <span className="ui-eyebrow ui-eyebrow-rule">Plan</span>
          {activeLevel ? (
            <span className="truncate font-mono text-[10px] text-muted-foreground">{activeLevel.name}</span>
          ) : null}
        </div>
        <MiniPlan
          levelId={activeLevelId}
          onHoverRoom={hoverRoom}
          onLeaveRoom={clearHover}
          onSelectRoom={selectRoom}
          source={source}
        />
        {/* rooms are buttons: say so, rather than leaving it to a hover */}
        <p className="mt-1.5 flex items-center gap-1.5 text-muted-foreground text-xs">
          <MousePointerClick aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
          Click a room to see and link its devices
        </p>
      </div>
    ) : null

  const pickedRoom = selectedRoomId
    ? sections.flatMap((section) => (section.kind === 'units' ? [] : section.rows)).find((row) => row.id === selectedRoomId)?.label
    : undefined
  const roomList =
    sections.length > 0 ? (
      <div className="flex flex-col gap-3">
        {sections.map((section) => (
          <div data-viewer-section={section.kind} key={section.kind}>
            <div className="mb-1 flex items-center justify-between px-1">
              <span className="ui-eyebrow ui-eyebrow-rule">{sectionTitle(section.kind)}</span>
              <span className="font-mono text-[10px] text-muted-foreground tabular-nums">{section.rows.length}</span>
            </div>
            <ul className="flex flex-col gap-0.5">
              {section.rows.map((row) => {
                const isRoom = section.kind !== 'units'
                const active = isRoom ? row.id === selectedRoomId : row.id === focusedUnitId
                const syncedHover = isRoom && row.id === hoveredId
                return (
                  <li key={row.id}>
                    <button
                      aria-current={!isRoom && active ? 'location' : undefined}
                      aria-pressed={isRoom ? active : undefined}
                      className={`flex w-full items-center gap-2.5 rounded-full px-2.5 text-left text-xs transition-colors focus-visible:outline-2 focus-visible:outline-ring focus-visible:-outline-offset-2 ${
                        compact ? 'min-h-11 py-2' : 'py-1.5'
                      } ${
                        active
                          ? 'bg-foreground/[0.11] font-medium text-foreground'
                          : syncedHover
                            ? 'bg-foreground/[0.06] text-foreground'
                            : 'text-muted-foreground hover:bg-foreground/[0.05] hover:text-foreground'
                      }`}
                      onBlur={() => {
                        if (isRoom) clearHover(row.id)
                      }}
                      onClick={() => {
                        if (isRoom) {
                          selectRoom(row.id)
                        } else {
                          clearHover()
                          selectViewerUnit(row.id, source)
                          if (compact) onMobileOpenChange(false)
                        }
                      }}
                      onFocus={() => {
                        if (isRoom) hoverRoom(row.id)
                      }}
                      onPointerEnter={() => {
                        if (isRoom) hoverRoom(row.id)
                      }}
                      onPointerLeave={() => {
                        if (isRoom) clearHover(row.id)
                      }}
                      type="button"
                    >
                      <span
                        aria-hidden="true"
                        className="h-2 w-2 shrink-0 rounded-full transition-transform duration-150"
                        style={{
                          backgroundColor: row.color,
                          transform: active || syncedHover ? 'scale(1.25)' : undefined,
                        }}
                      />
                      <span className="min-w-0 flex-1 truncate">{row.label}</span>
                      <AreaLabel areaM2={row.areaM2} locale={locale} unit={unit} />
                    </button>
                  </li>
                )
              })}
            </ul>
          </div>
        ))}
        {pickedRoom && (
          <div className="flex items-center gap-2 rounded-2xl bg-foreground/[0.05] px-3 py-2">
            <p className="min-w-0 flex-1 text-muted-foreground text-xs leading-snug">
              Click any furniture in {pickedRoom} to link a device.
            </p>
            <button
              className="h-7 shrink-0 rounded-full px-3 font-medium text-foreground text-xs transition-colors hover:bg-foreground/[0.08] focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2"
              onClick={() => onRoomSelect?.(null)}
              type="button"
            >
              Done
            </button>
          </div>
        )}
      </div>
    ) : levels.length > 0 ? (
      <p className="px-1 py-2 text-muted-foreground text-xs">No named rooms on this floor.</p>
    ) : null

  const guestFooter = !embed ? (
    <div className="border-foreground/10 border-t pt-3">
      <p className="text-muted-foreground text-xs leading-snug">Want to create your own 3D project?</p>
      <a
        className="mt-2 inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-full bg-foreground px-4 font-medium text-background text-xs transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2"
        href="https://editor.pascal.app"
      >
        <span>Get started</span>
        <ArrowUpRight aria-hidden="true" className="h-3.5 w-3.5" />
      </a>
    </div>
  ) : null

  if (compact) {
    return (
      <>
        <div className="ui-enter-right" data-chrome-surface="" data-viewer-header="">
          <button
            aria-expanded={mobileOpen}
            aria-label="Open explore panel"
            className="ui-glass pointer-events-auto absolute top-3 right-3 z-20 flex h-11 max-w-[calc(100vw-4.75rem)] items-center gap-2.5 rounded-full pr-4 pl-3 text-left text-foreground focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2"
            onClick={() => onMobileOpenChange(true)}
            type="button"
          >
            <Layers aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium text-xs leading-tight">{projectName || 'Untitled'}</span>
              {activeLevel ? (
                <span className="block truncate font-mono text-[10px] text-muted-foreground leading-tight">
                  {activeLevel.name}
                </span>
              ) : null}
            </span>
          </button>
        </div>

        <BottomSheet
          eyebrow={ownerName ? `By ${ownerName}` : 'Explore'}
          onClose={() => onMobileOpenChange(false)}
          open={mobileOpen}
          title={projectName || 'Untitled'}
        >
          <div className="flex flex-col gap-1 pb-2">
            {floorStack}
            {miniPlan}
            {roomList}
            {guestFooter ? <div className="mt-3">{guestFooter}</div> : null}
          </div>
        </BottomSheet>
      </>
    )
  }

  return (
    <div
      className="ui-enter-right ui-immersive-transition"
      data-chrome-edge="right"
      data-chrome-surface=""
      data-viewer-header=""
    >
      {open ? (
        <aside
          aria-label="Explore project"
          className="ui-glass corner-smooth pointer-events-auto absolute top-4 right-4 z-20 flex max-h-[calc(100dvh-11rem)] w-[18.25rem] flex-col overflow-hidden rounded-[20px] text-foreground"
        >
          <div className="px-4 pt-3 pb-3.5">
            {/* 6px in from the top and right edges, like the collapsed pill's padding, so the
                toggle stays put between the two states. */}
            <div className="-mx-2.5 -mt-1.5 flex items-center justify-between gap-2">
              {!embed ? (
                <div className="min-w-0">
                  <OutreachLinks />
                </div>
              ) : (
                <span />
              )}
              <Tooltip delayDuration={150}>
                <TooltipTrigger asChild>
                  <button
                    aria-label="Collapse explore panel"
                    className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-foreground/[0.08] hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2"
                    onClick={() => onOpenChange(false)}
                    type="button"
                  >
                    <PanelRightClose className="h-4 w-4" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="left">
                  <span className="inline-flex items-center gap-1.5">
                    <span>Collapse</span>
                    <kbd className="ui-kbd-tip">E</kbd>
                  </span>
                </TooltipContent>
              </Tooltip>
            </div>
          </div>

          {levels.length > 0 ? (
            <div className="ui-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain border-foreground/10 border-t px-4 py-3.5">
              {floorStack}
              {miniPlan}
              {roomList}
            </div>
          ) : null}

        </aside>
      ) : (
        <aside
          aria-label="Explore project"
          className="ui-glass pointer-events-auto absolute top-4 right-4 z-20 flex items-center gap-1 rounded-full p-1.5 text-foreground"
        >
          {!embed ? <OutreachLinks /> : null}
          <Tooltip delayDuration={150}>
            <TooltipTrigger asChild>
              <button
                aria-label="Expand explore panel"
                className="ui-dock-item grid h-9 w-9 place-items-center rounded-full text-foreground transition-colors hover:bg-foreground/[0.08] focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2"
                onClick={() => onOpenChange(true)}
                type="button"
              >
                <PanelRightOpen className="h-4 w-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              <span className="inline-flex items-center gap-1.5">
                <span>{projectName || 'Explore'}</span>
                <kbd className="ui-kbd-tip">E</kbd>
              </span>
            </TooltipContent>
          </Tooltip>

        </aside>
      )}
    </div>
  )
}
