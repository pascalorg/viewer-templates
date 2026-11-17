import { type KeyboardEvent, type ReactNode, useEffect, useRef } from 'react'
import type { DialLayer } from './Dial'
import { familyIcon, Icon } from './icons'
import { MOODS, type ModeDefinition, type ModeId, type MoodId } from './modes'

// Ported from Pascal's /next demo (MIT): the phone's persistent bar of views, with a disclosure
// for the time of day and Reset view above it.

function moveFocus(event: KeyboardEvent<HTMLElement>) {
  const delta = ({ ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1 } as Record<string, number>)[event.key]
  if (delta === undefined && !['Home', 'End'].includes(event.key)) return
  const buttons = [...event.currentTarget.querySelectorAll('button')]
  const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
  if (index < 0) return
  event.preventDefault()
  event.stopPropagation()
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (delta ?? 0) + buttons.length) % buttons.length
  buttons[next]?.focus({ preventScroll: true })
}

/**
 * The X-ray families as a snapping carousel above the bar: swipe or step through them, and the one
 * that settles in the middle is shown.
 */
function LayerCarousel({ layers, selected, onSelect }: {
  layers: readonly DialLayer[]
  selected: string | null
  onSelect: (id: string) => void
}) {
  const rail = useRef<HTMLDivElement>(null)
  const gesture = useRef(false)
  const dragging = useRef(false)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const active = Math.max(0, layers.findIndex((item) => item.id === selected))
  const latest = useRef({ layers, onSelect })
  latest.current = { layers, onSelect }

  function center(index: number, smooth = true) {
    const list = rail.current
    const button = list?.children[index] as HTMLElement | undefined
    if (!list || !button) return
    gesture.current = false
    clearTimeout(timer.current)
    list.scrollTo({
      left: button.offsetLeft - (list.clientWidth - button.offsetWidth) / 2,
      behavior: smooth && !matchMedia('(prefers-reduced-motion: reduce)').matches ? 'smooth' : 'instant',
    })
  }
  function select(index: number) {
    const item = layers[index]
    if (!item) return
    center(index)
    onSelect(item.id)
  }
  function settle() {
    clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      const list = rail.current
      if (!gesture.current || dragging.current || !list) return
      const midpoint = list.scrollLeft + list.clientWidth / 2
      let nearest = 0
      let distance = Infinity
      ;[...list.children].forEach((child, index) => {
        const button = child as HTMLElement
        const delta = Math.abs(button.offsetLeft + button.offsetWidth / 2 - midpoint)
        if (delta < distance) { distance = delta; nearest = index }
      })
      gesture.current = false
      const item = latest.current.layers[nearest]
      if (item) latest.current.onSelect(item.id)
    }, 160)
  }
  useEffect(() => {
    center(active)
    const observer = new ResizeObserver(() => center(active, false))
    if (rail.current) observer.observe(rail.current)
    return () => { observer.disconnect(); clearTimeout(timer.current) }
  }, [active, layers.length])

  return (
    <section aria-label="X-ray layers" className="sc-layer-carousel">
      <button aria-label="Previous layer" className="sc-carousel-step" disabled={active === 0} onClick={() => select(active - 1)} type="button">
        <Icon name="chevron" />
      </button>
      <div className="sc-layer-rail" ref={rail} onScroll={settle}
        onKeyDown={(event) => {
          const delta = ({ ArrowLeft: -1, ArrowRight: 1 } as Record<string, number>)[event.key]
          if (delta === undefined && !['Home', 'End'].includes(event.key)) return
          event.preventDefault()
          event.stopPropagation()
          const index = [...(rail.current?.children ?? [])].indexOf(document.activeElement as Element)
          const next = event.key === 'Home' ? 0 : event.key === 'End' ? layers.length - 1 : Math.max(0, Math.min(layers.length - 1, index + (delta ?? 0)))
          center(next)
          ;(rail.current?.children[next] as HTMLElement | undefined)?.focus({ preventScroll: true })
        }}
        onPointerCancel={() => { dragging.current = false; settle() }}
        onPointerDown={() => { gesture.current = true; dragging.current = true; clearTimeout(timer.current) }}
        onPointerUp={() => { dragging.current = false; settle() }}
        onWheel={() => { gesture.current = true }}>
        {layers.map((item, index) => (
          <button aria-label={item.label} aria-pressed={index === active} className="sc-carousel-layer" data-family={item.id} key={item.id}
            onClick={() => select(index)} type="button">
            <Icon name={familyIcon(item.id)} /><span>{item.label}</span>
          </button>
        ))}
      </div>
      <button aria-label="Next layer" className="sc-carousel-step" disabled={active === layers.length - 1} onClick={() => select(active + 1)} type="button">
        <Icon name="chevron" />
      </button>
    </section>
  )
}

export function MobileControls({ modes, mode, mood, lightingOpen, help, layers = [], layersOpen = false, pinned = null, onLayer, onMode, onMood, onReset, onLighting }: {
  modes: readonly ModeDefinition[]
  mode: ModeId | null
  mood: MoodId | null
  lightingOpen: boolean
  help?: ReactNode
  /** X-ray families, as a carousel above the bar while `layersOpen`. */
  layers?: readonly DialLayer[]
  layersOpen?: boolean
  pinned?: string | null
  onLayer?: (id: string) => void
  onMode: (mode: ModeId) => void
  onMood: (mood: MoodId) => void
  onReset: () => void
  onLighting: () => void
}) {
  return (
    <div className="sc-mobile-controls" data-disclosure="lighting">
      {layersOpen && !lightingOpen && onLayer && <LayerCarousel layers={layers} onSelect={onLayer} selected={pinned} />}
      {lightingOpen && (
        <div aria-label="Time of day" className="sc-mobile-lighting" id="sc-mobile-lighting" onKeyDown={moveFocus} role="group">
          {MOODS.map(({ id, label }) => (
            <button aria-label={label} aria-pressed={mood === id} data-mood={id} key={id} onClick={() => onMood(id)} type="button">
              <Icon name={id} /><span>{label}</span>
            </button>
          ))}
          <button aria-label="Reset view" className="sc-mobile-reset" onClick={onReset} type="button">
            <Icon name="reset" /><span>Reset</span>
          </button>
        </div>
      )}
      <div className="sc-mobile-bar">
        <nav aria-label="Views" onKeyDown={moveFocus}>
          {modes.map(({ id, label, short }) => (
            <button aria-label={label} aria-pressed={mode === id} data-mode={id} key={id} onClick={() => onMode(id)} type="button">
              <Icon name={id} /><span>{short}</span>
            </button>
          ))}
        </nav>
        <button aria-controls="sc-mobile-lighting" aria-expanded={lightingOpen} aria-label="Time of day" className="sc-mobile-light-toggle"
          data-lighting onClick={onLighting} type="button">
          <Icon name={mood ?? 'dusk'} /><span>Light</span>
        </button>
        {help}
      </div>
    </div>
  )
}
