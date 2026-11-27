/* Ported from home-assistant/frontend (Apache-2.0):
   - src/common/const.ts
   - src/common/entity/state_active.ts
   - src/common/entity/state_color.ts
   - src/common/entity/color/battery_color.ts
   - src/common/entity/supports-feature.ts
   - src/resources/theme/color/color.globals.ts */

import { domainOf, type HassEntity } from '../entities'

export const UNAVAILABLE = 'unavailable'
export const UNKNOWN = 'unknown'
export const OFF = 'off'

export type ServiceCallFn = (
  domain: string,
  service: string,
  data: Record<string, unknown> & { entity_id: string },
) => Promise<boolean> | void

/** Exact Home Assistant palette hex values from `src/resources/theme/color/color.globals.ts`. */
export const HA_COLORS = {
  amber: '#ffc107',
  blue: '#2196f3',
  lightBlue: '#03a9f4',
  cyan: '#00bcd4',
  teal: '#009688',
  green: '#4caf50',
  orange: '#ff9800',
  deepOrange: '#ff6f22',
  red: '#f44336',
  indigo: '#3f51b5',
  deepPurple: '#6e41ab',
  blueGrey: '#607d8b',
  grey: '#9e9e9e',
  lightGrey: '#bdbdbd',
  yellow: '#ffeb3b',
  lime: '#cddc39',
  snowy: '#c0e0ff',
  error: '#db4437',
  warning: '#ffa600',
  success: '#43a047',
  info: '#039be5',
  primary: '#009ac7',
  active: '#ffc107',
  inactive: '#9e9e9e',
} as const

export const TIMESTAMP_STATE_DOMAINS = new Set<string>([
  'ai_task',
  'button',
  'conversation',
  'datetime',
  'event',
  'image',
  'infrared',
  'input_button',
  'notify',
  'radio_frequency',
  'scene',
  'stt',
  'tag',
  'tts',
  'wake_word',
])

const STATE_COLORED_DOMAINS = new Set<string>([
  'alarm_control_panel',
  'alert',
  'automation',
  'binary_sensor',
  'calendar',
  'camera',
  'climate',
  'cover',
  'device_tracker',
  'fan',
  'group',
  'humidifier',
  'input_boolean',
  'lawn_mower',
  'light',
  'lock',
  'media_player',
  'person',
  'plant',
  'remote',
  'schedule',
  'script',
  'siren',
  'sun',
  'switch',
  'timer',
  'update',
  'vacuum',
  'valve',
  'water_heater',
  'weather',
])

const BINARY_SENSOR_DANGER_CLASSES = new Set<string>([
  'battery',
  'carbon_monoxide',
  'gas',
  'glass_break',
  'heat',
  'lock',
  'moisture',
  'problem',
  'safety',
  'smoke',
  'sound',
  'tamper',
])

const WEATHER_STATE_COLORS: Readonly<Record<string, string>> = {
  sunny: HA_COLORS.amber,
  'clear-night': HA_COLORS.deepPurple,
  cloudy: HA_COLORS.lightGrey,
  partlycloudy: HA_COLORS.blueGrey,
  fog: HA_COLORS.grey,
  rainy: HA_COLORS.blue,
  pouring: HA_COLORS.indigo,
  hail: HA_COLORS.cyan,
  snowy: HA_COLORS.snowy,
  'snowy-rainy': HA_COLORS.lightBlue,
  lightning: HA_COLORS.yellow,
  'lightning-rainy': HA_COLORS.lime,
  windy: HA_COLORS.green,
  'windy-variant': HA_COLORS.green,
  exceptional: HA_COLORS.red,
}

export function supportsFeature(stateObj: HassEntity, feature: number): boolean {
  return (Number(stateObj.attributes.supported_features ?? 0) & feature) !== 0
}

export function stateActive(stateObj: HassEntity, state?: string): boolean {
  const domain = domainOf(stateObj.entity_id)
  const compareState = state !== undefined ? state : stateObj.state

  if (TIMESTAMP_STATE_DOMAINS.has(domain)) {
    return compareState !== UNAVAILABLE
  }

  if (compareState === UNAVAILABLE || compareState === UNKNOWN) {
    return false
  }

  if (compareState === OFF && domain !== 'alert') {
    return false
  }

  switch (domain) {
    case 'alarm_control_panel':
      return compareState !== 'disarmed'
    case 'alert':
      return compareState !== 'idle'
    case 'cover':
      return compareState !== 'closed'
    case 'device_tracker':
    case 'person':
      return compareState !== 'not_home'
    case 'lawn_mower':
      return !['docked', 'paused', 'idle'].includes(compareState)
    case 'lock':
      return compareState !== 'locked'
    case 'media_player':
      return compareState !== 'standby'
    case 'vacuum':
      return !['idle', 'docked', 'paused'].includes(compareState)
    case 'valve':
      return compareState !== 'closed'
    case 'plant':
      return compareState === 'problem'
    case 'group':
      return ['on', 'home', 'open', 'locked', 'problem'].includes(compareState)
    case 'timer':
      return compareState === 'active'
    case 'camera':
      return ['streaming', 'recording'].includes(compareState)
  }

  return true
}

function computeGroupDomain(stateObj: HassEntity): string | undefined {
  const members = stateObj.attributes.entity_id
  if (!Array.isArray(members) || members.length === 0) return undefined
  let firstDomain: string | undefined
  for (const id of members) {
    if (typeof id !== 'string') return undefined
    const d = domainOf(id)
    if (!firstDomain) firstDomain = d
    else if (firstDomain !== d) return undefined
  }
  return firstDomain
}

function domainColorHex(
  domain: string,
  deviceClass: string | undefined,
  state: string,
  active: boolean,
): string {
  switch (domain) {
    case 'alarm_control_panel':
      if (
        state === 'armed_away' ||
        state === 'armed_home' ||
        state === 'armed_night' ||
        state === 'armed_vacation' ||
        state === 'armed_custom_bypass'
      ) {
        return HA_COLORS.green
      }
      if (state === 'arming' || state === 'disarming' || state === 'pending') {
        return HA_COLORS.orange
      }
      if (state === 'triggered') return HA_COLORS.red
      return HA_COLORS.inactive

    case 'alert':
      if (state === 'on') return HA_COLORS.red
      if (state === 'off') return HA_COLORS.orange
      return HA_COLORS.inactive

    case 'binary_sensor':
      if (!active) return HA_COLORS.inactive
      if (state === 'on' && deviceClass && BINARY_SENSOR_DANGER_CLASSES.has(deviceClass)) {
        return HA_COLORS.red
      }
      return HA_COLORS.amber

    case 'climate':
      if (!active) return HA_COLORS.inactive
      switch (state) {
        case 'auto': return HA_COLORS.green
        case 'cool': return HA_COLORS.blue
        case 'dry': return HA_COLORS.orange
        case 'fan_only': return HA_COLORS.cyan
        case 'heat': return HA_COLORS.deepOrange
        case 'heat_cool': return HA_COLORS.amber
        default: return HA_COLORS.amber
      }

    case 'cover':
    case 'valve':
      return active ? HA_COLORS.blue : HA_COLORS.inactive

    case 'fan':
      return active ? HA_COLORS.cyan : HA_COLORS.inactive

    case 'humidifier':
      return state === 'on' ? HA_COLORS.blue : HA_COLORS.inactive

    case 'light':
    case 'switch':
    case 'input_boolean':
      return active ? HA_COLORS.amber : HA_COLORS.inactive

    case 'siren':
      return active ? HA_COLORS.red : HA_COLORS.inactive

    case 'lock':
      if (state === 'locked') return HA_COLORS.green
      if (state === 'locking' || state === 'unlocking' || state === 'opening') return HA_COLORS.orange
      if (state === 'unlocked' || state === 'open' || state === 'jammed') return HA_COLORS.red
      return HA_COLORS.inactive

    case 'water_heater':
      if (!active) return HA_COLORS.inactive
      if (state === 'eco') return HA_COLORS.green
      if (state === 'electric' || state === 'gas' || state === 'heat_pump') return HA_COLORS.orange
      if (state === 'high_demand' || state === 'performance') return HA_COLORS.deepOrange
      return HA_COLORS.amber

    case 'media_player':
      return active ? HA_COLORS.lightBlue : HA_COLORS.inactive

    case 'vacuum':
    case 'lawn_mower':
      if (state === 'error') return HA_COLORS.red
      return active ? HA_COLORS.teal : HA_COLORS.inactive

    case 'update':
      return active ? HA_COLORS.orange : HA_COLORS.inactive

    case 'person':
    case 'device_tracker':
      if (state === 'home') return HA_COLORS.green
      return active ? HA_COLORS.blue : HA_COLORS.inactive

    case 'plant':
      return state === 'problem' ? HA_COLORS.red : HA_COLORS.inactive

    case 'sun':
      if (state === 'above_horizon') return HA_COLORS.amber
      if (state === 'below_horizon') return HA_COLORS.indigo
      return HA_COLORS.inactive

    case 'weather':
      return WEATHER_STATE_COLORS[state] ?? (active ? HA_COLORS.amber : HA_COLORS.inactive)

    default:
      return active ? HA_COLORS.active : HA_COLORS.inactive
  }
}

/**
 * Returns the exact Home Assistant state color (hex or CSS variable for unavailable)
 * matching `stateColorCss` in `src/common/entity/state_color.ts`.
 */
export function stateColorCss(stateObj: HassEntity, state?: string): string {
  const compareState = state !== undefined ? state : stateObj.state
  if (compareState === UNAVAILABLE) {
    return 'var(--muted-foreground)'
  }

  const domain = domainOf(stateObj.entity_id)
  const dc = stateObj.attributes.device_class

  if (domain === 'sensor' && dc === 'battery') {
    const num = Number(compareState)
    if (!Number.isNaN(num)) {
      if (num >= 70) return HA_COLORS.green
      if (num >= 30) return HA_COLORS.orange
      return HA_COLORS.red
    }
  }

  if (domain === 'group') {
    const groupDomain = computeGroupDomain(stateObj)
    if (groupDomain && STATE_COLORED_DOMAINS.has(groupDomain)) {
      const active = stateActive(stateObj, state)
      return domainColorHex(groupDomain, dc, compareState, active)
    }
  }

  const active = stateActive(stateObj, state)
  if (STATE_COLORED_DOMAINS.has(domain)) {
    return domainColorHex(domain, dc, compareState, active)
  }

  return active ? HA_COLORS.active : HA_COLORS.inactive
}
