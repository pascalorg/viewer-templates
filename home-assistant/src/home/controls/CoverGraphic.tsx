/* Ported from home-assistant/frontend (Apache-2.0):
   - src/state-control/cover/ha-state-control-cover.ts
   - src/state-control/cover/cover-drawing-styles.ts
   - src/state-control/cover/shapes/{index,shared,awning,curtain,roller,slats,slide,venetian}.ts */

import {
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react'
import type { HassEntity } from '../entities'
import type { EntityFormatters } from '../hass/names'
import {
  clampPercent,
  type CoverCommand,
  type CoverControlMode,
  type CoverDrag,
  CoverEntityFeature,
  type CoverRequest,
  coverCurrentValue,
  coverHasTiltControls,
  coverModeAttribute,
  coverSupportsPosition,
  coverSupportsSetValue,
  coverSupportsTiltPosition,
  coverTiltOpenness,
  isMoving,
  isOpening,
  PercentSpring,
  type SpringOptions,
  WaveMotion,
} from './cover'
import { supportsFeature, UNAVAILABLE } from './stateColors'

const VIEWBOX_SIZE = 200
const FRAME = {
  left: 10,
  top: 10,
  right: 190,
  bottom: 190,
  width: 180,
  height: 180,
  centerX: 100,
  centerY: 100,
} as const

type OpeningDirection = 'up' | 'down' | 'left'
type HandleMotion = 'follow' | 'drag' | 'swipe' | 'request' | 'return'

type CoverShapeInput = {
  position: number
  tiltOpenness: number
  wave: { velocity: number; phase: number }
  ids: { headrailFilter: string; grassGrad: string }
}

type CoverShapeParts = {
  back?: ReactNode
  cover: ReactNode
  front?: ReactNode
}

type CoverShape = {
  opens: OpeningDirection
  handle?: 'pill' | 'gauge'
  usesWave?: boolean
  render: (input: CoverShapeInput) => CoverShapeParts
  handleAt: (value: number) => [number, number]
  valueAt: (x: number, y: number) => number
  targetLine?: (value: number) => string
  targetShape?: (value: number) => ReactNode
}

const isHorizontal = (shape: CoverShape) => shape.opens === 'left'

const valueAxis = (atEmpty: number, atFull: number) => ({
  coordAt: (value: number) => atEmpty + ((atFull - atEmpty) * value) / 100,
  valueAt: (coord: number) => ((coord - atEmpty) / (atFull - atEmpty)) * 100,
})

const horizontalLine = (y: number, inset = 0) =>
  `M${FRAME.left + inset} ${y.toFixed(1)} H${FRAME.right - inset}`

function renderGhost(shape: ReactNode, opacity = 0.22) {
  return (
    <g className="cover-ghost" opacity={opacity}>
      {shape}
    </g>
  )
}

function renderHeadrail(height: number, filterId: string) {
  return (
    <>
      <filter id={filterId} x="-5%" y="-50%" width="110%" height="300%">
        <feDropShadow dx="0" dy="1.2" stdDeviation="1.2" floodColor="#000" floodOpacity="0.18" />
      </filter>
      <rect
        className="cover-fabric"
        x={FRAME.left}
        y={FRAME.top}
        width={FRAME.width}
        height={height}
        filter={`url(#${filterId})`}
      />
    </>
  )
}

function renderSlat(key: number, top: number, thickness: number) {
  const face = Math.max(0.4, thickness * 0.114)
  return (
    <g key={key}>
      <rect
        className="cover-fabric"
        x={FRAME.left}
        y={Number(top.toFixed(2))}
        width={FRAME.width}
        height={Number(Math.max(1, thickness).toFixed(2))}
      />
      {thickness > 2.2 && (
        <>
          <rect
            className="cover-seam"
            x={FRAME.left}
            y={Number((top + thickness - face).toFixed(2))}
            width={FRAME.width}
            height={Number(face.toFixed(2))}
          />
          <rect
            className="cover-lift"
            x={FRAME.left}
            y={Number(top.toFixed(2))}
            width={FRAME.width}
            height={Number((face * 0.55).toFixed(2))}
          />
        </>
      )}
    </g>
  )
}

/* ---------------- Rolling / Roller / Panel / Shutter / Garage ---------------- */

const ROLL_HEADRAIL = 10.4
const ROLL = 10
const BOTTOM_BAR = 4
const PANEL_EDGE = 2
const HANDLE_INSET = 2
const SHUTTER_SLAT = 12
const GARAGE_PANELS = 5

const coverBottomAxis = valueAxis(FRAME.bottom, FRAME.top + ROLL)
const rollHandleY = (value: number) => coverBottomAxis.coordAt(value) - HANDLE_INSET

const rollingGeometry: Pick<CoverShape, 'opens' | 'handleAt' | 'valueAt' | 'targetLine' | 'targetShape'> = {
  opens: 'up',
  handleAt: (value) => [FRAME.centerX, rollHandleY(value)],
  valueAt: (_x, y) => coverBottomAxis.valueAt(y + HANDLE_INSET),
  targetLine: (value) => horizontalLine(rollHandleY(value)),
  targetShape: (value) =>
    renderGhost(
      <rect
        x={FRAME.left}
        y={FRAME.top}
        width={FRAME.width}
        height={Number((coverBottomAxis.coordAt(value) - FRAME.top).toFixed(1))}
      />,
    ),
}

function makeRollingShape(details?: (bottom: number, position: number) => ReactNode): CoverShape {
  return {
    ...rollingGeometry,
    render: ({ position, ids }) => {
      const bottom = coverBottomAxis.coordAt(position)
      return {
        cover: (
          <>
            <rect
              className="cover-fabric"
              x={FRAME.left}
              y={FRAME.top}
              width={FRAME.width}
              height={Number((bottom - FRAME.top).toFixed(1))}
            />
            {details?.(bottom, position)}
            <rect
              className="cover-bottom-bar"
              x={FRAME.left}
              y={Number((bottom - BOTTOM_BAR).toFixed(1))}
              width={FRAME.width}
              height={BOTTOM_BAR}
            />
          </>
        ),
        front: renderHeadrail(ROLL_HEADRAIL, ids.headrailFilter),
      }
    },
  }
}

const rollerShape = makeRollingShape()

const panelShape: CoverShape = {
  ...rollingGeometry,
  render: ({ position }) => {
    const bottom = coverBottomAxis.coordAt(position)
    return {
      cover: (
        <>
          <rect
            className="cover-fabric"
            x={FRAME.left}
            y={FRAME.top}
            width={FRAME.width}
            height={Number((bottom - FRAME.top).toFixed(1))}
          />
          <rect
            className="cover-bottom-bar"
            x={FRAME.left}
            y={Number((bottom - PANEL_EDGE).toFixed(1))}
            width={FRAME.width}
            height={PANEL_EDGE}
          />
        </>
      ),
    }
  },
}

const shutterShape = makeRollingShape((bottom, position) => {
  const parts: ReactNode[] = []
  let idx = 0
  for (let lineY = bottom - BOTTOM_BAR - SHUTTER_SLAT; lineY > FRAME.top; lineY -= SHUTTER_SLAT) {
    const y = Number(lineY.toFixed(1))
    parts.push(
      <line key={`l-${idx++}`} className="cover-slat-line" x1={FRAME.left} y1={y} x2={FRAME.right} y2={y} />,
    )
    if (position > 0) {
      for (let slotX = FRAME.left + 8; slotX < FRAME.right - 8; slotX += 16) {
        parts.push(
          <rect
            key={`s-${idx++}`}
            className="cover-slot"
            x={slotX}
            y={Number((lineY - 1.2).toFixed(1))}
            width={7}
            height={2.4}
            rx={1.2}
          />,
        )
      }
    }
  }
  return parts
})

const garageShape = makeRollingShape((bottom) => {
  const panelHeight = FRAME.height / GARAGE_PANELS
  const firstPanelTop = bottom - FRAME.height
  const lintel = FRAME.top + ROLL_HEADRAIL
  const parts: ReactNode[] = []
  for (let i = 0; i < GARAGE_PANELS; i++) {
    const top = firstPanelTop + i * panelHeight
    const panelBottom = top + panelHeight
    if (panelBottom <= lintel) continue
    parts.push(
      top < lintel ? (
        <rect
          key={i}
          className="cover-panel-shadow"
          x={FRAME.left}
          y={lintel}
          width={FRAME.width}
          height={Number((panelBottom - lintel).toFixed(1))}
          opacity={Number(((0.22 * (lintel - top)) / panelHeight).toFixed(3))}
        />
      ) : (
        <rect
          key={i}
          className="cover-seam"
          x={FRAME.left}
          y={Number((top - 0.8).toFixed(1))}
          width={FRAME.width}
          height={1.6}
        />
      ),
    )
  }
  return parts
})

/* ---------------- Awning ---------------- */

const AWNING_SCALLOPS = 8
const AWNING_SCALLOP_W = FRAME.width / AWNING_SCALLOPS
const awningHemAxis = valueAxis(FRAME.top, FRAME.top + FRAME.height * 0.9)
const awningHemY = (value: number) => Math.max(FRAME.top + 8, awningHemAxis.coordAt(value))

function awningScallops(bottom: number): string {
  let path = ''
  for (let i = AWNING_SCALLOPS; i > 0; i--) {
    path += ` Q${FRAME.left + (i - 0.5) * AWNING_SCALLOP_W},${bottom + 6} ${FRAME.left + (i - 1) * AWNING_SCALLOP_W},${bottom}`
  }
  return path
}

const awningOutline = (bottom: number) =>
  `M${FRAME.left},${FRAME.top} H${FRAME.right} V${bottom}${awningScallops(bottom)} Z`

const awningShape: CoverShape = {
  opens: 'down',
  render: ({ position, ids }) => {
    const bottom = awningHemY(position)
    return {
      cover: (
        <>
          <path className="cover-fabric" d={awningOutline(bottom)} />
          {Array.from({ length: AWNING_SCALLOPS - 1 }, (_, i) => (
            <rect
              key={i}
              className="cover-seam"
              opacity={0.5}
              x={Number((FRAME.left + (i + 1) * AWNING_SCALLOP_W - 0.3).toFixed(1))}
              y={FRAME.top}
              width={0.6}
              height={Number((bottom - FRAME.top).toFixed(1))}
            />
          ))}
        </>
      ),
      front: renderHeadrail(10.4, ids.headrailFilter),
    }
  },
  handleAt: (value) => [FRAME.centerX, awningHemY(value)],
  valueAt: (_x, y) => awningHemAxis.valueAt(y),
  targetLine: (value) => {
    const bottom = awningHemY(value)
    return `M${FRAME.right},${bottom}${awningScallops(bottom)}`
  },
  targetShape: (value) => renderGhost(<path d={awningOutline(awningHemY(value))} />),
}

/* ---------------- Curtain ---------------- */

const CURTAIN_GATHERED = 22
const CURTAIN_ROWS = 12
const CURTAIN_FOLDS = 12
const curtainFreeEdge = valueAxis(FRAME.right, FRAME.left + CURTAIN_GATHERED)

const pointsToPath = (pts: [number, number][]) =>
  pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ')

const curtainHang = (t: number) => t ** 1.3
const curtainVert = (xAt: (t: number) => number): [number, number][] =>
  Array.from({ length: CURTAIN_ROWS + 1 }, (_, row) => [
    xAt(row / CURTAIN_ROWS),
    FRAME.top + (FRAME.height * row) / CURTAIN_ROWS,
  ])
const swingWave = (t: number, phase: number, delay = 0) =>
  Math.sin(t * Math.PI * 1.2 + phase - delay) * curtainHang(t) * 1.4
const restWave = (t: number, phase: number, delay = 0) =>
  Math.sin(t * Math.PI * 2 + phase * 0.6 - delay) * curtainHang(t)

const curtainShape: CoverShape = {
  opens: 'left',
  usesWave: true,
  render: ({ position, wave, ids }) => {
    const { left, top, bottom } = FRAME
    const open = position / 100
    const width = curtainFreeEdge.coordAt(position) - left
    const velocity = Math.min(Math.max(-wave.velocity, -1.5), 1.5)
    const phase = wave.phase
    const swing = Math.min(4.8, Math.abs(velocity) * 2.6) * Math.sign(velocity || 1)
    const rest = open * 1.4
    const lag = (t: number) => -Math.abs(velocity) * 4.6 * t ** 1.5 * Math.sign(velocity)

    const hem = curtainVert(
      (t) => left + width + lag(t) + swing * swingWave(t, phase) + rest * restWave(t, phase),
    )
    const folds = Array.from({ length: CURTAIN_FOLDS }, (_, idx) => {
      const i = idx + 1
      const distance = 1 - i / (CURTAIN_FOLDS + 1)
      const weight = (1 - distance) ** 1.3
      return curtainVert(
        (t) =>
          left +
          (width * i) / (CURTAIN_FOLDS + 1) +
          lag(t) * weight +
          swing * 1.35 * swingWave(t, phase, distance * 3.2) * weight +
          rest * 1.6 * restWave(t, phase, distance * 2.5) * open * (0.4 + 0.6 * weight),
      )
    })
    const stripes: string[] = []
    for (let i = 0; i < folds.length - 1; i += 2) {
      stripes.push(`${pointsToPath([...folds[i]!, ...folds[i + 1]!.slice().reverse()])} Z`)
    }
    return {
      cover: (
        <>
          <path className="cover-fabric" d={`${pointsToPath([[left, top], ...hem, [left, bottom]])} Z`} />
          {stripes.map((d, i) => (
            <path key={i} className="cover-stripe" d={d} />
          ))}
        </>
      ),
      front: renderHeadrail(6.4, ids.headrailFilter),
    }
  },
  handleAt: (value) => [curtainFreeEdge.coordAt(value), FRAME.centerY],
  valueAt: (x) => curtainFreeEdge.valueAt(x),
  targetLine: (value) => `M${curtainFreeEdge.coordAt(value).toFixed(1)} ${FRAME.top} V${FRAME.bottom}`,
  targetShape: (value) =>
    renderGhost(
      <rect
        x={FRAME.left}
        y={FRAME.top}
        width={Number((curtainFreeEdge.coordAt(value) - FRAME.left).toFixed(1))}
        height={FRAME.height}
      />,
    ),
}

/* ---------------- Venetian blind ---------------- */

const VEN_PITCH = 10
const VEN_STACK_PITCH = 0.6
const VEN_FLAT = 0.8
const VEN_CORDS = [0.22, 0.78]

const venetianShape: CoverShape = {
  ...rollingGeometry,
  render: ({ position, tiltOpenness, ids }) => {
    const { left, top, width, height } = FRAME
    const thickness = 9 - (7 * clampPercent(tiltOpenness)) / 100
    const count = Math.ceil(height / VEN_PITCH) + 1
    const first = top + thickness / 2
    const pitch = (top + height - thickness / 2 - first) / (count - 1)
    const rail = coverBottomAxis.coordAt(position)
    const centers = Array.from({ length: count }, (_, i) =>
      Math.max(
        first + i * VEN_STACK_PITCH,
        Math.min(first + i * pitch, rail - thickness / 2 - (count - 1 - i) * VEN_STACK_PITCH),
      ),
    )
    const openness: number[] = []
    for (let i = 0; i < count - 1; i++) {
      const gap = centers[i + 1]! - centers[i]! - VEN_STACK_PITCH
      openness.push(Math.min(Math.max(gap / (pitch - VEN_STACK_PITCH), 0), 1))
    }
    openness.push(openness[count - 2] ?? 0)
    const last = centers[count - 1] ?? top
    return {
      cover: (
        <>
          {centers.map((center, i) => {
            const slatHeight = VEN_FLAT + (thickness - VEN_FLAT) * openness[i]!
            return renderSlat(i, center - Math.max(0.5, slatHeight / 2), slatHeight)
          })}
          {VEN_CORDS.map((frac, i) => (
            <rect
              key={i}
              className="cover-cord"
              x={Number((left + width * frac - 0.7).toFixed(1))}
              y={top}
              width={1.4}
              height={Number(Math.max(0, last + 1 - top).toFixed(1))}
            />
          ))}
        </>
      ),
      front: renderHeadrail(8.8, ids.headrailFilter),
    }
  },
}

/* ---------------- Gate (slide) ---------------- */

const GATE_TRAVEL = FRAME.width - 28
const GATE_TOP = FRAME.top + FRAME.height * 0.36
const GATE_GROUND = FRAME.bottom - 20
const GATE_HEIGHT = GATE_GROUND - GATE_TOP
const GATE_BOARDS = 6
const GATE_BOARD_GAP = 4
const GATE_BOARD_H = (GATE_HEIGHT - GATE_BOARD_GAP * (GATE_BOARDS - 1)) / GATE_BOARDS
const GATE_POST_W = 7
const gateLeadingEdge = valueAxis(FRAME.right, FRAME.right - GATE_TRAVEL)
const gateLeftAt = (value: number) => gateLeadingEdge.coordAt(value) - FRAME.width

const GATE_GRASS = (() => {
  let path = `M${FRAME.left},${FRAME.bottom} V${GATE_GROUND}`
  for (let x = FRAME.left, i = 0; x < FRAME.right; x += 9, i++) {
    path += ` Q${x + 4.5},${GATE_GROUND - (i % 3 === 1 ? 6 : 4)} ${x + 9},${GATE_GROUND}`
  }
  return `${path} V${FRAME.bottom} Z`
})()

const slideShape: CoverShape = {
  opens: 'left',
  render: ({ position, ids }) => {
    const left = gateLeftAt(position)
    return {
      cover: (
        <>
          {Array.from({ length: GATE_BOARDS }, (_, i) => (
            <rect
              key={i}
              className="cover-metal"
              x={left}
              y={Number((GATE_TOP + i * (GATE_BOARD_H + GATE_BOARD_GAP)).toFixed(1))}
              width={FRAME.width}
              height={Number(GATE_BOARD_H.toFixed(1))}
              rx={2}
            />
          ))}
          <rect className="cover-metal" x={left} y={GATE_TOP} width={GATE_POST_W} height={GATE_HEIGHT} rx={2} />
          <rect
            className="cover-metal"
            x={left + FRAME.width - GATE_POST_W}
            y={GATE_TOP}
            width={GATE_POST_W}
            height={GATE_HEIGHT}
            rx={2}
          />
        </>
      ),
      front: (
        <>
          <linearGradient id={ids.grassGrad} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" className="cover-grass-top" />
            <stop offset="1" className="cover-grass-bottom" />
          </linearGradient>
          <path d={GATE_GRASS} fill={`url(#${ids.grassGrad})`} />
        </>
      ),
    }
  },
  handleAt: (value) => [gateLeadingEdge.coordAt(value), GATE_TOP + GATE_HEIGHT / 2],
  valueAt: (x) => gateLeadingEdge.valueAt(x),
  targetLine: (value) => `M${gateLeadingEdge.coordAt(value).toFixed(1)} ${GATE_TOP} V${GATE_GROUND}`,
  targetShape: (value) =>
    renderGhost(<rect x={gateLeftAt(value)} y={GATE_TOP} width={FRAME.width} height={GATE_HEIGHT} rx={2} />),
}

/* ---------------- Tilt slats ---------------- */

const tiltAxis = valueAxis(FRAME.bottom - 16, FRAME.top + 16)
const SLATS_PITCH = 12

const slatsShape: CoverShape = {
  opens: 'up',
  handle: 'gauge',
  handleAt: (value) => [FRAME.right - 14, tiltAxis.coordAt(value)],
  valueAt: (_x, y) => tiltAxis.valueAt(y),
  render: ({ tiltOpenness }) => {
    const count = Math.floor(FRAME.height / SLATS_PITCH)
    const thickness = Math.max(1.2, (SLATS_PITCH - 1) * (1 - tiltOpenness / 100))
    return {
      cover: Array.from({ length: count }, (_, i) =>
        renderSlat(i, FRAME.top + i * SLATS_PITCH + (SLATS_PITCH - thickness) / 2, thickness),
      ),
    }
  },
}

const POSITION_SHAPES: Readonly<Record<string, CoverShape>> = {
  awning: awningShape,
  blind: venetianShape,
  curtain: curtainShape,
  garage: garageShape,
  gate: slideShape,
  shade: rollerShape,
  shutter: shutterShape,
}

function resolveCoverShape(deviceClass: string | undefined, mode: CoverControlMode): CoverShape {
  if (mode === 'tilt') return slatsShape
  return (deviceClass && POSITION_SHAPES[deviceClass]) || panelShape
}

/* ---------------- CoverGraphic Component ---------------- */

const SWIPE_SPRING: SpringOptions = { stiffness: 22, damping: 0.8 }
const KEY_COMMIT_DELAY = 500
const SWIPE_RESISTANCE = 20
const GAUGE_WIDTH = 16
const DRAG_THRESHOLD_PX = 5

const MOVING_HINT_ANGLE: Record<OpeningDirection, number> = {
  up: 0,
  down: 180,
  left: -90,
}

const swipeResistance = (distance: number) =>
  SWIPE_RESISTANCE * (1 - Math.exp(-Math.max(0, distance) / 30))

export type CoverGraphicProps = {
  entity: HassEntity
  mode: CoverControlMode
  request?: CoverRequest
  formatters: EntityFormatters
  onCommand: (command: CoverCommand) => void
  onDragChanged: (drag: CoverDrag | undefined) => void
}

export function CoverGraphic({
  entity,
  mode,
  request,
  formatters,
  onCommand,
  onDragChanged,
}: CoverGraphicProps) {
  const uid = useId().replace(/:/g, '')
  const ids = {
    sky: `sky-${uid}`,
    skyWarm: `skyw-${uid}`,
    skyCool: `skyc-${uid}`,
    clip: `clip-${uid}`,
    headrailFilter: `hr-${uid}`,
    grassGrad: `gr-${uid}`,
  }

  const controlRef = useRef<HTMLDivElement>(null)
  const [drag, setDragState] = useState<CoverDrag | undefined>(undefined)
  const [pointerFocus, setPointerFocus] = useState(false)
  const [, setTick] = useState(0)

  const coverSpringsRef = useRef({ position: new PercentSpring(), tilt: new PercentSpring() })
  const handleSpringsRef = useRef({ position: new PercentSpring(), tilt: new PercentSpring() })
  const handleMotionsRef = useRef<Record<CoverControlMode, HandleMotion>>({
    position: 'follow',
    tilt: 'follow',
  })
  const waveRef = useRef(new WaveMotion())
  const rafRef = useRef<number | undefined>(undefined)
  const lastFrameRef = useRef(0)
  const keyTimerRef = useRef<number | undefined>(undefined)
  const lastEntityIdRef = useRef<string | null>(null)

  const dragRef = useRef<CoverDrag | undefined>(undefined)
  const pointerStateRef = useRef<{
    pointerId: number
    startX: number
    startY: number
    startPointer: number
    startValue: number
    moved: boolean
    isSwipe: boolean
    swipeAction?: 'open' | 'close'
  } | null>(null)

  const shape = resolveCoverShape(entity.attributes.device_class, mode)
  const canSetValue = coverSupportsSetValue(entity, mode)
  const openCloseOnly =
    mode === 'position' &&
    !coverSupportsPosition(entity) &&
    (supportsFeature(entity, CoverEntityFeature.OPEN) ||
      supportsFeature(entity, CoverEntityFeature.CLOSE))
  const valueUnknown =
    !(mode === 'tilt' && !canSetValue) && coverCurrentValue(entity, mode) === undefined
  const interactive = entity.state !== UNAVAILABLE && (canSetValue || (openCloseOnly && !valueUnknown))
  const valueChanging = drag !== undefined || request?.mode === mode

  const drawingGoal = (m: CoverControlMode): number => {
    const val = coverCurrentValue(entity, m)
    if (val !== undefined) return clampPercent(val)
    if (m === 'tilt' && !coverSupportsTiltPosition(entity)) return 50
    return coverSpringsRef.current[m].value
  }

  const handleGoal = (m: CoverControlMode): number => {
    if (request?.mode === m) return request.value
    return Math.round(drawingGoal(m))
  }

  const latestRef = useRef({
    entity,
    mode,
    request,
    shape,
    drawingGoal,
    handleGoal,
    onCommand,
    onDragChanged,
  })
  latestRef.current = {
    entity,
    mode,
    request,
    shape,
    drawingGoal,
    handleGoal,
    onCommand,
    onDragChanged,
  }

  const updateDrag = (next: CoverDrag | undefined) => {
    const prev = dragRef.current
    dragRef.current = next
    setDragState(next)
    startLoop()
    if (!next && !prev) return
    const changed =
      !next ||
      !prev ||
      (next.swipe ? next.swipe.passedHalfway !== prev.swipe?.passedHalfway : next.value !== prev.value)
    if (changed) latestRef.current.onDragChanged(next)
  }

  const startLoop = () => {
    if (rafRef.current !== undefined) return
    lastFrameRef.current = performance.now()
    const step = (time: number) => {
      rafRef.current = undefined
      const dt = Math.min(100, time - lastFrameRef.current) / 1000
      lastFrameRef.current = time
      const reducedMotion =
        typeof window !== 'undefined' &&
        window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

      const cur = latestRef.current
      let changed = false

      for (const m of ['position', 'tilt'] as const) {
        const goal = cur.drawingGoal(m)
        const cSpring = coverSpringsRef.current[m]
        const hSpring = handleSpringsRef.current[m]
        changed = (reducedMotion ? cSpring.jumpTo(goal) : cSpring.moveTo(goal, dt)) || changed

        let motion: HandleMotion = 'follow'
        if (dragRef.current && cur.mode === m) {
          motion = dragRef.current.swipe ? 'swipe' : 'drag'
        } else if (cur.request?.mode === m) {
          motion = 'request'
        } else {
          const prevM = handleMotionsRef.current[m]
          const afterReq = prevM === 'request' || prevM === 'return'
          if (afterReq && Math.abs(hSpring.value - cSpring.value) > 0.5) {
            motion = 'return'
          }
        }
        handleMotionsRef.current[m] = motion

        let hChanged = false
        if (motion === 'drag') {
          hChanged = hSpring.jumpTo(dragRef.current!.value)
        } else if (motion === 'swipe') {
          hChanged = reducedMotion
            ? hSpring.jumpTo(dragRef.current!.value)
            : hSpring.moveTo(dragRef.current!.value, dt, SWIPE_SPRING)
        } else if (motion === 'request') {
          hChanged = reducedMotion
            ? hSpring.jumpTo(cur.request!.value)
            : hSpring.moveTo(cur.request!.value, dt)
        } else if (motion === 'return') {
          hChanged = reducedMotion ? hSpring.jumpTo(goal) : hSpring.moveTo(goal, dt)
        } else {
          hChanged = hSpring.jumpTo(cSpring.value)
        }
        changed = hChanged || changed
      }

      if (cur.shape.usesWave) {
        const pos = coverSpringsRef.current.position.value
        if (reducedMotion) {
          waveRef.current.jumpTo(pos)
        } else {
          changed = waveRef.current.moveTo(pos, dt) || changed
        }
      }

      if (changed) {
        setTick((t) => (t + 1) & 0x7fffffff)
        rafRef.current = requestAnimationFrame(step)
      }
    }
    rafRef.current = requestAnimationFrame(step)
  }

  useEffect(() => {
    if (lastEntityIdRef.current !== entity.entity_id) {
      lastEntityIdRef.current = entity.entity_id
      for (const m of ['position', 'tilt'] as const) {
        const v = drawingGoal(m)
        coverSpringsRef.current[m].jumpTo(v)
        handleSpringsRef.current[m].jumpTo(v)
      }
      handleMotionsRef.current = { position: 'follow', tilt: 'follow' }
      waveRef.current.reset(coverSpringsRef.current.position.value)
      setTick((t) => (t + 1) & 0x7fffffff)
    }
    startLoop()
  })

  useEffect(
    () => () => {
      if (rafRef.current !== undefined) cancelAnimationFrame(rafRef.current)
      if (keyTimerRef.current !== undefined) window.clearTimeout(keyTimerRef.current)
    },
    [],
  )

  const commitKeyValue = () => {
    if (keyTimerRef.current === undefined) return
    window.clearTimeout(keyTimerRef.current)
    keyTimerRef.current = undefined
    const val = dragRef.current?.value
    updateDrag(undefined)
    if (val !== undefined) {
      latestRef.current.onCommand({ mode: latestRef.current.mode, action: 'set', value: val })
    }
  }

  const pointerValueAt = (clientX: number, clientY: number): number | undefined => {
    const rect = controlRef.current?.getBoundingClientRect()
    if (!rect?.width || !rect.height) return undefined
    let x = ((clientX - rect.left) / rect.width) * VIEWBOX_SIZE
    const y = ((clientY - rect.top) / rect.height) * VIEWBOX_SIZE
    const isRtl = typeof document !== 'undefined' && document.dir === 'rtl'
    if (isHorizontal(shape) && isRtl) x = VIEWBOX_SIZE - x
    return shape.valueAt(x, y)
  }

  const handlePointerDown = (ev: PointerEvent<HTMLDivElement>) => {
    if (!interactive || (ev.pointerType === 'mouse' && ev.button !== 0)) return
    commitKeyValue()
    setPointerFocus(true)
    controlRef.current?.focus({ preventScroll: true })
    ev.preventDefault()

    const startPointer = pointerValueAt(ev.clientX, ev.clientY)
    if (startPointer === undefined) return

    if (openCloseOnly) {
      const end = request?.mode === 'position' ? request.value : drawingGoal('position')
      const action: 'open' | 'close' = end >= 50 ? 'close' : 'open'
      const needed = action === 'close' ? CoverEntityFeature.CLOSE : CoverEntityFeature.OPEN
      if (!supportsFeature(entity, needed)) return
      ev.currentTarget.setPointerCapture(ev.pointerId)
      pointerStateRef.current = {
        pointerId: ev.pointerId,
        startX: ev.clientX,
        startY: ev.clientY,
        startPointer,
        startValue: end,
        moved: false,
        isSwipe: true,
        swipeAction: action,
      }
      return
    }

    const startValue = valueUnknown && request?.mode !== mode ? startPointer : handleGoal(mode)
    ev.currentTarget.setPointerCapture(ev.pointerId)
    pointerStateRef.current = {
      pointerId: ev.pointerId,
      startX: ev.clientX,
      startY: ev.clientY,
      startPointer,
      startValue,
      moved: false,
      isSwipe: false,
    }
  }

  const handlePointerMove = (ev: PointerEvent<HTMLDivElement>) => {
    const st = pointerStateRef.current
    if (!st || st.pointerId !== ev.pointerId) return
    if (!st.moved && Math.hypot(ev.clientX - st.startX, ev.clientY - st.startY) >= DRAG_THRESHOLD_PX) {
      st.moved = true
    }
    if (!st.moved) return
    const pointer = pointerValueAt(ev.clientX, ev.clientY)
    if (pointer === undefined) return

    if (st.isSwipe && st.swipeAction) {
      const closing = st.swipeAction === 'close'
      const direction = closing ? -1 : 1
      const progress = (pointer - st.startPointer) * direction
      const passedHalfway = progress > 50
      const travel = passedHalfway
        ? 100 - swipeResistance(100 - progress)
        : swipeResistance(progress)
      updateDrag({
        value: closing ? 100 - travel : travel,
        swipe: { action: st.swipeAction, passedHalfway },
      })
    } else {
      const value = st.startValue + pointer - st.startPointer
      updateDrag({ value: clampPercent(Math.round(value)) })
    }
  }

  const handlePointerUp = (ev: PointerEvent<HTMLDivElement>) => {
    const st = pointerStateRef.current
    if (!st || st.pointerId !== ev.pointerId) return
    pointerStateRef.current = null
    if (ev.currentTarget.hasPointerCapture(ev.pointerId)) {
      ev.currentTarget.releasePointerCapture(ev.pointerId)
    }

    if (st.isSwipe && st.swipeAction) {
      const action = st.swipeAction
      const closing = action === 'close'
      if (st.moved) {
        const passed = Boolean(dragRef.current?.swipe?.passedHalfway)
        updateDrag(undefined)
        if (passed) onCommand({ mode: 'position', action })
      } else {
        const pointer = pointerValueAt(ev.clientX, ev.clientY)
        updateDrag(undefined)
        if (pointer !== undefined && (pointer >= 50) !== closing) {
          onCommand({ mode: 'position', action })
        }
      }
      return
    }

    if (st.moved) {
      const val = dragRef.current?.value
      updateDrag(undefined)
      if (val !== undefined) onCommand({ mode, action: 'set', value: val })
    } else {
      const pointer = pointerValueAt(ev.clientX, ev.clientY)
      updateDrag(undefined)
      if (pointer !== undefined) {
        onCommand({ mode, action: 'set', value: clampPercent(Math.round(pointer)) })
      }
    }
  }

  const handlePointerCancel = (ev: PointerEvent<HTMLDivElement>) => {
    if (pointerStateRef.current?.pointerId !== ev.pointerId) return
    pointerStateRef.current = null
    updateDrag(undefined)
  }

  const handleKeyDown = (ev: KeyboardEvent<HTMLDivElement>) => {
    setPointerFocus(false)
    if (!interactive || !canSetValue) return
    const isRtl = typeof document !== 'undefined' && document.dir === 'rtl'
    const hSign = isRtl ? -1 : 1
    const inc = ev.shiftKey ? 10 : 1
    let step: number | undefined
    switch (ev.key) {
      case 'ArrowUp': step = inc; break
      case 'ArrowDown': step = -inc; break
      case 'ArrowRight': step = inc * hSign; break
      case 'ArrowLeft': step = -inc * hSign; break
      case 'PageUp': step = 10; break
      case 'PageDown': step = -10; break
      case 'Home': step = -100; break
      case 'End': step = 100; break
    }
    if (step === undefined) return
    ev.preventDefault()
    const cur = dragRef.current?.value ?? handleGoal(mode)
    updateDrag({ value: clampPercent(cur + step) })
    if (keyTimerRef.current !== undefined) window.clearTimeout(keyTimerRef.current)
    keyTimerRef.current = window.setTimeout(commitKeyValue, KEY_COMMIT_DELAY)
  }

  const coverVal = coverSpringsRef.current[mode].value
  const handleVal = handleSpringsRef.current[mode].value
  const withHandle = interactive && (!valueUnknown || valueChanging)
  const withTarget = valueChanging && (valueUnknown || Math.abs(handleVal - coverVal) > 1)

  const drawnTiltOpenness =
    mode === 'tilt' && drag
      ? coverTiltOpenness(entity, drag.value)
      : coverHasTiltControls(entity)
        ? coverTiltOpenness(entity, coverSpringsRef.current.tilt.value)
        : 0

  const parts = shape.render({
    position: coverSpringsRef.current.position.value,
    tiltOpenness: drawnTiltOpenness,
    wave: waveRef.current,
    ids,
  })

  const movingHintAngle =
    mode === 'position' && !valueUnknown && isMoving(entity)
      ? isOpening(entity)
        ? MOVING_HINT_ANGLE[shape.opens]
        : MOVING_HINT_ANGLE[shape.opens] + 180
      : undefined

  const [hx, hy] = shape.handleAt(handleVal)
  const [, railTop] = shape.handleAt(100)
  const [, railBottom] = shape.handleAt(0)

  const sliderActive = interactive && canSetValue
  const ariaValue = Math.round(drag?.value ?? handleGoal(mode))
  const ariaLabel =
    formatters.localize(mode === 'tilt' ? 'ui.card.cover.tilt_position' : 'ui.card.cover.position') ||
    (mode === 'tilt' ? 'Tilt position' : 'Position')
  const ariaValueText =
    valueUnknown && !valueChanging
      ? formatters.localize('state.default.unknown') || 'Unknown'
      : formatters.formatEntityAttributeValue(entity, coverModeAttribute(mode), ariaValue)

  const { left, top, width, height } = FRAME

  return (
    <div
      ref={controlRef}
      role={sliderActive ? 'slider' : undefined}
      tabIndex={sliderActive ? 0 : undefined}
      aria-label={sliderActive ? ariaLabel : undefined}
      aria-valuemin={sliderActive ? 0 : undefined}
      aria-valuemax={sliderActive ? 100 : undefined}
      aria-valuenow={sliderActive ? ariaValue : undefined}
      aria-valuetext={sliderActive ? ariaValueText : undefined}
      aria-orientation={sliderActive ? (isHorizontal(shape) ? 'horizontal' : 'vertical') : undefined}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      onKeyDown={handleKeyDown}
      onBlur={() => {
        setPointerFocus(false)
        commitKeyValue()
      }}
      className={`cover-drawing relative aspect-square w-[240px] max-w-full flex-none touch-none rounded-[28px] outline-none select-none ${
        interactive ? 'cursor-grab active:cursor-grabbing' : ''
      } ${entity.state === UNAVAILABLE ? 'opacity-40' : ''} ${
        !pointerFocus ? 'focus-visible:ring-[3px] focus-visible:ring-[#009ac7]' : ''
      }`}
    >
      <svg viewBox={`0 0 ${VIEWBOX_SIZE} ${VIEWBOX_SIZE}`} className="block h-full w-full" aria-hidden="true">
        <defs>
          <linearGradient id={ids.sky} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" className="cover-sky-top" />
            <stop offset="1" className="cover-sky-bottom" />
          </linearGradient>
          <radialGradient id={ids.skyWarm} cx="22%" cy="14%" r="58%">
            <stop offset="0" className="cover-sky-warm" stopOpacity="0.55" />
            <stop offset="1" className="cover-sky-warm" stopOpacity="0" />
          </radialGradient>
          <radialGradient id={ids.skyCool} cx="82%" cy="92%" r="62%">
            <stop offset="0" className="cover-sky-cool" stopOpacity="0.45" />
            <stop offset="1" className="cover-sky-cool" stopOpacity="0" />
          </radialGradient>
          <clipPath id={ids.clip}>
            <rect x={left} y={top} width={width} height={height} rx={12} />
          </clipPath>
        </defs>

        <rect className="cover-frame" width={VIEWBOX_SIZE} height={VIEWBOX_SIZE} rx={22} />

        <g>
          <g clipPath={`url(#${ids.clip})`}>
            <rect x={left} y={top} width={width} height={height} fill={`url(#${ids.sky})`} />
            <rect x={left} y={top} width={width} height={height} fill={`url(#${ids.skyWarm})`} />
            <rect x={left} y={top} width={width} height={height} fill={`url(#${ids.skyCool})`} />
            {parts.back}
            {!valueUnknown && parts.cover}
            {parts.front}
            {withTarget && (
              <>
                {shape.targetShape?.(handleVal)}
                {shape.targetLine && <path className="cover-target-line" d={shape.targetLine(handleVal)} />}
              </>
            )}
          </g>

          <rect
            className="cover-opening-edge"
            x={left - 0.5}
            y={top - 0.5}
            width={width + 1}
            height={height + 1}
            rx={12.5}
          />

          {movingHintAngle !== undefined && (
            <g transform={`translate(${FRAME.centerX} ${FRAME.centerY}) rotate(${movingHintAngle})`}>
              <g className="cover-moving-hint">
                <path className="cover-chevron" opacity={0.55} d="M-6 6.5 L0 0.5 L6 6.5" />
                <path className="cover-chevron" d="M-6 -0.5 L0 -6.5 L6 -0.5" />
              </g>
            </g>
          )}

          {withHandle &&
            (shape.handle === 'gauge' ? (
              <>
                <rect
                  className="cover-gauge-rail"
                  x={hx - GAUGE_WIDTH / 2}
                  y={railTop - GAUGE_WIDTH / 2}
                  width={GAUGE_WIDTH}
                  height={railBottom - railTop + GAUGE_WIDTH}
                  rx={GAUGE_WIDTH / 2}
                />
                <circle className="cover-gauge-ball" cx={hx} cy={hy} r={GAUGE_WIDTH / 2 - 2} />
              </>
            ) : isHorizontal(shape) ? (
              <rect className="cover-pill-handle" x={hx - 4} y={hy - 22} width={8} height={44} rx={4} />
            ) : (
              <rect className="cover-pill-handle" x={hx - 24} y={hy - 4} width={48} height={8} rx={4} />
            ))}
        </g>
      </svg>
    </div>
  )
}
