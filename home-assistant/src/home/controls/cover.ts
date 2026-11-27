/* Ported from home-assistant/frontend (Apache-2.0):
   - src/data/cover.ts
   - src/data/feature/cover_entity_feature.ts
   - src/data/favorite_positions.ts
   - src/common/entity/cover_icon.ts
   - src/state-control/cover/cover-request-controller.ts
   - src/state-control/cover/spring.ts
   - src/state-control/cover/wave.ts */

import {
  mdiArrowCollapseHorizontal,
  mdiArrowDown,
  mdiArrowExpandHorizontal,
  mdiArrowUp,
  mdiDoorClosed,
  mdiDoorOpen,
  mdiGate,
  mdiGateOpen,
} from '@mdi/js'
import type { HassEntity } from '../entities'
import { supportsFeature, UNAVAILABLE, UNKNOWN } from './stateColors'

export const CoverEntityFeature = {
  OPEN: 1,
  CLOSE: 2,
  SET_POSITION: 4,
  STOP: 8,
  OPEN_TILT: 16,
  CLOSE_TILT: 32,
  STOP_TILT: 64,
  SET_TILT_POSITION: 128,
  SPEED: 256,
} as const

export const DEFAULT_COVER_FAVORITE_POSITIONS = [0, 25, 75, 100]

export type CoverControlMode = 'position' | 'tilt'
export type CoverAction = 'open' | 'close' | 'stop'

export type CoverCommand =
  | { mode: CoverControlMode; action: CoverAction }
  | { mode: CoverControlMode; action: 'set'; value: number }

export type CoverRequest = {
  mode: CoverControlMode
  value: number
}

export type CoverSwipe = {
  action: 'open' | 'close'
  passedHalfway: boolean
}

export type CoverDrag = {
  value: number
  swipe?: CoverSwipe
}

export const clampPercent = (value: number) => Math.min(Math.max(value, 0), 100)

export function normalizeFavoritePositions(positions: number[]): number[] {
  const seen = new Set<number>()
  const out: number[] = []
  for (const raw of positions) {
    const num = Math.round(clampPercent(Number(raw)))
    if (Number.isNaN(num) || seen.has(num)) continue
    seen.add(num)
    out.push(num)
  }
  return out
}

export const coverSupportsPosition = (stateObj: HassEntity) =>
  supportsFeature(stateObj, CoverEntityFeature.SET_POSITION)

export const coverSupportsTiltPosition = (stateObj: HassEntity) =>
  supportsFeature(stateObj, CoverEntityFeature.SET_TILT_POSITION)

export const coverSupportsSetValue = (stateObj: HassEntity, mode: CoverControlMode) =>
  mode === 'tilt' ? coverSupportsTiltPosition(stateObj) : coverSupportsPosition(stateObj)

const POSITION_FEATURES = [
  CoverEntityFeature.OPEN,
  CoverEntityFeature.CLOSE,
  CoverEntityFeature.STOP,
  CoverEntityFeature.SET_POSITION,
]

const TILT_FEATURES = [
  CoverEntityFeature.OPEN_TILT,
  CoverEntityFeature.CLOSE_TILT,
  CoverEntityFeature.STOP_TILT,
  CoverEntityFeature.SET_TILT_POSITION,
]

export const coverHasPositionControls = (stateObj: HassEntity) =>
  POSITION_FEATURES.some((feature) => supportsFeature(stateObj, feature))

export const coverHasTiltControls = (stateObj: HassEntity) =>
  TILT_FEATURES.some((feature) => supportsFeature(stateObj, feature))

export const defaultCoverMode = (stateObj: HassEntity): CoverControlMode =>
  coverHasTiltControls(stateObj) && !coverHasPositionControls(stateObj) ? 'tilt' : 'position'

export const coverModeAttribute = (mode: CoverControlMode) =>
  mode === 'tilt' ? 'current_tilt_position' : 'current_position'

const COVER_SERVICES: Record<CoverControlMode, Record<CoverCommand['action'], string>> = {
  position: {
    open: 'open_cover',
    close: 'close_cover',
    stop: 'stop_cover',
    set: 'set_cover_position',
  },
  tilt: {
    open: 'open_cover_tilt',
    close: 'close_cover_tilt',
    stop: 'stop_cover_tilt',
    set: 'set_cover_tilt_position',
  },
}

export const coverCommandService = ({ mode, action }: CoverCommand) => COVER_SERVICES[mode][action]

export const coverCommandData = (
  stateObj: HassEntity,
  command: CoverCommand,
): Record<string, unknown> & { entity_id: string } => {
  const data = { entity_id: stateObj.entity_id }
  if (command.action !== 'set') return data
  if (command.mode === 'tilt') return { ...data, tilt_position: command.value }
  return { ...data, position: command.value }
}

export function isFullyOpen(stateObj: HassEntity): boolean {
  return stateObj.attributes.current_position === 100
}

export function isFullyClosed(stateObj: HassEntity): boolean {
  if (stateObj.attributes.current_position !== undefined) {
    return stateObj.attributes.current_position === 0
  }
  return stateObj.state === 'closed'
}

export function coverOpenTiltPosition(stateObj: HassEntity): number {
  return typeof stateObj.attributes.open_tilt_position === 'number'
    ? stateObj.attributes.open_tilt_position
    : 100
}

export function coverClosedTiltPositions(stateObj: HassEntity): number[] {
  return Array.isArray(stateObj.attributes.closed_tilt_positions)
    ? (stateObj.attributes.closed_tilt_positions as number[])
    : [0]
}

export function coverTiltAngle(stateObj: HassEntity, tilt: number): number {
  const start = stateObj.attributes.tilt_start_angle
  const end = stateObj.attributes.tilt_end_angle
  if (typeof start === 'number' && typeof end === 'number') {
    return start + ((end - start) * tilt) / 100
  }
  const open = coverOpenTiltPosition(stateObj)
  if (tilt <= open) {
    return open === 0 ? 0 : (-90 * (open - tilt)) / open
  }
  return (90 * (tilt - open)) / (100 - open)
}

export function coverTiltOpenness(stateObj: HassEntity, tilt: number): number {
  return 100 * (1 - Math.min(1, Math.abs(coverTiltAngle(stateObj, tilt)) / 90))
}

export function isFullyOpenTilt(stateObj: HassEntity): boolean {
  return stateObj.attributes.current_tilt_position === coverOpenTiltPosition(stateObj)
}

export function isFullyClosedTilt(stateObj: HassEntity): boolean {
  const tilt = stateObj.attributes.current_tilt_position
  return typeof tilt === 'number' && coverClosedTiltPositions(stateObj).includes(tilt)
}

export const isOpening = (stateObj: HassEntity) => stateObj.state === 'opening'
export const isClosing = (stateObj: HassEntity) => stateObj.state === 'closing'
export const isMoving = (stateObj: HassEntity) => isOpening(stateObj) || isClosing(stateObj)

export function canOpen(stateObj: HassEntity): boolean {
  if (stateObj.state === UNAVAILABLE) return false
  return stateObj.attributes.assumed_state === true || (!isFullyOpen(stateObj) && !isOpening(stateObj))
}

export function canClose(stateObj: HassEntity): boolean {
  if (stateObj.state === UNAVAILABLE) return false
  return stateObj.attributes.assumed_state === true || (!isFullyClosed(stateObj) && !isClosing(stateObj))
}

export const canStop = (stateObj: HassEntity) => stateObj.state !== UNAVAILABLE

export function canOpenTilt(stateObj: HassEntity): boolean {
  if (stateObj.state === UNAVAILABLE) return false
  return stateObj.attributes.assumed_state === true || !isFullyOpenTilt(stateObj)
}

export function canCloseTilt(stateObj: HassEntity): boolean {
  if (stateObj.state === UNAVAILABLE) return false
  return stateObj.attributes.assumed_state === true || !isFullyClosedTilt(stateObj)
}

export const canStopTilt = (stateObj: HassEntity) => stateObj.state !== UNAVAILABLE

export function coverCurrentValue(stateObj: HassEntity, mode: CoverControlMode): number | undefined {
  if (mode === 'tilt') {
    return typeof stateObj.attributes.current_tilt_position === 'number'
      ? stateObj.attributes.current_tilt_position
      : undefined
  }
  const position = stateObj.attributes.current_position
  if (typeof position === 'number' || supportsFeature(stateObj, CoverEntityFeature.SET_POSITION)) {
    return typeof position === 'number' ? position : undefined
  }
  if (stateObj.state === UNKNOWN || stateObj.state === UNAVAILABLE) return undefined
  return stateObj.state === 'closed' || stateObj.state === 'opening' ? 0 : 100
}

export function computeCoverOpenIcon(stateObj: HassEntity): string {
  switch (stateObj.attributes.device_class) {
    case 'door': return mdiDoorOpen
    case 'gate': return mdiGateOpen
    case 'curtain': return mdiArrowExpandHorizontal
    case 'awning': return mdiArrowDown
    default: return mdiArrowUp
  }
}

export function computeCoverCloseIcon(stateObj: HassEntity): string {
  switch (stateObj.attributes.device_class) {
    case 'door': return mdiDoorClosed
    case 'gate': return mdiGate
    case 'curtain': return mdiArrowCollapseHorizontal
    case 'awning': return mdiArrowUp
    default: return mdiArrowDown
  }
}

/* ---------------- Spring & Wave physics ---------------- */

export type SpringOptions = { stiffness?: number; damping?: number }

const SPRING_STEP = 0.016
const REST_DISTANCE = 0.05
const REST_VELOCITY = 0.5

export class PercentSpring {
  public value = 0
  public velocity = 0

  public jumpTo(value: number): boolean {
    this.velocity = 0
    if (this.value === value) return false
    this.value = value
    return true
  }

  public moveTo(goal: number, dt: number, { stiffness = 7, damping = 1 }: SpringOptions = {}): boolean {
    if (Math.abs(goal - this.value) < REST_DISTANCE && Math.abs(this.velocity) < REST_VELOCITY) {
      return this.jumpTo(goal)
    }
    for (let left = dt; left > 0; left -= SPRING_STEP) {
      const step = Math.min(SPRING_STEP, left)
      this.velocity +=
        (stiffness * stiffness * (goal - this.value) - 2 * damping * stiffness * this.velocity) * step
      this.value += this.velocity * step
      if (this.value < 0 || this.value > 100) {
        this.value = clampPercent(this.value)
        this.velocity = 0
      }
    }
    return true
  }
}

const FRAME_DURATION = 16.7
const WAVE_REST_VELOCITY = 0.015

export class WaveMotion {
  public velocity = 0
  public phase = 0
  private _position = 0

  public reset(position: number): void {
    this.jumpTo(position)
    this.phase = 0
  }

  public jumpTo(position: number): void {
    this._position = position
    this.velocity = 0
  }

  public moveTo(position: number, dt: number): boolean {
    const frames = Math.max(0.01, (dt * 1000) / FRAME_DURATION)
    const keep = 0.9 ** frames
    const instant = (position - this._position) / frames
    this.velocity = this.velocity * keep + instant * (1 - keep)
    if (Math.abs(this.velocity) < WAVE_REST_VELOCITY && Math.abs(instant) < 0.001) {
      this.velocity = 0
    }
    this._position = position
    if (!this.velocity) return false
    this.phase += (0.06 + Math.abs(this.velocity) * 0.03) * frames
    return true
  }
}

/* ---------------- CoverRequestTracker ---------------- */

function roundedCurrentValue(stateObj: HassEntity, mode: CoverControlMode): number | undefined {
  const value = coverCurrentValue(stateObj, mode)
  return value === undefined ? undefined : Math.round(value)
}

function endValue(action: 'open' | 'close', mode: CoverControlMode, stateObj: HassEntity): number {
  if (mode === 'tilt' && action === 'open') return coverOpenTiltPosition(stateObj)
  if (mode === 'tilt') return coverClosedTiltPositions(stateObj)[0] ?? 0
  return action === 'open' ? 100 : 0
}

export class CoverRequestTracker {
  private _request?: CoverRequest
  private _startValue?: number
  private _moving = false

  public get request(): CoverRequest | undefined {
    return this._request
  }

  public clear(): boolean {
    if (this._request === undefined) return false
    this._request = undefined
    this._moving = false
    return true
  }

  public commandSent(command: CoverCommand, stateObj: HassEntity): boolean {
    const { mode } = command
    if (command.action === 'stop') {
      if (this._request?.mode === mode) {
        this._request = undefined
        this._moving = false
        return true
      }
      return false
    }
    const value =
      command.action === 'set' ? command.value : endValue(command.action, mode, stateObj)
    const startValue = roundedCurrentValue(stateObj, mode)
    const next = startValue === value ? undefined : { mode, value }
    this._request = next
    this._startValue = startValue
    this._moving = false
    return true
  }

  public stateChanged(stateObj: HassEntity): boolean {
    const request = this._request
    if (!request) return false
    const value = roundedCurrentValue(stateObj, request.mode)
    if (value === request.value) {
      this._request = undefined
      this._moving = false
      return true
    }
    if (isMoving(stateObj)) {
      this._moving = true
      return false
    }
    if (this._moving || (value !== undefined && value !== this._startValue)) {
      this._request = undefined
      this._moving = false
      return true
    }
    return false
  }
}
