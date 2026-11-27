import { type Anchor, domainOf, type HassEntities } from '../entities'
import { type DeviceKind, kindFromWords } from './classify'
import type { Room, Thing } from './scene'
import { normalize, roomLikeness, telling, words } from './words'

/* Which Home Assistant entity drives which thing in the Pascal scene. Home Assistant's areas are
   paired with Pascal's rooms by name, then each entity with the things of a kind it can drive in
   its room. Where one entity and one thing are left in a room it is certain; where several are,
   the words of their names and of what stands near each thing rank them, and a person settles the
   rest (the viewer's job, later: blink the light, click the lamp that blinked). */

/** An entity as the linking needs it: what Home Assistant calls it and the area it is in. */
export type EntityInfo = { entity_id: string; name: string; area?: string; device_class?: string }

/** What an entity is on the plan: a thing of these kinds, something of its room, or of the home. */
type Wants = { place: 'thing'; kinds: DeviceKind[]; also?: DeviceKind[]; named?: boolean } | { place: 'room' } | { place: 'home' }

const ROOM_SENSORS = new Set(['temperature', 'humidity', 'carbon_dioxide', 'co2', 'pm25', 'pm10', 'volatile_organic_compounds', 'illuminance', 'sound_pressure', 'pressure', 'aqi', 'nitrogen_dioxide'])

/** The kinds of thing an entity can drive, by its domain, its device class and its name. */
export function wantsOf(e: EntityInfo): Wants {
  const dc = e.device_class ?? ''
  const named = kindFromWords(`${e.name} ${e.entity_id.split('.')[1]?.replace(/_/g, ' ')}`)
  const pick = (kinds: DeviceKind[], also: DeviceKind[] = []): Wants => {
    // the name picks among what the domain allows: "Lounge floor fan" is a fan, not a ceiling fan
    const first = named && [...kinds, ...also].includes(named) ? [named] : []
    return { place: 'thing', kinds: [...first, ...kinds.filter((k) => k !== named)], also: also.filter((k) => k !== named), named: first.length > 0 }
  }
  switch (domainOf(e.entity_id)) {
    // a light goes on a fan only when it is the fan's own ("Ceiling fan light"), never for want of a lamp
    case 'light': return /\bfans?\b|ventilateur/.test(words(`${e.name} ${e.entity_id.replace(/[._]/g, ' ')}`).join(' ')) ? pick(['ceiling-fan', 'fan', 'light']) : pick(['light'])
    // never a fan for want of an AC: a fan drawn in the plan is the fan's, not a climate unit's
    case 'climate': return pick(['ac', 'heater', 'thermostat'])
    case 'fan': return pick(['fan', 'ceiling-fan', 'purifier'])
    case 'humidifier': return pick(['humidifier', 'purifier'])
    case 'media_player':
      return dc === 'tv' ? pick(['tv']) : dc === 'speaker' || dc === 'receiver' ? pick(['speaker'], ['tv']) : pick(['tv', 'speaker'])
    case 'assist_satellite': return pick(['speaker'])
    case 'cover':
      // a garage door is often drawn as a plain door in the garage
      if (dc === 'garage') return pick(['garage-door'], ['door'])
      if (dc === 'gate') return pick(['gate'])
      if (dc === 'door') return pick(['door', 'garage-door'])
      if (dc === 'window') return pick(['window'])
      if (dc === 'curtain') return pick(['curtain'], ['blind'])
      if (['blind', 'shade', 'shutter', 'awning'].includes(dc)) return pick(['blind'], ['curtain', 'window'])
      return pick(['blind', 'curtain', 'garage-door', 'gate', 'window', 'door'])
    case 'lock': return pick(['door', 'garage-door', 'gate', 'lock'])
    case 'binary_sensor':
      if (dc === 'door') return pick(['door'], ['garage-door', 'gate'])
      if (dc === 'garage_door') return pick(['garage-door'])
      if (dc === 'window') return pick(['window'])
      if (dc === 'opening') return pick(['door', 'window', 'garage-door', 'gate'])
      if (['smoke', 'gas', 'carbon_monoxide', 'heat'].includes(dc)) return pick(['smoke-detector'], ['sensor'])
      if (dc === 'connectivity') return named === 'router' ? pick(['router']) : { place: 'home' }
      return named ? pick([named]) : { place: 'room' }
    case 'sensor':
      if (ROOM_SENSORS.has(dc)) return { place: 'room' }
      return named && named !== 'sensor' ? pick([named]) : { place: 'room' }
    case 'camera': return pick(['camera'], ['doorbell'])
    case 'vacuum': return pick(['vacuum'])
    case 'lawn_mower': return pick(['mower'])
    case 'water_heater': return pick(['water-heater'])
    case 'valve': return pick(['valve'])
    case 'siren': return pick(['siren'], ['keypad', 'smoke-detector'])
    case 'alarm_control_panel': return pick(['keypad'])
    case 'event': return named === 'doorbell' || dc === 'doorbell' ? pick(['doorbell']) : { place: 'home' }
    case 'switch': return named ? pick([named], ['plug']) : pick(['plug'])
    case 'remote':
    case 'infrared': return named === 'tv' ? pick(['tv']) : { place: 'room' }
    default: return { place: 'home' }
  }
}

/** One thing an entity could drive, scored, and why. */
export type Candidate = { thingId: string; score: number; why: string[] }

/**
 * sure: the only one of its kind left in its room. likely: the best by its words, clearly.
 * ask: several fit equally; a person picks. room: it belongs to its room, not a thing (a
 * thermometer). home: it belongs to no place (a person, the weather). missing: nothing in the plan
 * can be it (a lamp nobody drew). unplaced: in no area in Home Assistant, so it is never placed by
 * itself, even where only one thing in the house could be it; it waits for an area, or a person
 * links it by hand.
 */
export type LinkStatus = 'sure' | 'likely' | 'ask' | 'room' | 'home' | 'missing' | 'unplaced'

export type Link = {
  entityId: string
  status: LinkStatus
  /** The thing it drives, for sure and likely. */
  thingId?: string
  /** Its room, when Home Assistant's area pairs with one. */
  roomId?: string
  /** Best first. */
  candidates: Candidate[]
  why: string
}

/**
 * How a Home Assistant area found its Pascal room. name: by its name. you: the visitor said.
 * unsure: as alike two or more rooms ("Bedroom" against "Bedroom 1" and "Bedroom 2"), so not
 * guessed: `choices` are those rooms. none: like no room ("Guest room"); `choices` is every room.
 */
export type AreaPairing = { area: string; room: Room | null; likeness: number; how: 'name' | 'you' | 'unsure' | 'none'; choices: Room[] }

export type LinkReport = {
  areas: AreaPairing[]
  links: Link[]
  /** Device-like things no entity drives: a lamp Home Assistant does not know. */
  unused: string[]
}

/** How much more alike the best room must be than the next, for an area to take it unasked. */
const AREA_LEAD = 0.05

/**
 * Each Home Assistant area with its Pascal room: the visitor's answers first, then by name, the
 * most alike pairs first, one room per area. An area as alike two free rooms is left unpaired.
 * @param chosen the visitor's answers: area name → room id, or null for "none of these"
 */
export function pairAreas(areas: string[], rooms: Room[], chosen: Record<string, string | null> = {}): AreaPairing[] {
  const taken = new Set<string>()
  const done = new Map<string, AreaPairing>()
  for (const area of areas) {
    if (!(area in chosen)) continue
    const room = rooms.find((r) => r.id === chosen[area]) ?? null
    done.set(area, { area, room, likeness: room ? 1 : 0, how: 'you', choices: [] })
    if (room) taken.add(room.id)
  }
  const ranked = (area: string, among: Room[]) =>
    among.map((room) => ({ room, likeness: roomLikeness(area, room.name) })).filter((r) => r.likeness >= 0.55).sort((a, b) => b.likeness - a.likeness)
  // the clearest pair first; each one taken can settle the next
  for (let settled = true; settled; ) {
    settled = false
    const best = areas
      .filter((area) => !done.has(area))
      .map((area) => ({ area, ranked: ranked(area, rooms.filter((r) => !taken.has(r.id))) }))
      .filter(({ ranked: r }) => r[0] && (!r[1] || r[0].likeness - r[1].likeness >= AREA_LEAD))
      .sort((a, b) => b.ranked[0]!.likeness - a.ranked[0]!.likeness)[0]
    if (!best) break
    const { room, likeness } = best.ranked[0]!
    done.set(best.area, { area: best.area, room, likeness, how: 'name', choices: [] })
    taken.add(room.id)
    settled = true
  }
  return areas.map((area) => {
    const pairing = done.get(area)
    if (pairing) return pairing
    const alike = ranked(area, rooms).map((r) => r.room)
    return alike.length ? { area, room: null, likeness: 0, how: 'unsure', choices: alike } : { area, room: null, likeness: 0, how: 'none', choices: rooms }
  })
}

/** Names of a way in from outside. */
const OUTSIDE_WORDS = /\b(front|back|main|entry|entrance|exterior|outside|garden|patio|porch|yard|entree|principale|jardin|terrasse)\b/

/** How far ahead the best candidate must be, on its words, to be taken without asking. */
const CLEAR_LEAD = 0.5

/**
 * @param chosenAreas the visitor's answers to which room an area is (see `pairAreas`)
 */
export function linkHome(things: Thing[], entities: EntityInfo[], rooms: Room[], chosenAreas: Record<string, string | null> = {}): LinkReport {
  const areas = pairAreas([...new Set(entities.flatMap((e) => (e.area ? [e.area] : [])))], rooms, chosenAreas)
  const roomOfArea = new Map(areas.map((a) => [a.area, a.room]))
  const pairingOf = new Map(areas.map((a) => [a.area, a]))
  const links = new Map<string, Link>()
  // waiting: its area could be several rooms, so nothing is linked until the visitor says which
  const open: { e: EntityInfo; roomId?: string; candidates: Candidate[]; waiting?: string }[] = []

  for (const e of entities) {
    const room = e.area ? roomOfArea.get(e.area) : undefined
    const wants = wantsOf(e)
    const base = { entityId: e.entity_id, ...(room ? { roomId: room.id } : {}), candidates: [] }
    if (wants.place !== 'thing') {
      links.set(e.entity_id, { ...base, status: wants.place, why: wants.place === 'room' ? 'reads its room, no thing of its own' : 'not a thing in a room' })
      continue
    }
    const nameWords = telling(e.name).filter((w) => !(room && words(room.name).includes(w)) && !(e.area && words(e.area).includes(w)))
    // the things of a kind it can drive, in its room (an area with no room keeps every room open)
    // an area that could be several rooms looks in those rooms only; an area like no room is
    // outside (a garden), so it looks at what is in no room
    const pairing = e.area ? pairingOf.get(e.area) : undefined
    const inPlace = (t: Thing) =>
      room ? t.rooms.some((r) => r.id === room.id)
        : pairing?.how === 'unsure' ? t.rooms.some((r) => pairing.choices.some((c) => c.id === r.id))
        : pairing?.how === 'none' ? !t.rooms.length
        : true
    const fit = things.filter((t) => (wants.kinds.includes(t.kind) || wants.also?.includes(t.kind)) && inPlace(t))
    const ownWords = new Map(fit.map((t) => [t.id, new Set(telling(t.label))]))
    // a word on several of them tells less: "lamp" on two lamps counts half on each
    const spread = (w: string) => fit.filter((t) => ownWords.get(t.id)!.has(w) || t.near.includes(w)).length || 1
    const candidates: Candidate[] = []
    for (const t of fit) {
      const rank = wants.kinds.indexOf(t.kind)
      const why: string[] = []
      // its name says what it is ("Ecobee" is a thermostat): the domain's other kinds count for less
      let score = rank === 0 ? 1 : rank > 0 ? (wants.named ? 0.4 : 0.8) : 0.3
      why.push(rank === 0 ? `a ${t.kind}` : `a ${t.kind}, which it can be`)
      if (t.confidence === 'likely') score -= 0.1
      if (room) {
        score += 1
        why.push(`in ${room.name}`)
      }
      // "front door", "back gate": the ones with a room on one side only lead outside
      if (OUTSIDE_WORDS.test(normalize(e.name)) && (t.type === 'door' || t.type === 'window') && t.rooms.length === 1) {
        score += 0.6
        why.push('leads outside')
      }
      const own = ownWords.get(t.id)!
      const byName = nameWords.filter((w) => own.has(w))
      const byNear = nameWords.filter((w) => !own.has(w) && t.near.includes(w))
      if (byName.length) {
        score += byName.reduce((s, w) => s + 0.6 / spread(w), 0)
        why.push(`named "${byName.join(' ')}" too`)
      }
      if (byNear.length) {
        score += byNear.reduce((s, w) => s + 0.5 / spread(w), 0)
        why.push(`near a ${byNear.join(', ')}`)
      }
      candidates.push({ thingId: t.id, score: Math.round(score * 100) / 100, why })
    }
    candidates.sort((a, b) => b.score - a.score)
    open.push({ e, ...(room ? { roomId: room.id } : {}), candidates, ...(pairing?.how === 'unsure' ? { waiting: pairing.area } : {}) })
  }

  // A thing takes one entity per domain, and per class for sensors: a ceiling fan its fan and its
  // light, a door its lock and its contact sensor, a smoke alarm its smoke and battery sensors, but
  // never two lights.
  const classOf = new Map(entities.map((e) => [e.entity_id, e.device_class ?? '']))
  const slot = (thingId: string, entityId: string) => {
    const domain = domainOf(entityId)
    return `${thingId}|${domain}${domain.endsWith('sensor') ? `|${classOf.get(entityId)}` : ''}`
  }
  const held = new Set<string>()
  const settle = (o: (typeof open)[number], status: 'sure' | 'likely', c: Candidate, why: string) => {
    links.set(o.e.entity_id, { entityId: o.e.entity_id, status, thingId: c.thingId, ...(o.roomId ? { roomId: o.roomId } : {}), candidates: o.candidates, why })
    held.add(slot(c.thingId, o.e.entity_id))
  }
  const free = (o: (typeof open)[number]) => o.candidates.filter((c) => !held.has(slot(c.thingId, o.e.entity_id)))
  const pending = () => open.filter((o) => !links.has(o.e.entity_id) && !o.waiting)
  // what is placed by itself: only an entity Home Assistant puts in an area. One in no area could be
  // anything anywhere (a demo's whole house of devices), so it never takes a thing by elimination
  const placeable = () => pending().filter((o) => o.e.area)

  // sure, again and again: an entity with one thing left that no other entity can take; each one
  // settled can leave the next with one
  for (let changed = true; changed; ) {
    changed = false
    for (const o of placeable()) {
      const left = free(o)
      if (left.length !== 1 || !o.roomId) continue
      const c = left[0]!
      const rivals = placeable().filter((p) => p !== o && (!!p.roomId || !o.roomId) && free(p).some((d) => slot(d.thingId, p.e.entity_id) === slot(c.thingId, o.e.entity_id)))
      if (rivals.length) continue
      settle(o, 'sure', c, 'the only one of its kind in its room')
      changed = true
    }
  }

  // likely: ahead of the rest by its words, and the best for that thing too
  for (let changed = true; changed; ) {
    changed = false
    for (const o of placeable()) {
      const [best, next] = free(o)
      if (!best || (next && best.score - next.score < CLEAR_LEAD)) continue
      const rivals = placeable().filter((p) => p !== o && (!!p.roomId || !o.roomId) && free(p).some((d) => slot(d.thingId, p.e.entity_id) === slot(best.thingId, o.e.entity_id) && d.score >= best.score))
      if (rivals.length) continue
      settle(o, 'likely', best, next ? `clearly ahead: ${best.why.join(', ')}` :'the only one of its kind it could be')
      changed = true
    }
  }

  for (const o of pending()) {
    const left = free(o)
    // a sensor with no thing drawn for it still reads its room
    if (!o.candidates.length && wantsOf(o.e).place === 'thing' && (wantsOf(o.e) as { kinds: DeviceKind[] }).kinds.every((k) => k === 'sensor')) {
      links.set(o.e.entity_id, { entityId: o.e.entity_id, status: 'room', ...(o.roomId ? { roomId: o.roomId } : {}), candidates: [], why: 'a sensor not drawn in the plan: reads its room' })
      continue
    }
    // with no room, "which one?" would range over the whole house: it waits for a room instead
    const status: LinkStatus = !left.length ? 'missing' : o.roomId ? 'ask' : 'unplaced'
    links.set(o.e.entity_id, {
      entityId: o.e.entity_id, status, ...(o.roomId ? { roomId: o.roomId } : {}), candidates: left,
      why: status === 'unplaced' ? 'in no room Home Assistant knows of: give it an area'
        : left.length ? `${left.length} could be it` : o.candidates.length ? 'what it could be is taken' : 'nothing of its kind in its room',
    })
  }
  for (const o of open) {
    if (!o.waiting) continue
    links.set(o.e.entity_id, { entityId: o.e.entity_id, status: 'unplaced', candidates: o.candidates, why: `waiting for which room "${o.waiting}" is` })
  }

  const linked = new Set([...links.values()].flatMap((l) => (l.thingId ? [l.thingId] : [])))
  return { areas, links: entities.map((e) => links.get(e.entity_id)!), unused: things.filter((t) => !linked.has(t.id)).map((t) => t.id) }
}

/** Entities as Home Assistant hands them over, with each one's area name. */
export function entityInfos(entities: HassEntities, areaOf: (entityId: string) => string | undefined): EntityInfo[] {
  return Object.values(entities).map((e) => {
    const area = areaOf(e.entity_id)
    const dc = e.attributes.device_class
    return { entity_id: e.entity_id, name: e.attributes.friendly_name ?? e.entity_id, ...(area ? { area } : {}), ...(dc ? { device_class: dc } : {}) }
  })
}

/** The effect anchor of a linked thing: where its effect is drawn from, and which way it faces. */
export function anchorOf(t: Thing, area: string): Anchor {
  return {
    position: t.position, rotationY: t.facing ?? 0, mount: t.mount, area,
    // the anchor's size is deep (the way it faces), tall, then across
    ...(t.size ? { size: [t.size[2], t.size[1], t.size[0]] } : {}),
  }
}
