/* Ported from home-assistant/frontend (Apache-2.0):
   - src/data/valve.ts */

import type { HassEntity } from '../entities'
import type { EntityFormatters } from '../hass/names'
import { stateActive, supportsFeature, UNAVAILABLE } from './stateColors'

export const ValveEntityFeature = {
  OPEN: 1,
  CLOSE: 2,
  SET_POSITION: 4,
  STOP: 8,
} as const

export const DEFAULT_VALVE_FAVORITE_POSITIONS = [0, 25, 75, 100]

export const valveSupportsPosition = (stateObj: HassEntity) =>
  supportsFeature(stateObj, ValveEntityFeature.SET_POSITION)

export function isValveFullyOpen(stateObj: HassEntity): boolean {
  if (typeof stateObj.attributes.current_position === 'number') {
    return stateObj.attributes.current_position === 100
  }
  return stateObj.state === 'open'
}

export function isValveFullyClosed(stateObj: HassEntity): boolean {
  if (typeof stateObj.attributes.current_position === 'number') {
    return stateObj.attributes.current_position === 0
  }
  return stateObj.state === 'closed'
}

export const isValveOpening = (stateObj: HassEntity) => stateObj.state === 'opening'
export const isValveClosing = (stateObj: HassEntity) => stateObj.state === 'closing'

export function canOpenValve(stateObj: HassEntity): boolean {
  if (stateObj.state === UNAVAILABLE) return false
  return (
    stateObj.attributes.assumed_state === true ||
    (!isValveFullyOpen(stateObj) && !isValveOpening(stateObj))
  )
}

export function canCloseValve(stateObj: HassEntity): boolean {
  if (stateObj.state === UNAVAILABLE) return false
  return (
    stateObj.attributes.assumed_state === true ||
    (!isValveFullyClosed(stateObj) && !isValveClosing(stateObj))
  )
}

export const canStopValve = (stateObj: HassEntity) => stateObj.state !== UNAVAILABLE

export function computeValvePositionStateDisplay(
  stateObj: HassEntity,
  formatters: EntityFormatters,
): string {
  const pos = stateActive(stateObj)
    ? (stateObj.attributes.current_position as number | null | undefined)
    : undefined
  return typeof pos === 'number' && pos > 0 && pos !== 100
    ? formatters.formatEntityAttributeValue(stateObj, 'current_position', Math.round(pos))
    : ''
}
