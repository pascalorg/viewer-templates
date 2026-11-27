import type { SceneGraph } from '../../src/pascal/contract'
import type { Area, HassEntities, HomeDevice, V3 } from '../../src/home/entities'
import frontDoor from './frontDoor.json' with { type: 'json' }

/* The link tests' sample home (once the /lab route's): three rooms and a garden built as a Pascal
   graph, every device family placed by hand, and their entities as Home Assistant would report them. */

/** The lab's sample home, kept as the link tests' fixture (the /lab route is gone).
 * The slab's walking surface: Pascal's default slab elevation. */
export const FLOOR_Y = 0.05
/** The garden's ground, just above the site's own. */
const GROUND_Y = 0.012
const H = 3

const X0 = -6
const X1 = 10
const D = 4
type Wall = [string, [number, number], [number, number]]
const WALLS: Wall[] = [
  ['wall_south', [X0, -D], [X1, -D]],
  ['wall_east', [X1, -D], [X1, D]],
  ['wall_north', [X1, D], [X0, D]],
  ['wall_west', [X0, D], [X0, -D]],
  // the partitions between the rooms, open at their north ends
  ['wall_mid', [0, -D], [0, 0.9]],
  ['wall_utility', [6, -D], [6, 0.9]],
]

export const AREAS: Area[] = [
  { id: 'lounge', name: 'Lounge', bounds: [X0 + 0.1, -D + 0.1, -0.1, D - 0.1] },
  { id: 'studio', name: 'Studio', bounds: [0.1, -D + 0.1, 5.9, D - 0.1] },
  { id: 'utility', name: 'Utility', bounds: [6.1, -D + 0.1, X1 - 0.1, D - 0.1] },
  { id: 'garden', name: 'Garden', bounds: [X0, D + 0.4, X1, D + 6.5] },
]
/** Rooms indoors: the alarm's outline and the floor fields cover these. */
export const INDOOR = AREAS.filter((a) => a.id !== 'garden')

const zone = (id: string, name: string, [x0, z0, x1, z1]: Area['bounds'], color: string) => ({
  object: 'node', id, type: 'zone', name, parentId: 'level_lab', visible: true,
  polygon: [[x0, z0], [x1, z0], [x1, z1], [x0, z1]], holes: [], autoFromWalls: false, boundaryWallIds: [], boundarySeparatorIds: [],
  spaceRole: 'generic', roomNumber: '', enclosureStatus: 'auto', floorFinish: '', wallFinish: '', ceilingFinish: '', ceilingHeight: H - 0.3,
  occupancy: '', clearDimensionPolicy: 'none', color,
})

export const FRONT_DOOR_ID = 'door_front'

export const LAB_GRAPH = {
  nodes: {
    site_lab: { object: 'node', id: 'site_lab', type: 'site', parentId: null, visible: true, polygon: { type: 'polygon', points: [[-25, -25], [25, -25], [25, 25], [-25, 25]] }, children: ['building_lab'] },
    building_lab: { object: 'node', id: 'building_lab', type: 'building', parentId: 'site_lab', visible: true, children: ['level_lab'], position: [0, 0, 0], rotation: [0, 0, 0] },
    level_lab: {
      object: 'node', id: 'level_lab', type: 'level', name: 'Ground floor', parentId: 'building_lab', visible: true, level: 0, baseElevation: 0, height: H,
      children: ['slab_lab', ...WALLS.map(([id]) => id), 'zone_lounge', 'zone_studio', 'zone_utility'],
    },
    slab_lab: { object: 'node', id: 'slab_lab', type: 'slab', parentId: 'level_lab', visible: true, children: [], polygon: [[X0, -D], [X1, -D], [X1, D], [X0, D]], holes: [] },
    ...Object.fromEntries(WALLS.map(([id, start, end]) => [id, {
      object: 'node', id, type: 'wall', parentId: 'level_lab', visible: true, children: id === 'wall_north' ? [FRONT_DOOR_ID] : [], start, end, frontSide: 'unknown', backSide: 'unknown',
    }])),
    [FRONT_DOOR_ID]: frontDoor,
    zone_lounge: zone('zone_lounge', 'Lounge', AREAS[0]!.bounds, '#3b82f6'),
    zone_studio: zone('zone_studio', 'Studio', AREAS[1]!.bounds, '#10b981'),
    zone_utility: zone('zone_utility', 'Utility', AREAS[2]!.bounds, '#f59e0b'),
  },
  rootNodeIds: ['site_lab'],
  materials: {},
  installedPlugins: [],
} as unknown as SceneGraph

/* rotationY turns the device's facing (+x) in plan: 0 faces +x, π/2 faces −z, π faces −x, −π/2 faces +z. */
const PX = 0
const NZ = Math.PI / 2
const NX = Math.PI
const PZ = -Math.PI / 2

/** Which body the lab draws for a device; a project's own items will bring their models. */
export type LabModel =
  | 'wall-ac' | 'pendant' | 'floor-lamp' | 'ceiling-fan' | 'floor-fan' | 'wall-sensor'
  | 'blind' | 'door-lock' | 'door-contact' | 'smoke' | 'leak' | 'motion' | 'siren' | 'keypad'
  | 'tv' | 'speaker' | 'voice' | 'camera' | 'router' | 'vacuum-dock' | 'mower-dock' | 'heater' | 'plug' | 'boiler' | 'valve'
  | 'gate' | 'weather-station' | 'doorbell' | 'puck' | 'remote' | 'ir' | 'humidifier' | 'curtain' | 'garage' | 'shutter' | 'washer' | 'freezer'
  | 'none'

type LabDevice = HomeDevice & { model: LabModel }
const at =(x: number, h: number, z: number): V3 => [x, h, z]
const floor = (x: number, z: number): V3 => [x, FLOOR_Y + 0.012, z]
const ground = (x: number, z: number): V3 => [x, GROUND_Y, z]

export const LAB_DEVICES: LabDevice[] = [
  /* lounge */
  { entityId: 'climate.lounge_ac', model: 'wall-ac', anchor: { area: 'lounge', mount: 'wall', position: [X0 + 0.17, 2.45, -0.4], rotationY: PX, size: [0.24, 0.32, 1.12], outlet: [0.13, -0.16, 0] } },
  { entityId: 'light.lounge_pendant', model: 'pendant', anchor: { area: 'lounge', mount: 'ceiling', position: [-3, 2.35, 0.6], rotationY: 0, size: [0.4, 0.3, 1.7] } },
  { entityId: 'fan.lounge_floor_fan', model: 'floor-fan', anchor: { area: 'lounge', mount: 'floor', position: [-0.9, 1.15, -3.2], rotationY: (3 * Math.PI) / 4 + Math.PI / 2, size: [0.3, 0.5, 0.5] } },
  { entityId: 'cover.lounge_blind', model: 'blind', anchor: { area: 'lounge', mount: 'wall', position: [-4.4, 1.65, -D + 0.08], rotationY: PZ, size: [0.1, 1.4, 1.5] } },
  { entityId: 'media_player.lounge_tv', model: 'tv', anchor: { area: 'lounge', mount: 'wall', position: [-0.14, 1.35, -1.8], rotationY: NX, size: [0.06, 0.66, 1.18] } },
  { entityId: 'assist_satellite.lounge_voice', model: 'voice', anchor: { area: 'lounge', mount: 'table', position: [-5.3, 0.72, 2.9], rotationY: 0, size: [0.12, 0.06, 0.12] } },
  { entityId: 'lock.front_door', model: 'door-lock', nodeId: FRONT_DOOR_ID, links: ['binary_sensor.front_door'], anchor: { area: 'lounge', mount: 'wall', position: [-2.4, 1.05, D], rotationY: NZ, size: [0.1, 0.2, 0.1] } },
  { entityId: 'binary_sensor.front_door', model: 'door-contact', nodeId: FRONT_DOOR_ID, anchor: { area: 'lounge', mount: 'wall', position: [-2, 1.12, D], rotationY: NZ, size: [0.1, 2.25, 1] } },
  { entityId: 'alarm_control_panel.home_alarm', model: 'keypad', anchor: { area: 'lounge', mount: 'wall', position: [-3.4, 1.45, D - 0.1], rotationY: NZ, size: [0.03, 0.2, 0.14] } },
  { entityId: 'siren.lounge_siren', model: 'siren', anchor: { area: 'lounge', mount: 'wall', position: [-0.5, 2.6, D - 0.14], rotationY: NZ, size: [0.12, 0.16, 0.16] } },
  { entityId: 'sensor.lounge_temperature', model: 'wall-sensor', anchor: { area: 'lounge', mount: 'wall', position: [-2.6, 1.45, -D + 0.12], rotationY: PZ, size: [0.04, 0.25, 0.25] } },
  { entityId: 'sensor.lounge_humidity', model: 'wall-sensor', anchor: { area: 'lounge', mount: 'wall', position: [X0 + 0.12, 1.45, 2.4], rotationY: PX, size: [0.04, 0.25, 0.25] } },

  /* studio */
  { entityId: 'fan.studio_ceiling_fan', model: 'ceiling-fan', anchor: { area: 'studio', mount: 'ceiling', position: [3, 2.6, -0.6], rotationY: 0, size: [0.3, 0.3, 2.5] } },
  { entityId: 'light.studio_lamp', model: 'floor-lamp', anchor: { area: 'studio', mount: 'floor', position: [5.3, 1.62, 3.3], rotationY: 0, size: [0.4, 1.6, 0.4] } },
  { entityId: 'media_player.studio_speaker', model: 'speaker', anchor: { area: 'studio', mount: 'floor', position: [0.6, 0.55, -3.4], rotationY: Math.PI / 4, size: [0.22, 1, 0.22] } },
  { entityId: 'binary_sensor.studio_motion', model: 'motion', anchor: { area: 'studio', mount: 'wall', position: [5.8, 2.5, -3.8], rotationY: (3 * Math.PI) / 4, size: [0.08, 0.1, 0.08] } },
  { entityId: 'binary_sensor.studio_smoke', model: 'smoke', anchor: { area: 'studio', mount: 'ceiling', position: [3.2, 2.92, 2.2], rotationY: 0, size: [0.14, 0.05, 0.14] } },
  { entityId: 'binary_sensor.router_internet', model: 'router', anchor: { area: 'studio', mount: 'table', position: [1.4, 0.8, 1.6], rotationY: 0.45, size: [0.3, 0.1, 0.4] } },
  {
    entityId: 'switch.studio_heater_plug', model: 'heater', links: ['sensor.studio_heater_power'],
    anchor: { area: 'studio', mount: 'floor', position: [2.4, 0.4, 3.72], rotationY: NZ, size: [0.1, 0.6, 1.2] },
    // the cable from the electrical panel in the utility room, along the skirting, to the plug
    path: [at(9.86, 1.3, -1.6), at(9.86, 0.22, -1.6), at(9.86, 0.22, 3.86), at(3.3, 0.22, 3.86), at(3.2, 0.3, 3.86)],
  },
  { entityId: 'sensor.studio_heater_power', model: 'plug', anchor: { area: 'studio', mount: 'wall', position: [3.2, 0.3, D - 0.06], rotationY: NZ, size: [0.04, 0.08, 0.06] } },
  {
    entityId: 'vacuum.studio_robot', model: 'vacuum-dock',
    anchor: { area: 'studio', mount: 'floor', position: [5.5, 0.15, 2.2], rotationY: NX, size: [0.3, 0.3, 0.3] },
    path: [floor(5.3, 2.2), floor(4.2, 3.3), floor(1, 3.2), floor(0.6, 0.4), floor(0.7, -3.2), floor(3, -2.2), floor(5.3, -3.3), floor(5.4, -0.4)],
  },
  { entityId: 'sensor.studio_temperature', model: 'wall-sensor', anchor: { area: 'studio', mount: 'wall', position: [0.12, 1.45, -2.4], rotationY: PX, size: [0.04, 0.25, 0.25] } },
  { entityId: 'sensor.studio_co2', model: 'wall-sensor', anchor: { area: 'studio', mount: 'wall', position: [0.12, 1.45, -0.6], rotationY: PX, size: [0.04, 0.25, 0.25] } },

  /* utility */
  {
    entityId: 'water_heater.utility_boiler', model: 'boiler',
    anchor: { area: 'utility', mount: 'floor', position: [9.3, 0.9, -3.3], rotationY: 0, size: [0.62, 1.6, 0.62] },
    // hot water up and out through the partition to the studio
    path: [at(9.3, 1.72, -3.3), at(9.3, 2.6, -3.3), at(6.25, 2.6, -3.3), at(6.25, 2.6, -3.75), at(5.8, 2.6, -3.75)],
  },
  {
    entityId: 'valve.utility_water_main', model: 'valve',
    anchor: { area: 'utility', mount: 'wall', position: [7.4, 0.55, -D + 0.12], rotationY: PZ, size: [0.2, 0.2, 0.2] },
    // the main comes in under the south wall, through the valve and on to the boiler
    path: [at(7.4, -0.2, -D - 0.5), at(7.4, 0.55, -D + 0.12), at(8.6, 0.55, -D + 0.12), at(8.6, 0.3, -3.3), at(9, 0.3, -3.3)],
  },
  { entityId: 'binary_sensor.utility_leak', model: 'leak', anchor: { area: 'utility', mount: 'floor', position: [8.4, FLOOR_Y + 0.02, -2.4], rotationY: 0, size: [0.08, 0.03, 0.08] } },

  /* garden */
  {
    entityId: 'lawn_mower.garden_mower', model: 'mower-dock',
    anchor: { area: 'garden', mount: 'floor', position: [8.6, 0.12, 5.0], rotationY: PZ, size: [0.7, 0.25, 0.6] },
    path: [ground(8.6, 5.2), ground(9.2, 8.8), ground(4, 10), ground(-2, 9.6), ground(-5.2, 9), ground(-5.4, 5.6), ground(0, 5.3), ground(4.5, 7.2)],
  },
  { entityId: 'camera.garden_camera', model: 'camera', anchor: { area: 'garden', mount: 'wall', position: [3.5, 2.6, D + 0.12], rotationY: PZ, size: [0.18, 0.1, 0.1] } },
  { entityId: 'cover.garden_gate', model: 'gate', anchor: { area: 'garden', mount: 'floor', position: [X0 - 0.6, 0.62, 7.2], rotationY: PX, size: [0.1, 1.2, 1.8] } },
  { entityId: 'sensor.garden_wind_speed', model: 'weather-station', anchor: { area: 'garden', mount: 'floor', position: [-3.5, 1.8, 9.6], rotationY: 0, size: [0.2, 0.2, 0.2] } },
  { entityId: 'sensor.garden_pressure', model: 'none', anchor: { area: 'garden', mount: 'floor', position: [-3.5, 1.4, 9.6], rotationY: 0, size: [0.1, 0.1, 0.1] } },
  { entityId: 'binary_sensor.garden_frost', model: 'none', anchor: { area: 'garden', mount: 'floor', position: [-3.5, 1.0, 9.6], rotationY: 0, size: [0.1, 0.1, 0.1] } },
  { entityId: 'binary_sensor.garden_daylight', model: 'none', anchor: { area: 'garden', mount: 'floor', position: [-3.5, 2.15, 9.6], rotationY: 0, size: [0.1, 0.1, 0.1] } },
  { entityId: 'event.front_doorbell', model: 'doorbell', anchor: { area: 'garden', mount: 'wall', position: [-1.25, 1.3, D + 0.1], rotationY: PZ, size: [0.03, 0.12, 0.05] } },

  /* people: they stand in the room Home Assistant puts them in; the path is where they go when out */
  { entityId: 'person.alex', model: 'none', anchor: { area: 'lounge', mount: 'floor', position: [-2, FLOOR_Y, D], rotationY: 0 }, path: [at(-2, 0, D + 1.5)] },
  { entityId: 'person.sam', model: 'none', anchor: { area: 'studio', mount: 'floor', position: [-2, FLOOR_Y, D], rotationY: 0 }, path: [at(-2, 0, D + 1.5)] },
  { entityId: 'device_tracker.alex_phone', model: 'none', anchor: { area: 'lounge', mount: 'floor', position: [-2, FLOOR_Y, D], rotationY: 0 }, path: [at(-2, 0, D + 1.5)] },

  /* more of the lounge */
  { entityId: 'binary_sensor.lounge_window', model: 'none', anchor: { area: 'lounge', mount: 'wall', position: [-4.4, 1.65, -D + 0.1], rotationY: PZ, size: [0.1, 1.45, 1.55] } },
  { entityId: 'binary_sensor.lounge_glass_break', model: 'puck', anchor: { area: 'lounge', mount: 'wall', position: [-5.5, 2.3, -D + 0.1], rotationY: PZ, size: [0.03, 0.1, 0.1] } },
  { entityId: 'binary_sensor.keypad_tamper', model: 'none', anchor: { area: 'lounge', mount: 'wall', position: [-3.4, 1.62, D - 0.1], rotationY: NZ, size: [0.03, 0.05, 0.05] } },
  { entityId: 'sensor.lounge_noise', model: 'wall-sensor', anchor: { area: 'lounge', mount: 'wall', position: [-0.14, 1.45, 2.6], rotationY: NX, size: [0.04, 0.25, 0.25] } },
  { entityId: 'sensor.lounge_pm25', model: 'wall-sensor', anchor: { area: 'lounge', mount: 'wall', position: [X0 + 0.12, 1.45, -2.6], rotationY: PX, size: [0.04, 0.25, 0.25] } },
  { entityId: 'remote.lounge_tv_remote', model: 'remote', anchor: { area: 'lounge', mount: 'table', position: [-2.4, 0.47, -1.6], rotationY: 0, size: [0.05, 0.02, 0.18] } },
  { entityId: 'infrared.lounge_ir_blaster', model: 'ir', anchor: { area: 'lounge', mount: 'table', position: [-1.9, 0.5, -1.1], rotationY: NX, size: [0.08, 0.04, 0.08] } },

  /* more of the studio */
  { entityId: 'humidifier.studio_humidifier', model: 'humidifier', anchor: { area: 'studio', mount: 'floor', position: [4.4, 0.3, -3.3], rotationY: 0, size: [0.32, 0.5, 0.32] } },
  { entityId: 'cover.studio_curtain', model: 'curtain', anchor: { area: 'studio', mount: 'wall', position: [2.6, 1.6, -D + 0.12], rotationY: PZ, size: [0.1, 2.2, 1.8] } },
  { entityId: 'sensor.studio_illuminance', model: 'wall-sensor', anchor: { area: 'studio', mount: 'wall', position: [0.12, 1.45, 1.2], rotationY: PX, size: [0.04, 0.25, 0.25] } },
  { entityId: 'sensor.studio_noise', model: 'wall-sensor', anchor: { area: 'studio', mount: 'wall', position: [5.88, 1.45, 1.6], rotationY: NX, size: [0.04, 0.25, 0.25] } },
  { entityId: 'sensor.utility_noise', model: 'wall-sensor', anchor: { area: 'utility', mount: 'wall', position: [6.12, 1.45, 2.6], rotationY: PX, size: [0.04, 0.25, 0.25] } },
  { entityId: 'sensor.studio_voc', model: 'wall-sensor', anchor: { area: 'studio', mount: 'wall', position: [0.12, 1.45, 2.6], rotationY: PX, size: [0.04, 0.25, 0.25] } },
  { entityId: 'binary_sensor.studio_desk_plug', model: 'none', anchor: { area: 'studio', mount: 'table', position: [1.6, 0.86, 2.1], rotationY: 0, size: [0.05, 0.05, 0.05] } },
  { entityId: 'binary_sensor.studio_smoke_battery', model: 'none', anchor: { area: 'studio', mount: 'ceiling', position: [3.42, 2.92, 2.2], rotationY: 0, size: [0.05, 0.05, 0.05] } },

  /* more of the utility room */
  { entityId: 'cover.garage_door', model: 'garage', anchor: { area: 'utility', mount: 'wall', position: [8.1, 1.25, D - 0.1], rotationY: NZ, size: [0.1, 2.4, 2.4] } },
  { entityId: 'cover.utility_shutter', model: 'shutter', anchor: { area: 'utility', mount: 'wall', position: [X1 - 0.1, 1.65, -0.6], rotationY: NX, size: [0.1, 1.2, 1.2] } },
  { entityId: 'binary_sensor.utility_washer_vibration', model: 'washer', anchor: { area: 'utility', mount: 'floor', position: [6.55, 0.45, -1.6], rotationY: PX, size: [0.6, 0.85, 0.6] } },
  { entityId: 'binary_sensor.utility_washer_running', model: 'none', anchor: { area: 'utility', mount: 'floor', position: [6.55, 0.95, -1.6], rotationY: PX, size: [0.05, 0.05, 0.05] } },
  { entityId: 'binary_sensor.utility_freezer_problem', model: 'freezer', anchor: { area: 'utility', mount: 'floor', position: [6.55, 0.8, 0.0], rotationY: PX, size: [0.6, 1.6, 0.6] } },
  { entityId: 'radio_frequency.utility_rf_bridge', model: 'ir', anchor: { area: 'utility', mount: 'wall', position: [X1 - 0.12, 2.2, 2.4], rotationY: NX, size: [0.08, 0.04, 0.08] } },
  { entityId: 'sensor.home_energy', model: 'none', anchor: { area: 'utility', mount: 'wall', position: [9.86, 1.75, -1.6], rotationY: NX, size: [0.05, 0.05, 0.05] } },
]
export const LAB_AREA_OF: Record<string, string> = Object.fromEntries(LAB_DEVICES.map((d) => [d.entityId, d.anchor.area]))

/** Lab-only scenery that is not a device: the electrical panel the plug's cable runs from. */
export const LAB_SCENERY: { model: 'panel'; position: V3; rotationY: number }[] = [{ model: 'panel', position: [9.9, 1.4, -1.6], rotationY: NX }]


const sensor = (id: string, name: string, device_class: string, unit: string, state: number, extra: Record<string, unknown> = {}) => ({
  entity_id: id, state: String(state), attributes: { friendly_name: name, device_class, unit_of_measurement: unit, state_class: 'measurement', ...extra },
})
const binary = (id: string, name: string, device_class: string, extra: Record<string, unknown> = {}, state = 'off') => ({
  entity_id: id, state, attributes: { friendly_name: name, device_class, ...extra },
})

const PLAYLIST = [
  { title: 'Night Swim', artist: 'Harbor Lane', duration: 214, art: ['#4f6dff', '#16d6c4'] },
  { title: 'Paper Lanterns', artist: 'Mono Atlas', duration: 187, art: ['#ff7a45', '#ffcf5a'] },
  { title: 'Slow Weather', artist: 'The Quiet Rooms', duration: 241, art: ['#b37bff', '#ff6fb1'] },
]

export const LAB_ENTITIES: HassEntities = Object.fromEntries(
  [
    {
      entity_id: 'climate.lounge_ac', state: 'cool',
      attributes: {
        friendly_name: 'Lounge air conditioner',
        supported_features: 959, // TARGET_TEMPERATURE | TARGET_TEMPERATURE_RANGE | TARGET_HUMIDITY | FAN_MODE | PRESET_MODE | SWING_MODE | TURN_OFF | TURN_ON | SWING_HORIZONTAL_MODE
        hvac_modes: ['off', 'cool', 'heat', 'heat_cool', 'dry', 'fan_only'],
        hvac_action: 'cooling',
        fan_modes: ['auto', 'low', 'medium', 'high'],
        fan_mode: 'auto',
        preset_modes: ['none', 'eco', 'comfort', 'boost', 'sleep'],
        preset_mode: 'none',
        swing_modes: ['off', 'vertical', 'horizontal', 'both'],
        swing_mode: 'off',
        swing_horizontal_modes: ['off', 'on'],
        swing_horizontal_mode: 'off',
        min_temp: 16, max_temp: 30, target_temp_step: 0.5,
        temperature: 21, target_temp_low: null, target_temp_high: null,
        current_temperature: 25.4,
        min_humidity: 30, max_humidity: 80, target_humidity_step: 5,
        humidity: 50, current_humidity: 61,
      },
    },
    {
      entity_id: 'light.lounge_pendant', state: 'on',
      attributes: { friendly_name: 'Lounge pendant', supported_features: 0, supported_color_modes: ['color_temp'], color_mode: 'color_temp', brightness: 204, color_temp_kelvin: 2700, min_color_temp_kelvin: 2000, max_color_temp_kelvin: 6500 },
    },
    {
      entity_id: 'fan.lounge_floor_fan', state: 'on',
      attributes: { friendly_name: 'Lounge floor fan', supported_features: 59, percentage: 66, percentage_step: 33.33, oscillating: true, preset_modes: ['normal', 'natural', 'sleep'], preset_mode: 'normal' },
    },
    {
      entity_id: 'cover.lounge_blind', state: 'open',
      attributes: { friendly_name: 'Lounge blind', device_class: 'blind', supported_features: 255, current_position: 100, current_tilt_position: 50 },
    },
    {
      entity_id: 'media_player.lounge_tv', state: 'playing',
      attributes: {
        friendly_name: 'Lounge TV', device_class: 'tv',
        supported_features: 383423, // PAUSE|SEEK|VOLUME_SET|VOLUME_MUTE|PREVIOUS_TRACK|NEXT_TRACK|TURN_ON|TURN_OFF|SELECT_SOURCE|STOP|PLAY|SHUFFLE_SET|SELECT_SOUND_MODE|REPEAT_SET
        volume_level: 0.35, is_volume_muted: false,
        source: 'Music', source_list: ['Music', 'Netflix', 'YouTube', 'HDMI 1'],
        sound_mode: 'Standard', sound_mode_list: ['Standard', 'Cinema', 'Music'],
        shuffle: false, repeat: 'off',
        media_content_type: 'music',
        media_title: PLAYLIST[0]!.title, media_artist: PLAYLIST[0]!.artist, media_duration: PLAYLIST[0]!.duration, media_position: 32,
        media_position_updated_at: new Date().toISOString(),
        _art: PLAYLIST[0]!.art, _playlist: PLAYLIST,
      },
    },
    { entity_id: 'assist_satellite.lounge_voice', state: 'idle', attributes: { friendly_name: 'Lounge voice assistant' } },
    { entity_id: 'lock.front_door', state: 'locked', attributes: { friendly_name: 'Front door lock', supported_features: 1 } },
    binary('binary_sensor.front_door', 'Front door', 'door'),
    { entity_id: 'alarm_control_panel.home_alarm', state: 'disarmed', attributes: { friendly_name: 'Home alarm', supported_features: 63, code_arm_required: false } },
    { entity_id: 'siren.lounge_siren', state: 'off', attributes: { friendly_name: 'Lounge siren', supported_features: 31, available_tones: ['alarm', 'fire', 'chime'], tone: 'alarm', volume_level: 0.8 } },
    sensor('sensor.lounge_temperature', 'Lounge temperature', 'temperature', '°C', 25.4),
    sensor('sensor.lounge_humidity', 'Lounge humidity', 'humidity', '%', 61),

    {
      entity_id: 'fan.studio_ceiling_fan', state: 'on',
      attributes: { friendly_name: 'Studio ceiling fan', supported_features: 55, percentage: 50, percentage_step: 10, oscillating: false, direction: 'forward' },
    },
    {
      entity_id: 'light.studio_lamp', state: 'on',
      attributes: {
        friendly_name: 'Studio lamp',
        supported_features: 4,
        supported_color_modes: ['color_temp', 'rgb', 'white'],
        color_mode: 'rgb',
        brightness: 230,
        rgb_color: [150, 110, 255],
        color_temp_kelvin: 4000,
        min_color_temp_kelvin: 2000,
        max_color_temp_kelvin: 6500,
        effect_list: ['None', 'Colorloop', 'Candle', 'Fireplace'],
        effect: 'None',
      },
    },
    {
      entity_id: 'media_player.studio_speaker', state: 'paused',
      attributes: {
        friendly_name: 'Studio speaker', device_class: 'speaker',
        supported_features: 383423,
        volume_level: 0.55, is_volume_muted: false,
        source: 'Spotify', source_list: ['Spotify', 'Radio', 'AirPlay'],
        sound_mode: 'Music', sound_mode_list: ['Standard', 'Music', 'Night'],
        shuffle: false, repeat: 'off',
        media_content_type: 'music',
        media_title: PLAYLIST[1]!.title, media_artist: PLAYLIST[1]!.artist, media_duration: PLAYLIST[1]!.duration, media_position: 80,
        media_position_updated_at: new Date().toISOString(),
        _art: PLAYLIST[1]!.art, _playlist: PLAYLIST,
      },
    },
    binary('binary_sensor.studio_motion', 'Studio motion', 'motion', { _reach: 6.5 }),
    binary('binary_sensor.studio_smoke', 'Studio smoke alarm', 'smoke'),
    binary('binary_sensor.router_internet', 'Router internet', 'connectivity', { _reach: 9.5 }, 'on'),
    { entity_id: 'switch.studio_heater_plug', state: 'off', attributes: { friendly_name: 'Studio heater plug', rated_power_w: 1800, current_power_w: 0, heats_room: true } },
    sensor('sensor.studio_heater_power', 'Studio heater power', 'power', 'W', 0, { power_of: 'switch.studio_heater_plug' }),
    {
      entity_id: 'vacuum.studio_robot', state: 'docked',
      attributes: {
        friendly_name: 'Studio robot vacuum',
        supported_features: 13884, // PAUSE|STOP|RETURN_HOME|FAN_SPEED|LOCATE|CLEAN_SPOT|STATE|START
        battery_level: 92, fan_speed: 'standard', fan_speed_list: ['quiet', 'standard', 'turbo'],
      },
    },
    sensor('sensor.studio_temperature', 'Studio temperature', 'temperature', '°C', 24.6),
    sensor('sensor.studio_co2', 'Studio CO₂', 'carbon_dioxide', 'ppm', 1480),

    {
      entity_id: 'water_heater.utility_boiler', state: 'eco',
      attributes: { friendly_name: 'Water heater', supported_features: 15, operation_list: ['off', 'eco', 'electric', 'performance'], temperature: 55, current_temperature: 41, min_temp: 35, max_temp: 70, away_mode: 'off', _last_mode: 'eco' },
    },
    { entity_id: 'valve.utility_water_main', state: 'open', attributes: { friendly_name: 'Water main', device_class: 'water', supported_features: 15, current_position: 100, reports_position: true } },
    binary('binary_sensor.utility_leak', 'Utility leak sensor', 'moisture'),

    { entity_id: 'lawn_mower.garden_mower', state: 'docked', attributes: { friendly_name: 'Garden mower', supported_features: 15, battery_level: 100 } },
    {
      entity_id: 'camera.garden_camera', state: 'streaming',
      attributes: { friendly_name: 'Garden camera', supported_features: 1, motion_detection: true, _fov: 80, _reach: 7.5, _tilt: 0.42, watches: ['lawn_mower.garden_mower', 'binary_sensor.front_door'] },
    },
    { entity_id: 'cover.garden_gate', state: 'closed', attributes: { friendly_name: 'Garden gate', device_class: 'gate', supported_features: 11, current_position: 0 } },
    sensor('sensor.garden_wind_speed', 'Garden wind speed', 'wind_speed', 'km/h', 14),
    sensor('sensor.garden_pressure', 'Garden pressure', 'atmospheric_pressure', 'hPa', 1014),
    binary('binary_sensor.garden_frost', 'Garden frost', 'cold'),
    binary('binary_sensor.garden_daylight', 'Garden daylight', 'light', {}, 'on'),
    { entity_id: 'event.front_doorbell', state: 'unknown', attributes: { friendly_name: 'Front doorbell', device_class: 'doorbell', event_types: ['ring'] } },

    /* people */
    { entity_id: 'person.alex', state: 'home', attributes: { friendly_name: 'Alex', _room: 'lounge', _color: '#ff8a5c', device_trackers: ['device_tracker.alex_phone'] } },
    { entity_id: 'person.sam', state: 'home', attributes: { friendly_name: 'Sam', _room: 'studio', _color: '#7c9cff', device_trackers: [] } },
    { entity_id: 'device_tracker.alex_phone', state: 'home', attributes: { friendly_name: "Alex's phone", source_type: 'gps', battery_level: 68 } },

    /* more of the lounge */
    binary('binary_sensor.lounge_window', 'Lounge window', 'window'),
    binary('binary_sensor.lounge_glass_break', 'Lounge glass break', 'glass_break'),
    binary('binary_sensor.keypad_tamper', 'Keypad tamper', 'tamper'),
    sensor('sensor.lounge_noise', 'Lounge noise', 'sound_pressure', 'dB', 45),
    sensor('sensor.lounge_pm25', 'Lounge PM2.5', 'pm25', 'µg/m³', 16),
    { entity_id: 'remote.lounge_tv_remote', state: 'on', attributes: { friendly_name: 'TV remote', supported_features: 4, activity_list: ['Watch TV', 'Music', 'Games'], current_activity: 'Music', _target: 'media_player.lounge_tv' } },
    { entity_id: 'infrared.lounge_ir_blaster', state: 'unknown', attributes: { friendly_name: 'Lounge IR blaster', _target: 'climate.lounge_ac' } },

    /* more of the studio */
    {
      entity_id: 'humidifier.studio_humidifier', state: 'on',
      attributes: { friendly_name: 'Studio humidifier', device_class: 'humidifier', supported_features: 1, humidity: 60, current_humidity: 55, min_humidity: 30, max_humidity: 80, mode: 'normal', available_modes: ['normal', 'eco', 'sleep', 'boost'], action: 'humidifying' },
    },
    { entity_id: 'cover.studio_curtain', state: 'open', attributes: { friendly_name: 'Studio curtain', device_class: 'curtain', supported_features: 15, current_position: 100 } },
    sensor('sensor.studio_illuminance', 'Studio light level', 'illuminance', 'lx', 300),
    sensor('sensor.studio_noise', 'Studio noise', 'sound_pressure', 'dB', 35),
    sensor('sensor.utility_noise', 'Utility noise', 'sound_pressure', 'dB', 30),
    sensor('sensor.studio_voc', 'Studio VOC', 'volatile_organic_compounds', 'µg/m³', 640),
    binary('binary_sensor.studio_desk_plug', 'Desk charger', 'plug', {}, 'on'),
    binary('binary_sensor.studio_smoke_battery', 'Smoke alarm battery', 'battery'),

    /* more of the utility room */
    { entity_id: 'cover.garage_door', state: 'closed', attributes: { friendly_name: 'Garage door', device_class: 'garage', supported_features: 15, current_position: 0 } },
    { entity_id: 'cover.utility_shutter', state: 'open', attributes: { friendly_name: 'Utility shutter', device_class: 'shutter', supported_features: 15, current_position: 100 } },
    binary('binary_sensor.utility_washer_vibration', 'Washer vibration', 'vibration'),
    binary('binary_sensor.utility_washer_running', 'Washer running', 'running'),
    binary('binary_sensor.utility_freezer_problem', 'Freezer door ajar', 'problem'),
    { entity_id: 'radio_frequency.utility_rf_bridge', state: 'unknown', attributes: { friendly_name: 'RF bridge', _target: 'cover.garage_door' } },
    sensor('sensor.home_energy', 'Home energy', 'energy', 'kWh', 4821.6, { state_class: 'total_increasing' }),

    /* the Home tab: everything that is not a thing in a room */
    {
      entity_id: 'weather.home', state: 'partlycloudy',
      attributes: {
        friendly_name: 'Home weather', temperature: 17, apparent_temperature: 16, humidity: 62, pressure: 1014, wind_speed: 14, wind_bearing: 220, cloud_coverage: 40, uv_index: 3,
        temperature_unit: '°C', wind_speed_unit: 'km/h',
        _forecast: [
          { day: 'Tue', condition: 'sunny', temperature: 19, templow: 9 },
          { day: 'Wed', condition: 'rainy', temperature: 14, templow: 8 },
          { day: 'Thu', condition: 'cloudy', temperature: 15, templow: 7 },
          { day: 'Fri', condition: 'snowy', temperature: 3, templow: -2 },
        ],
      },
    },
    {
      entity_id: 'scene.movie_night', state: 'unknown',
      attributes: {
        friendly_name: 'Movie night',
        _entities: {
          'light.lounge_pendant': ['turn_on', { brightness_pct: 15, color_temp_kelvin: 2700 }],
          'cover.lounge_blind': ['close_cover', {}],
          'media_player.lounge_tv': ['media_play', {}],
          'light.studio_lamp': ['turn_off', {}],
        },
      },
    },
    {
      entity_id: 'scene.good_night', state: 'unknown',
      attributes: {
        friendly_name: 'Good night',
        _entities: {
          'light.lounge_pendant': ['turn_off', {}], 'light.studio_lamp': ['turn_off', {}], 'media_player.lounge_tv': ['turn_off', {}], 'media_player.studio_speaker': ['media_pause', {}],
          'lock.front_door': ['lock', {}], 'cover.garage_door': ['close_cover', {}], 'alarm_control_panel.home_alarm': ['alarm_arm_night', {}],
        },
      },
    },
    { entity_id: 'button.router_restart', state: 'unknown', attributes: { friendly_name: 'Restart router', device_class: 'restart', _restarts: 'binary_sensor.router_internet' } },
    { entity_id: 'number.boiler_boost_minutes', state: '30', attributes: { friendly_name: 'Water heater boost', min: 0, max: 120, step: 15, unit_of_measurement: 'min', mode: 'slider' } },
    { entity_id: 'select.house_mode', state: 'Home', attributes: { friendly_name: 'House mode', options: ['Home', 'Away', 'Guest', 'Holiday'] } },
    { entity_id: 'text.welcome_message', state: 'Welcome home!', attributes: { friendly_name: 'Doorbell greeting', min: 0, max: 60, mode: 'text' } },
    { entity_id: 'date.bin_day', state: '2026-11-27', attributes: { friendly_name: 'Next bin day' } },
    { entity_id: 'time.wake_up', state: '07:00:00', attributes: { friendly_name: 'Wake-up time' } },
    { entity_id: 'datetime.holiday_start', state: '2026-12-19T16:00:00', attributes: { friendly_name: 'Holiday starts' } },
    {
      entity_id: 'update.router_firmware', state: 'on',
      attributes: { friendly_name: 'Router firmware', title: 'Router firmware', device_class: 'firmware', supported_features: 5, installed_version: '2.4.1', latest_version: '2.5.0', in_progress: false, release_summary: 'Faster roaming between access points and security fixes.' },
    },
    { entity_id: 'update.home_assistant_core', state: 'off', attributes: { friendly_name: 'Home Assistant Core', title: 'Home Assistant Core', supported_features: 5, installed_version: '2026.11.3', latest_version: '2026.11.3', in_progress: false } },
    { entity_id: 'notify.family_phones', state: 'unknown', attributes: { friendly_name: 'Family phones' } },
    {
      entity_id: 'calendar.family', state: 'off',
      attributes: {
        friendly_name: 'Family calendar',
        _events: [
          { summary: 'Piano lesson', start: Date.now() + 40 * 60_000, end: Date.now() + 100 * 60_000, location: 'Music school' },
          { summary: 'Dinner with Jo', start: Date.now() + 5 * 3600_000, end: Date.now() + 7 * 3600_000 },
        ],
      },
    },
    {
      entity_id: 'todo.shopping_list', state: '3',
      attributes: { friendly_name: 'Shopping list', _items: [{ summary: 'Milk', status: 'needs_action' }, { summary: 'Light bulbs', status: 'needs_action' }, { summary: 'Coffee', status: 'needs_action' }, { summary: 'Bread', status: 'completed' }] },
    },
    { entity_id: 'timer_list.kitchen', state: '0', attributes: { friendly_name: 'Kitchen timers', _timers: [] } },
    { entity_id: 'conversation.home_assistant', state: 'unknown', attributes: { friendly_name: 'Assist' } },
    { entity_id: 'tts.home_voice', state: 'unknown', attributes: { friendly_name: 'Text to speech', _speakers: ['media_player.studio_speaker', 'media_player.lounge_tv'] } },
    { entity_id: 'stt.home_speech', state: 'unknown', attributes: { friendly_name: 'Speech to text', _languages: ['en', 'fr', 'ar', 'de'] } },
    { entity_id: 'wake_word.home_wake_word', state: 'unknown', attributes: { friendly_name: 'Wake word', _words: ['Okay Nabu', 'Hey Jarvis'] } },
    { entity_id: 'ai_task.home_ai', state: 'unknown', attributes: { friendly_name: 'AI tasks' } },
    { entity_id: 'image.front_door_snapshot', state: new Date().toISOString(), attributes: { friendly_name: 'Front door snapshot', _caption: 'Nobody at the door', _seed: 0.3 } },
    { entity_id: 'image_processing.garden_people', state: '0', attributes: { friendly_name: 'People in the garden', _area: 'garden', _label: 'people' } },
    { entity_id: 'geo_location.lightning_strike', state: '12', attributes: { friendly_name: 'Lightning strike', source: 'lightning', unit_of_measurement: 'km', latitude: 51.5, longitude: -0.12 } },
    { entity_id: 'geo_location.local_flood_warning', state: '4', attributes: { friendly_name: 'Flood warning: river', source: 'flood', unit_of_measurement: 'km', latitude: 51.48, longitude: -0.1 } },
    { entity_id: 'air_quality.outdoor', state: '9', attributes: { friendly_name: 'Outdoor air quality', particulate_matter_10: 15, ozone: 48, nitrogen_dioxide: 12 } },
    sensor('sensor.alex_phone_battery', "Alex's phone battery", 'battery', '%', 68),
  ].map((e) => [e.entity_id, e]),
)
