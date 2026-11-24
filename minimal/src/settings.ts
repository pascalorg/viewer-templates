import { z } from 'zod/mini'
import { parseSettings } from './pascal'
import type { DrawingView } from './viewer/navigation'

/**
 * This template's viewer settings, saved per project by its managers (see listing's AGENTS.md,
 * Viewer settings): `{ v: 1, opening: { projection, turns, zoom, target } }`. The drawing has no
 * free camera, so its opening view is what navigation knows (`DrawingView`): the projection, the
 * corner as quarter turns from the first, the zoom against the fit, and the centre of the screen.
 * Anything else saved under `data` is kept as it is.
 */
const OpeningSchema = z.object({
  projection: z.enum(['axonometric', 'plan']),
  turns: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]),
  zoom: z.number().check(z.gte(0.3), z.lte(16)),
  target: z.optional(z.tuple([z.number(), z.number(), z.number()])),
})

const DrawingSettingsSchema = z.looseObject({
  v: z.literal(1),
  // A bad opening view opens on the default one.
  opening: z.catch(z.optional(OpeningSchema), undefined),
})
export type DrawingSettings = z.infer<typeof DrawingSettingsSchema>

export const DEFAULT_SETTINGS: DrawingSettings = { v: 1 }

export function parseDrawingSettings(data: unknown): DrawingSettings {
  return parseSettings(DrawingSettingsSchema, data, DEFAULT_SETTINGS)
}

export type { DrawingView }
