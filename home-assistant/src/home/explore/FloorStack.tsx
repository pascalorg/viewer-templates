import { useViewer } from '@pascal-app/viewer'

export type FloorStackLevel = {
  id: string
  level: number
  name: string
}

const pad = (n: number) => String(n).padStart(2, '0')

/**
 * Isometric architectural floor stack: one skewed parallelogram slab per level (top floor on top),
 * active slab lit and lifted, inactive slabs as quiet ink outlines. Spreads apart automatically
 * when `levelMode === 'exploded'`.
 */
export function FloorStack({
  levels,
  activeLevelId,
  hasExplicitLevel,
  compact = false,
  onSelectLevel,
  onSelectBuilding,
}: {
  levels: readonly FloorStackLevel[]
  activeLevelId: string | null
  hasExplicitLevel: boolean
  compact?: boolean
  onSelectLevel: (id: string) => void
  onSelectBuilding: () => void
}) {
  const levelMode = useViewer((s) => s.levelMode)
  if (levels.length === 0) return null

  const exploded = levelMode === 'exploded'
  // Display highest floor on top like an architectural building section.
  const ordered = [...levels].reverse()

  return (
    <div className="mb-3.5">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="ui-eyebrow ui-eyebrow-rule">Floors</span>
        {hasExplicitLevel ? (
          <button
            className="rounded-full px-2 py-0.5 font-mono text-[10px] text-muted-foreground transition-colors hover:bg-accent/70 hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2"
            onClick={onSelectBuilding}
            type="button"
          >
            All floors
          </button>
        ) : null}
      </div>

      <div
        aria-label="Floors"
        className={`flex flex-col transition-[gap] duration-300 ease-out ${exploded ? 'gap-2.5' : 'gap-0.5'}`}
        role="group"
      >
        {ordered.map((lvl, revIndex) => {
          const floorNumber = levels.length - revIndex
          const active = lvl.id === activeLevelId
          return (
            <button
              aria-pressed={active}
              className={`group flex w-full items-center gap-3 rounded-xl px-2 text-left transition-all duration-200 focus-visible:outline-2 focus-visible:outline-ring focus-visible:-outline-offset-2 ${
                compact ? 'min-h-11 py-1.5' : 'py-1'
              } ${
                active
                  ? 'bg-foreground/[0.07] text-foreground'
                  : 'text-muted-foreground hover:bg-foreground/[0.04] hover:text-foreground'
              }`}
              key={lvl.id}
              onClick={() => onSelectLevel(lvl.id)}
              type="button"
            >
              {/* Isometric slab glyph: lifts slightly and illuminates when active. */}
              <svg
                aria-hidden="true"
                className={`h-6 w-11 shrink-0 overflow-visible transition-transform duration-300 ease-out ${
                  active ? '-translate-y-0.5' : 'group-hover:-translate-y-px'
                }`}
                viewBox="0 0 44 24"
              >
                {/* Underside thickness edge on the active slab for architectural depth. */}
                {active ? (
                  <path
                    d="M3 13.5 L22 20.5 L41 13.5 L41 15.5 L22 22.5 L3 15.5 Z"
                    fill="currentColor"
                    fillOpacity={0.32}
                  />
                ) : null}
                <polygon
                  className="transition-[fill-opacity,stroke-opacity] duration-200"
                  fill="currentColor"
                  fillOpacity={active ? 0.24 : 0.04}
                  points="22,4 41,11.5 22,19 3,11.5"
                  stroke="currentColor"
                  strokeLinejoin="round"
                  strokeOpacity={active ? 0.95 : 0.34}
                  strokeWidth={active ? 1.35 : 0.9}
                />
              </svg>

              <span className="flex min-w-0 flex-1 items-baseline gap-2">
                <span
                  className={`font-mono text-[10px] tabular-nums ${
                    active ? 'text-foreground' : 'text-muted-foreground/65'
                  }`}
                >
                  {pad(floorNumber)}
                </span>
                <span className={`truncate font-mono text-[11px] ${active ? 'font-medium text-foreground' : ''}`}>
                  {lvl.name}
                </span>
              </span>

              {active ? (
                <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-foreground" />
              ) : null}
            </button>
          )
        })}
      </div>
    </div>
  )
}
