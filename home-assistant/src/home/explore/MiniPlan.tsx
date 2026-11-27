import { usePascalI18n } from '@pascal-app/core'
import type { ViewerSource } from '@pascal-app/viewer/ui'
import { useId, useMemo } from 'react'
import { buildLevelPlan } from './planGeometry'
import { useRoomHover } from './roomHover'

/**
 * Interactive SVG mini floor plan drawn from the current level's real zone polygons.
 * Synced with the room list and the rooms' labels in 3D through `useRoomHover`: a room is lit only while hovered,
 * and a click frames it without selecting it,
 * and animates its room outlines drawing in when switching floors.
 */
export function MiniPlan({
  levelId,
  source,
  onSelectRoom,
  onHoverRoom,
  onLeaveRoom,
}: {
  levelId: string | null
  source: ViewerSource
  onSelectRoom: (zoneId: string) => void
  onHoverRoom: (zoneId: string) => void
  onLeaveRoom: (zoneId: string) => void
}) {
  const i18n = usePascalI18n()
  const hoveredId = useRoomHover((s) => s.id)
  const glowId = useId().replaceAll(':', '')

  const plan = useMemo(
    () => (levelId ? buildLevelPlan(levelId, source.nodes, i18n, 240) : { width: 240, height: 180, rooms: [] }),
    [levelId, source.nodes, i18n],
  )

  const hoveredRoom = plan.rooms.find((room) => room.id === hoveredId) ?? null

  if (!levelId || plan.rooms.length === 0) {
    return (
      <div className="ui-drafting-plate relative flex h-[112px] items-center justify-center rounded-[14px] border border-foreground/10 px-4 text-center">
        <div className="flex flex-col items-center gap-1.5">
          <div aria-hidden="true" className="h-7 w-11 rounded border border-foreground/20 border-dashed" />
          <p className="font-mono text-[10px] text-muted-foreground">No room outlines on this floor</p>
        </div>
      </div>
    )
  }

  // Keep the floating hover label inside the plate bounds even for rooms near an edge.
  const tagX = hoveredRoom ? Math.max(14, Math.min(86, (hoveredRoom.centroid[0] / plan.width) * 100)) : 50
  const tagY = hoveredRoom ? Math.max(16, Math.min(84, (hoveredRoom.centroid[1] / plan.height) * 100)) : 50

  const maxFrameHeight = 240
  const maxFrameWidth = Math.round(maxFrameHeight * (plan.width / plan.height))

  return (
    <div
      className="ui-drafting-plate relative mx-auto w-full overflow-hidden rounded-[14px] border border-foreground/10"
      style={{ aspectRatio: `${plan.width} / ${plan.height}`, maxHeight: maxFrameHeight, maxWidth: maxFrameWidth }}
    >
      <span
        aria-hidden="true"
        className="pointer-events-none absolute top-2 right-2.5 flex items-center gap-0.5 font-mono text-[8px] text-muted-foreground/70 tracking-[0.14em]"
      >
        <span className="inline-block h-1.5 w-px bg-current" />
        <span>N</span>
      </span>

      <svg
        aria-label="Floor plan"
        className="block h-full w-full select-none"
        key={levelId}
        role="img"
        viewBox={`0 0 ${plan.width} ${plan.height}`}
      >
        <defs>
          <filter height="140%" id={`glow-${glowId}`} width="140%" x="-20%" y="-20%">
            <feGaussianBlur result="blur" stdDeviation="2.5" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {plan.rooms.map((room, index) => {
          const isHovered = room.id === hoveredId
          const emphasised = isHovered
          return (
            <g
              aria-label={`Show ${room.label}`}
              className="cursor-pointer outline-none"
              key={room.id}
              onBlur={() => onLeaveRoom(room.id)}
              onClick={() => onSelectRoom(room.id)}
              onFocus={() => onHoverRoom(room.id)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  onSelectRoom(room.id)
                }
              }}
              onPointerEnter={() => onHoverRoom(room.id)}
              onPointerLeave={() => onLeaveRoom(room.id)}
              role="button"
              tabIndex={0}
            >
              {/* Soft colour fill: subtle at rest, luminous while hovered. */}
              <path
                className="transition-[fill-opacity] duration-200"
                d={room.path}
                fill={room.color}
                fillOpacity={isHovered ? 0.34 : 0.14}
                fillRule="evenodd"
                filter={emphasised ? `url(#glow-${glowId})` : undefined}
              />
              {/* Precision architectural 1px ink outline, animated drawing in per level. */}
              <path
                className="ui-plan-draw"
                d={room.path}
                fill="none"
                fillRule="evenodd"
                stroke={emphasised ? room.color : 'currentColor'}
                strokeDasharray={room.perimeter}
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeOpacity={emphasised ? 0.95 : 0.48}
                strokeWidth={emphasised ? 1.5 : 1}
                style={{
                  '--plan-len': room.perimeter,
                  animationDelay: `${120 + Math.min(index * 45, 320)}ms`,
                } as React.CSSProperties}
                vectorEffect="non-scaling-stroke"
              />
            </g>
          )
        })}
      </svg>

      {hoveredRoom ? (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded-full bg-foreground px-2 py-0.5 font-mono text-[9px] text-background shadow-sm transition-[left,top] duration-150"
          style={{ left: `${tagX}%`, top: `${tagY}%` }}
        >
          {hoveredRoom.label}
        </span>
      ) : null}
    </div>
  )
}
