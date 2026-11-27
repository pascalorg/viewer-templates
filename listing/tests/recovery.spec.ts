import { readFileSync } from 'node:fs'
import { expect, type Page, test } from '@playwright/test'
import { cors, mockPascal, sceneBody } from './pascal-mocks'

const fixtures = new URL('./fixtures/', import.meta.url)
const liveGraph = JSON.parse(readFileSync(new URL('live-scene.json', fixtures), 'utf8'))
const cube = readFileSync(new URL('cube.gltf', fixtures))

// A session credential Pascal rejects before its expiry (revoked from the Share popover, the binding
// changed, the parent session ended): one fresh round trip in the same mode, then the public view
// of a public project, or a reopen screen that keeps the Customize intent.

const issuer = 'https://editor.pascal.app'
const project = 'fixture-house'
const viewer = 'viewer_fixture'
const revoked = `pvh_${'r'.repeat(43)}`
const replacement = `pvh_${'n'.repeat(43)}`
const code = `pvc_${'c'.repeat(43)}`
const transactionKey = `pascal:handoff:${issuer}`
const configureEntry = `/?project=${project}&viewer=${viewer}&access=session&configure=1`
const sessionEntry = `/?project=${project}&viewer=${viewer}&access=session`
const READY = 'main[data-state="ready"]'
const settings = (canConfigure: boolean) => ({ viewerId: viewer, revision: 0, data: null, canConfigure })
const callback = (state: string) => `/?code=${code}&state=${state}&iss=${encodeURIComponent(issuer)}`
const tab = (page: Page) => page.getByRole('button', { name: /^Customize/ })

async function registry(page: Page) {
  await page.route('**/api/viewers/resolve?*', (route) => route.fulfill({ headers: cors, json: {
    availability: 'available', viewer_id: viewer, redirect_uri: new URL(route.request().url()).searchParams.get('origin') + '/',
  } }))
}

/** Pascal's authorize page; records every request the viewer makes to it. */
async function authorize(page: Page) {
  const requests: URLSearchParams[] = []
  await page.route('**/viewer/authorize?*', (route) => {
    requests.push(new URL(route.request().url()).searchParams)
    return route.fulfill({ contentType: 'text/html', body: '<p>Pascal authorize</p>' })
  })
  return requests
}

/**
 * The scene read: a tokenless read answers as a public (or private) published project would; a
 * credential is accepted only when it is in `valid`. Records the credential each read carried.
 */
async function scenes(page: Page, { publicProject, valid = [] as string[], tokenless }: {
  publicProject: boolean
  valid?: string[]
  /** Overrides a tokenless read: an HTTP status, or `abort` for a network failure. */
  tokenless?: () => number | 'abort' | undefined
}) {
  const calls = await mockPascal(page)
  const auth: string[] = []
  await page.route('**/api/projects/*/scene*', (route) => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors })
    const bearer = route.request().headers().authorization ?? ''
    auth.push(bearer)
    if (bearer && !valid.includes(bearer.replace('Bearer ', ''))) {
      return route.fulfill({ status: 401, json: { error: 'unauthorized' }, headers: cors })
    }
    const override = bearer ? undefined : tokenless?.()
    if (override === 'abort') return route.abort('internetdisconnected')
    if (override) return route.fulfill({ status: override, json: { error: 'unavailable' }, headers: cors })
    if (!bearer && !publicProject) return route.fulfill({ status: 404, json: { error: 'not_found' }, headers: cors })
    return route.fulfill({ body: sceneBody({ settings: settings(!!bearer) }), contentType: 'application/json', headers: cors })
  })
  return { calls, auth }
}

async function exchange(page: Page, scope: string | null = 'configure') {
  await page.route('**/api/viewer-handoff/exchange', (route) => route.fulfill({ headers: cors, json: {
    access_token: replacement, token_type: 'Bearer', expires_at: new Date(Date.now() + 3_600_000).toISOString(),
    project_id: project, viewer_id: viewer, revision: 'published', ...(scope ? { scope } : {}),
  } }))
}

/** An unexpired credential in the tab, as the exchange left it; seeded once per test. */
async function seedCredential(page: Page, { configure = true, access = 'session', token = revoked, recoverySpent = false } = {}) {
  await page.addInitScript(({ issuer, project, viewer, configure, access, token, recoverySpent }) => {
    if (sessionStorage.getItem('fixture:seeded')) return
    sessionStorage.setItem('fixture:seeded', '1')
    const name = JSON.stringify([issuer, viewer, project, location.origin])
    sessionStorage.setItem(`pascal:credential:${name}`, JSON.stringify({
      issuer, project_id: project, viewer_id: viewer, origin: location.origin, access, access_token: token,
      expires_at: new Date(Date.now() + 30 * 60_000).toISOString(), renewalAttempted: false,
      ...(configure ? { configure: true } : {}),
    }))
    if (recoverySpent) sessionStorage.setItem(`pascal:recovery:${name}`, '1')
  }, { issuer, project, viewer, configure, access, token, recoverySpent })
}

/** Reads the tab's storage from a page of this origin that runs no app code. */
async function storage(page: Page) {
  await page.route('**/inspect', (route) => route.fulfill({ contentType: 'text/html', body: '<p>Inspect</p>' }))
  await page.goto('/inspect')
  return page.evaluate(() => Object.fromEntries(Object.keys(sessionStorage).map((key) => [key, sessionStorage.getItem(key)!])))
}

const recoveryKey = (origin: string) => `pascal:recovery:${JSON.stringify([issuer, viewer, project, origin])}`

test('the incident: a rejected configure credential reopens Customize once with scope=configure', async ({ page, baseURL }) => {
  const { auth } = await scenes(page, { publicProject: true })
  await registry(page)
  const requests = await authorize(page)
  await seedCredential(page)
  await page.goto(configureEntry)
  await page.waitForURL(`${issuer}/viewer/authorize?*`)
  expect(auth).toEqual([`Bearer ${revoked}`])
  expect(requests).toHaveLength(1)
  const query = requests[0]!
  expect(query.get('scope')).toBe('configure')
  expect(query.get('access')).toBe('session')
  expect(query.get('interaction')).toBe('sign_in')
  expect(query.get('state')).toMatch(/^[A-Za-z0-9_-]{43}$/)
  expect(page.url()).not.toContain(revoked)
  const stored = await storage(page)
  const transaction = JSON.parse(stored[transactionKey]!)
  expect(transaction).toMatchObject({ access: 'session', configure: true, recovery: true, signIn: false, renewal: false })
  expect(transaction.customize).toBeUndefined()
  expect(transaction.returnPath).toBe(configureEntry)
  // The rejected credential is gone; it is never the authority for anything again.
  expect(Object.keys(stored).filter((key) => key.startsWith('pascal:credential:'))).toEqual([])
  expect(stored[recoveryKey(new URL(baseURL!).origin)]).toBeTruthy()
})

test('the recovered configure credential opens Customize and gives the round trip back', async ({ page, baseURL }) => {
  const { auth } = await scenes(page, { publicProject: true, valid: [replacement] })
  await registry(page)
  const requests = await authorize(page)
  await exchange(page)
  await seedCredential(page)
  await page.goto(configureEntry)
  await page.waitForURL(`${issuer}/viewer/authorize?*`)
  await page.goto(callback(requests[0]!.get('state')!))
  await expect(page.locator(READY)).toBeVisible({ timeout: 20_000 })
  expect(page.url()).toBe(new URL(configureEntry, baseURL).href)
  expect(auth.at(-1)).toBe(`Bearer ${replacement}`)
  await expect(page.getByRole('region', { name: 'Customize' })).toBeVisible()
  expect(requests).toHaveLength(1)
  const stored = await storage(page)
  expect(stored[recoveryKey(new URL(baseURL!).origin)]).toBeUndefined()
})

for (const publicProject of [false, true]) {
  test(`a replacement that is rejected too does not loop (${publicProject ? 'public' : 'private'} project)`, async ({ page, baseURL }) => {
    const { auth } = await scenes(page, { publicProject })
    await registry(page)
    const requests = await authorize(page)
    await exchange(page)
    await seedCredential(page)
    await page.goto(configureEntry)
    await page.waitForURL(`${issuer}/viewer/authorize?*`)
    await page.goto(callback(requests[0]!.get('state')!))
    if (publicProject) {
      await expect(page.locator(READY)).toBeVisible({ timeout: 20_000 })
      expect(page.url()).toBe(new URL(`/?project=${project}`, baseURL).href)
    } else {
      await expect(page.locator('main[data-state="reopen"]')).toBeVisible()
      await expect(page.getByText('Sign in again to keep customizing, or open this project from Pascal.')).toBeVisible()
    }
    expect(requests).toHaveLength(1)
    expect(auth.slice(0, 2)).toEqual([`Bearer ${revoked}`, `Bearer ${replacement}`])
    if (publicProject) {
      // The anonymous address reloads as a plain public visit.
      await page.reload()
      await expect(page.locator(READY)).toBeVisible({ timeout: 20_000 })
      expect(auth.at(-1)).toBe('')
    } else {
      // The spent round trip is kept for the tab: reloading the entry address (no credential
      // left, nothing reseeded) asks to reopen again instead of leaving for Pascal.
      expect(await page.evaluate(() => Object.keys(sessionStorage).filter((key) => key.startsWith('pascal:credential:')))).toEqual([])
      await page.reload()
      expect(page.url()).toBe(new URL(configureEntry, baseURL).href)
      await expect(page.locator('main[data-state="reopen"]')).toBeVisible()
    }
    expect(requests).toHaveLength(1)
  })
}

test('the round trip is spent for the tab: a reload with another rejected credential does not leave again', async ({ page }) => {
  await scenes(page, { publicProject: false })
  await registry(page)
  const requests = await authorize(page)
  await seedCredential(page)
  await page.goto(configureEntry)
  await page.waitForURL(`${issuer}/viewer/authorize?*`)
  expect(requests).toHaveLength(1)
  // Back on the viewer in the same tab with a configure credential Pascal rejects as well.
  await page.route('**/seed', (route) => route.fulfill({ contentType: 'text/html', body: '<p>Seed</p>' }))
  await page.goto('/seed')
  await page.evaluate(({ issuer, project, viewer, token }) => {
    sessionStorage.removeItem(`pascal:handoff:${issuer}`)
    sessionStorage.setItem(`pascal:credential:${JSON.stringify([issuer, viewer, project, location.origin])}`, JSON.stringify({
      issuer, project_id: project, viewer_id: viewer, origin: location.origin, access: 'session', access_token: token,
      expires_at: new Date(Date.now() + 30 * 60_000).toISOString(), renewalAttempted: false, configure: true,
    }))
  }, { issuer, project, viewer, token: replacement })
  await page.goto(configureEntry)
  await expect(page.locator('main[data-state="reopen"]')).toBeVisible()
  expect(requests).toHaveLength(1)
})

test('the reopen screen after Customize restarts Customize, not a plain sign-in', async ({ page }) => {
  await scenes(page, { publicProject: false })
  await registry(page)
  const requests = await authorize(page)
  await seedCredential(page, { recoverySpent: true })
  await page.goto(configureEntry)
  await expect(page.locator('main[data-state="reopen"]')).toBeVisible()
  expect(requests).toHaveLength(0)
  await page.getByRole('button', { name: 'Sign in with Pascal' }).click()
  await page.waitForURL(`${issuer}/viewer/authorize?*`)
  expect(requests).toHaveLength(1)
  expect(requests[0]!.get('scope')).toBe('configure')
  expect(requests[0]!.get('interaction')).toBe('sign_in')
  const transaction = JSON.parse((await storage(page))[transactionKey]!)
  expect(transaction).toMatchObject({ configure: true, signIn: false })
  expect(transaction.returnPath).toBe(configureEntry)
})

test('a public project falls back to its public view on its anonymous address, with Customize to reopen', async ({ page, baseURL }) => {
  const { auth } = await scenes(page, { publicProject: true })
  await registry(page)
  const requests = await authorize(page)
  await seedCredential(page, { recoverySpent: true })
  await page.goto(`${configureEntry}&embed=1#camera`)
  await expect(page.locator(READY)).toBeVisible({ timeout: 20_000 })
  expect(page.url()).toBe(new URL(`/?project=${project}&embed=1#camera`, baseURL).href)
  expect(requests).toHaveLength(0)
  expect(auth[0]).toBe(`Bearer ${revoked}`)
  expect(auth.at(-1)).toBe('')
  // Read-only: no panel, no save; Customize says it needs reopening.
  await expect(page.getByRole('region', { name: 'Customize' })).toHaveCount(0)
  await expect(page.getByText('Your Customize session ended.', { exact: false })).toBeVisible()
  await expect(tab(page)).not.toHaveAttribute('aria-expanded')
  await tab(page).click()
  await page.waitForURL(`${issuer}/viewer/authorize?*`)
  expect(requests).toHaveLength(1)
  expect(requests[0]!.get('scope')).toBe('configure')
  const transaction = JSON.parse((await storage(page))[transactionKey]!)
  expect(transaction).toMatchObject({ configure: true, customize: true, fallbackPath: `/?project=${project}&embed=1#camera` })
})

test('a reader session rejected on a public project shows the public view without asking Pascal', async ({ page, baseURL }) => {
  const { auth } = await scenes(page, { publicProject: true })
  await registry(page)
  const requests = await authorize(page)
  await seedCredential(page, { configure: false })
  await page.goto(sessionEntry)
  await expect(page.locator(READY)).toBeVisible({ timeout: 20_000 })
  expect(page.url()).toBe(new URL(`/?project=${project}`, baseURL).href)
  expect(requests).toHaveLength(0)
  expect(auth).toEqual([`Bearer ${revoked}`, '', ''])
  await expect(tab(page)).toHaveCount(0)
})

test('a reader session rejected on a private project reopens once in session mode', async ({ page }) => {
  await scenes(page, { publicProject: false })
  await registry(page)
  const requests = await authorize(page)
  await seedCredential(page, { configure: false })
  await page.goto(sessionEntry)
  await page.waitForURL(`${issuer}/viewer/authorize?*`)
  expect(requests).toHaveLength(1)
  expect(requests[0]!.get('access')).toBe('session')
  expect(requests[0]!.get('interaction')).toBe('sign_in')
  expect(requests[0]!.has('scope')).toBe(false)
  const transaction = JSON.parse((await storage(page))[transactionKey]!)
  expect(transaction).toMatchObject({ recovery: true, signIn: false })
  expect(transaction.configure).toBeUndefined()
})

for (const publicProject of [true, false]) {
  test(`Pascal refusing the round trip on a ${publicProject ? 'public' : 'private'} project ${publicProject ? 'shows the public view' : 'is refused'}`, async ({ page, baseURL }) => {
    await scenes(page, { publicProject })
    await registry(page)
    const requests = await authorize(page)
    await seedCredential(page)
    await page.goto(configureEntry)
    await page.waitForURL(`${issuer}/viewer/authorize?*`)
    await page.goto(`/?error=access_denied&state=${requests[0]!.get('state')}&iss=${encodeURIComponent(issuer)}`)
    if (publicProject) {
      await expect(page.locator(READY)).toBeVisible({ timeout: 20_000 })
      expect(page.url()).toBe(new URL(`/?project=${project}`, baseURL).href)
      await expect(page.getByText('Your Customize session ended.', { exact: false })).toBeVisible()
    } else {
      await expect(page.locator('main[data-state="refused"]')).toBeVisible()
    }
    expect(requests).toHaveLength(1)
  })
}

test('a configure grant without the configure scope on a public project shows the public view', async ({ page, baseURL }) => {
  await scenes(page, { publicProject: true, valid: [replacement] })
  await registry(page)
  const requests = await authorize(page)
  await exchange(page, null)
  await seedCredential(page)
  await page.goto(configureEntry)
  await page.waitForURL(`${issuer}/viewer/authorize?*`)
  await page.goto(callback(requests[0]!.get('state')!))
  await expect(page.locator(READY)).toBeVisible({ timeout: 20_000 })
  expect(page.url()).toBe(new URL(`/?project=${project}`, baseURL).href)
  expect(requests).toHaveLength(1)
})

test('a rejected share credential still asks to reopen the share link, without a trip or an anonymous read', async ({ page }) => {
  const { auth } = await scenes(page, { publicProject: true })
  await registry(page)
  const requests = await authorize(page)
  await seedCredential(page, { configure: false, access: 'share' })
  await page.goto(`/?project=${project}&viewer=${viewer}&access=share`)
  await expect(page.getByRole('heading', { name: 'Reopen your share link' })).toBeVisible()
  expect(requests).toHaveLength(0)
  expect(auth).toEqual([`Bearer ${revoked}`])
})

test('an indeterminate public probe shows a retryable error: no round trip, no public view', async ({ page, baseURL }) => {
  const probes: (number | 'abort')[] = [503, 'abort', 404]
  await scenes(page, { publicProject: true, tokenless: () => probes.shift() })
  await registry(page)
  const requests = await authorize(page)
  await seedCredential(page, { configure: false })
  await page.goto(sessionEntry)
  await expect(page.locator('main[data-state="error"]')).toBeVisible()
  expect(requests).toHaveLength(0)
  expect(page.url()).toBe(new URL(sessionEntry, baseURL).href)
  // Still indeterminate on retry (offline this time).
  await page.getByRole('button', { name: 'Try again' }).click()
  await expect(page.getByRole('heading', { name: "Couldn't reach Pascal" })).toBeVisible()
  expect(requests).toHaveLength(0)
  // Definitively not public: now the one round trip, in session mode.
  await page.getByRole('button', { name: 'Try again' }).click()
  await page.waitForURL(`${issuer}/viewer/authorize?*`)
  expect(requests).toHaveLength(1)
  expect(requests[0]!.get('access')).toBe('session')
})

test('an indeterminate probe on reload still never leaves for Pascal', async ({ page }) => {
  await scenes(page, { publicProject: true, tokenless: () => 503 })
  await registry(page)
  const requests = await authorize(page)
  await seedCredential(page, { configure: false })
  await page.goto(sessionEntry)
  await expect(page.locator('main[data-state="error"]')).toBeVisible()
  await page.reload()
  await expect(page.locator('main[data-state="error"]')).toBeVisible()
  expect(requests).toHaveLength(0)
})

for (const tamper of ['state', 'issuer'] as const) {
  test(`a pending recovery answered by a callback with the wrong ${tamper} is not exchanged and does not fall back`, async ({ page, baseURL }) => {
    const { auth } = await scenes(page, { publicProject: true })
    await registry(page)
    const requests = await authorize(page)
    let exchanged = 0
    await page.route('**/api/viewer-handoff/exchange', (route) => { exchanged++; return route.abort() })
    await seedCredential(page)
    await page.goto(configureEntry)
    await page.waitForURL(`${issuer}/viewer/authorize?*`)
    const state = tamper === 'state' ? 'w'.repeat(43) : requests[0]!.get('state')!
    const iss = tamper === 'issuer' ? 'https://wrong.example' : issuer
    await page.goto(`/?code=${code}&state=${state}&iss=${encodeURIComponent(iss)}`)
    await expect(page.locator('main[data-state="reopen"]')).toBeVisible()
    expect(exchanged).toBe(0)
    expect(auth).toEqual([`Bearer ${revoked}`])
    expect(new URL(page.url()).searchParams.get('project')).toBeNull()
    expect(page.url()).toBe(new URL('/', baseURL).href)
  })
}

test('a public fallback after the exchange keeps the validated return path: unrelated parameters and the hash', async ({ page, baseURL }) => {
  await scenes(page, { publicProject: true })
  await registry(page)
  const requests = await authorize(page)
  await exchange(page, null)
  await seedCredential(page)
  await page.goto(`${configureEntry}&embed=1&lang=fr#camera`)
  await page.waitForURL(`${issuer}/viewer/authorize?*`)
  await page.goto(callback(requests[0]!.get('state')!))
  await expect(page.locator(READY)).toBeVisible({ timeout: 20_000 })
  expect(page.url()).toBe(new URL(`/?project=${project}&embed=1&lang=fr#camera`, baseURL).href)
})

test('a mid-session downgrade clears Customize, cancels the pending save and reads the public scene', async ({ page, baseURL }) => {
  test.setTimeout(60_000)
  await page.clock.install()
  await mockPascal(page)
  await registry(page)
  const requests = await authorize(page)
  const baking = { status: 'baking', bakeVersion: null, hash: null, lods: [] }
  // The manager's read is the live graph; the public one the ready bake, so nothing can be reused.
  const named = (name: string, canConfigure: boolean) => {
    const body = JSON.parse(canConfigure
      ? sceneBody({ graph: liveGraph, bake: baking, settings: settings(true) })
      : sceneBody({ settings: settings(false) }))
    return JSON.stringify({ ...body, project: { ...body.project, name } })
  }
  let revokedNow = false
  const auth: string[] = []
  await page.route('**/api/projects/*/scene*', (route) => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors })
    const bearer = route.request().headers().authorization ?? ''
    auth.push(bearer)
    // 403: Pascal refuses this credential outright, so there is no round trip to take.
    if (bearer && revokedNow) return route.fulfill({ status: 403, json: { error: 'forbidden' }, headers: cors })
    return route.fulfill({ body: named(bearer ? 'Manager draft house' : 'Public house', !!bearer), contentType: 'application/json', headers: cors })
  })
  await page.route('https://editor.pascal.app/cube.gltf', (route) =>
    route.fulfill({ body: cube, contentType: 'model/gltf+json', headers: cors }))
  const puts: string[] = []
  const failedPuts: string[] = []
  await page.route('**/api/projects/*/viewer-settings', (route) => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { ...cors, 'access-control-allow-methods': 'PUT, OPTIONS' } })
    puts.push(route.request().headers().authorization ?? '')
    // Held open: the save is still in flight when the session ends.
  })
  page.on('requestfailed', (request) => { if (request.url().includes('/viewer-settings') && request.method() === 'PUT') failedPuts.push(request.failure()?.errorText ?? '') })
  await seedCredential(page)
  await page.goto(configureEntry)
  await expect(page.locator('main[data-source="live"][data-scene-ready="true"]')).toBeVisible({ timeout: 20_000 })
  await expect(page.getByRole('heading', { name: 'Manager draft house' })).toBeVisible()
  const panel = page.getByRole('region', { name: 'Customize' })
  await expect(panel).toBeVisible()
  await panel.getByRole('button', { name: 'Use current view' }).click()
  await panel.getByRole('button', { name: 'Save' }).click()
  await expect.poll(() => puts.length).toBe(1)
  expect(puts[0]).toBe(`Bearer ${revoked}`)
  // The pass is withdrawn; the next read (the baking poll) is refused.
  revokedNow = true
  await page.clock.fastForward(30_000)
  await expect(page.locator('main[data-source="baked"][data-scene-ready="true"]')).toBeVisible({ timeout: 20_000 })
  await expect(page.getByRole('heading', { name: 'Public house' })).toBeVisible()
  expect(page.url()).toBe(new URL(`/?project=${project}`, baseURL).href)
  await expect(panel).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Save' })).toHaveCount(0)
  await expect(page.getByText('Your Customize session ended.', { exact: false })).toBeVisible()
  await expect.poll(() => failedPuts.length).toBe(1)
  expect(puts).toHaveLength(1)
  // The public scene came from a tokenless read; nothing authenticated was reused.
  expect(auth.at(-1)).toBe('')
  expect(auth.filter((value) => value === `Bearer ${revoked}`)).toHaveLength(2)
  expect(requests).toHaveLength(0)
})
