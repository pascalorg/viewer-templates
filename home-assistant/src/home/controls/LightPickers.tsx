/* Ported from home-assistant/frontend (Apache-2.0):
   - src/state-control/light/ha-state-control-light-brightness.ts
   - src/components/ha-hs-color-picker.ts
   - src/dialogs/more-info/components/lights/light-color-rgb-picker.ts
   - src/dialogs/more-info/components/lights/light-color-temp-picker.ts
   - src/dialogs/more-info/components/lights/ha-more-info-light-favorite-colors.ts
   - src/dialogs/more-info/components/lights/ha-favorite-color-button.ts */

import {
  mdiBrightness7,
  mdiEyedropper,
  mdiFileWordBox,
  mdiFileWordBoxOutline,
} from '@mdi/js'
import {
  type ChangeEvent,
  type PointerEvent,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react'
import type { HassEntity } from '../entities'
import type { EntityFormatters } from '../hass/names'
import {
  DEFAULT_MAX_KELVIN,
  DEFAULT_MIN_KELVIN,
  generateColorTemperatureGradient,
  hex2rgb,
  hs2rgb,
  hsv2rgb,
  luminosity,
  rgb2hex,
  rgb2hs,
  rgb2hsv,
  rgbw2rgb,
  rgbww2rgb,
  temperature2rgb,
} from './colorMath'
import { ControlSlider } from './ControlSlider'
import { MdiIcon } from './MdiIcon'
import { createThrottle, PendingValueSync } from './pendingSync'
import { type ServiceCallFn, stateActive, stateColorCss, UNAVAILABLE } from './stateColors'

export const LightEntityFeature = {
  EFFECT: 4,
  FLASH: 8,
  TRANSITION: 32,
} as const

export const LightColorMode = {
  UNKNOWN: 'unknown',
  ONOFF: 'onoff',
  BRIGHTNESS: 'brightness',
  COLOR_TEMP: 'color_temp',
  HS: 'hs',
  XY: 'xy',
  RGB: 'rgb',
  RGBW: 'rgbw',
  RGBWW: 'rgbww',
  WHITE: 'white',
} as const

export type LightColorModeValue = (typeof LightColorMode)[keyof typeof LightColorMode]

const MODES_SUPPORTING_COLOR: readonly string[] = [
  LightColorMode.HS,
  LightColorMode.XY,
  LightColorMode.RGB,
  LightColorMode.RGBW,
  LightColorMode.RGBWW,
]

const MODES_SUPPORTING_BRIGHTNESS: readonly string[] = [
  ...MODES_SUPPORTING_COLOR,
  LightColorMode.COLOR_TEMP,
  LightColorMode.BRIGHTNESS,
  LightColorMode.WHITE,
]

export type LightColor =
  | { color_temp_kelvin: number }
  | { hs_color: [number, number] }
  | { rgb_color: [number, number, number] }
  | { rgbw_color: [number, number, number, number] }
  | { rgbww_color: [number, number, number, number, number] }

export function supportedColorModesOf(entity: HassEntity): string[] {
  const modes = entity.attributes.supported_color_modes
  return Array.isArray(modes) ? (modes as string[]) : []
}

export function lightSupportsColorMode(entity: HassEntity, mode: string): boolean {
  return supportedColorModesOf(entity).includes(mode)
}

export function lightSupportsColor(entity: HassEntity): boolean {
  return supportedColorModesOf(entity).some((m) => MODES_SUPPORTING_COLOR.includes(m))
}

export function lightSupportsBrightness(entity: HassEntity): boolean {
  return supportedColorModesOf(entity).some((m) => MODES_SUPPORTING_BRIGHTNESS.includes(m))
}

export function lightSupportsFavoriteColors(entity: HassEntity): boolean {
  return lightSupportsColor(entity) || lightSupportsColorMode(entity, LightColorMode.COLOR_TEMP)
}

export function getLightCurrentModeRgbColor(entity: HassEntity): number[] | undefined {
  const a = entity.attributes
  if (a.color_mode === LightColorMode.RGBWW && Array.isArray(a.rgbww_color)) {
    return a.rgbww_color as number[]
  }
  if (a.color_mode === LightColorMode.RGBW && Array.isArray(a.rgbw_color)) {
    return a.rgbw_color as number[]
  }
  if (Array.isArray(a.rgb_color)) {
    return a.rgb_color as number[]
  }
  return undefined
}

const COLOR_TEMP_COUNT = 4
const DEFAULT_COLORED_COLORS: LightColor[] = [
  { rgb_color: [127, 172, 255] }, // #7FACFF
  { rgb_color: [215, 150, 255] }, // #D796FF
  { rgb_color: [255, 158, 243] }, // #FF9EF3
  { rgb_color: [255, 110, 84] }, // #FF6E54
]

export function computeDefaultFavoriteColors(entity: HassEntity): LightColor[] {
  const colors: LightColor[] = []
  const supportsColorTemp = lightSupportsColorMode(entity, LightColorMode.COLOR_TEMP)
  const supportsColor = lightSupportsColor(entity)

  if (supportsColorTemp) {
    const min = Number(entity.attributes.min_color_temp_kelvin ?? DEFAULT_MIN_KELVIN)
    const max = Number(entity.attributes.max_color_temp_kelvin ?? DEFAULT_MAX_KELVIN)
    const step = (max - min) / (COLOR_TEMP_COUNT - 1)
    for (let i = 0; i < COLOR_TEMP_COUNT; i++) {
      colors.push({ color_temp_kelvin: Math.round(min + step * i) })
    }
  } else if (supportsColor) {
    const min = 2000
    const max = 6500
    const step = (max - min) / (COLOR_TEMP_COUNT - 1)
    for (let i = 0; i < COLOR_TEMP_COUNT; i++) {
      colors.push({ rgb_color: temperature2rgb(Math.round(min + step * i)) })
    }
  }

  if (supportsColor) {
    colors.push(...DEFAULT_COLORED_COLORS)
  }
  return colors
}

/* ---------------- LightBrightness ---------------- */

export function LightBrightness({
  entity,
  call,
  formatters,
}: {
  entity: HassEntity
  call: ServiceCallFn
  formatters: EntityFormatters
}) {
  const brightness =
    typeof entity.attributes.brightness === 'number'
      ? Math.max(Math.round((entity.attributes.brightness * 100) / 255), 1)
      : undefined

  let color = stateColorCss(entity)
  if (Array.isArray(entity.attributes.rgb_color)) {
    const hsv = rgb2hsv(entity.attributes.rgb_color as [number, number, number])
    if (hsv[1] < 0.4) {
      if (hsv[1] < 0.1) hsv[2] = 225
      else hsv[1] = 0.4
    }
    color = rgb2hex(hsv2rgb(hsv))
  }

  return (
    <ControlSlider
      vertical
      value={brightness}
      min={1}
      max={100}
      showHandle={stateActive(entity)}
      disabled={entity.state === UNAVAILABLE}
      label={formatters.formatEntityAttributeName(entity, 'brightness')}
      unit="%"
      formatters={formatters}
      color={color}
      background={color}
      backgroundOpacity={0.2}
      thickness={130}
      borderRadius={36}
      className="h-[240px]"
      onValueChanged={(value) => {
        void call('light', 'turn_on', {
          entity_id: entity.entity_id,
          brightness_pct: value,
        })
      }}
    />
  )
}

/* ---------------- HsColorPicker (canvas wheel) ---------------- */

function xy2polar(x: number, y: number): [number, number] {
  return [Math.sqrt(x * x + y * y), Math.atan2(y, x)]
}

function polar2xy(r: number, phi: number): [number, number] {
  return [Math.cos(phi) * r, Math.sin(phi) * r]
}

const rad2deg = (rad: number) => (rad / (2 * Math.PI)) * 360
const deg2rad = (deg: number) => (deg / 360) * 2 * Math.PI

function adjustWheelRgb(
  rgb: [number, number, number],
  wv?: number,
  cw?: number,
  ww?: number,
  minKelvin?: number,
  maxKelvin?: number,
): [number, number, number] {
  if (wv != null) {
    return rgbw2rgb([rgb[0], rgb[1], rgb[2], wv])
  }
  if (cw != null && ww != null) {
    return rgbww2rgb([rgb[0], rgb[1], rgb[2], cw, ww], minKelvin, maxKelvin)
  }
  return rgb
}

function drawColorWheel(
  ctx: CanvasRenderingContext2D,
  wv?: number,
  cw?: number,
  ww?: number,
  minKelvin?: number,
  maxKelvin?: number,
  colorBrightness = 255,
) {
  const radius = ctx.canvas.width / 2
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height)
  for (let angle = 0; angle < 360; angle += 1) {
    const startAngle = deg2rad(angle - 0.5)
    const endAngle = deg2rad(angle + 1.5)
    ctx.beginPath()
    ctx.moveTo(radius, radius)
    ctx.arc(radius, radius, radius, startAngle, endAngle)
    ctx.closePath()
    const gradient = ctx.createRadialGradient(radius, radius, 0, radius, radius, radius)
    const start = rgb2hex(
      adjustWheelRgb(hsv2rgb([angle, 0, colorBrightness]), wv, cw, ww, minKelvin, maxKelvin),
    )
    const end = rgb2hex(
      adjustWheelRgb(hsv2rgb([angle, 1, colorBrightness]), wv, cw, ww, minKelvin, maxKelvin),
    )
    gradient.addColorStop(0, start)
    gradient.addColorStop(1, end)
    ctx.fillStyle = gradient
    ctx.fill()
  }
}

function HsColorPicker({
  value,
  disabled = false,
  colorBrightness,
  wv,
  cw,
  ww,
  minKelvin,
  maxKelvin,
  onCursorMoved,
  onValueChanged,
}: {
  value?: [number, number]
  disabled?: boolean
  colorBrightness?: number
  wv?: number
  cw?: number
  ww?: number
  minKelvin?: number
  maxKelvin?: number
  onCursorMoved: (hs: [number, number] | undefined) => void
  onValueChanged: (hs: [number, number] | undefined) => void
}) {
  const renderSize = 240
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const pointerIdRef = useRef<number | null>(null)
  const [pressedType, setPressedType] = useState<string | null>(null)
  const [localValue, setLocalValue] = useState<[number, number] | undefined>(value)
  const filterId = useId()

  useEffect(() => {
    if (!pressedType) setLocalValue(value)
  }, [value, pressedType])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1
    const px = Math.round(renderSize * dpr)
    if (canvas.width !== px || canvas.height !== px) {
      canvas.width = px
      canvas.height = px
    }
    drawColorWheel(ctx, wv, cw, ww, minKelvin, maxKelvin, colorBrightness ?? 255)
  }, [colorBrightness, wv, cw, ww, minKelvin, maxKelvin])

  const hsFromClient = (clientX: number, clientY: number): [number, number] => {
    const el = canvasRef.current
    if (!el) return [0, 0]
    const rect = el.getBoundingClientRect()
    const size = Math.min(rect.width, rect.height)
    const cx = rect.left + rect.width / 2
    const cy = rect.top + rect.height / 2
    const nx = (2 * (clientX - cx)) / size
    const ny = (2 * (clientY - cy)) / size
    const [r, phi] = xy2polar(nx, ny)
    const deg = Math.round(rad2deg(phi)) % 360
    const hue = (deg + 360) % 360
    const sat = Math.round(Math.min(r, 1) * 100) / 100
    return [hue, sat]
  }

  const handlePointerDown = (ev: PointerEvent<HTMLCanvasElement>) => {
    if (disabled || (ev.pointerType === 'mouse' && ev.button !== 0)) return
    ev.currentTarget.setPointerCapture(ev.pointerId)
    pointerIdRef.current = ev.pointerId
    setPressedType(ev.pointerType)
    const next = hsFromClient(ev.clientX, ev.clientY)
    setLocalValue(next)
    onCursorMoved(next)
  }

  const handlePointerMove = (ev: PointerEvent<HTMLCanvasElement>) => {
    if (disabled || pointerIdRef.current !== ev.pointerId) return
    const next = hsFromClient(ev.clientX, ev.clientY)
    setLocalValue(next)
    onCursorMoved(next)
  }

  const handlePointerUp = (ev: PointerEvent<HTMLCanvasElement>) => {
    if (pointerIdRef.current !== ev.pointerId) return
    pointerIdRef.current = null
    if (ev.currentTarget.hasPointerCapture(ev.pointerId)) {
      ev.currentTarget.releasePointerCapture(ev.pointerId)
    }
    setPressedType(null)
    if (disabled) return
    const next = hsFromClient(ev.clientX, ev.clientY)
    setLocalValue(next)
    onCursorMoved(undefined)
    onValueChanged(next)
  }

  const handlePointerCancel = (ev: PointerEvent<HTMLCanvasElement>) => {
    if (pointerIdRef.current !== ev.pointerId) return
    pointerIdRef.current = null
    setPressedType(null)
    setLocalValue(value)
    onCursorMoved(undefined)
  }

  const cursorPos: [number, number] | undefined = localValue
    ? polar2xy(Math.min(localValue[1], 1), deg2rad(localValue[0]))
    : undefined

  const markerRgb = localValue
    ? adjustWheelRgb(hsv2rgb([localValue[0], localValue[1], colorBrightness ?? 255]), wv, cw, ww, minKelvin, maxKelvin)
    : ([255, 255, 255] as [number, number, number])

  const cx = cursorPos ? ((cursorPos[0] + 1) * renderSize) / 2 : renderSize / 2
  const cy = cursorPos ? ((cursorPos[1] + 1) * renderSize) / 2 : renderSize / 2
  const scale = pressedType ? (pressedType === 'touch' ? 2 : 1.35) : 1
  const offsetY = pressedType === 'touch' ? -renderSize / 16 : 0

  return (
    <div className="relative mx-auto aspect-square w-[240px] max-w-full select-none">
      <canvas
        ref={canvasRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        className={`block h-full w-full touch-none rounded-full object-contain ${
          disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'
        }`}
      />
      <svg
        viewBox={`0 0 ${renderSize} ${renderSize}`}
        overflow="visible"
        className="pointer-events-none absolute inset-0 h-full w-full"
        aria-hidden="true"
      >
        <defs>
          <filter id={filterId} x="-50%" y="-50%" width="200%" height="200%">
            <feDropShadow dx="0" dy="1" stdDeviation="2" floodOpacity="0.35" floodColor="#000" />
          </filter>
        </defs>
        {cursorPos && (
          <g
            style={{
              transform: `translate(${cx}px, ${cy}px)`,
              transition: pressedType ? 'none' : 'transform 180ms ease-in-out',
            }}
          >
            <circle
              cx={0}
              cy={0}
              r={11}
              stroke="#ffffff"
              strokeWidth={2}
              filter={`url(#${filterId})`}
              style={{
                fill: rgb2hex(markerRgb),
                transform: `translate(0px, ${offsetY}px) scale(${scale})`,
                transition: pressedType ? 'none' : 'transform 100ms ease-in-out, fill 100ms ease-in-out',
              }}
            />
          </g>
        )}
      </svg>
    </div>
  )
}

/* ---------------- LightColorRgbPicker ---------------- */

function adjustColorBrightness(
  rgbColor: [number, number, number],
  value?: number,
  invert = false,
): [number, number, number] {
  const out: [number, number, number] = [...rgbColor]
  if (out[0] === 0 && out[1] === 0 && out[2] === 0) {
    out[0] = 255
    out[1] = 255
    out[2] = 255
  }
  if (value !== undefined && value !== 255) {
    let ratio = value / 255
    if (invert && ratio > 0) ratio = 1 / ratio
    out[0] = Math.min(255, Math.round(out[0] * ratio))
    out[1] = Math.min(255, Math.round(out[1] * ratio))
    out[2] = Math.min(255, Math.round(out[2] * ratio))
  }
  return out
}

function readRgbPickerState(entity: HassEntity) {
  if (entity.state !== 'on') {
    return {
      hs: undefined as [number, number] | undefined,
      colorBrightness: undefined as number | undefined,
      wv: undefined as number | undefined,
      cw: undefined as number | undefined,
      ww: undefined as number | undefined,
      brightnessAdjusted: undefined as number | undefined,
    }
  }

  const a = entity.attributes
  let brightnessAdjusted: number | undefined
  if (
    a.color_mode === LightColorMode.RGB &&
    Array.isArray(a.rgb_color) &&
    !lightSupportsColorMode(entity, LightColorMode.RGBWW) &&
    !lightSupportsColorMode(entity, LightColorMode.RGBW)
  ) {
    const maxVal = Math.max(...(a.rgb_color as number[]))
    if (maxVal < 255) brightnessAdjusted = maxVal
  }

  const wv =
    a.color_mode === LightColorMode.RGBW && Array.isArray(a.rgbw_color)
      ? Math.round((Number(a.rgbw_color[3] ?? 0) * 100) / 255)
      : undefined
  const cw =
    a.color_mode === LightColorMode.RGBWW && Array.isArray(a.rgbww_color)
      ? Math.round((Number(a.rgbww_color[3] ?? 0) * 100) / 255)
      : undefined
  const ww =
    a.color_mode === LightColorMode.RGBWW && Array.isArray(a.rgbww_color)
      ? Math.round((Number(a.rgbww_color[4] ?? 0) * 100) / 255)
      : undefined

  const currentRgb = getLightCurrentModeRgbColor(entity)
  const colorBrightness = currentRgb
    ? Math.round((Math.max(...currentRgb.slice(0, 3)) * 100) / 255)
    : undefined
  const hs = currentRgb
    ? rgb2hs([currentRgb[0] ?? 0, currentRgb[1] ?? 0, currentRgb[2] ?? 0])
    : undefined

  return { hs, colorBrightness, wv, cw, ww, brightnessAdjusted }
}

function LabeledHorizontalSlider({
  caption,
  iconPath,
  value,
  disabled,
  formatters,
  onValueChanged,
}: {
  caption: string
  iconPath: string
  value?: number
  disabled?: boolean
  formatters: EntityFormatters
  onValueChanged: (value: number) => void
}) {
  return (
    <div className="grid w-full gap-1">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <MdiIcon path={iconPath} size={16} />
          <span>{caption}</span>
        </span>
        {value != null && <span className="font-mono text-foreground">{Math.round(value)}%</span>}
      </div>
      <ControlSlider
        value={value}
        min={0}
        max={100}
        step={1}
        disabled={disabled}
        label={caption}
        unit="%"
        formatters={formatters}
        thickness={28}
        borderRadius={10}
        onValueChanged={onValueChanged}
      />
    </div>
  )
}

export function LightColorRgbPicker({
  entity,
  call,
  formatters,
}: {
  entity: HassEntity
  call: ServiceCallFn
  formatters: EntityFormatters
}) {
  const initial = readRgbPickerState(entity)
  const [hs, setHs] = useState<[number, number] | undefined>(initial.hs)
  const [colorBrightness, setColorBrightness] = useState<number | undefined>(initial.colorBrightness)
  const [wv, setWv] = useState<number | undefined>(initial.wv)
  const [cw, setCw] = useState<number | undefined>(initial.cw)
  const [ww, setWw] = useState<number | undefined>(initial.ww)
  const [brightnessAdjusted, setBrightnessAdjusted] = useState<number | undefined>(
    initial.brightnessAdjusted,
  )

  const pendingSyncRef = useRef<PendingValueSync | null>(null)
  pendingSyncRef.current ??= new PendingValueSync()
  const interactingRef = useRef(false)
  const lastEntityIdRef = useRef(entity.entity_id)

  const stateRef = useRef({ entity, call, hs, colorBrightness, wv, cw, ww, brightnessAdjusted })
  stateRef.current = { entity, call, hs, colorBrightness, wv, cw, ww, brightnessAdjusted }

  const syncFromEntity = useCallback(() => {
    const next = readRgbPickerState(stateRef.current.entity)
    setHs(next.hs)
    setColorBrightness(next.colorBrightness)
    setWv(next.wv)
    setCw(next.cw)
    setWw(next.ww)
    setBrightnessAdjusted(next.brightnessAdjusted)
  }, [])

  const applyColor = useCallback(
    (color: LightColor, params?: Record<string, unknown>) => {
      const { entity: ent, call: callFn } = stateRef.current
      return pendingSyncRef.current!.run(
        () => callFn('light', 'turn_on', { entity_id: ent.entity_id, ...color, ...params }),
        syncFromEntity,
      )
    },
    [syncFromEntity],
  )

  const setRgbWColor = useCallback(
    (rgbColor: [number, number, number]) => {
      const ent = stateRef.current.entity
      if (lightSupportsColorMode(ent, LightColorMode.RGBWW)) {
        const cur = Array.isArray(ent.attributes.rgbww_color)
          ? ([...ent.attributes.rgbww_color] as number[])
          : [0, 0, 0, 0, 0]
        const rgbww_color: [number, number, number, number, number] = [
          rgbColor[0],
          rgbColor[1],
          rgbColor[2],
          cur[3] ?? 0,
          cur[4] ?? 0,
        ]
        void applyColor({ rgbww_color })
      } else if (lightSupportsColorMode(ent, LightColorMode.RGBW)) {
        const cur = Array.isArray(ent.attributes.rgbw_color)
          ? ([...ent.attributes.rgbw_color] as number[])
          : [0, 0, 0, 0]
        const rgbw_color: [number, number, number, number] = [
          rgbColor[0],
          rgbColor[1],
          rgbColor[2],
          cur[3] ?? 0,
        ]
        void applyColor({ rgbw_color })
      }
    },
    [applyColor],
  )

  const sendCurrentColor = useCallback(
    (nextHs?: [number, number], nextColorBrightness?: number) => {
      const { entity: ent, brightnessAdjusted: adj } = stateRef.current
      const pickHs = nextHs ?? stateRef.current.hs
      if (!pickHs) return
      const cb = nextColorBrightness ?? stateRef.current.colorBrightness
      const hs_color: [number, number] = [pickHs[0], pickHs[1] * 100]
      const rgb_color = hs2rgb(pickHs)

      if (
        lightSupportsColorMode(ent, LightColorMode.RGBWW) ||
        lightSupportsColorMode(ent, LightColorMode.RGBW)
      ) {
        setRgbWColor(cb ? adjustColorBrightness(rgb_color, (cb * 255) / 100) : rgb_color)
      } else if (lightSupportsColorMode(ent, LightColorMode.RGB)) {
        if (adj) {
          const brightnessAdjust = (adj / 255) * 100
          const brightnessPct = Math.round(
            ((Number(ent.attributes.brightness ?? 0) * brightnessAdjust) / 255),
          )
          const adjustedRgb = adjustColorBrightness(rgb_color, adj, true)
          void applyColor({ rgb_color: adjustedRgb }, { brightness_pct: brightnessPct })
        } else {
          void applyColor({ rgb_color })
        }
      } else {
        void applyColor({ hs_color })
      }
    },
    [applyColor, setRgbWColor],
  )

  const throttledSend = useMemo(() => createThrottle(() => sendCurrentColor(), 500), [sendCurrentColor])

  useEffect(() => () => throttledSend.cancel(), [throttledSend])

  useEffect(() => {
    if (lastEntityIdRef.current !== entity.entity_id) {
      lastEntityIdRef.current = entity.entity_id
      throttledSend.cancel()
      pendingSyncRef.current?.reset()
      interactingRef.current = false
      syncFromEntity()
    } else if (!interactingRef.current && pendingSyncRef.current?.shouldSync()) {
      syncFromEntity()
    } else if (entity.state === 'on') {
      const next = readRgbPickerState(entity)
      setBrightnessAdjusted(next.brightnessAdjusted)
    }
  }, [entity, syncFromEntity, throttledSend])

  const supportsRgbww = lightSupportsColorMode(entity, LightColorMode.RGBWW)
  const supportsRgbw = !supportsRgbww && lightSupportsColorMode(entity, LightColorMode.RGBW)
  const unavailable = entity.state === UNAVAILABLE

  const hexValue = hs
    ? rgb2hex(hsv2rgb([hs[0], hs[1], ((colorBrightness ?? 100) / 100) * 255]))
    : '#ffffff'

  const handleNativeColorChange = (ev: ChangeEvent<HTMLInputElement>) => {
    const rgb = hex2rgb(ev.currentTarget.value)
    const hsv = rgb2hsv(rgb)
    const nextHs: [number, number] = [hsv[0], hsv[1]]
    setHs(nextHs)
    stateRef.current.hs = nextHs
    if (supportsRgbw || supportsRgbww) {
      const nextCb = hsv[2] / 2.55
      setColorBrightness(nextCb)
      stateRef.current.colorBrightness = nextCb
    }
    pendingSyncRef.current?.schedule()
    throttledSend()
  }

  const handleWhiteChannelChange = (channel: 'wv' | 'cw' | 'ww', pctValue: number) => {
    if (channel === 'wv') setWv(pctValue)
    else if (channel === 'cw') setCw(pctValue)
    else setWw(pctValue)

    const byteVal = Math.min(255, Math.round((pctValue * 255) / 100))
    const currentRgb = getLightCurrentModeRgbColor(entity)

    if (channel === 'wv') {
      const rgbw: [number, number, number, number] = currentRgb
        ? [currentRgb[0] ?? 0, currentRgb[1] ?? 0, currentRgb[2] ?? 0, byteVal]
        : [0, 0, 0, byteVal]
      void applyColor({ rgbw_color: rgbw })
      return
    }

    const rgbww: [number, number, number, number, number] = currentRgb
      ? [
          currentRgb[0] ?? 0,
          currentRgb[1] ?? 0,
          currentRgb[2] ?? 0,
          currentRgb[3] ?? 0,
          currentRgb[4] ?? 0,
        ]
      : [0, 0, 0, 0, 0]
    rgbww[channel === 'cw' ? 3 : 4] = byteVal
    void applyColor({ rgbww_color: rgbww })
  }

  const handleColorBrightnessChange = (pctValue: number) => {
    const oldValue = colorBrightness
    setColorBrightness(pctValue)
    stateRef.current.colorBrightness = pctValue
    const raw = (pctValue * 255) / 100
    const current = getLightCurrentModeRgbColor(entity)
    const rgb: [number, number, number] = current
      ? [current[0] ?? 255, current[1] ?? 255, current[2] ?? 255]
      : [255, 255, 255]
    const normalized = oldValue ? adjustColorBrightness(rgb, (oldValue * 255) / 100, true) : rgb
    setRgbWColor(adjustColorBrightness(normalized, raw))
  }

  return (
    <div className="flex w-full flex-col items-center gap-3">
      <div className="relative w-full">
        <label
          title={formatters.localize('ui.dialogs.more_info_control.light.color') || 'Color'}
          className={`absolute top-0 right-0 z-10 grid size-10 place-items-center rounded-full transition-colors ${
            unavailable
              ? 'cursor-not-allowed opacity-40'
              : 'cursor-pointer hover:bg-foreground/10'
          }`}
        >
          <input
            type="color"
            disabled={unavailable}
            value={hexValue}
            onChange={handleNativeColorChange}
            className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
            aria-label={formatters.localize('ui.dialogs.more_info_control.light.color') || 'Color'}
          />
          <MdiIcon path={mdiEyedropper} size={20} className="pointer-events-none text-foreground" />
        </label>

        <HsColorPicker
          value={hs}
          disabled={unavailable}
          colorBrightness={colorBrightness != null ? (colorBrightness * 255) / 100 : undefined}
          wv={wv != null ? (wv * 255) / 100 : undefined}
          cw={cw != null ? (cw * 255) / 100 : undefined}
          ww={ww != null ? (ww * 255) / 100 : undefined}
          minKelvin={
            typeof entity.attributes.min_color_temp_kelvin === 'number'
              ? entity.attributes.min_color_temp_kelvin
              : undefined
          }
          maxKelvin={
            typeof entity.attributes.max_color_temp_kelvin === 'number'
              ? entity.attributes.max_color_temp_kelvin
              : undefined
          }
          onCursorMoved={(next) => {
            interactingRef.current = next !== undefined
            if (!next) return
            setHs(next)
            stateRef.current.hs = next
            pendingSyncRef.current?.schedule()
            throttledSend()
          }}
          onValueChanged={(next) => {
            interactingRef.current = false
            throttledSend.cancel()
            if (!next) {
              pendingSyncRef.current?.reset()
              syncFromEntity()
              return
            }
            setHs(next)
            stateRef.current.hs = next
            sendCurrentColor(next)
          }}
        />
      </div>

      {(supportsRgbw || supportsRgbww) && (
        <LabeledHorizontalSlider
          caption={formatters.localize('ui.card.light.color_brightness') || 'Color brightness'}
          iconPath={mdiBrightness7}
          value={colorBrightness}
          disabled={unavailable}
          formatters={formatters}
          onValueChanged={handleColorBrightnessChange}
        />
      )}

      {supportsRgbw && (
        <LabeledHorizontalSlider
          caption={formatters.localize('ui.card.light.white_value') || 'White'}
          iconPath={mdiFileWordBox}
          value={wv}
          disabled={unavailable}
          formatters={formatters}
          onValueChanged={(v) => handleWhiteChannelChange('wv', v)}
        />
      )}

      {supportsRgbww && (
        <>
          <LabeledHorizontalSlider
            caption={formatters.localize('ui.card.light.cold_white_value') || 'Cold white'}
            iconPath={mdiFileWordBoxOutline}
            value={cw}
            disabled={unavailable}
            formatters={formatters}
            onValueChanged={(v) => handleWhiteChannelChange('cw', v)}
          />
          <LabeledHorizontalSlider
            caption={formatters.localize('ui.card.light.warm_white_value') || 'Warm white'}
            iconPath={mdiFileWordBox}
            value={ww}
            disabled={unavailable}
            formatters={formatters}
            onValueChanged={(v) => handleWhiteChannelChange('ww', v)}
          />
        </>
      )}
    </div>
  )
}

/* ---------------- LightColorTempPicker ---------------- */

function readColorTemp(entity: HassEntity): number | undefined {
  if (entity.state !== 'on') return undefined
  if (entity.attributes.color_mode !== LightColorMode.COLOR_TEMP) return undefined
  return typeof entity.attributes.color_temp_kelvin === 'number'
    ? entity.attributes.color_temp_kelvin
    : undefined
}

export function LightColorTempPicker({
  entity,
  call,
  formatters,
}: {
  entity: HassEntity
  call: ServiceCallFn
  formatters: EntityFormatters
}) {
  const [kelvin, setKelvin] = useState<number | undefined>(() => readColorTemp(entity))
  const pendingSyncRef = useRef<PendingValueSync | null>(null)
  pendingSyncRef.current ??= new PendingValueSync()
  const interactingRef = useRef(false)
  const lastEntityIdRef = useRef(entity.entity_id)
  const stateRef = useRef({ entity, call, kelvin })
  stateRef.current = { entity, call, kelvin }

  const syncFromEntity = useCallback(() => {
    const next = readColorTemp(stateRef.current.entity)
    setKelvin(next)
    stateRef.current.kelvin = next
  }, [])

  const sendColorTemp = useCallback(
    (value?: number) => {
      const target = value ?? stateRef.current.kelvin
      if (target == null || Number.isNaN(target)) return
      const { entity: ent, call: callFn } = stateRef.current
      void pendingSyncRef.current!.run(
        () =>
          callFn('light', 'turn_on', {
            entity_id: ent.entity_id,
            color_temp_kelvin: Math.round(target),
          }),
        syncFromEntity,
      )
    },
    [syncFromEntity],
  )

  const throttledSend = useMemo(() => createThrottle(() => sendColorTemp(), 500), [sendColorTemp])

  useEffect(() => () => throttledSend.cancel(), [throttledSend])

  useEffect(() => {
    if (lastEntityIdRef.current !== entity.entity_id) {
      lastEntityIdRef.current = entity.entity_id
      throttledSend.cancel()
      pendingSyncRef.current?.reset()
      interactingRef.current = false
      syncFromEntity()
    } else if (!interactingRef.current && pendingSyncRef.current?.shouldSync()) {
      syncFromEntity()
    }
  }, [entity, syncFromEntity, throttledSend])

  const minKelvin = Number(entity.attributes.min_color_temp_kelvin ?? DEFAULT_MIN_KELVIN)
  const maxKelvin = Number(entity.attributes.max_color_temp_kelvin ?? DEFAULT_MAX_KELVIN)
  const gradient = useMemo(
    () => `linear-gradient(to bottom, ${generateColorTemperatureGradient(minKelvin, maxKelvin)})`,
    [minKelvin, maxKelvin],
  )
  const color = stateColorCss(entity)

  return (
    <ControlSlider
      vertical
      inverted
      mode="cursor"
      value={kelvin}
      min={minKelvin}
      max={maxKelvin}
      step={1}
      disabled={entity.state === UNAVAILABLE}
      label={formatters.localize('ui.dialogs.more_info_control.light.color_temp') || 'Color temperature'}
      unit="K"
      formatters={formatters}
      color={color}
      background={gradient}
      backgroundOpacity={1}
      thickness={130}
      borderRadius={36}
      className="h-[240px]"
      onSliderMoved={(next) => {
        interactingRef.current = next !== undefined
        if (next === undefined || Number.isNaN(next) || next === stateRef.current.kelvin) return
        setKelvin(next)
        stateRef.current.kelvin = next
        pendingSyncRef.current?.schedule()
        throttledSend()
      }}
      onValueChanged={(next) => {
        interactingRef.current = false
        throttledSend.cancel()
        if (Number.isNaN(next)) {
          pendingSyncRef.current?.reset()
          syncFromEntity()
          return
        }
        setKelvin(next)
        stateRef.current.kelvin = next
        sendColorTemp(next)
      }}
    />
  )
}

/* ---------------- LightFavoriteColors (read-only one-tap apply) ---------------- */

function favoriteToRgb(color: LightColor, entity: HassEntity): [number, number, number] {
  if ('hs_color' in color) {
    return hs2rgb([color.hs_color[0], color.hs_color[1] / 100])
  }
  if ('color_temp_kelvin' in color) {
    return temperature2rgb(color.color_temp_kelvin)
  }
  if ('rgb_color' in color) {
    return color.rgb_color
  }
  if ('rgbw_color' in color) {
    return rgbw2rgb(color.rgbw_color)
  }
  if ('rgbww_color' in color) {
    return rgbww2rgb(
      color.rgbww_color,
      typeof entity.attributes.min_color_temp_kelvin === 'number'
        ? entity.attributes.min_color_temp_kelvin
        : undefined,
      typeof entity.attributes.max_color_temp_kelvin === 'number'
        ? entity.attributes.max_color_temp_kelvin
        : undefined,
    )
  }
  return [255, 255, 255]
}

export function LightFavoriteColors({
  entity,
  registryFavorites,
  call,
  formatters,
}: {
  entity: HassEntity
  registryFavorites?: LightColor[]
  call: ServiceCallFn
  formatters: EntityFormatters
}) {
  const favorites = useMemo(() => {
    if (registryFavorites !== undefined) return registryFavorites
    return computeDefaultFavoriteColors(entity)
  }, [entity, registryFavorites])

  if (favorites.length === 0) return null

  const unavailable = entity.state === UNAVAILABLE

  return (
    <div className="flex max-w-[240px] flex-wrap items-center justify-center gap-3">
      {favorites.map((color, index) => {
        const rgb = favoriteToRgb(color, entity)
        const hex = rgb2hex(rgb)
        const isLight = luminosity(rgb) > 0.8
        const label =
          formatters.localize('ui.dialogs.more_info_control.light.favorite_color.set', {
            number: index + 1,
          }) || `Set favorite color ${index + 1}`

        return (
          <button
            key={index}
            type="button"
            disabled={unavailable}
            title={label}
            aria-label={label}
            onClick={() => {
              void call('light', 'turn_on', {
                entity_id: entity.entity_id,
                ...color,
              })
            }}
            className="size-10 rounded-full border transition-transform duration-150 ease-in-out active:scale-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-50 disabled:grayscale"
            style={{
              backgroundColor: hex,
              borderColor: isLight ? 'var(--border)' : 'transparent',
            }}
          />
        )
      })}
    </div>
  )
}
