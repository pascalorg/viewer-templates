import { z } from 'zod/mini'
import { parseSettings } from '../pascal/settings'

/**
 * The immersive viewer's settings, saved per project by its managers (listing's AGENTS.md, Viewer
 * settings): `{ v: 1, tour: { order, skip, autostart }, opening: { camera, time, walls } }`.
 * The tour is the guided tour's route: the rooms' order on each floor, the rooms it skips, and
 * whether it starts by itself. The opening is how the page arrives. Pure: no viewer import, so it
 * is unit-tested in Node.
 *
 * Every field falls back on its own: a bad camera frames the house, an unknown time or wall mode is
 * the viewer's own. Anything else saved under `data` (another build's settings) is kept.
 */

export type Vec3 = [number, number, number]
export type CameraPose = { position: Vec3; target: Vec3 }

export const OPENING_TIMES = ['midday', 'golden', 'blue', 'night'] as const
export const OPENING_WALLS = ['up', 'cutaway', 'down'] as const

export type OpeningTime = (typeof OPENING_TIMES)[number]
export type OpeningWalls = (typeof OPENING_WALLS)[number]

/** What the viewer does with nothing saved: `useViewer`'s own starting values. */
export const VIEWER_DEFAULTS = { time: 'midday', walls: 'up' } as const satisfies {
  time: OpeningTime
  walls: OpeningWalls
}

export const TIME_LABELS: Record<OpeningTime, string> = {
  midday: 'Midday', golden: 'Golden hour', blue: 'Blue hour', night: 'Night',
}
export const WALL_LABELS: Record<OpeningWalls, string> = { up: 'Full height', cutaway: 'Cutaway', down: 'Low' }

const Vec3Schema = z.tuple([z.number(), z.number(), z.number()])
const CameraSchema = z.object({ position: Vec3Schema, target: Vec3Schema }).check(
  z.refine(({ position, target }) => Math.hypot(position[0] - target[0], position[1] - target[1], position[2] - target[2]) > 0.01,
    'The camera must not sit on its target'),
)

const OpeningSchema = z.object({
  camera: z.catch(z.optional(CameraSchema), undefined),
  time: z.catch(z.optional(z.enum(OPENING_TIMES)), undefined),
  walls: z.catch(z.optional(z.enum(OPENING_WALLS)), undefined),
})

const RoomIdsSchema = z.array(z.string())

const TourSchema = z.object({
  /** Room (zone) ids in tour order. Floors keep their order; this orders rooms within each floor. */
  order: z.catch(z.optional(RoomIdsSchema), undefined),
  /** Room ids the tour leaves out. */
  skip: z.catch(z.optional(RoomIdsSchema), undefined),
  autostart: z.catch(z.optional(z.boolean()), undefined),
})

const ImmersiveSettingsSchema = z.looseObject({
  v: z.literal(1),
  opening: z.catch(z.optional(OpeningSchema), undefined),
  tour: z.catch(z.optional(TourSchema), undefined),
})
export type ImmersiveSettings = z.infer<typeof ImmersiveSettingsSchema>
export type SavedOpening = NonNullable<ImmersiveSettings['opening']>
export type SavedTour = NonNullable<ImmersiveSettings['tour']>

export const DEFAULT_SETTINGS: ImmersiveSettings = { v: 1 }

export function parseImmersiveSettings(data: unknown): ImmersiveSettings {
  return parseSettings(ImmersiveSettingsSchema, data, DEFAULT_SETTINGS)
}

/** Drops fields set to undefined; an object with none left is removed (nothing saved). */
function patched<T extends object>(current: T | undefined, patch: Partial<T>): T | undefined {
  const next = Object.fromEntries(Object.entries({ ...current, ...patch }).filter(([, value]) => value !== undefined)) as T
  return Object.keys(next).length ? next : undefined
}

/** Changes the saved opening field by field: a field set to undefined goes back to the viewer's. */
export function withOpening(settings: ImmersiveSettings, patch: Partial<SavedOpening>): ImmersiveSettings {
  const { opening: _, ...rest } = settings
  const opening = patched(settings.opening, patch)
  return opening ? { ...rest, opening } : rest
}

/** Changes the saved tour options the same way. */
export function withTour(settings: ImmersiveSettings, patch: Partial<SavedTour>): ImmersiveSettings {
  const { tour: _, ...rest } = settings
  const tour = patched(settings.tour, patch)
  return tour ? { ...rest, tour } : rest
}

/** Millimetres are plenty, and keep the saved JSON short. */
export function roundPose({ position, target }: CameraPose): CameraPose {
  const round = (v: Vec3) => v.map((n) => Math.round(n * 1000) / 1000) as Vec3
  return { position: round(position), target: round(target) }
}

/** What the tour arranges: a floor and its rooms, in the viewer's own order. */
export type RouteFloor<Stop extends { zoneId: string }> = { levelId: string; stops: Stop[] }

/**
 * The tour's route with the saved order and skips applied. Floors stay lowest first; on each
 * floor, rooms in the saved order come first, in that order, and rooms the order does not name
 * (added since it was saved) follow in the viewer's order. Skipped rooms are left out, and a floor
 * with none left is too. With nothing saved, the route is the viewer's, unchanged.
 */
export function arrangeTour<Stop extends { zoneId: string }, Floor extends RouteFloor<Stop>>(
  floors: readonly Floor[],
  tour: SavedTour | undefined,
): Floor[] {
  const rank = new Map((tour?.order ?? []).map((id, index) => [id, index]))
  const skip = new Set(tour?.skip ?? [])
  const result: Floor[] = []
  for (const floor of floors) {
    const stops = floor.stops
      .map((stop, index) => ({ stop, index }))
      .sort((a, b) => (rank.get(a.stop.zoneId) ?? rank.size + a.index) - (rank.get(b.stop.zoneId) ?? rank.size + b.index))
      .map(({ stop }) => stop)
      .filter((stop) => !skip.has(stop.zoneId))
    if (stops.length) result.push({ ...floor, stops })
  }
  return result
}

/**
 * The whole route in saved order, skipped rooms included, as the Customize panel lists it: what
 * `order` becomes once a manager changes anything (the first save writes the full order).
 */
export function tourOrder<Stop extends { zoneId: string }, Floor extends RouteFloor<Stop>>(
  floors: readonly Floor[],
  tour: SavedTour | undefined,
): Floor[] {
  return arrangeTour(floors, tour ? { ...tour, skip: undefined } : undefined)
}

/** Moves a room one place up or down on its floor; the saved order is rewritten in full. */
export function moveRoom<Stop extends { zoneId: string }>(
  floors: readonly RouteFloor<Stop>[],
  tour: SavedTour | undefined,
  zoneId: string,
  step: -1 | 1,
): string[] {
  const ordered = tourOrder(floors, tour)
  return ordered.flatMap((floor) => {
    const ids = floor.stops.map((stop) => stop.zoneId)
    const from = ids.indexOf(zoneId)
    const to = from + step
    if (from >= 0 && to >= 0 && to < ids.length) [ids[from], ids[to]] = [ids[to]!, ids[from]!]
    return ids
  })
}

/** Turns a room on or off in the tour. */
export function toggleRoom(tour: SavedTour | undefined, zoneId: string, included: boolean): string[] | undefined {
  const skip = new Set(tour?.skip ?? [])
  if (included) skip.delete(zoneId)
  else skip.add(zoneId)
  return skip.size ? [...skip] : undefined
}
