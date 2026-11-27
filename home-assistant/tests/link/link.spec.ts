import { expect, test } from '@playwright/test'
import { classify } from '../../src/home/link/classify'
import { entityInfos, linkHome, pairAreas } from '../../src/home/link/match'
import { formatReport } from '../../src/home/link/report'
import { readThings } from '../../src/home/link/scene'
import { roomLikeness } from '../../src/home/link/words'
import { LAB_ENTITIES } from './labHome'
import { EXTRA_ENTITIES, labPlan } from './labPlan'

/* Linking Home Assistant to a Pascal plan, scored on the lab's home drawn as catalog items. No
   browser: `npm run test:link`. The report it prints is the debugging view. */

const deg = (r: number) => Math.round(((((r * 180) / Math.PI) % 360) + 540) % 360 - 180)

test('the lab home links every device to its thing, and nothing to a wrong one', () => {
  const { nodes, truth, facing, areaName } = labPlan()
  const { things, rooms } = readThings(nodes)
  const entities = [...entityInfos(LAB_ENTITIES, areaName), ...EXTRA_ENTITIES]
  const report = linkHome(things, entities, rooms)
  console.log(formatReport(report, things))

  const score = { right: 0, asked: 0, wrong: [] as string[], missed: [] as string[] }
  for (const l of report.links) {
    const want = truth[l.entityId] ?? null
    if (l.thingId) {
      if (l.thingId === want) score.right++
      else score.wrong.push(`${l.entityId} → ${l.thingId}, should be ${want ?? 'nothing'}`)
    } else if (want) {
      if (l.status === 'ask' && l.candidates.some((c) => c.thingId === want)) score.asked++
      else score.missed.push(`${l.entityId}: ${l.status}, should be ${want}`)
    }
  }
  console.log(`\nscore: ${score.right} right, ${score.asked} to ask, ${score.wrong.length} wrong, ${score.missed.length} missed`)
  for (const s of [...score.wrong, ...score.missed]) console.log(`  ${s}`)
  expect(score.wrong).toEqual([])
  expect(score.missed).toEqual([])

  // every thing that faces somewhere faces as the lab device does
  const off = things
    .filter((t) => t.facing !== null && facing[t.id] !== undefined && t.mount !== 'ceiling')
    .filter((t) => Math.abs(deg(t.facing! - facing[t.id]!)) > 1)
    .map((t) => `${t.label}: ${deg(t.facing!)}° by ${t.facingFrom}, should be ${deg(facing[t.id]!)}°`)
  expect(off).toEqual([])
})

test('a device in no area is never placed by itself, and a climate unit never takes a fan', () => {
  const { nodes, areaName } = labPlan()
  const { things, rooms } = readThings(nodes)
  const lab = entityInfos(LAB_ENTITIES, areaName)
  // the lab's own AC with no area, and a second climate unit in a room that has no AC left
  const loose = lab.map((e) => (e.entity_id === 'climate.lounge_ac' ? { entity_id: e.entity_id, name: e.name } : e))
  const report = linkHome(things, [...loose, { entity_id: 'climate.thermostat', name: 'Thermostat' }], rooms)
  const ac = report.links.find((l) => l.entityId === 'climate.lounge_ac')!
  expect(ac.thingId).toBeUndefined()
  expect(ac.status).toBe('unplaced')
  const other = report.links.find((l) => l.entityId === 'climate.thermostat')!
  const kindOf = (id?: string) => things.find((t) => t.id === id)?.kind
  expect(other.thingId).toBeUndefined()
  expect(other.candidates.map((c) => kindOf(c.thingId))).not.toContain('fan')
})

test('names read as device kinds, and furniture does not', () => {
  const kind = (name: string, attachTo?: 'ceiling' | 'wall') => classify({ type: 'item', asset: { name, ...(attachTo ? { attachTo } : {}) } })?.kind ?? null
  expect(kind('Fan', 'ceiling')).toBe('ceiling-fan')
  expect(kind('Ceiling fan with light')).toBe('ceiling-fan')
  expect(kind('Box fan')).toBe('fan')
  expect(kind('Climatiseur mural')).toBe('ac')
  expect(kind('AC unit')).toBe('ac')
  expect(kind('Lampe de chevet')).toBe('light')
  expect(kind('Sofa lamp')).toBe('light')
  expect(kind('TV stand')).toBe(null)
  expect(kind('Light grey sofa')).toBe(null)
  expect(kind('Door mat')).toBe(null)
  expect(kind('Climbing plant')).toBe(null)
  expect(kind('Four-poster bed')).toBe(null)
  expect(kind('Fan heater')).toBe('heater')
  // from Pascal's own catalog (the Wawa House)
  expect(classify({ type: 'item', asset: { name: 'Apple HomeView — Silver', category: 'smart display' } })?.kind).toBe('speaker')
  expect(kind('Television')).toBe('tv')
  expect(kind('Thermostat', 'wall')).toBe('thermostat')
  expect(kind('Semi-automatic espresso machine')).toBe('coffee-machine')
  expect(kind('TV Stand')).toBe(null)
})

test('room names pair across words and languages', () => {
  expect(roomLikeness('Living room', 'Salon')).toBeGreaterThan(0.8)
  expect(roomLikeness('Chambre 2', 'Bedroom 2')).toBeGreaterThan(0.8)
  expect(roomLikeness('Bedroom 1', 'Bedroom 2')).toBe(0)
  expect(roomLikeness('Kitchen', 'Garage')).toBe(0)
  // "room" alone tells no room apart
  expect(roomLikeness('Room', 'Living Room')).toBe(0)
  expect(roomLikeness('Kitchen', 'Kitchen / Office')).toBeGreaterThan(0.7)
})

test('an area as alike two rooms is asked, not guessed', () => {
  const rooms = [{ id: 'z1', name: 'Bedroom 1' }, { id: 'z2', name: 'Bedroom 2' }, { id: 'z3', name: 'Kitchen / Office' }]
  const [bedroom, kitchen, guest, garage] = pairAreas(['Bedroom', 'Kitchen', 'Guest room', 'Garage'], rooms)
  expect(bedroom).toMatchObject({ room: null, how: 'unsure' })
  expect(bedroom!.choices.map((r) => r.id)).toEqual(['z1', 'z2'])
  expect(kitchen).toMatchObject({ room: { id: 'z3' }, how: 'name' })
  // a guest room is a bedroom too: which one?
  expect(guest).toMatchObject({ room: null, how: 'unsure' })
  expect(garage).toMatchObject({ room: null, how: 'none' })
  // once the visitor says which, it is that room, and the other bedroom stays free
  const [answered, second] = pairAreas(['Bedroom', 'Bedroom 2'], rooms, { Bedroom: 'z1' })
  expect(answered).toMatchObject({ room: { id: 'z1' }, how: 'you' })
  expect(second).toMatchObject({ room: { id: 'z2' }, how: 'name' })
})
