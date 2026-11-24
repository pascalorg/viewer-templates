import { z } from 'zod/mini'
import { parseSettings } from '../pascal/settings'
import type { Vec3 } from './framing'
import { defaultView, type ModeId, type MoodId } from './modes'

/**
 * The showcase's viewer settings, saved per project by its managers (listing's AGENTS.md, Viewer
 * settings): `{ v: 1, opening: { camera: { position, target }, time, mode } }`, the view the page
 * settles into after its intro. Pure: no viewer import, so it is unit-tested in Node.
 *
 * Every field falls back on its own: a bad camera frames the house, an unknown time is Dusk, an
 * unknown mode (Walkthrough included: nobody arrives walking) is the default one. Anything else
 * saved under `data` (another build's settings) is kept as it is.
 */

const Vec3Schema = z.tuple([z.number(), z.number(), z.number()])
const CameraSchema = z.object({ position: Vec3Schema, target: Vec3Schema }).check(
  z.refine(({ position, target }) => Math.hypot(position[0] - target[0], position[1] - target[1], position[2] - target[2]) > 0.01,
    'The camera must not sit on its target'),
)

/** The modes a page may open in. */
export const OPENING_MODES = ['exterior', 'exploded', 'cut', 'xray'] as const satisfies readonly ModeId[]

const OpeningSchema = z.object({
  camera: z.catch(z.optional(CameraSchema), undefined),
  time: z.catch(z.optional(z.enum(['night', 'dawn', 'day', 'dusk'])), undefined),
  mode: z.catch(z.optional(z.enum(OPENING_MODES)), undefined),
})

const ShowcaseSettingsSchema = z.looseObject({
  v: z.literal(1),
  opening: z.catch(z.optional(OpeningSchema), undefined),
})
export type ShowcaseSettings = z.infer<typeof ShowcaseSettingsSchema>
export type SavedOpening = NonNullable<ShowcaseSettings['opening']>

export const DEFAULT_SETTINGS: ShowcaseSettings = { v: 1 }

export function parseShowcaseSettings(data: unknown): ShowcaseSettings {
  return parseSettings(ShowcaseSettingsSchema, data, DEFAULT_SETTINGS)
}

export type CameraPose = { position: Vec3; target: Vec3 }

/**
 * Changes the saved opening view field by field: a field set to undefined goes back to the
 * template's default, and an opening view with no field left is removed (nothing saved).
 */
export function withOpening(settings: ShowcaseSettings, patch: Partial<SavedOpening>): ShowcaseSettings {
  const opening = Object.fromEntries(Object.entries({ ...settings.opening, ...patch })
    .filter(([, value]) => value !== undefined)) as SavedOpening
  const { opening: _, ...rest } = settings
  return Object.keys(opening).length ? { ...rest, opening } : rest
}

/** The view a page settles into: always a mode and a mood; a camera, or null to frame the house. */
export type OpeningView = { mode: ModeId; mood: MoodId; camera: CameraPose | null }

/**
 * The saved opening view over the template's default (`defaultView`). A mode this page does not
 * offer (Cut view or X-ray switched off, X-ray with one family) is the default one.
 */
export function resolveOpening(saved: SavedOpening | undefined, levelCount: number, offered: readonly ModeId[]): OpeningView {
  const initial = defaultView(levelCount)
  const mode = saved?.mode && offered.includes(saved.mode) ? saved.mode : initial.mode
  return { mode, mood: saved?.time ?? initial.mood, camera: saved?.camera ?? null }
}

/** The heading a camera looks from, as `fitPoints` measures it: atan2(x, z) from its target. */
export function cameraAzimuth({ position, target }: CameraPose): number {
  return Math.atan2(position[0] - target[0], position[2] - target[2])
}

/** Millimetres are plenty, and keep the saved JSON short. */
export function roundPose({ position, target }: CameraPose): CameraPose {
  const round = (v: Vec3) => v.map((n) => Math.round(n * 1000) / 1000) as Vec3
  return { position: round(position), target: round(target) }
}
