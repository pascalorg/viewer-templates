import { expect, test } from '@playwright/test'
import { z } from 'zod/mini'
import { SceneResponseSchema } from '../../src/pascal/contract'
import { parseSettings, saveSettings, SETTINGS_MAX_BYTES, ViewerSettingsError } from '../../src/pascal/settings'
import { sceneBody } from '../pascal-mocks'

const token = `pvh_${'t'.repeat(43)}`
const saved = { viewerId: 'viewer_fixture', revision: 4, data: { v: 1 }, canConfigure: true }

/** A fetch that answers once and records what it was asked. */
function answer(status: number, body: unknown) {
  const calls: { url: string; init: RequestInit }[] = []
  const fetch = (async (url: string, init: RequestInit) => {
    calls.push({ url, init })
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
  }) as unknown as typeof globalThis.fetch
  return { fetch, calls }
}

async function failure(promise: Promise<unknown>): Promise<ViewerSettingsError> {
  const error = await promise.then(() => null, (reason: unknown) => reason)
  expect(error).toBeInstanceOf(ViewerSettingsError)
  return error as ViewerSettingsError
}

test('saves with the configure credential, the read revision and no cookies, and returns the new settings', async () => {
  const { fetch, calls } = answer(200, { settings: saved })
  const result = await saveSettings('https://editor.pascal.app/', 'project 1', { token, revision: 3, data: { v: 1 }, fetch })
  expect(result).toEqual(saved)
  expect(calls).toHaveLength(1)
  expect(calls[0]!.url).toBe('https://editor.pascal.app/api/projects/project%201/viewer-settings')
  expect(calls[0]!.init.method).toBe('PUT')
  expect(calls[0]!.init.credentials).toBe('omit')
  expect(calls[0]!.init.headers).toMatchObject({ Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' })
  expect(JSON.parse(calls[0]!.init.body as string)).toEqual({ revision: 3, data: { v: 1 } })
})

test('a conflict carries the settings the server holds now', async () => {
  const { fetch } = answer(409, { error: 'conflict', settings: saved })
  const error = await failure(saveSettings('https://editor.pascal.app', 'p', { token, revision: 3, data: {}, fetch }))
  expect(error.code).toBe('conflict')
  expect(error.current).toEqual(saved)
  const unreadable = await failure(saveSettings('https://editor.pascal.app', 'p', { token, revision: 3, data: {}, fetch: answer(409, { error: 'conflict' }).fetch }))
  expect(unreadable.code).toBe('invalid_response')
})

for (const [status, body, code] of [
  [401, { error: 'unauthorized' }, 'unauthorized'],
  [403, { error: 'origin_not_allowed' }, 'origin_not_allowed'],
  [413, { error: 'too_large' }, 'too_large'],
  [429, { error: 'rate_limited' }, 'rate_limited'],
  [400, { error: 'invalid_request' }, 'invalid_request'],
  [500, null, 'http'],
  [200, { settings: { revision: 'x' } }, 'invalid_response'],
] as const) {
  test(`${status} ${JSON.stringify(body)} is ${code}`, async () => {
    const error = await failure(saveSettings('https://editor.pascal.app', 'p', { token, revision: 0, data: {}, fetch: answer(status, body).fetch }))
    expect(error.code).toBe(code)
    expect(error.status).toBe(status)
  })
}

test('settings over 256 KB never leave the browser', async () => {
  const { fetch, calls } = answer(200, { settings: saved })
  const error = await failure(saveSettings('https://editor.pascal.app', 'p', { token, revision: 0, data: { blob: 'x'.repeat(SETTINGS_MAX_BYTES) }, fetch }))
  expect(error.code).toBe('too_large')
  expect(calls).toHaveLength(0)
})

test('an unreachable server is a network error; an abort stays an abort', async () => {
  const offline = (async () => { throw new TypeError('Failed to fetch') }) as unknown as typeof fetch
  expect((await failure(saveSettings('https://editor.pascal.app', 'p', { token, revision: 0, data: {}, fetch: offline }))).code).toBe('network')
  const controller = new AbortController()
  controller.abort()
  const aborted = (async () => { throw new DOMException('Aborted', 'AbortError') }) as unknown as typeof fetch
  const error = await saveSettings('https://editor.pascal.app', 'p', { token, revision: 0, data: {}, fetch: aborted, signal: controller.signal }).catch((reason: unknown) => reason)
  expect((error as Error).name).toBe('AbortError')
})

test('parseSettings returns the data, or the defaults when there is none or it does not match', () => {
  const schema = z.looseObject({ v: z.literal(1), size: z.catch(z.number(), 1) })
  const defaults = { v: 1 as const, size: 1 }
  expect(parseSettings(schema, null, defaults)).toBe(defaults)
  expect(parseSettings(schema, undefined, defaults)).toBe(defaults)
  expect(parseSettings(schema, { v: 2, size: 3 }, defaults)).toBe(defaults)
  // A bad field falls back on its own; keys this build doesn't know survive.
  expect(parseSettings(schema, { v: 1, size: 'big', tour: ['a'] }, defaults)).toEqual({ v: 1, size: 1, tour: ['a'] })
})

test('the scene read keeps working without settings, and a malformed settings document is null', () => {
  const { settings: _, ...withoutSettings } = sceneBody()
  expect(SceneResponseSchema.parse(withoutSettings).settings ?? null).toBeNull()
  expect(SceneResponseSchema.parse({ ...withoutSettings, settings: null }).settings).toBeNull()
  expect(SceneResponseSchema.parse({ ...withoutSettings, settings: { viewerId: 7 } }).settings).toBeNull()
  expect(SceneResponseSchema.parse({ ...withoutSettings, settings: { ...saved, data: [1] } }).settings).toBeNull()
  expect(SceneResponseSchema.parse({ ...withoutSettings, settings: saved }).settings).toEqual(saved)
})
