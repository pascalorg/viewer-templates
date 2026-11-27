/* Ported from home-assistant/frontend (Apache-2.0):
   - src/data/climate.ts
   - src/data/feature/climate_entity_feature.ts
   - src/common/entity/supports-feature.ts
   - src/common/entity/state_active.ts
   - src/resources/theme/color/color.globals.ts */

import {
  mdiFan,
  mdiFire,
  mdiPower,
  mdiSnowflake,
  mdiSunSnowflakeVariant,
  mdiThermostat,
  mdiThermostatAuto,
  mdiWaterPercent,
} from '@mdi/js'
import type { HassEntity } from '../entities'
import type { EntityFormatters } from '../hass/names'
import { resolveAttributeIcon } from './icons'
import { HA_COLORS, supportsFeature, UNAVAILABLE, UNKNOWN } from './stateColors'

export { supportsFeature, UNAVAILABLE, UNKNOWN }

export const ClimateEntityFeature = {
  TARGET_TEMPERATURE: 1,
  TARGET_TEMPERATURE_RANGE: 2,
  TARGET_HUMIDITY: 4,
  FAN_MODE: 8,
  PRESET_MODE: 16,
  SWING_MODE: 32,
  AUX_HEAT: 64,
  TURN_OFF: 128,
  TURN_ON: 256,
  SWING_HORIZONTAL_MODE: 512,
} as const

export const HVAC_MODES = ['auto', 'heat_cool', 'heat', 'cool', 'dry', 'fan_only', 'off'] as const
export type HvacMode = (typeof HVAC_MODES)[number]

export type HvacAction =
  | 'cooling'
  | 'defrosting'
  | 'drying'
  | 'fan'
  | 'heating'
  | 'idle'
  | 'off'
  | 'preheating'

export function climateStateActive(state: string): boolean {
  return state !== 'off' && state !== UNAVAILABLE && state !== UNKNOWN
}

const hvacModeOrdering: Record<string, number> = Object.fromEntries(
  HVAC_MODES.map((mode, index) => [mode, index]),
)

export function compareClimateHvacModes(mode1: string, mode2: string): number {
  const o1 = hvacModeOrdering[mode1] ?? HVAC_MODES.length
  const o2 = hvacModeOrdering[mode2] ?? HVAC_MODES.length
  return o1 - o2
}

export const CLIMATE_HVAC_ACTION_TO_MODE: Readonly<Record<string, HvacMode>> = {
  cooling: 'cool',
  defrosting: 'heat',
  drying: 'dry',
  fan: 'fan_only',
  heating: 'heat',
  idle: 'off',
  off: 'off',
  preheating: 'heat',
}

/** Exact Home Assistant climate/humidifier state hex colors from color.globals.ts. */
export const HA_CLIMATE_COLORS = {
  auto: HA_COLORS.green,
  cool: HA_COLORS.blue,
  dry: HA_COLORS.orange,
  fan_only: HA_COLORS.cyan,
  heat: HA_COLORS.deepOrange,
  heat_cool: HA_COLORS.amber,
  inactive: HA_COLORS.inactive,
  humidifierOn: HA_COLORS.blue,
} as const

export function climateStateColor(state: string): string {
  if (state === UNAVAILABLE) return 'var(--muted-foreground)'
  if (!climateStateActive(state)) return HA_CLIMATE_COLORS.inactive
  switch (state) {
    case 'auto': return HA_CLIMATE_COLORS.auto
    case 'cool': return HA_CLIMATE_COLORS.cool
    case 'dry': return HA_CLIMATE_COLORS.dry
    case 'fan_only': return HA_CLIMATE_COLORS.fan_only
    case 'heat': return HA_CLIMATE_COLORS.heat
    case 'heat_cool': return HA_CLIMATE_COLORS.heat_cool
    default: return HA_CLIMATE_COLORS.heat_cool
  }
}

export function climateActionColor(state: string, action?: string): string | undefined {
  if (!action || action === 'idle' || action === 'off' || !climateStateActive(state)) {
    return undefined
  }
  const mappedMode = CLIMATE_HVAC_ACTION_TO_MODE[action]
  return mappedMode ? climateStateColor(mappedMode) : undefined
}

export function humidifierStateColor(active: boolean): string {
  return active ? HA_CLIMATE_COLORS.humidifierOn : HA_CLIMATE_COLORS.inactive
}

export const CLIMATE_HVAC_MODE_ICONS: Readonly<Record<string, string>> = {
  cool: mdiSnowflake,
  dry: mdiWaterPercent,
  fan_only: mdiFan,
  auto: mdiThermostatAuto,
  heat: mdiFire,
  off: mdiPower,
  heat_cool: mdiSunSnowflakeVariant,
}

export function climateHvacModeIcon(mode: string): string {
  return CLIMATE_HVAC_MODE_ICONS[mode] ?? mdiThermostat
}

/**
 * Resolves a climate attribute value icon: first via Home Assistant's `frontend/get_icons`
 * (`entity` then `entity_component`) mapped through the static named-import table, then via the
 * offline built-in climate map, and finally falling back to the select menu's default icon.
 */
export function resolveClimateAttributeIcon(
  entity: HassEntity,
  attribute: string,
  value: string | undefined,
  formatters: EntityFormatters,
  fallbackPath: string,
): string {
  return resolveAttributeIcon(entity, attribute, value, formatters, fallbackPath)
}
