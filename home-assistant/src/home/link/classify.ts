import { normalize } from './words'

/* What a thing in a Pascal scene is, as far as Home Assistant cares: a lamp, a ceiling fan, an AC.
   Read from what the catalog calls it (its name, tags and category), then how it hangs and the
   controls the catalog gave it. Pascal keeps no fixed list of kinds, so this is a word table. */

export type DeviceKind =
  | 'light' | 'ceiling-fan' | 'fan' | 'purifier' | 'ac' | 'heater' | 'thermostat' | 'humidifier'
  | 'tv' | 'speaker' | 'blind' | 'curtain' | 'door' | 'window' | 'garage-door' | 'gate'
  | 'camera' | 'smoke-detector' | 'sensor' | 'siren' | 'keypad' | 'doorbell' | 'lock'
  | 'vacuum' | 'mower' | 'water-heater' | 'valve' | 'router' | 'plug'
  | 'washer' | 'dryer' | 'dishwasher' | 'fridge' | 'oven' | 'microwave' | 'coffee-machine'
  /** An item the visitor linked by hand that the word table reads as nothing. */
  | 'other'

/** How a thing hangs: it decides which way it faces. */
export type Mount = 'ceiling' | 'wall' | 'floor' | 'table'

/** Most telling first: "ceiling fan light" is a ceiling fan, "fan heater" a heater. */
const TABLE: [DeviceKind, RegExp][] = [
  ['ceiling-fan', /\b(ceiling fans?|fan lights?|ventilateurs? de plafond|ventilateurs? plafonniers?)\b/],
  ['garage-door', /\b(garage doors?|portes? de garage|porte garage)\b/],
  ['doorbell', /\b(doorbells?|door bells?|sonnettes?|interphones?|video ?phones?)\b/],
  ['smoke-detector', /\b(smoke|fumee|co detectors?|carbon monoxide|detecteurs? de (fumee|co))\b/],
  ['water-heater', /\b(water heaters?|boilers?|chauffe ?eau|ballons? d eau|cumulus|chaudieres?)\b/],
  ['purifier', /\b(air purifiers?|purifiers?|purificateurs?)\b/],
  ['humidifier', /\b(de ?humidifiers?|humidifiers?|de ?humidificateurs?|humidificateurs?)\b/],
  ['ac', /\b(air ?con\w*|ac( units?)?|split (units?|systems?|ac)|mini ?splits?|hvac|clim|climatiseurs?|climatisation|heat pumps?|pompes? a chaleur)\b/],
  ['heater', /\b(\w*heaters?|radiators?|radiateurs?|chauffages?|convectors?|convecteurs?|wood ?burners?|poeles?|fireplaces?|cheminees?)\b/],
  ['thermostat', /\b(thermostats?|ecobee|tado)\b/],
  ['fan', /\b(fans?|ventilateurs?|ventilos?)\b/],
  ['tv', /\b(tvs?|televisions?|televiseurs?|teles?|tele)\b/],
  ['speaker', /\b(speakers?|enceintes?|soundbars?|sound bars?|barres? de son|sonos|homepods?|echo|subwoofers?|hifi|hi fi|stereo|smart displays?|nest hub)\b/],
  ['camera', /\b(cameras?|cctv|webcams?)\b/],
  ['vacuum', /\b(robot vacuums?|vacuums?|aspirateurs?|roombas?)\b/],
  ['mower', /\b(mowers?|tondeuses?)\b/],
  ['washer', /\b(washing machines?|washers?|lave ?linges?)\b/],
  ['dryer', /\b(dryers?|seche ?linges?)\b/],
  ['dishwasher', /\b(dishwashers?|lave ?vaisselles?)\b/],
  ['fridge', /\b(fridges?|refrigerators?|freezers?|frigos?|refrigerateurs?|congelateurs?)\b/],
  ['microwave', /\b(microwaves?|micro ?ondes?)\b/],
  ['oven', /\b(ovens?|cooktops?|hobs?|range cookers?|cookers?|cuisinieres?)\b/],
  ['coffee-machine', /\b(coffee( machines?| makers?)?|espresso|cafetieres?|machines? a cafe)\b/],
  ['router', /\b(routers?|routeurs?|modems?|wi ?fi|access points?|mesh|box internet)\b/],
  ['siren', /\b(sirens?|sirenes?|alarm bells?)\b/],
  ['keypad', /\b(keypads?|alarm panels?|claviers?|centrales? d alarme)\b/],
  ['lock', /\b(locks?|serrures?|deadbolts?)\b/],
  ['valve', /\b(valves?|vannes?|robinets? d arret|stop ?cocks?)\b/],
  ['plug', /\b(smart plugs?|plugs?|outlets?|sockets?|prises?)\b/],
  ['blind', /\b(blinds?|shades?|shutters?|stores?|volets?|jalousies?|awnings?|stores? bannes?)\b/],
  ['curtain', /\b(curtains?|drapes?|draperies|rideaux?|voilages?)\b/],
  ['gate', /\b(gates?|portails?|portillons?)\b/],
  ['window', /\b(windows?|fenetres?|skylights?|velux|baies?)\b/],
  ['door', /\b(doors?|portes?)\b/],
  ['sensor', /\b(sensors?|capteurs?|detectors?|detecteurs?|motion|pir|thermometers?|hygrometers?)\b/],
  // last: "light" is in many names ("light grey sofa" is caught by the furniture words below)
  ['light', /\b(lamps?|lights?|lighting|luminaires?|lampes?|lampadaires?|suspensions?|appliques?|pendants?|chandeliers?|sconces?|spots?|spotlights?|downlights?|bulbs?|ampoules?|lustres?|plafonniers?|led strips?|ruban led|lanterns?|lanternes?)\b/],
]

/** Furniture that happens to carry a device word ("light grey sofa", "TV stand", "door mat"). */
const NOT_A_DEVICE = /\b(stands?|tables?|tv units?|cabinets?|meubles?|consoles?|mats?|tapis|frames?|cadres?|handles?|poignees?|benches?|shelf|shelves|etageres?|grey|gray|gris|weight|poids|sofa|canape|chairs?|chaises?|beds?|lits?|rug)\b/

/** What the catalog's category alone suggests, when its name says nothing. */
const CATEGORY: [DeviceKind, RegExp][] = [
  ['light', /\b(lighting|lights?|lamps?|luminaires?|eclairage)\b/],
  // Pascal's catalog files an Apple HomeView under "smart display"
  ['speaker', /\b(smart (displays?|speakers?)|speakers?|audio|hifi)\b/],
  ['tv', /\b(tvs?|televisions?)\b/],
  ['fan', /\b(fans?|ventilation)\b/],
  ['ac', /\b(hvac|climate|climatisation)\b/],
  ['door', /\bdoors?\b/],
  ['window', /\bwindows?\b/],
]

export type CatalogAsset = {
  name?: string
  category?: string
  tags?: string[]
  functionTags?: string[]
  attachTo?: 'ceiling' | 'wall' | 'wall-side'
  interactive?: { controls?: { kind: string }[]; effects?: { kind: string }[] }
}

/** The parts of a Pascal node the classifier reads. */
export type ClassifiedInput = { type: string; name?: string; asset?: CatalogAsset }

export type Classification = {
  kind: DeviceKind
  /** sure: its name or tags say so; likely: only its category, controls or shape do. */
  confidence: 'sure' | 'likely'
  /** In words, for the debug report: "name says ceiling fan". */
  why: string
}

const byTable = (text: string, table: [DeviceKind, RegExp][]) => table.find(([, re]) => re.test(text))?.[0]

/** A name's device kind by the word table, or none when the name says nothing or is furniture. */
export function kindFromWords(text: string): DeviceKind | undefined {
  const t = normalize(text)
  if (!t) return undefined
  const kind = byTable(t, TABLE)
  // "TV stand", "light grey sofa": furniture, unless the device word comes last ("sofa lamp")
  if (kind && NOT_A_DEVICE.test(t)) {
    const last = t.split(' ').at(-1) ?? ''
    if (byTable(last, TABLE) !== kind) return undefined
  }
  return kind
}

/** How a node hangs: from its catalog entry, its node type, or what it stands on. */
export function mountOf(node: ClassifiedInput, onItem = false): Mount {
  if (node.type === 'door' || node.type === 'window') return 'wall'
  const at = node.asset?.attachTo
  if (at === 'ceiling') return 'ceiling'
  if (at === 'wall' || at === 'wall-side') return 'wall'
  return onItem ? 'table' : 'floor'
}

/** The device kind of a Pascal node, or null for everything Home Assistant has no part in. */
export function classify(node: ClassifiedInput, onItem = false): Classification | null {
  if (node.type === 'door') return { kind: kindFromWords(node.name ?? '') === 'garage-door' ? 'garage-door' : 'door', confidence: 'sure', why: 'a Pascal door' }
  if (node.type === 'window') return { kind: 'window', confidence: 'sure', why: 'a Pascal window' }
  if (node.type !== 'item') return null
  const asset = node.asset ?? {}
  const mount = mountOf(node, onItem)
  const refine = (kind: DeviceKind): DeviceKind => (kind === 'fan' && mount === 'ceiling' ? 'ceiling-fan' : kind)

  // what it is called: the node's own name (a person may have renamed it), then the catalog's
  for (const [text, where] of [[node.name, 'its name'], [asset.name, 'its catalog name']] as const) {
    const kind = text ? kindFromWords(text) : undefined
    if (kind) return { kind: refine(kind), confidence: 'sure', why: `${where} "${text}"` }
  }
  const tags = [...(asset.tags ?? []), ...(asset.functionTags ?? [])].join(' ')
  const tagged = tags ? kindFromWords(tags) : undefined
  if (tagged) return { kind: refine(tagged), confidence: 'sure', why: `its tags "${tags}"` }

  const category = normalize(asset.category)
  const filed = category ? byTable(category, CATEGORY) : undefined
  if (filed) return { kind: refine(filed), confidence: 'likely', why: `its category "${asset.category}"` }

  // what it does in Pascal: a temperature control is a climate unit, a light effect a lamp
  const controls = asset.interactive?.controls?.map((c) => c.kind) ?? []
  const effects = asset.interactive?.effects?.map((e) => e.kind) ?? []
  if (controls.includes('temperature')) return { kind: mount === 'wall' ? 'ac' : 'heater', confidence: 'likely', why: 'it has a temperature control' }
  if (effects.includes('light')) return { kind: 'light', confidence: 'likely', why: 'it has a light effect' }
  return null
}
