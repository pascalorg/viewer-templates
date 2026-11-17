import { type CSSProperties, type FocusEvent, type KeyboardEvent, type ReactNode, type RefObject, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { familyIcon, Icon } from './icons'
import { MOODS, type ModeDefinition, type ModeId, type MoodId } from './modes'

// Ported from Pascal's /next demo (MIT): concentric controls, views outside, light inside,
// reset at their centre. Only native buttons take input; the glass never blocks the scene.

type Point = { x: number; y: number }
// Native trig can differ in its last digit between engines; keep stable subpixel coordinates.
const coordinate = (value: number) => Number(value.toFixed(4))
const point = (radius: number, angle: number): Point => ({
  x: coordinate(radius * Math.cos((angle * Math.PI) / 180)),
  y: coordinate(radius * Math.sin((angle * Math.PI) / 180)),
})

const ring = (inner: number, outer: number, start: number, end: number) => {
  const a = point(outer, start), b = point(outer, end), c = point(inner, end), d = point(inner, start)
  return `M${a.x},${a.y} A${outer},${outer} 0 0 1 ${b.x},${b.y} L${c.x},${c.y} A${inner},${inner} 0 0 0 ${d.x},${d.y} Z`
}

/** One X-ray family in the fan beside the dial. */
export type DialLayer = { id: string; label: string }

/** The base radii of the rings (px at full size): reset, light ring, view ring. */
const RESET = 52
const MOOD_OUTER = 116
const VIEW_OUTER = 176

/** A clipped, absolutely placed button covering one ring sector, with its icon's centre. */
function sectorStyle(inner: number, outer: number, start: number, end: number, scale: number, squash: number): CSSProperties {
  const icon = point(((inner + outer) / 2) * scale, (start + end) / 2)
  // The edge wedges continue behind the viewport edge while keeping the icon spacing.
  if (start === -90) start = -180
  if (end === 90) end = 180
  const steps = Math.max(24, Math.ceil((end - start) / 2))
  const points: Point[] = []
  for (let i = 0; i <= steps; i++) points.push(point(outer * scale, start + ((end - start) * i) / steps))
  for (let i = steps; i >= 0; i--) points.push(point(inner * scale, start + ((end - start) * i) / steps))
  for (const p of points) p.y = coordinate(p.y * squash)
  const left = Math.min(...points.map((p) => p.x))
  const top = Math.min(...points.map((p) => p.y))
  const width = Math.max(...points.map((p) => p.x)) - left
  const height = Math.max(...points.map((p) => p.y)) - top
  icon.y = coordinate(icon.y * squash)
  return {
    left, top, width, height,
    clipPath: `polygon(${points.map((p) => `${coordinate(((p.x - left) / width) * 100)}% ${coordinate(((p.y - top) / height) * 100)}%`).join(',')})`,
    '--icon-x': `${coordinate(icon.x - left)}px`,
    '--icon-y': `${coordinate(icon.y - top)}px`,
  } as CSSProperties
}

/** Arrow keys move focus around a ring; Home and End jump to its ends. */
function arrowFocus(event: KeyboardEvent<HTMLElement>) {
  const delta = ({ ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 } as Record<string, number>)[event.key]
  if (delta === undefined && !['Home', 'End'].includes(event.key)) return
  const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')]
  const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
  if (index < 0) return
  event.preventDefault()
  event.stopPropagation()
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (delta ?? 0) + buttons.length) % buttons.length
  buttons[next]?.focus({ preventScroll: true })
}

export function Dial({ modes, mode, mood, ready, compact = false, layers = [], layersOpen = false, pinned = null, help, onMode, onMood, onReset, onLayer }: {
  modes: readonly ModeDefinition[]
  mode: ModeId | null
  mood: MoodId | null
  ready: boolean
  compact?: boolean
  /** X-ray families, fanned out beside the dial while `layersOpen`. */
  layers?: readonly DialLayer[]
  layersOpen?: boolean
  pinned?: string | null
  onLayer?: (id: string) => void
  /** The help button and its dialog, placed under the dial. */
  help?: ReactNode
  onMode: (mode: ModeId) => void
  onMood: (mood: MoodId) => void
  onReset: () => void
}) {
  const root = useRef<HTMLDivElement>(null)
  const [short, setShort] = useState(false)
  const [shallow, setShallow] = useState(false)
  const [tight, setTight] = useState(false)
  const [squash, setSquash] = useState(1)
  const [hovered, setHovered] = useState<string | null>(null)
  // Short viewports scale the dial down, then flatten it into an ellipse.
  useEffect(() => {
    const update = () => {
      const small = innerHeight <= 680
      const style = getComputedStyle(root.current!.closest('.sc')!)
      const safe = (parseFloat(style.getPropertyValue('--sc-safe-top')) || 0) + (parseFloat(style.getPropertyValue('--sc-safe-bottom')) || 0)
      setShort(small)
      setShallow(innerHeight <= 430 && innerWidth > innerHeight)
      setTight(innerHeight - safe < 300)
      setSquash(Math.min(1, Math.max(0.7, (innerHeight - safe - 24) / (VIEW_OUTER * 2 * (small ? 0.84 : 1)))))
    }
    update()
    addEventListener('resize', update)
    return () => removeEventListener('resize', update)
  }, [])
  const scale = short ? 0.84 : 1
  const radius = VIEW_OUTER * scale
  const verticalRadius = radius * squash
  // Hover and focus only change the label; the clipped input geometry stays put.
  const sectors = useMemo(() => {
    const viewStep = 180 / modes.length
    const moodStep = 180 / MOODS.length
    return {
      views: modes.map((_, i) => sectorStyle(MOOD_OUTER, VIEW_OUTER, -90 + i * viewStep, -90 + (i + 1) * viewStep, scale, squash)),
      moods: MOODS.map((_, i) => sectorStyle(RESET, MOOD_OUTER, -90 + i * moodStep, -90 + (i + 1) * moodStep, scale, squash)),
    }
  }, [modes, scale, squash])
  const dividers = ([[MOOD_OUTER, VIEW_OUTER, modes.length], [RESET, MOOD_OUTER, MOODS.length]] as const).flatMap(([inner, outer, count]) =>
    Array.from({ length: count - 1 }, (_, i) => {
      const angle = -90 + ((i + 1) * 180) / count
      const a = point(inner * scale, angle)
      const b = point(outer * scale, angle)
      return <path className="sc-dial-divider" d={`M${a.x},${a.y}L${b.x},${b.y}`} key={`${inner}-${i}`} />
    }))
  const hover = (id: string) => ({
    onPointerEnter: () => setHovered(id),
    onPointerLeave: () => setHovered(null),
    onFocus: () => setHovered(id),
    // Safari blurs a focused button on click while the pointer stays over it.
    onBlur: (event: FocusEvent<HTMLButtonElement>) => {
      if (!event.currentTarget.matches(':hover')) setHovered((value) => (value === id ? null : value))
    },
  })
  const caption = hovered === 'reset' ? 'Reset view'
    : [...modes, ...MOODS].find((entry) => entry.id === hovered)?.label

  return (
    <div className="sc-dial" data-layers={layersOpen} data-shallow={shallow} data-short={short} ref={root} style={{
      '--dial-radius': `${radius}px`,
      '--dial-y-radius': `${verticalRadius}px`,
      '--reset-radius': `${RESET * scale}px`,
      '--reset-y-radius': `${RESET * scale * squash}px`,
    } as CSSProperties}>
      <div aria-hidden="true" className="sc-dial-glass" />
      <svg aria-hidden="true" className="sc-dial-face" style={{ width: radius + 30, height: verticalRadius * 2 + 4, top: -verticalRadius - 2 }}
        viewBox={`0 ${-verticalRadius - 2} ${radius + 30} ${verticalRadius * 2 + 4}`}>
        <g transform={`scale(1 ${squash})`}>
          <circle className="sc-dial-track" r={(RESET - 0.25) * scale} />
          <circle className="sc-dial-track" r={(MOOD_OUTER - 0.25) * scale} />
          {dividers}
        </g>
      </svg>
      <button aria-label="Reset view" className="sc-dial-reset" disabled={!ready} onClick={onReset} type="button" {...hover('reset')}>
        <Icon name="reset" />
      </button>
      <nav aria-label="Views" onKeyDown={arrowFocus}>
        {modes.map(({ id, label }, index) => (
          <button aria-label={label} aria-pressed={mode === id} className="sc-dial-view" data-mode={id} disabled={!ready} key={id}
            onClick={() => onMode(id)} style={sectors.views[index]} type="button" {...hover(id)}>
            <Icon name={id} />
          </button>
        ))}
      </nav>
      <div aria-label="Time of day" onKeyDown={arrowFocus} role="group">
        {MOODS.map(({ id, label }, index) => (
          <button aria-label={label} aria-pressed={mood === id} className="sc-dial-mood" data-mood={id} disabled={!ready} key={id}
            onClick={() => onMood(id)} style={sectors.moods[index]} type="button" {...hover(id)}>
            <Icon name={id} />
          </button>
        ))}
      </div>
      <DialLabel active={hovered} dialRef={root} label={caption} scale={scale} />
      <LayerFan compact={compact || short} layers={layers} onLayer={onLayer} open={layersOpen} pinned={pinned}
        radius={radius} shallow={shallow} tight={tight} verticalRadius={verticalRadius} />
      {help}
    </div>
  )
}

/**
 * The X-ray families fanned along an arc beside the dial, paged when they don't fit. Pointing at a
 * family shows it, as on /next; a press or keyboard focus does too.
 */
function LayerFan({ layers, open, pinned, onLayer, compact, shallow, tight, radius, verticalRadius }: {
  layers: readonly DialLayer[]
  open: boolean
  pinned: string | null
  onLayer?: (id: string) => void
  compact: boolean
  shallow: boolean
  tight: boolean
  radius: number
  verticalRadius: number
}) {
  const [page, setPage] = useState(0)
  const pageSize = shallow ? (tight ? 2 : 3) : compact ? 5 : layers.length || 1
  const pageCount = Math.ceil(layers.length / pageSize)
  const currentPage = Math.min(page, Math.max(0, pageCount - 1))
  const items = layers.slice(currentPage * pageSize, (currentPage + 1) * pageSize)
  const spacing = compact ? 48 : 36
  const fanRadius = Math.max(radius + 25, ((items.length - 1) * spacing) / 2 + 24)
  const pagerTop = shallow ? Math.min(90, verticalRadius - 44) : -167
  useEffect(() => {
    setPage(Math.floor(Math.max(0, layers.findIndex((layer) => layer.id === pinned)) / pageSize))
  }, [pinned, pageSize, open, layers])
  const turnPage = (next: number) => {
    setPage(next)
    const first = layers[next * pageSize]
    if (first) onLayer?.(first.id)
  }
  return (
    <div aria-hidden={!open} aria-label="X-ray layers" className="sc-dial-layers" data-open={open} id="sc-dial-layers" inert={!open}
      onKeyDown={arrowFocus} role="group">
      {open && <>
        <svg aria-hidden="true" className="sc-dial-layer-arc" style={{ width: fanRadius + 30, height: 2 * fanRadius + 4, top: -fanRadius - 2 }}
          viewBox={`0 ${-fanRadius - 2} ${fanRadius + 30} ${2 * fanRadius + 4}`}>
          <path d={ring(fanRadius - 1, fanRadius, -78, 78)} />
        </svg>
        {items.map((layer, index) => {
          const y = (index - (items.length - 1) / 2) * spacing
          const x = Math.sqrt(fanRadius * fanRadius - y * y) + 9
          return (
            <button aria-label={layer.label} aria-pressed={pinned === layer.id} className="sc-dial-layer" data-family={layer.id} key={layer.id}
              onClick={() => onLayer?.(layer.id)}
              onFocus={(event) => { if (event.currentTarget.matches(':focus-visible')) onLayer?.(layer.id) }}
              onPointerMove={(event) => { if (event.pointerType === 'mouse' || event.pointerType === 'pen') onLayer?.(layer.id) }}
              style={{ left: x, top: y - (compact ? 22 : 16), '--layer-x': `${x}px` } as CSSProperties} type="button">
              <Icon name={familyIcon(layer.id)} /><span>{layer.label}</span>
            </button>
          )
        })}
        {pageCount > 1 && <>
          <button aria-label="Previous layers" className="sc-dial-page" disabled={currentPage === 0} onClick={() => turnPage(currentPage - 1)}
            style={{ left: radius + 36, top: pagerTop }} type="button"><Icon name="up" /></button>
          <span aria-hidden="true" className="sc-dial-page-count" style={{ left: radius + 91, top: pagerTop + 14 }}>{currentPage + 1} / {pageCount}</span>
          <button aria-label="More layers" className="sc-dial-page" disabled={currentPage === pageCount - 1} onClick={() => turnPage(currentPage + 1)}
            style={{ left: radius + (shallow ? 132 : 36), top: shallow ? pagerTop : 123 }} type="button"><Icon name="down" /></button>
        </>}
      </>}
    </div>
  )
}

/** Keeps the visual label beside its icon, outside the sector's clipped surface. */
function DialLabel({ dialRef, active, label, scale }: {
  dialRef: RefObject<HTMLDivElement | null>
  active: string | null
  label: string | undefined
  scale: number
}) {
  const tip = useRef<HTMLSpanElement>(null)
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null)
  const [dismissed, setDismissed] = useState(false)
  useLayoutEffect(() => {
    setDismissed(false)
    const dial = dialRef.current
    const button = active === 'reset' ? dial?.querySelector('.sc-dial-reset')
      : dial?.querySelector(`[data-mode="${active}"], [data-mood="${active}"]`)
    if (!dial || !button || !label) {
      setPosition(null)
      return
    }
    const icon = button.querySelector('svg') ?? button
    const place = () => {
      if (!tip.current) return
      const anchor = icon.getBoundingClientRect()
      const origin = dial.getBoundingClientRect()
      const box = tip.current.getBoundingClientRect()
      const margin = 8
      const left = Math.max(margin, Math.min(anchor.right + 10, innerWidth - box.width - margin))
      const top = Math.max(margin, Math.min(anchor.top + anchor.height / 2 - box.height / 2, innerHeight - box.height - margin))
      setPosition({ left: left - origin.left, top: top - origin.top })
    }
    const dismiss = (event: globalThis.KeyboardEvent) => { if (event.key === 'Escape') setDismissed(true) }
    place()
    const resize = new ResizeObserver(place)
    resize.observe(icon)
    if (tip.current) resize.observe(tip.current)
    addEventListener('resize', place)
    addEventListener('keydown', dismiss, true)
    return () => {
      resize.disconnect()
      removeEventListener('resize', place)
      removeEventListener('keydown', dismiss, true)
    }
  }, [active, label, scale, dialRef])
  return (
    <span aria-hidden="true" className="sc-dial-label" data-for={active ?? ''} data-visible={Boolean(label && position && !dismissed)}
      ref={tip} style={position ?? undefined}>{label}</span>
  )
}
