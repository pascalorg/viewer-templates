/* Devices as Home Assistant describes them. Entity state, attributes and service calls follow
   Home Assistant's own shapes (the ones home-assistant-js-websocket hands out), as a real
   Home Assistant connection gives them to the effects and cards. */

export type V3 = [number, number, number]

/** One entity as Home Assistant reports it: `light.lounge_pendant`, its state and attributes. */
export type HassEntity = {
  entity_id: string
  state: string
  attributes: Record<string, unknown> & { friendly_name?: string; device_class?: string; unit_of_measurement?: string }
  last_changed?: string
}
export type HassEntities = Record<string, HassEntity>
/** A Home Assistant service call: `light.turn_on` with `{ brightness_pct: 80 }`. */
export type ServiceCall = { domain: string; service: string; data: Record<string, unknown> & { entity_id: string } }

export const domainOf = (entityId: string) => entityId.split('.')[0]!

/* ---------------- effect families ---------------- */

/** The 3D effect a device gets. Each family is one reusable effect, placed from the device's anchor. */
export type EffectFamily =
  | 'light' | 'airflow' | 'rotor' | 'field'
  | 'opening' | 'lock' | 'contact' | 'smoke' | 'leak' | 'motion' | 'siren' | 'alarm'
  | 'media' | 'camera' | 'robot' | 'energy' | 'heater' | 'water' | 'network' | 'voice'
  | 'mist' | 'presence' | 'alert' | 'status' | 'signal' | 'doorbell'
  /** On a Pascal door or window: the model opens as its own animation does, and nothing is drawn. */
  | 'model'
  | 'none'

const SMOKE_CLASSES = ['smoke', 'gas', 'carbon_monoxide', 'heat']
const MOTION_CLASSES = ['motion', 'occupancy', 'presence', 'moving']
const CONTACT_CLASSES = ['door', 'window', 'opening', 'garage_door']
/** Binary sensors that warn of something happening: they pulse. */
const ALERT_CLASSES = ['vibration', 'glass_break', 'sound', 'tamper', 'problem', 'safety', 'cold']
/* Every other binary sensor (battery, running, plug, power, light, lock, update…) reports a
   condition, and glows while it holds: the "status" family. */

/** Every Home Assistant entity platform, and where the viewer shows it: on the model (with an
    effect, or a pin only) or in the Home tab, for the ones that are not a thing in a room. */
export const PLATFORMS = {
  model: [
    'light', 'climate', 'fan', 'humidifier', 'sensor', 'binary_sensor', 'cover', 'lock', 'siren', 'alarm_control_panel', 'media_player', 'camera',
    'vacuum', 'lawn_mower', 'switch', 'water_heater', 'valve', 'assist_satellite', 'remote', 'infrared', 'radio_frequency', 'event', 'person', 'device_tracker', 'weather',
  ],
  home: [
    'scene', 'button', 'number', 'select', 'text', 'date', 'time', 'datetime', 'update', 'notify', 'calendar', 'todo', 'timer_list',
    'conversation', 'tts', 'stt', 'wake_word', 'ai_task', 'image', 'image_processing', 'geo_location', 'air_quality',
  ],
} as const

/** Which family draws an entity, by its domain and, where it matters, its device class. */
export function familyOf(e: HassEntity): EffectFamily {
  const dc = String(e.attributes.device_class ?? '')
  switch (domainOf(e.entity_id)) {
    case 'light': return 'light'
    case 'climate': return 'airflow'
    case 'fan': return 'rotor'
    case 'sensor': return fieldOf(e) ? 'field' : 'none'
    case 'cover': return 'opening'
    case 'lock': return 'lock'
    case 'binary_sensor':
      if (SMOKE_CLASSES.includes(dc)) return 'smoke'
      if (dc === 'moisture') return 'leak'
      if (MOTION_CLASSES.includes(dc)) return 'motion'
      if (CONTACT_CLASSES.includes(dc)) return 'contact'
      if (dc === 'connectivity') return 'network'
      if (ALERT_CLASSES.includes(dc)) return 'alert'
      return 'status'
    case 'siren': return 'siren'
    case 'alarm_control_panel': return 'alarm'
    case 'media_player': return 'media'
    case 'camera': return 'camera'
    case 'vacuum':
    case 'lawn_mower': return 'robot'
    case 'switch': return 'energy'
    case 'water_heater': return 'heater'
    case 'valve': return 'water'
    case 'assist_satellite': return 'voice'
    case 'humidifier': return 'mist'
    case 'person':
    case 'device_tracker': return 'presence'
    case 'remote':
    case 'infrared':
    case 'radio_frequency': return 'signal'
    case 'event': return 'doorbell'
    default: return 'none'
  }
}

/** Domains the viewer can switch on and off with one tap (the rest have their own controls). */
export const TOGGLE_DOMAINS = ['light', 'climate', 'fan', 'switch', 'siren', 'media_player', 'camera', 'humidifier', 'remote']

/** The colour a status or alert binary sensor shows while it is on. */
export function binaryColor(dc: string) {
  switch (dc) {
    case 'battery':
    case 'problem':
    case 'tamper':
    case 'glass_break':
    case 'safety': return '#ff4d4f'
    case 'cold': return '#6fc8ff'
    case 'running':
    case 'battery_charging':
    case 'power': return '#3ddc97'
    case 'light': return '#ffe27a'
    case 'update': return '#5ab0ff'
    default: return '#ffb020'
  }
}

/** Pascal's sky cover for a Home Assistant weather condition. */
export function skyFor(condition: string): 'clear' | 'fair' | 'cloudy' | 'overcast' {
  if (condition === 'sunny' || condition === 'clear-night') return 'clear'
  if (condition === 'partlycloudy' || condition === 'windy') return 'fair'
  if (condition === 'cloudy' || condition === 'fog' || condition === 'windy-variant') return 'cloudy'
  return 'overcast'
}

/** Colours the alert, security and status families share. */
export const ALERT = { danger: '#ff4d4f', warn: '#ffb020', ok: '#3ddc97', info: '#5ab0ff', water: '#4fb3ff', idle: '#8a939e' }

/** The alarm panel's colour for its state. */
export function alarmColor(state: string) {
  if (state === 'triggered') return ALERT.danger
  if (state === 'disarmed') return ALERT.ok
  if (state === 'arming' || state === 'pending') return ALERT.warn
  return state === 'armed_home' || state === 'armed_night' ? ALERT.warn : ALERT.danger
}

/** Is a binary sensor reporting its problem (smoke, water, motion, open)? Home Assistant says "on". */
export const tripped = (e: HassEntity | undefined) => e?.state === 'on'

/** A cover or valve's openness, 0 (closed) to 1 (open). */
export const openness = (e: HassEntity) =>
  e.attributes.current_position !== undefined ? Number(e.attributes.current_position) / 100 : e.state === 'open' || e.state === 'opening' ? 1 : 0

/* ---------------- where a device sits ---------------- */

/** How a device hangs: it decides which way its light falls and its air blows. */
export type Mount = 'ceiling' | 'wall' | 'floor' | 'table'

/** Where a device is in the model. In the lab it is placed by hand; in a project it will come
    from the Pascal item the entity is linked to. Local +x is the way the device faces. */
export type Anchor = {
  position: V3
  rotationY: number
  mount: Mount
  area: string
  /** The device's own size in its axes (x deep, the way it faces; y up; z across its face), so effects scale with it. */
  size?: V3
  /** Where its effect starts, relative to `position` in the device's own axes (an AC's louver). */
  outlet?: V3
}

/** A room, as the floor field maps it: its floor rectangle in plan (x0, z0, x1, z1). */
export type Area = { id: string; name: string; bounds: [number, number, number, number] }

/** A device on the model: the entity it shows, and where. */
export type HomeDevice = {
  entityId: string
  anchor: Anchor
  /** Other entities it works with: a plug's power sensor, a lock's door sensor. */
  links?: string[]
  /** Where its effect reaches, in world space: a plug's cable run to the panel, a valve's pipe,
      a robot's route, a router's coverage centre. */
  path?: V3[]
  /** The Pascal node it drives (a door the lock and contact sensor open). */
  nodeId?: string
  /** The effect to draw, where the thing it is linked to decides rather than the entity: a wall
      thermostat drives the heating but blows no air of its own ('none'). */
  effect?: EffectFamily
}

/* ---------------- lights ---------------- */

export const isOn = (e: HassEntity | undefined) => !!e && e.state !== 'off' && e.state !== 'unavailable' && e.state !== 'unknown'

/** A light's colour: its RGB colour when it has one, otherwise its colour temperature. */
export function lightColor(e: HassEntity): string {
  const rgb = e.attributes.rgb_color as [number, number, number] | undefined
  if (e.attributes.color_mode === 'rgb' && rgb) return `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`
  return kelvinColor(Number(e.attributes.color_temp_kelvin ?? 2700))
}
/** Brightness 0..1 (Home Assistant reports 0..255). */
export const lightLevel = (e: HassEntity) => (isOn(e) ? Number(e.attributes.brightness ?? 255) / 255 : 0)

/** Black-body colour of a colour temperature, close enough for lighting (Tanner Helland's fit). */
export function kelvinColor(k: number) {
  const t = k / 100
  const r = t <= 66 ? 255 : 329.7 * (t - 60) ** -0.1332
  const g = t <= 66 ? 99.47 * Math.log(t) - 161.12 : 288.12 * (t - 60) ** -0.0755
  const b = t >= 66 ? 255 : t <= 19 ? 0 : 138.52 * Math.log(t - 10) - 305.04
  const c = (v: number) => Math.round(Math.max(0, Math.min(255, v)))
  return `rgb(${c(r)},${c(g)},${c(b)})`
}

/* ---------------- climate ---------------- */

export const HVAC_COLOR: Record<string, string> = {
  cool: '#63cfff', heat: '#ff9548', fan_only: '#dfe7ef', dry: '#b9a7ff', heat_cool: '#9fe8c8', auto: '#9fe8c8', off: '#2a2f35',
}
/** The target as words: one temperature, or the low–high band heat_cool keeps between. */
export function climateTarget(e: HassEntity): string | null {
  const a = e.attributes
  if (a.temperature != null) return `${a.temperature}°`
  if (a.target_temp_low != null && a.target_temp_high != null) return `${a.target_temp_low}–${a.target_temp_high}°`
  return null
}

/** What the unit is doing right now: as Home Assistant reports it, or else heat_cool and auto cool
    or heat towards the target (or out of the low–high band). */
export function hvacAction(e: HassEntity): 'cooling' | 'heating' | 'fan' | 'drying' | 'idle' | 'off' {
  const reported = ({ cooling: 'cooling', heating: 'heating', fan: 'fan', drying: 'drying', idle: 'idle', off: 'off' } as const)[String(e.attributes.hvac_action) as 'cooling']
  if (reported && e.state !== 'off') return reported
  const a = e.attributes
  const low = Number(a.temperature ?? a.target_temp_low ?? 21)
  const high = Number(a.temperature ?? a.target_temp_high ?? low)
  const target = low
  const now = Number(a.current_temperature ?? target)
  switch (e.state) {
    case 'off': return 'off'
    case 'cool': return now > high + 0.2 ? 'cooling' : 'idle'
    case 'heat': return now < target - 0.2 ? 'heating' : 'idle'
    case 'fan_only': return 'fan'
    case 'dry': return 'drying'
    default: return now > high + 0.2 ? 'cooling' : now < low - 0.2 ? 'heating' : 'idle'
  }
}
/** The air's tint: by what it is doing, so heat_cool reads as cool air or warm air. */
export function climateColor(e: HassEntity) {
  const a = hvacAction(e)
  if (a === 'cooling') return HVAC_COLOR.cool!
  if (a === 'heating') return HVAC_COLOR.heat!
  if (a === 'drying') return HVAC_COLOR.dry!
  if (a === 'off') return HVAC_COLOR.off!
  return HVAC_COLOR.fan_only!
}
/** How hard it blows, 0..1: the fan mode, and a gentle idle once the room is at target. */
export function climateStrength(e: HassEntity) {
  if (e.state === 'off') return 0
  const fan = ({ low: 0.55, medium: 0.8, high: 1, auto: 0.85 } as Record<string, number>)[String(e.attributes.fan_mode ?? 'auto')] ?? 0.85
  return hvacAction(e) === 'idle' ? fan * 0.45 : fan
}

/* ---------------- fans ---------------- */

/** Blade speed in rad/s for a fan's percentage. */
export const fanSpin = (e: HassEntity | undefined) => (isOn(e) ? 3 + (Number(e!.attributes.percentage ?? 50) / 100) * 15 : 0)

/* ---------------- sensors and the floor field ---------------- */

/** The floor field a sensor's reading paints: its colour scale and its range. */
export type FieldKind = 'temperature' | 'humidity' | 'carbon_dioxide' | 'pm25' | 'volatile_organic_compounds' | 'illuminance' | 'sound_pressure'
type Stop = [number, [number, number, number]]
export const FIELDS: Record<FieldKind, { label: string; unit: string; stops: Stop[]; digits: number }> = {
  temperature: { label: 'Temperature', unit: '°C', digits: 1, stops: [[16, [70, 150, 255]], [20, [90, 220, 215]], [23, [150, 225, 130]], [26, [255, 150, 70]], [30, [255, 85, 70]]] },
  humidity: { label: 'Humidity', unit: '%', digits: 0, stops: [[20, [255, 190, 90]], [35, [200, 225, 120]], [50, [110, 225, 170]], [65, [90, 170, 255]], [80, [150, 110, 255]]] },
  carbon_dioxide: { label: 'CO₂', unit: 'ppm', digits: 0, stops: [[400, [110, 225, 150]], [800, [190, 225, 110]], [1200, [255, 200, 80]], [1600, [255, 130, 70]], [2200, [255, 70, 90]]] },
  pm25: { label: 'PM2.5', unit: 'µg/m³', digits: 0, stops: [[0, [110, 225, 150]], [12, [190, 225, 110]], [35, [255, 200, 80]], [55, [255, 130, 70]], [150, [200, 70, 160]]] },
  volatile_organic_compounds: { label: 'VOC', unit: 'µg/m³', digits: 0, stops: [[0, [110, 225, 150]], [250, [190, 225, 110]], [500, [255, 200, 80]], [1000, [255, 130, 70]], [2000, [200, 70, 160]]] },
  illuminance: { label: 'Light', unit: 'lx', digits: 0, stops: [[0, [40, 50, 110]], [50, [90, 90, 180]], [200, [200, 170, 120]], [500, [255, 220, 120]], [1000, [255, 250, 210]]] },
  sound_pressure: { label: 'Noise', unit: 'dB', digits: 0, stops: [[25, [90, 200, 170]], [40, [140, 220, 120]], [55, [255, 210, 90]], [70, [255, 130, 70]], [85, [255, 70, 90]]] },
}
export const fieldOf = (e: HassEntity): FieldKind | null => (String(e.attributes.device_class) in FIELDS ? (e.attributes.device_class as FieldKind) : null)

export function fieldColor(kind: FieldKind, v: number) {
  const stops = FIELDS[kind].stops
  const x = Math.max(stops[0]![0], Math.min(stops[stops.length - 1]![0], v))
  let i = 0
  while (i < stops.length - 2 && x > stops[i + 1]![0]) i++
  const [a, ca] = stops[i]!
  const [b, cb] = stops[i + 1]!
  const u = (x - a) / (b - a)
  const c = ca.map((p, k) => Math.round(p + (cb[k]! - p) * u))
  return `rgb(${c[0]},${c[1]},${c[2]})`
}

/* ---------------- noise ---------------- */

/** A quiet room with nothing running, in dB. */
export const QUIET_DB = 26

/**
 * How loud a device is right now, in dB at one metre, or null when it makes no sound. Rough
 * real-world figures: a fan on high ~50, a TV at a normal volume ~60, a vacuum ~68, a siren ~95.
 */
export function noiseOf(e: HassEntity): number | null {
  const a = e.attributes
  switch (domainOf(e.entity_id)) {
    case 'media_player': return e.state === 'playing' && !a.is_volume_muted ? 42 + Number(a.volume_level ?? 0.4) * 36 : null
    case 'fan': return isOn(e) ? 30 + Number(a.percentage ?? 50) * 0.22 : null
    case 'climate': return e.state === 'off' ? null : 34 + climateStrength(e) * 12
    case 'humidifier': return isOn(e) ? (a.action === 'humidifying' ? 36 : 30) : null
    case 'vacuum': return e.state === 'cleaning' ? (a.fan_speed === 'turbo' ? 74 : a.fan_speed === 'quiet' ? 60 : 67) : e.state === 'returning' ? 58 : null
    case 'lawn_mower': return e.state === 'mowing' ? 70 : e.state === 'returning' ? 62 : null
    case 'siren': return isOn(e) ? 95 : null
    case 'assist_satellite': return e.state === 'responding' ? 58 : null
    case 'binary_sensor': return a.device_class === 'vibration' && e.state === 'on' ? 62 : null
    case 'water_heater': return e.state !== 'off' && Number(a.current_temperature ?? 0) < Number(a.temperature ?? 0) - 0.5 ? 38 : null
    case 'cover': return e.state === 'opening' || e.state === 'closing' ? (a.device_class === 'garage' ? 64 : 44) : null
    default: return null
  }
}

/** Sound levels add as energy, not as numbers: two 60 dB sources make 63 dB, not 120. */
export const addDb = (levels: number[]) => 10 * Math.log10(levels.reduce((s, l) => s + 10 ** (l / 10), 0) || 1)

/* ---------------- what the list and the card say ---------------- */

export const nameOf = (e: HassEntity) => e.attributes.friendly_name ?? e.entity_id

export type ClimateStatusFormatters = {
  formatEntityState: (e: HassEntity, state?: string) => string
  formatEntityAttributeValue: (e: HassEntity, attribute: string, value?: unknown) => string
  formatNumber: (num: string | number) => string
}

export function statusOf(e: HassEntity, fmt?: ClimateStatusFormatters): string {
  switch (domainOf(e.entity_id)) {
    case 'light': {
      if (!isOn(e)) return 'Off'
      const pct = Math.round(lightLevel(e) * 100)
      // a colour (rgb, rgbw, hs, xy…) or a white light that reports its temperature, or just its level
      if (e.attributes.color_temp_kelvin) return `${pct}% · ${e.attributes.color_temp_kelvin} K`
      return e.attributes.color_mode && e.attributes.color_mode !== 'brightness' && e.attributes.color_mode !== 'onoff' ? `${pct}% · colour` : `${pct}%`
    }
    case 'climate': {
      if (fmt) {
        if (e.state === 'off' || e.state === 'unavailable' || e.state === 'unknown') {
          return fmt.formatEntityState(e)
        }
        const rawAction = typeof e.attributes.hvac_action === 'string' ? e.attributes.hvac_action : undefined
        const label =
          rawAction && rawAction !== 'off'
            ? fmt.formatEntityAttributeValue(e, 'hvac_action')
            : fmt.formatEntityState(e)
        let target: string | null = null
        if (e.attributes.temperature != null) {
          target = fmt.formatEntityAttributeValue(e, 'temperature')
        } else if (e.attributes.target_temp_low != null && e.attributes.target_temp_high != null) {
          target = `${fmt.formatNumber(Number(e.attributes.target_temp_low))}–${fmt.formatEntityAttributeValue(e, 'target_temp_high')}`
        }
        return target ? `${label} · ${target}` : label
      }
      if (e.state === 'off') return 'Off'
      const a = hvacAction(e)
      const t = climateTarget(e)
      if (a === 'drying') return 'Drying'
      if (a === 'fan') return 'Fan only'
      if (!t) return a === 'cooling' ? 'Cooling' : a === 'heating' ? 'Heating' : 'Idle'
      return a === 'cooling' ? `Cooling · ${t}` : a === 'heating' ? `Heating · ${t}` : `${cap(e.state)} · ${t}`
    }
    case 'fan': return isOn(e) ? `${e.attributes.percentage}%${e.attributes.oscillating ? ' · oscillating' : ''}` : 'Off'
    case 'sensor': {
      const k = fieldOf(e)
      const v = Number(e.state)
      return k ? `${v.toFixed(FIELDS[k].digits)} ${e.attributes.unit_of_measurement ?? FIELDS[k].unit}` : `${e.state} ${e.attributes.unit_of_measurement ?? ''}`
    }
    case 'cover': {
      const p = e.attributes.current_position
      return e.state === 'opening' ? 'Opening…' : e.state === 'closing' ? 'Closing…' : p === undefined ? cap(e.state) : p === 0 ? 'Closed' : p === 100 ? 'Open' : `${p}% open`
    }
    case 'valve': return e.state === 'opening' ? 'Opening…' : e.state === 'closing' ? 'Closing…' : cap(e.state)
    case 'lock': return cap(e.state)
    case 'binary_sensor': return binaryLabel(e)
    case 'siren': return isOn(e) ? `Sounding · ${e.attributes.tone ?? 'alarm'}` : 'Off'
    case 'alarm_control_panel': return ALARM_LABEL[e.state] ?? cap(e.state)
    case 'media_player': {
      if (e.state === 'off') return 'Off'
      const t = e.attributes.media_title
      return e.state === 'playing' && t ? `${t}` : cap(e.state)
    }
    case 'camera': return e.state === 'recording' ? 'Recording' : e.state === 'streaming' ? 'Live' : e.state === 'off' ? 'Off' : 'Idle'
    case 'vacuum':
    case 'lawn_mower': return `${cap(e.state)} · ${e.attributes.battery_level ?? 100}%`
    case 'switch': {
      const w = e.attributes.current_power_w
      return isOn(e) ? (w !== undefined ? `On · ${Math.round(Number(w))} W` : 'On') : 'Off'
    }
    case 'water_heater': return e.state === 'off' ? 'Off' : `${cap(String(e.state).replace('_', ' '))} · ${e.attributes.current_temperature}° → ${e.attributes.temperature}°`
    case 'assist_satellite': return cap(e.state)
    case 'humidifier': return isOn(e) ? `${cap(String(e.attributes.action ?? 'on'))} · ${e.attributes.current_humidity}% → ${e.attributes.humidity}%` : 'Off'
    case 'person':
    case 'device_tracker': return e.state === 'home' ? `Home · ${cap(String(e.attributes._room ?? ''))}` : e.state === 'not_home' ? 'Away' : cap(e.state)
    case 'remote': return isOn(e) ? String(e.attributes.current_activity ?? 'On') : 'Off'
    case 'infrared':
    case 'radio_frequency':
    case 'button':
    case 'notify':
    case 'conversation':
    case 'tts':
    case 'ai_task': return e.state && e.state !== 'unknown' ? `Last ${ago(e.state)}` : 'Never used'
    case 'event': return e.attributes.event_type ? `${cap(String(e.attributes.event_type))} ${ago(e.state)}` : 'Nothing yet'
    case 'weather': return `${cap(e.state.replace('-', ' '))} · ${e.attributes.temperature}°`
    case 'scene': return e.state && e.state !== 'unknown' ? `Set ${ago(e.state)}` : 'Not set yet'
    case 'number': return `${e.state}${e.attributes.unit_of_measurement ? ` ${e.attributes.unit_of_measurement}` : ''}`
    case 'update': return e.attributes.in_progress ? `Installing ${Math.round(Number(e.attributes.update_percentage ?? 0))}%` : e.state === 'on' ? `${e.attributes.latest_version} available` : `Up to date · ${e.attributes.installed_version}`
    case 'calendar': return e.state === 'on' ? `Now: ${e.attributes.message}` : e.attributes.message ? `Next: ${e.attributes.message}` : 'Nothing planned'
    case 'todo': return `${e.state} to do`
    case 'timer_list': return Number(e.state) ? `${e.state} running` : 'No timers'
    case 'image_processing': return `${e.state} ${e.attributes._label ?? 'found'}`
    case 'geo_location': return `${e.state} km away`
    case 'air_quality': return `PM2.5 ${e.state} µg/m³`
    case 'stt':
    case 'wake_word': return 'Ready'
    case 'image': return e.attributes._caption ? String(e.attributes._caption) : 'Image'
    default: return e.state
  }
}

/** How long ago an ISO timestamp was, in words. */
export function ago(iso: string) {
  const s = (Date.now() - Date.parse(iso)) / 1000
  if (!Number.isFinite(s)) return ''
  if (s < 10) return 'just now'
  if (s < 60) return `${Math.round(s)} s ago`
  if (s < 3600) return `${Math.round(s / 60)} min ago`
  return `${Math.round(s / 3600)} h ago`
}

export const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1).replaceAll('_', ' ') : s)

export const ALARM_LABEL: Record<string, string> = {
  disarmed: 'Disarmed', armed_home: 'Armed home', armed_away: 'Armed away', armed_night: 'Armed night',
  arming: 'Arming…', pending: 'Entry delay…', triggered: 'Triggered!',
}

/** What a binary sensor's on and off mean for its device class, as Home Assistant words them. */
export function binaryLabel(e: HassEntity) {
  const on = tripped(e)
  switch (e.attributes.device_class) {
    case 'smoke': return on ? 'Smoke detected' : 'Clear'
    case 'gas': return on ? 'Gas detected' : 'Clear'
    case 'carbon_monoxide': return on ? 'CO detected' : 'Clear'
    case 'moisture': return on ? 'Water detected' : 'Dry'
    case 'motion': return on ? 'Motion' : 'No motion'
    case 'occupancy':
    case 'presence': return on ? 'Occupied' : 'Clear'
    case 'door':
    case 'window':
    case 'garage_door':
    case 'opening': return on ? 'Open' : 'Closed'
    case 'connectivity': return on ? 'Connected' : 'Disconnected'
    case 'vibration': return on ? 'Vibrating' : 'Still'
    case 'glass_break': return on ? 'Glass broken' : 'Clear'
    case 'sound': return on ? 'Sound detected' : 'Quiet'
    case 'tamper': return on ? 'Tampered with' : 'OK'
    case 'problem': return on ? 'Problem' : 'OK'
    case 'safety': return on ? 'Unsafe' : 'Safe'
    case 'cold': return on ? 'Too cold' : 'Normal'
    case 'heat': return on ? 'Too hot' : 'Normal'
    case 'battery': return on ? 'Battery low' : 'Battery OK'
    case 'battery_charging': return on ? 'Charging' : 'Not charging'
    case 'running': return on ? 'Running' : 'Not running'
    case 'plug': return on ? 'Plugged in' : 'Unplugged'
    case 'power': return on ? 'Powered' : 'No power'
    case 'light': return on ? 'Light' : 'Dark'
    case 'lock': return on ? 'Unlocked' : 'Locked'
    case 'update': return on ? 'Update available' : 'Up to date'
    case 'moving': return on ? 'Moving' : 'Still'
    default: return on ? 'On' : 'Off'
  }
}

/** A service call as a line of Home Assistant YAML-ish text, for the card's footer. */
export function describeCall(c: ServiceCall) {
  const { entity_id, ...rest } = c.data
  const args = Object.entries(rest).filter(([k]) => !k.startsWith('_')).map(([k, v]) => `${k}: ${Array.isArray(v) ? `[${v.join(', ')}]` : v}`)
  return `${c.domain}.${c.service}  ${entity_id}${args.length ? `  { ${args.join(', ')} }` : ''}`
}
