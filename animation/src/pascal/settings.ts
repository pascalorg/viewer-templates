import { z } from 'zod/mini'
import { ErrorBodySchema, type ViewerSettings, ViewerSettingsSchema } from './contract'

/**
 * Viewer settings: how this viewer presents one project, saved by the project's managers from a
 * configure session. The read comes with the scene (`SceneResponse.settings`); this file writes.
 */

/** The server refuses a body over 256 KB; the client checks first and never sends it. */
export const SETTINGS_MAX_BYTES = 262_144

export type ViewerSettingsErrorCode =
  /** Someone saved since this revision was read; `current` is what the server holds now. */
  | 'conflict'
  /** The configure credential is missing, expired or no longer allowed (a demoted manager). */
  | 'unauthorized'
  /** The settings are over 256 KB. */
  | 'too_large'
  /** The request never got an answer (offline, DNS, CORS). */
  | 'network'
  /** 400: not a JSON object, or nested deeper than 32 levels. */
  | 'invalid_request'
  /** 403: this page's origin is not one the viewer registered. */
  | 'origin_not_allowed'
  /** 429: more than 30 saves a minute from this address. */
  | 'rate_limited'
  /** The answer does not match the contract this client understands. */
  | 'invalid_response'
  /** Any other non-OK answer. */
  | 'http'

export class ViewerSettingsError extends Error {
  readonly code: ViewerSettingsErrorCode
  readonly status: number | null
  /** On `conflict`: the settings the server holds now. */
  readonly current: ViewerSettings | null

  constructor(code: ViewerSettingsErrorCode, message: string, status: number | null = null, current: ViewerSettings | null = null) {
    super(message)
    this.name = 'ViewerSettingsError'
    this.code = code
    this.status = status
    this.current = current
  }
}

export type SaveSettingsOptions = {
  /** The configure credential (`pvh_…`) from the handoff. Never an API key. */
  token: string
  /** The revision this change is based on: the one last read (0 before the first save). */
  revision: number
  /** The template's whole settings object; it replaces what is saved. */
  data: Record<string, unknown>
  signal?: AbortSignal
  fetch?: typeof fetch
}

const SavedBodySchema = z.object({ settings: ViewerSettingsSchema })

/**
 * Saves this viewer's settings for a project and returns them with their new revision. Visitors
 * get them on their next read. Throws `ViewerSettingsError`; a `conflict` carries the current ones.
 */
export async function saveSettings(
  baseUrl: string,
  projectId: string,
  { token, revision, data, signal, fetch: fetchImpl = fetch }: SaveSettingsOptions,
): Promise<ViewerSettings> {
  const body = JSON.stringify({ revision, data })
  if (new TextEncoder().encode(body).byteLength > SETTINGS_MAX_BYTES) {
    throw new ViewerSettingsError('too_large', 'Viewer settings are limited to 256 KB')
  }
  const url = `${baseUrl.replace(/\/+$/, '')}/api/projects/${encodeURIComponent(projectId)}/viewer-settings`
  let response: Response
  try {
    response = await fetchImpl(url, {
      method: 'PUT',
      signal,
      credentials: 'omit',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body,
    })
  } catch (error) {
    if (signal?.aborted) throw error
    throw new ViewerSettingsError('network', `Could not reach ${baseUrl}`)
  }
  const answer: unknown = await response.json().catch(() => null)
  if (response.ok) {
    const parsed = SavedBodySchema.safeParse(answer)
    if (!parsed.success) throw new ViewerSettingsError('invalid_response', 'Unexpected response', response.status)
    return parsed.data.settings
  }
  if (response.status === 409) {
    const current = SavedBodySchema.safeParse(answer)
    if (current.success) throw new ViewerSettingsError('conflict', 'Someone else saved changes', 409, current.data.settings)
    throw new ViewerSettingsError('invalid_response', 'Unexpected conflict response', 409)
  }
  if (response.status === 401) throw new ViewerSettingsError('unauthorized', 'The credential was rejected', 401)
  if (response.status === 413) throw new ViewerSettingsError('too_large', 'Viewer settings are limited to 256 KB', 413)
  const code = ErrorBodySchema.safeParse(answer).data?.error
  if (response.status === 403 && code === 'origin_not_allowed') {
    throw new ViewerSettingsError('origin_not_allowed', 'This origin may not save settings', 403)
  }
  if (response.status === 403) throw new ViewerSettingsError('unauthorized', 'The credential was rejected', 403)
  if (response.status === 429) throw new ViewerSettingsError('rate_limited', 'Too many saves; try again in a minute', 429)
  if (response.status === 400) throw new ViewerSettingsError('invalid_request', 'Pascal refused these settings', 400)
  throw new ViewerSettingsError('http', `Pascal answered ${response.status}`, response.status)
}

/** Anything with zod's `safeParse`: a template's schema for its own `data`. */
export type SettingsSchema<T> = { safeParse(value: unknown): { success: true; data: T } | { success: false } }

/**
 * Reads a template's settings from saved `data`: the parsed value, or `defaults` when there is none
 * or it does not match (another template's or an older shape). Give fields their own
 * `z.catch(…, default)` in the schema to fall back field by field instead of all at once, and keep
 * the top level a `z.looseObject` so keys a newer build added survive a save from this one.
 */
export function parseSettings<T>(schema: SettingsSchema<T>, data: unknown, defaults: T): T {
  if (data === null || data === undefined) return defaults
  const parsed = schema.safeParse(data)
  return parsed.success ? parsed.data : defaults
}
