import { z } from 'zod/mini'
import { parseSettings } from './pascal'

/**
 * This template's viewer settings, saved per project by its managers (see AGENTS.md, Viewer
 * settings): `{ v: 1, opening: { camera: { position, target } } }`. Anything else saved under
 * `data` (another build's settings) is kept as it is.
 */
const Vec3 = z.tuple([z.number(), z.number(), z.number()])

/** Where the camera opens: its position and the point it orbits, in metres. */
export const OpeningCameraSchema = z.object({ position: Vec3, target: Vec3 }).check(
  z.refine(({ position, target }) => Math.hypot(position[0] - target[0], position[1] - target[1], position[2] - target[2]) > 0.01,
    'The camera must not sit on its target'),
)
export type OpeningCamera = z.infer<typeof OpeningCameraSchema>

const ListingSettingsSchema = z.looseObject({
  v: z.literal(1),
  // Each part falls back on its own: a bad camera opens on the default view.
  opening: z.catch(z.optional(z.object({ camera: z.catch(z.optional(OpeningCameraSchema), undefined) })), undefined),
})
export type ListingSettings = z.infer<typeof ListingSettingsSchema>

export const DEFAULT_SETTINGS: ListingSettings = { v: 1 }

export function parseListingSettings(data: unknown): ListingSettings {
  return parseSettings(ListingSettingsSchema, data, DEFAULT_SETTINGS)
}

/** Millimetres are plenty, and keep the saved JSON short. */
export function roundPose({ position, target }: OpeningCamera): OpeningCamera {
  const round = (v: [number, number, number]) => v.map((n) => Math.round(n * 1000) / 1000) as [number, number, number]
  return { position: round(position), target: round(target) }
}
