import { useViewer } from '@pascal-app/viewer'
import type { ViewerSource } from '@pascal-app/viewer/ui'
import { Html } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useRoomHover } from './roomHover'

/** How high over its floor a room's dot sits, in metres. */
const DOT_Y = 0.05
/** How high over its floor a room's label stands, above the walls, in metres. */
const LABEL_Y = 3.6

type ZoneNode = { id: string; type: string; name?: string; parentId?: string | null; polygon?: [number, number][] | { points?: [number, number][] } }
type Room = { id: string; name: string; centre: [number, number]; polygon: [number, number][] }

/** The middle of a room's outline, in its level's own frame. */
function centreOf(polygon: [number, number][]): [number, number] {
  let area = 0
  let x = 0
  let z = 0
  polygon.forEach(([x1, z1], i) => {
    const [x2, z2] = polygon[(i + 1) % polygon.length]!
    const cross = x1 * z2 - x2 * z1
    area += cross
    x += (x1 + x2) * cross
    z += (z1 + z2) * cross
  })
  if (Math.abs(area) < 1e-6) {
    const n = polygon.length
    return [polygon.reduce((s, p) => s + p[0], 0) / n, polygon.reduce((s, p) => s + p[1], 0) / n]
  }
  return [x / (3 * area), z / (3 * area)]
}

function hide(...elements: (HTMLElement | SVGElement | undefined)[]) {
  for (const el of elements) if (el) el.style.visibility = 'hidden'
}

/** Where the labels' overlay sits: the canvas's top left corner, whatever the camera does. */
const TOP_LEFT = (): [number, number] => [0, 0]

/**
 * Inside the viewer's canvas: the name of each room of the floor shown, standing in 3D over the
 * middle of its room, above the walls, on a stick that rises straight up from a dot on its floor. As
 * the camera turns, label and stick stay where they are in the room, so the stick is vertical in
 * the world, not on the screen. A label picks its room as the explore panel's list does, and lights up while it or the room's row in the panel is pointed
 * at (`useRoomHover`).
 */
export function RoomLabels({ source, roomId, onPick }: { source: ViewerSource; roomId: string | null; onPick: (zoneId: string) => void }) {
  const levelId = useViewer((s) => s.selection.levelId)
  const size = useThree((s) => s.size)
  const rooms = useMemo<Room[]>(() => {
    if (!levelId) return []
    return Object.values(source.nodes as unknown as Record<string, ZoneNode | undefined>).flatMap((n) => {
      if (n?.type !== 'zone' || n.parentId !== levelId || !n.name) return []
      const polygon = Array.isArray(n.polygon) ? n.polygon : (n.polygon?.points ?? [])
      return polygon.length < 3 ? [] : [{ id: n.id, name: n.name, centre: centreOf(polygon), polygon }]
    })
  }, [levelId, source.nodes])

  const pills = useRef(new Map<string, HTMLButtonElement>())
  const lines = useRef(new Map<string, SVGLineElement>())
  const dots = useRef(new Map<string, SVGCircleElement>())
  const scratch = useMemo(() => ({ v: new THREE.Vector3() }), [])

  useFrame(({ camera }) => {
    const level = levelId ? source.objectFor(levelId) : undefined
    if (!level) return
    const { v } = scratch
    const { width, height } = size
    const toScreen = (x: number, y: number, z: number) => {
      v.set(x, y, z).applyMatrix4(level.matrixWorld).project(camera)
      return { x: ((v.x + 1) / 2) * width, y: ((1 - v.y) / 2) * height, front: v.z < 1 }
    }
    // a room whose middle is off the screen (behind the camera, or zoomed past) has no label
    const onScreen = (d: { x: number; y: number; front: boolean }) => d.front && d.x >= 0 && d.x <= width && d.y >= 0 && d.y <= height
    for (const room of rooms) {
      const pill = pills.current.get(room.id)
      const line = lines.current.get(room.id)
      const dot = dots.current.get(room.id)
      if (!pill) continue
      const foot = toScreen(room.centre[0], DOT_Y, room.centre[1])
      const head = toScreen(room.centre[0], LABEL_Y, room.centre[1])
      if (!onScreen(foot) || !head.front) {
        hide(pill, line, dot)
        continue
      }
      // the label's bottom middle on the stick's top
      pill.style.transform = `translate(${head.x - pill.offsetWidth / 2}px, ${head.y - pill.offsetHeight}px)`
      pill.style.visibility = 'visible'
      if (line) {
        line.setAttribute('x1', String(head.x))
        line.setAttribute('y1', String(head.y))
        line.setAttribute('x2', String(foot.x))
        line.setAttribute('y2', String(foot.y))
        line.style.visibility = 'visible'
      }
      if (dot) {
        dot.setAttribute('cx', String(foot.x))
        dot.setAttribute('cy', String(foot.y))
        dot.style.visibility = 'visible'
      }
    }
  })

  if (!levelId || !rooms.length) return null
  return (
    // under the panels and cards (z-20 and up), over the plan
    <Html calculatePosition={TOP_LEFT} zIndexRange={[15, 0]}>
      <div className="pointer-events-none absolute top-0 left-0" style={{ width: size.width, height: size.height }}>
        <svg aria-hidden="true" className="absolute inset-0 overflow-visible text-foreground" height={size.height} width={size.width}>
          {rooms.map((room) => (
            <RoomLead
              dotRef={(el) => (el ? dots.current.set(room.id, el) : dots.current.delete(room.id))}
              key={room.id}
              lineRef={(el) => (el ? lines.current.set(room.id, el) : lines.current.delete(room.id))}
              picked={room.id === roomId}
              roomId={room.id}
            />
          ))}
        </svg>
        {rooms.map((room) => (
          <RoomPill
            key={room.id}
            name={room.name}
            onPick={onPick}
            picked={room.id === roomId}
            pillRef={(el) => (el ? pills.current.set(room.id, el) : pills.current.delete(room.id))}
            roomId={room.id}
          />
        ))}
      </div>
    </Html>
  )
}

function RoomLead({ roomId, picked, lineRef, dotRef }: {
  roomId: string
  picked: boolean
  lineRef: (el: SVGLineElement | null) => void
  dotRef: (el: SVGCircleElement | null) => void
}) {
  const lit = useRoomHover((s) => s.id === roomId) || picked
  return (
    <g className="transition-opacity" opacity={lit ? 0.95 : 0.55}>
      <line ref={lineRef} stroke="currentColor" strokeWidth={lit ? 1.25 : 1} />
      <circle className="fill-background" r={3.5} ref={dotRef} stroke="currentColor" strokeWidth={1.25} />
    </g>
  )
}

function RoomPill({ roomId, name, picked, onPick, pillRef }: {
  roomId: string
  name: string
  picked: boolean
  onPick: (zoneId: string) => void
  pillRef: (el: HTMLButtonElement | null) => void
}) {
  const lit = useRoomHover((s) => s.id === roomId)
  return (
    <button
      aria-pressed={picked}
      className={`pointer-events-auto absolute top-0 left-0 whitespace-nowrap rounded-full border px-4 py-1.5 font-medium text-sm shadow-sm backdrop-blur transition-colors ${
        picked || lit
          ? 'border-foreground bg-foreground text-background'
          : 'border-border/60 bg-background/70 text-foreground hover:bg-background'
      }`}
      onClick={() => onPick(roomId)}
      onPointerEnter={() => useRoomHover.getState().set(roomId)}
      onPointerLeave={() => {
        if (useRoomHover.getState().id === roomId) useRoomHover.getState().set(null)
      }}
      ref={pillRef}
      // placed by the frame loop; hidden until then
      style={{ visibility: 'hidden' }}
      type="button"
    >
      {name}
    </button>
  )
}
