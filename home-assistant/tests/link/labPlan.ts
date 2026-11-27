import type { V3 } from '../../src/home/entities'
import type { GraphNode, GraphNodes } from '../../src/home/link/scene'
import { AREAS, FRONT_DOOR_ID, LAB_AREA_OF, LAB_DEVICES, LAB_GRAPH } from './labHome'

/* The lab's home as a real Pascal project would have it: its devices drawn as catalog items (the
   lab draws them by hand instead), with furniture around them that is not a device, and two
   identical table lamps to tell apart. Every entity's right answer is known, so the linking can be
   scored. Item names are made up to read like catalog names, some in French; a real plan's names
   are the real test. */

type Fixture = { name: string; attachTo?: 'ceiling' | 'wall'; dims?: V3 }

/** The catalog item each lab device would be, by its entity. */
const AS_ITEM: Record<string, Fixture> = {
  'climate.lounge_ac': { name: 'Split air conditioner', attachTo: 'wall', dims: [0.9, 0.3, 0.22] },
  'light.lounge_pendant': { name: 'Pendant lamp', attachTo: 'ceiling' },
  'fan.lounge_floor_fan': { name: 'Standing fan' },
  'cover.lounge_blind': { name: 'Roller blind', attachTo: 'wall' },
  'media_player.lounge_tv': { name: 'Wall-mounted TV 55"', attachTo: 'wall' },
  'assist_satellite.lounge_voice': { name: 'Smart speaker' },
  'alarm_control_panel.home_alarm': { name: 'Alarm keypad', attachTo: 'wall' },
  'siren.lounge_siren': { name: 'Indoor siren', attachTo: 'wall' },
  'fan.studio_ceiling_fan': { name: 'Ventilateur de plafond', attachTo: 'ceiling' },
  'light.studio_lamp': { name: 'Lampadaire arc' },
  'media_player.studio_speaker': { name: 'Floor-standing speaker' },
  'binary_sensor.studio_motion': { name: 'Motion sensor', attachTo: 'wall' },
  'binary_sensor.studio_smoke': { name: 'Smoke detector', attachTo: 'ceiling' },
  'binary_sensor.router_internet': { name: 'Wi-Fi router' },
  'switch.studio_heater_plug': { name: 'Oil-filled radiator' },
  'vacuum.studio_robot': { name: 'Robot vacuum' },
  'humidifier.studio_humidifier': { name: 'Humidificateur' },
  'cover.studio_curtain': { name: 'Linen curtain', attachTo: 'wall' },
  'water_heater.utility_boiler': { name: 'Chauffe-eau 200L', attachTo: 'wall' },
  'valve.utility_water_main': { name: 'Water shut-off valve', attachTo: 'wall' },
  'lawn_mower.garden_mower': { name: 'Robot lawn mower' },
  'camera.garden_camera': { name: 'Outdoor camera', attachTo: 'wall' },
  'cover.garden_gate': { name: 'Garden gate' },
  'event.front_doorbell': { name: 'Video doorbell', attachTo: 'wall' },
}

/** Furniture the linking must leave alone, and a washing machine only its sensors report on. */
const DECOYS: [string, V3, number, string?][] = [
  ['Three-seat sofa', [-3.6, 0, -2.6], 0],
  ['Coffee table', [-3.6, 0, -1.4], 0],
  ['TV stand', [-0.4, 0, -1.8], 0],
  ['Light grey armchair', [-5, 0, -0.6], 0],
  ['Bookshelf', [-5.5, 0, 3.2], 0],
  ['Wool rug', [-3, 0, -1], 0],
  ['Desk', [1.6, 0, 2.1], 0],
  ['Office chair', [1.6, 0, 1.4], 0],
  ['Washing machine', [9.4, 0, -3.4], 0, 'item_washer'],
  // the two identical lamps: one by the sofa, one by the bookshelf
  ['Table lamp', [-2.5, 0.5, -2.8], 0, 'item_lamp_sofa'],
  ['Table lamp', [-5.4, 0.5, 2.6], 0, 'item_lamp_shelf'],
]

/** Two lights for the identical lamps, named as people name them. */
export const EXTRA_ENTITIES = [
  { entity_id: 'light.lounge_sofa_lamp', name: 'Sofa lamp', area: 'Lounge' },
  { entity_id: 'light.lounge_reading_lamp', name: 'Reading lamp', area: 'Lounge' },
]

/** The model's turn (y) that makes a +z-facing catalog model face as the lab device does. */
const yawFor = (rotationY: number) => Math.atan2(Math.cos(rotationY), -Math.sin(rotationY))

export function labPlan() {
  const nodes: GraphNodes = { ...(LAB_GRAPH.nodes as unknown as GraphNodes) }
  const level = nodes.level_lab!
  const children = [...(level.children ?? [])]
  const add = (node: GraphNode) => {
    nodes[node.id] = node
    children.push(node.id)
  }
  /** Each entity's right thing; null where it has no thing of its own. */
  const truth: Record<string, string | null> = {}
  const facing: Record<string, number> = {}

  for (const d of LAB_DEVICES) {
    if (d.nodeId === FRONT_DOOR_ID) {
      truth[d.entityId] = FRONT_DOOR_ID
      continue
    }
    const f = AS_ITEM[d.entityId]
    if (!f) {
      truth[d.entityId] = null
      continue
    }
    const id = `item_${d.entityId.replace('.', '_')}`
    truth[d.entityId] = id
    facing[id] = d.anchor.rotationY
    add({
      id, type: 'item', name: '', parentId: 'level_lab', position: d.anchor.position, rotation: [0, yawFor(d.anchor.rotationY), 0], scale: [1, 1, 1],
      asset: { name: f.name, category: 'misc', ...(f.attachTo ? { attachTo: f.attachTo } : {}), ...(f.dims ? { dimensions: f.dims } : {}) },
    })
  }
  // a device's power reading belongs with what it powers
  truth['sensor.studio_heater_power'] = truth['switch.studio_heater_plug']!
  // and a device's own sensors with the device: the keypad's tamper switch; the TV remote drives the TV
  truth['binary_sensor.keypad_tamper'] = truth['alarm_control_panel.home_alarm']!
  truth['remote.lounge_tv_remote'] = truth['media_player.lounge_tv']!
  truth['binary_sensor.studio_smoke_battery'] = truth['binary_sensor.studio_smoke']!
  // The lab turns its corner motion sensor (3π/4) so its lens half faces the south wall; from its
  // corner it should look out between the walls, into the studio.
  facing.item_binary_sensor_studio_motion = (-3 * Math.PI) / 4
  truth['binary_sensor.utility_washer_vibration'] = 'item_washer'
  truth['binary_sensor.utility_washer_running'] = 'item_washer'
  DECOYS.forEach(([name, position, rot, id], i) =>
    add({ id: id ?? `item_decoy_${i}`, type: 'item', name: '', parentId: 'level_lab', position, rotation: [0, rot, 0], asset: { name, category: 'furniture' } }))
  truth['light.lounge_sofa_lamp'] = 'item_lamp_sofa'
  truth['light.lounge_reading_lamp'] = 'item_lamp_shelf'
  nodes.level_lab = { ...level, children }

  const areaName = (entityId: string) => AREAS.find((a) => a.id === LAB_AREA_OF[entityId])?.name
  return { nodes, truth, facing, areaName }
}
