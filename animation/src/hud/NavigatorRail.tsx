import { type LevelNode, useLocale, usePascalI18n } from '@pascal-app/core'
import { isTypingTarget, markPerfAction, useViewer } from '@pascal-app/viewer'
import {
  formatRoomArea,
  localizedLevelName,
  selectViewerBuilding,
  selectViewerLevel,
  selectViewerRoom,
  selectViewerUnit,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  useIsMobile,
  viewerBreadcrumb,
  type ViewerSource,
  viewerSidebarSections,
} from '@pascal-app/viewer/ui'
import { ArrowUpRight, Building, ChevronLeft, ChevronRight, Layers, Menu, User, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

function sectionTitle(kind: 'units' | 'rooms' | 'zones', i18n: ReturnType<typeof usePascalI18n>) {
  if (kind === 'units') return i18n._({ id: 'viewer.header.units', message: 'Units' })
  if (kind === 'rooms') return i18n._({ id: 'viewer.header.rooms', message: 'Rooms' })
  return i18n._({ id: 'viewer.header.zones', message: 'Zones' })
}

/** Compact badge label for a floor in the collapsed 64px icon rail (e.g. R, G, 1, 2, B1). */
function floorMonogram(level: LevelNode, label: string): string {
  const trimmed = label.trim()
  if (/^roof/i.test(trimmed)) return 'R'
  if (/^ground/i.test(trimmed)) return 'G'
  const numMatch = trimmed.match(/-?\d+/)
  if (numMatch) return trimmed.toLowerCase().startsWith('b') ? `B${Math.abs(Number(numMatch[0]))}` : numMatch[0]
  if (typeof level.level === 'number') {
    if (level.level < 0) return `B${Math.abs(level.level)}`
    if (level.level === 0) return 'G'
    return String(level.level)
  }
  return trimmed.slice(0, 2).toUpperCase() || 'L'
}

function GuestFooterCard() {
  return (
    <div className="shrink-0 border-[var(--glass-border)] border-t p-3">
      <div className="rounded-2xl border border-[var(--glass-border)] bg-[var(--glass-bg-subtle)] p-3">
        <p className="font-medium text-[var(--glass-muted)] text-xs leading-snug">
          Want to create your own 3D project?
        </p>
        <a
          className="studio-interactive mt-2.5 inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-full bg-[var(--glass-accent)] px-3.5 font-semibold text-white text-xs shadow-xs transition-all hover:bg-[var(--glass-accent-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--glass-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-white active:scale-[0.98]"
          href="https://editor.pascal.app"
        >
          Get started
          <ArrowUpRight aria-hidden className="size-3.5 shrink-0" />
        </a>
      </div>
    </div>
  )
}

export function NavigatorRail({ projectName, ownerName, source, embed, collapsed, onToggleCollapsed }: {
  projectName: string | null
  ownerName: string | null
  source: ViewerSource
  embed: boolean
  collapsed: boolean
  onToggleCollapsed: () => void
}) {
  const i18n = usePascalI18n()
  const catalogVersion = i18n.getVersion()
  const locale = useLocale()
  const isMobile = useIsMobile()
  const [mobileOpen, setMobileOpen] = useState(false)

  const selection = useViewer((s) => s.selection)
  const focusedUnitId = useViewer((s) => s.focusedUnitId)
  const unit = useViewer((s) => s.unit)
  const walkthroughMode = useViewer((s) => s.walkthroughMode)

  const { nodes } = source
  const crumbs = useMemo(
    () => viewerBreadcrumb(selection, focusedUnitId, nodes, i18n),
    [selection, focusedUnitId, nodes, i18n, locale, catalogVersion],
  )
  const buildingId = useMemo(() => {
    const fromCrumb = crumbs.find((crumb) => crumb.kind === 'building')?.id
    if (fromCrumb) return fromCrumb
    return Object.values(nodes).find((node) => node.type === 'building')?.id ?? null
  }, [crumbs, nodes])

  // Highest first so the stacked slab rows read top-down like an architectural section.
  const levels = useMemo(() => {
    const building = buildingId ? nodes[buildingId] : undefined
    if (building?.type !== 'building') return []
    return building.children
      .map((id) => nodes[id])
      .filter((node): node is LevelNode => node?.type === 'level')
      .sort((a, b) => b.level - a.level)
  }, [buildingId, nodes])

  const sections = useMemo(
    () => (selection.levelId ? viewerSidebarSections(selection.levelId, nodes, i18n) : []),
    [selection.levelId, nodes, i18n, locale, catalogVersion],
  )

  useEffect(() => {
    if (!mobileOpen) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !isTypingTarget(event.target)) setMobileOpen(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [mobileOpen])

  if (walkthroughMode) return null

  const title = projectName || i18n._({ id: 'viewer.header.untitled', message: 'Untitled' })
  const buildingActive = !selection.levelId

  const selectLevel = (lvl: LevelNode) => {
    if (lvl.id !== selection.levelId) markPerfAction('level-switch', lvl.id)
    selectViewerLevel(lvl.id, source)
  }

  const expandedBody = (onCloseMobile?: () => void) => (
    <>
      <div className="flex shrink-0 items-start gap-2 border-[var(--glass-border)] border-b p-4">
        <div className="min-w-0 flex-1">
          <div className="truncate font-semibold text-[15px] text-[var(--glass-ink)] leading-snug tracking-[-0.015em]" title={title}>
            {title}
          </div>
          {ownerName && (
            <div className="mt-1 flex items-center gap-1.5 text-[var(--glass-muted)] text-xs">
              <User aria-hidden className="size-3 shrink-0 opacity-75" />
              <span className="truncate">{ownerName}</span>
            </div>
          )}
        </div>
        {onCloseMobile ? (
          <button
            aria-label="Close navigator"
            className="studio-interactive flex size-8 shrink-0 items-center justify-center rounded-full text-[var(--glass-muted)] transition-colors hover:bg-[var(--glass-bg-hover)] hover:text-[var(--glass-ink)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--glass-accent)]"
            onClick={onCloseMobile}
            type="button"
          >
            <X className="size-4" />
          </button>
        ) : (
          <button
            aria-label="Collapse navigator"
            className="studio-interactive flex size-8 shrink-0 items-center justify-center rounded-full text-[var(--glass-muted)] transition-colors hover:bg-[var(--glass-bg-hover)] hover:text-[var(--glass-ink)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--glass-accent)]"
            onClick={onToggleCollapsed}
            title="Collapse navigator"
            type="button"
          >
            <ChevronLeft className="size-4" />
          </button>
        )}
      </div>

      <div className="hud-scroll flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
        <button
          aria-pressed={buildingActive}
          className={`studio-interactive flex h-9 w-full shrink-0 items-center gap-2 rounded-full border px-3 font-medium text-[13px] transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--glass-accent)] ${
            buildingActive
              ? 'border-[var(--glass-accent-border)] bg-[var(--glass-accent-soft)] font-semibold text-[var(--glass-accent)]'
              : 'border-[var(--glass-border)] bg-[var(--glass-raised-soft)] text-[var(--glass-ink)] hover:border-[var(--glass-border-strong)] hover:bg-[var(--glass-raised)]'
          }`}
          onClick={() => selectViewerBuilding(source)}
          type="button"
        >
          <Building aria-hidden className="size-4 shrink-0" />
          <span className="truncate">{i18n._({ id: 'viewer.header.building', message: 'Building' })}</span>
        </button>

        {levels.length > 0 && (
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between px-1">
              <span className="font-semibold text-[11px] text-[var(--glass-muted)] uppercase tracking-[0.12em]">
                {i18n._({ id: 'viewer.header.levels', message: 'Levels' })}
              </span>
              <span className="font-mono text-[11px] text-[var(--glass-muted)] tabular-nums">{levels.length}</span>
            </div>

            {/* Architectural building section: stacked slab rows with a vertical datum rail. */}
            <div className="relative flex flex-col gap-1 pl-3 before:pointer-events-none before:absolute before:inset-y-2 before:left-1 before:w-[2px] before:rounded-full before:bg-[var(--glass-border)]">
              {levels.map((lvl, index) => {
                const isSelected = lvl.id === selection.levelId
                const label = localizedLevelName(lvl, i18n, locale)
                // Slight visual slab width cadence reinforces an architectural section cut.
                const barWidth = index === 0 ? 'w-7' : 'w-9'
                return (
                  <div className="flex flex-col" key={lvl.id}>
                    <button
                      aria-pressed={isSelected}
                      className={`studio-interactive group relative flex w-full items-center gap-2.5 rounded-xl border px-3 py-2 text-left text-[13px] transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--glass-accent)] ${
                        isSelected
                          ? 'border-[var(--glass-accent-border)] bg-[var(--glass-accent-soft)] font-semibold text-[var(--glass-accent)] shadow-xs'
                          : 'border-transparent bg-[var(--glass-raised-soft)] text-[var(--glass-ink)]/85 hover:border-[var(--glass-border)] hover:bg-[var(--glass-raised-soft)] hover:text-[var(--glass-ink)]'
                      }`}
                      onClick={() => selectLevel(lvl)}
                      type="button"
                    >
                      <span
                        aria-hidden
                        className={`h-2 ${barWidth} shrink-0 rounded-full transition-colors ${
                          isSelected
                            ? 'bg-[var(--glass-accent)]'
                            : 'bg-[rgb(15_23_42/0.16)] group-hover:bg-[rgb(15_23_42/0.30)]'
                        }`}
                      />
                      <span className="min-w-0 flex-1 truncate">{label}</span>
                    </button>

                    {isSelected && sections.length > 0 && (
                      <div className="mt-1 mb-1 ml-2.5 flex flex-col gap-2 border-[var(--glass-border)] border-l pl-2.5">
                        {sections.map((section) => (
                          <div className="flex flex-col gap-0.5" data-viewer-section={section.kind} key={section.kind}>
                            <span className="px-2 pt-1 pb-0.5 font-semibold text-[10px] text-[var(--glass-muted)] uppercase tracking-[0.12em]">
                              {sectionTitle(section.kind, i18n)}
                            </span>
                            {section.rows.map((row) => {
                              const active = section.kind === 'units'
                                ? row.id === focusedUnitId
                                : row.id === selection.zoneId
                              return (
                                <button
                                  aria-pressed={active}
                                  className={`studio-interactive flex h-8 w-full items-center gap-2 rounded-full px-2.5 text-left text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--glass-accent)] ${
                                    active
                                      ? 'bg-[var(--glass-accent-soft)] font-semibold text-[var(--glass-accent)]'
                                      : 'text-[var(--glass-ink)]/85 hover:bg-[var(--glass-bg-hover)] hover:text-[var(--glass-ink)]'
                                  }`}
                                  key={row.id}
                                  onClick={() => (section.kind === 'units'
                                    ? selectViewerUnit(row.id, source)
                                    : selectViewerRoom(row.id, source))}
                                  type="button"
                                >
                                  <span aria-hidden className="size-2 shrink-0 rounded-full ring-1 ring-[var(--glass-border)]" style={{ backgroundColor: row.color }} />
                                  <span className="min-w-0 flex-1 truncate">{row.label}</span>
                                  <span className="shrink-0 font-mono text-[11px] text-[var(--glass-muted)] tabular-nums">
                                    {formatRoomArea(row.areaM2, unit, locale)}
                                  </span>
                                </button>
                              )
                            })}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>

      {!embed && <GuestFooterCard />}
    </>
  )

  if (isMobile) {
    return (
      <>
        <button
          aria-expanded={mobileOpen}
          aria-label="Open navigator"
          className="studio-hud-light studio-interactive pointer-events-auto absolute top-4 left-4 z-30 flex size-10 items-center justify-center rounded-full text-[var(--glass-ink)] transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--glass-accent)] active:scale-95"
          onClick={() => setMobileOpen(true)}
          title={title}
          type="button"
        >
          <Menu className="size-4" />
        </button>

        {mobileOpen && (
          <div className="fixed inset-0 z-50 flex">
            <button
              aria-label="Close navigator"
              className="absolute inset-0 bg-slate-950/20 backdrop-blur-[2px]"
              onClick={() => setMobileOpen(false)}
              type="button"
            />
            <aside
              aria-label="Project navigator"
              className="corner-smooth studio-hud-light relative z-10 m-3 flex w-[min(20rem,calc(100vw-1.5rem))] flex-col overflow-hidden rounded-[20px]"
            >
              {expandedBody(() => setMobileOpen(false))}
            </aside>
          </div>
        )}
      </>
    )
  }

  return (
    <aside
      aria-label="Project navigator"
      className={`corner-smooth studio-hud-light pointer-events-auto absolute top-4 bottom-[4.75rem] left-4 z-30 flex flex-col overflow-hidden rounded-[20px] transition-[width] duration-200 ease-out ${
        collapsed ? 'w-16' : 'w-[264px]'
      }`}
      data-navigator-rail={collapsed ? 'collapsed' : 'expanded'}
    >
      {collapsed ? (
        <div className="flex min-h-0 flex-1 flex-col items-center gap-2 py-3">
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                aria-label="Expand navigator"
                className="studio-interactive flex size-10 shrink-0 items-center justify-center rounded-full text-[var(--glass-muted)] transition-colors hover:bg-[var(--glass-bg-hover)] hover:text-[var(--glass-ink)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--glass-accent)]"
                onClick={onToggleCollapsed}
                type="button"
              >
                <ChevronRight className="size-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">Expand navigator</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <button
                aria-label={ownerName ? `${title} by ${ownerName}` : title}
                className={`studio-interactive flex size-10 shrink-0 items-center justify-center rounded-full border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--glass-accent)] ${
                  buildingActive
                    ? 'border-[var(--glass-accent-border)] bg-[var(--glass-accent-soft)] text-[var(--glass-accent)]'
                    : 'border-[var(--glass-border)] bg-[var(--glass-raised-soft)] text-[var(--glass-ink)] hover:bg-[var(--glass-raised)]'
                }`}
                onClick={() => selectViewerBuilding(source)}
                type="button"
              >
                <User className="size-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">
              <div className="flex flex-col">
                <span className="font-medium">{title}</span>
                {ownerName && <span className="opacity-75">{ownerName}</span>}
              </div>
            </TooltipContent>
          </Tooltip>

          <span aria-hidden className="my-0.5 h-px w-7 shrink-0 bg-[var(--glass-border)]" />

          <div className="hud-scroll flex min-h-0 w-full flex-1 flex-col items-center gap-1.5 overflow-y-auto px-2 py-0.5">
            {levels.map((lvl) => {
              const isSelected = lvl.id === selection.levelId
              const label = localizedLevelName(lvl, i18n, locale)
              return (
                <Tooltip key={lvl.id}>
                  <TooltipTrigger asChild>
                    <button
                      aria-label={label}
                      aria-pressed={isSelected}
                      className={`studio-interactive flex size-10 shrink-0 items-center justify-center rounded-full border font-mono font-semibold text-xs transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--glass-accent)] ${
                        isSelected
                          ? 'border-[var(--glass-accent)] bg-[var(--glass-accent)] text-white shadow-xs'
                          : 'border-[var(--glass-border)] bg-[var(--glass-raised-soft)] text-[var(--glass-ink)] hover:border-[var(--glass-border-strong)] hover:bg-[var(--glass-raised)]'
                      }`}
                      onClick={() => selectLevel(lvl)}
                      type="button"
                    >
                      {floorMonogram(lvl, label)}
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="right">{label}</TooltipContent>
                </Tooltip>
              )
            })}
            {levels.length === 0 && (
              <Layers aria-hidden className="size-4 text-[var(--glass-muted)]/60" />
            )}
          </div>

          {!embed && (
            <>
              <span aria-hidden className="h-px w-7 shrink-0 bg-[var(--glass-border)]" />
              <Tooltip>
                <TooltipTrigger asChild>
                  <a
                    aria-label="Get started"
                    className="studio-interactive flex size-10 shrink-0 items-center justify-center rounded-full bg-[var(--glass-accent)] text-white shadow-xs transition-all hover:bg-[var(--glass-accent-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--glass-accent)]"
                    href="https://editor.pascal.app"
                  >
                    <ArrowUpRight aria-hidden className="size-4" />
                  </a>
                </TooltipTrigger>
                <TooltipContent side="right">Get started with Pascal</TooltipContent>
              </Tooltip>
            </>
          )}
        </div>
      ) : (
        expandedBody()
      )}
    </aside>
  )
}
