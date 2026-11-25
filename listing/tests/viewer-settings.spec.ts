import { expect, type Page, test } from '@playwright/test'
import { cors, mockPascal, sceneBody } from './pascal-mocks'

const issuer = 'https://editor.pascal.app'
const project = 'fixture-house'
const viewer = 'viewer_fixture'
const token = `pvh_${'t'.repeat(43)}`
const code = `pvc_${'c'.repeat(43)}`
const transactionKey = `pascal:handoff:${issuer}`
const configureEntry = `/?project=${project}&viewer=${viewer}&access=session&configure=1`
const READY = 'main[data-state="ready"]'
const OPENING = { position: [12, 9, -14], target: [0.5, 1, 0.25] }

const settings = (data: unknown, { revision = 3, canConfigure = false, configureAvailable = undefined as boolean | undefined } = {}) =>
  ({ viewerId: viewer, revision, data, canConfigure, ...(configureAvailable === undefined ? {} : { configureAvailable }) })

async function registry(page: Page) {
  await page.route('**/api/viewers/resolve?*', (route) => route.fulfill({ headers: cors, json: {
    availability: 'available', viewer_id: viewer, redirect_uri: new URL(route.request().url()).searchParams.get('origin') + '/',
  } }))
}

async function authorize(page: Page) {
  await page.route('**/viewer/authorize?*', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<p>Pascal authorize</p>' }))
}

/** A configure credential in the tab, as the exchange leaves it (or a reader's, `configure: false`). */
async function seedConfigureCredential(page: Page, remainingMs = 3_600_000,
  { configure = true, access = 'session' as 'session' | 'share', accessToken = token } = {}) {
  await page.addInitScript(({ issuer, project, viewer, accessToken, remainingMs, configure, access }) => {
    if (sessionStorage.getItem('fixture:seeded')) return
    sessionStorage.setItem('fixture:seeded', '1')
    sessionStorage.setItem(`pascal:credential:${JSON.stringify([issuer, viewer, project, location.origin])}`,
      JSON.stringify({ issuer, project_id: project, viewer_id: viewer, origin: location.origin, access,
        ...(configure ? { configure: true } : {}), access_token: accessToken, renewalAttempted: false,
        expires_at: new Date(Date.now() + remainingMs).toISOString() }))
  }, { issuer, project, viewer, accessToken, remainingMs, configure, access })
}

/** The transaction the tab keeps while it is away at Pascal (read from a page that does not consume it). */
async function savedTransaction(page: Page) {
  await page.route('**/inspect', (route) => route.fulfill({ contentType: 'text/html', body: '<p>Inspect</p>' }))
  await page.goto('/inspect')
  return page.evaluate((key) => JSON.parse(sessionStorage.getItem(key)!), transactionKey)
}

/** Answers PUT /viewer-settings with `answer(body)`; records the requests. */
async function settingsWrites(page: Page, answer: (body: { revision: number; data: unknown }) => { status?: number; json: unknown }) {
  const calls: { body: { revision: number; data: { opening?: { camera?: { position: number[] } } } }; headers: Record<string, string> }[] = []
  await page.route('**/api/projects/*/viewer-settings', (route) => {
    const request = route.request()
    const headers = { ...cors, 'access-control-allow-methods': 'PUT, OPTIONS' }
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers })
    calls.push({ body: request.postDataJSON(), headers: request.headers() })
    const { status = 200, json } = answer(request.postDataJSON())
    return route.fulfill({ status, json, headers })
  })
  return calls
}

/** The camera position of each frame the renderer draws, through three's devtools hook. */
async function recordCamera(page: Page) {
  await page.addInitScript(() => {
    const poses: number[][] = []
    ;(window as unknown as { cameraPoses: number[][] }).cameraPoses = poses
    const devtools = new EventTarget()
    ;(window as unknown as { __THREE_DEVTOOLS__: EventTarget }).__THREE_DEVTOOLS__ = devtools
    devtools.addEventListener('observe', (event) => {
      const object = (event as CustomEvent).detail as Record<string, unknown>
      if (!object.isWebGLRenderer) return
      const original = object.render as (...args: unknown[]) => unknown
      object.render = function (this: unknown, scene: unknown, camera: { position: { x: number; y: number; z: number } }) {
        poses.push([camera.position.x, camera.position.y, camera.position.z])
        return original.apply(this, [scene, camera])
      }
    })
  })
  return async () => (await page.evaluate(() => (window as unknown as { cameraPoses: number[][] }).cameraPoses)).at(-1)!
}

function expectNear(actual: number[], expected: number[]) {
  for (const [axis, value] of expected.entries()) expect(actual[axis], JSON.stringify(actual)).toBeCloseTo(value, 2)
}

/** Drags the view round, then waits for the controls' damping to come to rest. */
async function orbit(page: Page, camera: () => Promise<number[]>) {
  // The drag's damping ends after a number of frames, not a time: about a hundred, which a CI
  // runner drawing in software takes well over the default five seconds to render.
  test.slow()
  const box = (await page.locator('canvas').boundingBox())!
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.45, { steps: 8 })
  await page.mouse.up()
  let last: number[] = []
  await expect.poll(async () => {
    const pose = await camera()
    const still = last.length > 0 && Math.hypot(...pose.map((value, axis) => value - last[axis]!)) < 1e-4
    last = pose
    return still
  }, { intervals: [250], timeout: 25_000 }).toBe(true)
}

test('Customize starts the handoff with scope=configure and keeps it in the return path', async ({ page }) => {
  const reads = await mockPascal(page)
  await registry(page)
  await authorize(page)
  await page.goto(configureEntry)
  await page.waitForURL(`${issuer}/viewer/authorize?*`)
  const query = new URL(page.url()).searchParams
  expect(query.get('scope')).toBe('configure')
  expect(query.get('access')).toBe('session')
  expect(query.get('interaction')).toBe('sign_in')
  expect(reads.scene).toBe(0)
  const saved = await savedTransaction(page)
  expect(saved.configure).toBe(true)
  expect(saved.customize).toBeUndefined()
  expect(new URL(saved.returnPath, 'http://x').searchParams.get('configure')).toBe('1')
})

test('an Open from Pascal entry asks for no scope, exactly as before', async ({ page }) => {
  await mockPascal(page)
  await registry(page)
  await authorize(page)
  await page.goto(`/?project=${project}&viewer=${viewer}&access=session`)
  await page.waitForURL(`${issuer}/viewer/authorize?*`)
  const query = new URL(page.url()).searchParams
  expect([...query.keys()].sort()).toEqual(['access', 'code_challenge', 'code_challenge_method', 'interaction', 'project', 'redirect_uri', 'state', 'viewer'])
})

for (const entry of [
  'access=share&configure=1', 'access=anonymous&configure=1', 'access=session&configure=true', 'access=session&configure=1&configure=1',
  'access=session&configure=yes', 'access=share&configure=available&configure=available', 'access=session&configure=1&configure=available',
]) {
  test(`an entry with ${entry} is not one Pascal makes: reopen`, async ({ page }) => {
    const reads = await mockPascal(page)
    await registry(page)
    await page.goto(`/?project=${project}&viewer=${viewer}&${entry}`)
    await expect(page.locator('main[data-state="reopen"]')).toBeVisible()
    expect(reads.scene).toBe(0)
  })
}

for (const granted of [true, false]) {
  test(`a configure callback ${granted ? 'stores a configure credential' : 'not granted configure reopens'}`, async ({ page, baseURL }) => {
    const reads = await mockPascal(page, () => ({ body: sceneBody({ settings: settings(null, { revision: 0, canConfigure: true }) }) }))
    await registry(page)
    await authorize(page)
    await page.route('**/api/viewer-handoff/exchange', (route) => route.fulfill({ headers: cors, json: {
      access_token: token, token_type: 'Bearer', expires_at: new Date(Date.now() + 3_600_000).toISOString(),
      project_id: project, viewer_id: viewer, revision: 'published', ...(granted ? { scope: 'configure' } : {}),
    } }))
    await page.goto(configureEntry)
    await page.waitForURL(`${issuer}/viewer/authorize?*`)
    const state = new URL(page.url()).searchParams.get('state')
    await page.goto(`/?code=${code}&state=${state}&iss=${encodeURIComponent(issuer)}`)
    if (!granted) {
      await expect(page.locator('main[data-state="reopen"]')).toBeVisible()
      expect(reads.scene).toBe(0)
      return
    }
    await expect(page.locator(READY)).toBeVisible({ timeout: 20_000 })
    expect(page.url()).toBe(new URL(configureEntry, baseURL).href)
    await expect(page.getByRole('region', { name: 'Customize' })).toBeVisible()
    const stored = await page.evaluate(() => JSON.parse(sessionStorage.getItem(Object.keys(sessionStorage).find((key) => key.startsWith('pascal:credential:'))!)!))
    expect(stored.configure).toBe(true)
  })
}

test('a configure credential renews with scope=configure', async ({ page }) => {
  await mockPascal(page)
  await registry(page)
  await authorize(page)
  await seedConfigureCredential(page, 90_000)
  await page.goto(configureEntry)
  await page.waitForURL(`${issuer}/viewer/authorize?*`)
  const query = new URL(page.url()).searchParams
  expect(query.get('scope')).toBe('configure')
  expect(query.get('access')).toBe('session')
})

test('a visitor opens on the saved opening view, with no Customize entry', async ({ page }) => {
  const camera = await recordCamera(page)
  await mockPascal(page, () => ({ body: sceneBody({ settings: settings({ v: 1, opening: { camera: OPENING } }) }) }))
  await page.goto(`/?project=${project}`)
  await expect(page.locator(READY)).toBeVisible({ timeout: 20_000 })
  await expect.poll(camera).toBeTruthy()
  expectNear(await camera(), OPENING.position)
  await expect(page.getByRole('region', { name: 'Customize' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /^Customize/ })).toHaveCount(0)
})

for (const [name, body] of [
  ['without a settings field', sceneBody()],
  ['with malformed settings', sceneBody({ settings: { viewerId: 7 } })],
  ['with invalid data', sceneBody({ settings: settings({ v: 1, opening: { camera: { position: 'up', target: [0, 0, 0] } } }) })],
  ['with another shape', sceneBody({ settings: settings({ v: 2, opening: { camera: OPENING } }) })],
] as const) {
  test(`a read ${name} opens on the default view`, async ({ page }) => {
    const camera = await recordCamera(page)
    await mockPascal(page, () => ({ body }))
    await page.goto(`/?project=${project}`)
    await expect(page.locator(READY)).toBeVisible({ timeout: 20_000 })
    await expect.poll(camera).toBeTruthy()
    const pose = await camera()
    expect(Math.hypot(pose[0]! - OPENING.position[0]!, pose[2]! - OPENING.position[2]!)).toBeGreaterThan(1)
  })
}

test('a manager sets the opening view, saves it with the read revision and sees Saved', async ({ page }) => {
  const camera = await recordCamera(page)
  const reads = await mockPascal(page, () => ({ body: sceneBody({ settings: settings({ v: 1, keep: 'me' }, { canConfigure: true }) }) }))
  await registry(page)
  await seedConfigureCredential(page)
  const writes = await settingsWrites(page, (body) => ({ json: { settings: settings(body.data, { revision: 4, canConfigure: true }) } }))
  await page.goto(configureEntry)
  await expect(page.locator(READY)).toBeVisible({ timeout: 20_000 })
  const bar = page.getByRole('region', { name: 'Customize' })
  await expect(bar.getByRole('button', { name: 'Save' })).toBeDisabled()
  await expect(bar.getByRole('button', { name: 'Clear opening camera' })).toBeDisabled()
  await orbit(page, camera)
  await bar.getByRole('button', { name: 'Use current view' }).click()
  await expect(bar.getByRole('status')).toHaveText('Unsaved changes')
  // The manager keeps navigating; the opening view stays where it was set.
  const set = await camera()
  await orbit(page, camera)
  await bar.getByRole('button', { name: 'Save' }).click()
  await expect(bar.getByRole('status')).toHaveText('Saved')
  expect(writes).toHaveLength(1)
  expect(writes[0]!.headers.authorization).toBe(`Bearer ${token}`)
  expect(writes[0]!.headers.cookie).toBeUndefined()
  expect(writes[0]!.body.revision).toBe(3)
  expect(writes[0]!.body.data).toMatchObject({ v: 1, keep: 'me' })
  expectNear(writes[0]!.body.data.opening!.camera!.position, set)
  await expect(bar.getByRole('button', { name: 'Save' })).toBeDisabled()
  expect(reads.scene).toBe(1)
  // Clear is a change too: back to the template's default.
  await bar.getByRole('button', { name: 'Clear opening camera' }).click()
  await expect(bar.getByRole('status')).toHaveText('Unsaved changes')
  await bar.getByRole('button', { name: 'Save' }).click()
  await expect(bar.getByRole('status')).toHaveText('Saved')
  expect(writes[1]!.body.revision).toBe(4)
  expect(writes[1]!.body.data).toEqual({ v: 1, keep: 'me' })
})

test('a conflict says so and loads the latest', async ({ page }) => {
  await mockPascal(page, () => ({ body: sceneBody({ settings: settings(null, { revision: 0, canConfigure: true }) }) }))
  await registry(page)
  await seedConfigureCredential(page)
  const writes = await settingsWrites(page, () => ({ status: 409, json: { error: 'conflict',
    settings: settings({ v: 1, opening: { camera: OPENING } }, { revision: 5, canConfigure: true }) } }))
  await page.goto(configureEntry)
  await expect(page.locator(READY)).toBeVisible({ timeout: 20_000 })
  const bar = page.getByRole('region', { name: 'Customize' })
  await bar.getByRole('button', { name: 'Use current view' }).click()
  await bar.getByRole('button', { name: 'Save' }).click()
  await expect(bar.getByRole('status')).toHaveText('Someone else saved changes.')
  expect(writes[0]!.body.revision).toBe(0)
  await bar.getByRole('button', { name: 'Load the latest' }).click()
  await expect(bar.getByRole('status')).toHaveText('No unsaved changes')
  await expect(bar.getByRole('button', { name: 'Save' })).toBeDisabled()
  await expect(bar.getByRole('button', { name: 'Clear opening camera' })).toBeEnabled()
  await expect(bar.getByRole('button', { name: 'Load the latest' })).toHaveCount(0)
})

test('an ended session asks to reopen from Pascal', async ({ page }) => {
  await mockPascal(page, () => ({ body: sceneBody({ settings: settings(null, { revision: 0, canConfigure: true }) }) }))
  await registry(page)
  await seedConfigureCredential(page)
  await settingsWrites(page, () => ({ status: 401, json: { error: 'unauthorized' } }))
  await page.goto(configureEntry)
  await expect(page.locator(READY)).toBeVisible({ timeout: 20_000 })
  const bar = page.getByRole('region', { name: 'Customize' })
  await bar.getByRole('button', { name: 'Use current view' }).click()
  await bar.getByRole('button', { name: 'Save' }).click()
  await expect(bar.getByRole('status')).toHaveText('Your session ended. Reopen from Pascal to keep customizing.')
  await expect(bar.getByRole('button', { name: 'Save' })).toBeDisabled()
})

test('an unsaved draft survives a reload and opens there', async ({ page }) => {
  const camera = await recordCamera(page)
  await mockPascal(page, () => ({ body: sceneBody({ settings: settings(null, { revision: 0, canConfigure: true }) }) }))
  await registry(page)
  await seedConfigureCredential(page)
  const writes = await settingsWrites(page, (body) => ({ json: { settings: settings(body.data, { revision: 1, canConfigure: true }) } }))
  await page.goto(configureEntry)
  await expect(page.locator(READY)).toBeVisible({ timeout: 20_000 })
  const bar = page.getByRole('region', { name: 'Customize' })
  await orbit(page, camera)
  await bar.getByRole('button', { name: 'Use current view' }).click()
  const set = await camera()
  const dialogs: string[] = []
  page.on('dialog', (dialog) => {
    dialogs.push(dialog.type())
    void dialog.accept()
  })
  await page.reload()
  await expect(page.locator(READY)).toBeVisible({ timeout: 20_000 })
  expect(dialogs).toEqual(['beforeunload'])
  await expect(bar.getByRole('status')).toHaveText('Unsaved changes')
  await expect.poll(async () => Math.hypot(...(await camera()).map((value, axis) => value - set[axis]!))).toBeLessThan(0.01)
  await bar.getByRole('button', { name: 'Discard' }).click()
  await expect(bar.getByRole('status')).toHaveText('No unsaved changes')
  expect(await page.evaluate(() => Object.keys(sessionStorage).filter((key) => key.startsWith('pascal:settings-draft:')))).toEqual([])
  expect(writes).toHaveLength(0)
})

// ── Managers arrive with the configure pass; Customize from inside the viewer (protocol v1.1, v1.2) ──

const tab = (page: Page) => page.getByRole('button', { name: /^Customize/ })
const plain = (access: string) => `/?project=${project}&viewer=${viewer}&access=${access}`
const hinted = (access: string) => `${plain(access)}&configure=available`
const granted = `pvh_${'n'.repeat(43)}`
const callback = (state: string) => `/?code=${code}&state=${state}&iss=${encodeURIComponent(issuer)}`

async function exchange(page: Page, scope?: string) {
  await page.route('**/api/viewer-handoff/exchange', (route) => route.fulfill({ headers: cors, json: {
    access_token: granted, token_type: 'Bearer', expires_at: new Date(Date.now() + 3_600_000).toISOString(),
    project_id: project, viewer_id: viewer, revision: 'published', ...(scope ? { scope } : {}),
  } }))
}

/** The credential each scene read carried. */
function sceneAuth(page: Page) {
  const auth: string[] = []
  page.on('request', (request) => {
    if (/\/api\/projects\/[^/]+\/scene/.test(request.url()) && request.method() === 'GET') auth.push(request.headers().authorization ?? '')
  })
  return auth
}

/** The page left for Pascal to ask for the configure pass from inside the viewer: its request and transaction. */
async function configureRequest(page: Page, from: string) {
  await page.waitForURL(`${issuer}/viewer/authorize?*`)
  const query = new URL(page.url()).searchParams
  expect(query.get('scope')).toBe('configure')
  expect(query.get('access')).toBe('session')
  expect(query.get('interaction')).toBe('sign_in')
  const saved = await savedTransaction(page)
  expect(saved.configure).toBe(true)
  expect(saved.customize).toBe(true)
  expect(saved.fallbackPath).toBe(from)
  return { state: query.get('state') as string, saved }
}

for (const access of ['anonymous', 'session', 'share'] as const) {
  test(`a manager's ${access} entry (the hint) asks for the configure pass before any read, to come back to the same address without the hint`, async ({ page }) => {
    const reads = await mockPascal(page)
    await registry(page)
    await authorize(page)
    await page.goto(hinted(access))
    const { saved } = await configureRequest(page, hinted(access))
    expect(saved.returnPath).toBe(plain(access))
    expect(reads.scene).toBe(0)
  })
}

for (const access of ['anonymous', 'share'] as const) {
  test(`a manager arriving on a ${access} entry holds the pass with the panel collapsed, and opens it with no second trip`, async ({ page, baseURL }) => {
    await mockPascal(page, () => ({ body: sceneBody({ settings: settings(null, { revision: 0, canConfigure: true, configureAvailable: true }) }) }))
    await registry(page)
    await authorize(page)
    await exchange(page, 'configure')
    const auth = sceneAuth(page)
    await page.goto(hinted(access))
    const { state } = await configureRequest(page, hinted(access))
    await page.goto(callback(state))
    await expect(page.locator(READY)).toBeVisible({ timeout: 20_000 })
    // The address a visitor can open: the access it had, no hint.
    expect(page.url()).toBe(new URL(plain(access), baseURL).href)
    expect(auth.at(-1)).toBe(`Bearer ${granted}`)
    const panel = page.getByRole('region', { name: 'Customize' })
    await expect(panel).toHaveCount(0)
    await expect(tab(page)).toHaveAttribute('aria-expanded', 'false')
    await tab(page).click()
    await expect(panel).toBeVisible()
    expect(page.url()).toBe(new URL(plain(access), baseURL).href)
    // The pass lasts for the tab: a reload reads with it and never leaves for Pascal.
    await page.reload()
    await expect(page.locator(READY)).toBeVisible({ timeout: 20_000 })
    expect(page.url()).toBe(new URL(plain(access), baseURL).href)
    expect(auth.at(-1)).toBe(`Bearer ${granted}`)
    await expect(panel).toBeVisible()
  })
}

test('a configure pass held on a visitor address renews in place', async ({ page }) => {
  await mockPascal(page)
  await registry(page)
  await authorize(page)
  await seedConfigureCredential(page, 90_000)
  await page.goto(plain('anonymous'))
  await page.waitForURL(`${issuer}/viewer/authorize?*`)
  expect(new URL(page.url()).searchParams.get('scope')).toBe('configure')
  const saved = await savedTransaction(page)
  expect(saved.renewal).toBe(true)
  expect(saved.customize).toBeUndefined()
  expect(saved.returnPath).toBe(plain('anonymous'))
})

test('a configure pass already held is kept on an Open from Pascal entry', async ({ page }) => {
  const reads = await mockPascal(page, () => ({ body: sceneBody({ settings: settings(null, { revision: 0, canConfigure: true }) }) }))
  await registry(page)
  await authorize(page)
  await seedConfigureCredential(page)
  const auth = sceneAuth(page)
  await page.goto(plain('session'))
  await expect(page.locator(READY)).toBeVisible({ timeout: 20_000 })
  expect(auth.at(-1)).toBe(`Bearer ${token}`)
  expect(reads.scene).toBe(1)
  await expect(tab(page)).toHaveAttribute('aria-expanded', 'false')
})

for (const [name, flag, shown] of [['says configureAvailable', true, true], ['says nothing', undefined, false], ['says false', false, false]] as const) {
  test(`a reader's scene read that ${name} ${shown ? 'offers' : 'does not offer'} Customize`, async ({ page }) => {
    await mockPascal(page, () => ({ body: sceneBody({ settings: settings(null, { revision: 0, configureAvailable: flag }) }) }))
    await registry(page)
    await seedConfigureCredential(page, 3_600_000, { configure: false })
    await page.goto(plain('session'))
    await expect(page.locator(READY)).toBeVisible({ timeout: 20_000 })
    await expect(tab(page)).toHaveCount(shown ? 1 : 0)
  })
}

test('a manager without the pass presses Customize: one trip to Pascal, back on the same address with the panel open', async ({ page, baseURL }) => {
  let pass = false
  await mockPascal(page, () => ({ body: sceneBody({ settings: settings(null, { revision: 0, canConfigure: pass, configureAvailable: true }) }) }))
  await registry(page)
  await authorize(page)
  await exchange(page, 'configure')
  await seedConfigureCredential(page, 3_600_000, { configure: false })
  await page.goto(plain('session'))
  await expect(page.locator(READY)).toBeVisible({ timeout: 20_000 })
  await tab(page).click()
  const { state, saved } = await configureRequest(page, plain('session'))
  expect(saved.returnPath).toBe(plain('session'))
  pass = true
  await page.goto(callback(state))
  await expect(page.locator(READY)).toBeVisible({ timeout: 20_000 })
  expect(page.url()).toBe(new URL(plain('session'), baseURL).href)
  await expect(page.getByRole('region', { name: 'Customize' })).toBeVisible()
  const stored = await page.evaluate(() => JSON.parse(sessionStorage.getItem(Object.keys(sessionStorage).find((key) => key.startsWith('pascal:credential:'))!)!))
  expect(stored.configure).toBe(true)
})

for (const [refusal, access] of [['access_denied', 'anonymous'], ['access_denied', 'session'], ['access_denied', 'share'], ['no configure scope', 'session']] as const) {
  test(`a refused configure pass (${refusal}, ${access} entry) returns to the same view and hides the entry`, async ({ page, baseURL }) => {
    await mockPascal(page, () => ({ body: sceneBody({ settings: settings(null, { revision: 0 }) }) }))
    await registry(page)
    await authorize(page)
    if (access !== 'anonymous') await seedConfigureCredential(page, 3_600_000, { configure: false, access, accessToken: token })
    await page.goto(hinted(access))
    const { state } = await configureRequest(page, hinted(access))
    const auth = sceneAuth(page)
    if (refusal === 'access_denied') {
      await page.goto(`/?error=access_denied&state=${state}&iss=${encodeURIComponent(issuer)}`)
    } else {
      await exchange(page)
      await page.goto(callback(state))
    }
    await expect(page.locator(READY)).toBeVisible({ timeout: 20_000 })
    expect(page.url()).toBe(new URL(hinted(access), baseURL).href)
    // The access the entry gives, untouched; never a refusal screen.
    expect(auth.at(-1)).toBe(access === 'anonymous' ? '' : `Bearer ${token}`)
    await expect(page.locator('main[data-state="refused"]')).toHaveCount(0)
    await expect(tab(page)).toHaveCount(0)
    // For the rest of the tab: the hint is not tried again.
    await page.reload()
    await expect(page.locator(READY)).toBeVisible({ timeout: 20_000 })
    expect(page.url()).toBe(new URL(hinted(access), baseURL).href)
    await expect(tab(page)).toHaveCount(0)
  })
}

test('a fallback path that asks for configure mode is not followed', async ({ page }) => {
  await mockPascal(page)
  await registry(page)
  await authorize(page)
  const state = 's'.repeat(43)
  await page.route('**/seed', (route) => route.fulfill({ contentType: 'text/html', body: '<p>Seed</p>' }))
  await page.goto('/seed')
  await page.evaluate(({ key, issuer, project, viewer, state }) => sessionStorage.setItem(key, JSON.stringify({
    verifier: 'v'.repeat(43), state, issuer, viewer, project, redirect_uri: location.origin + '/', access: 'session',
    createdAt: Date.now(), returnPath: `/?project=${project}&viewer=${viewer}&access=session&configure=1`,
    renewal: false, signIn: false, configure: true, customize: true,
    fallbackPath: `/?project=${project}&viewer=${viewer}&access=session&configure=1`,
  })), { key: transactionKey, issuer, project, viewer, state })
  await page.goto(`/?error=access_denied&state=${state}&iss=${encodeURIComponent(issuer)}`)
  await expect(page.locator('main[data-state="reopen"]')).toBeVisible()
})

test('the panel collapses and expands, keeps the draft, shows it on the tab and remembers being closed', async ({ page }) => {
  const camera = await recordCamera(page)
  await mockPascal(page, () => ({ body: sceneBody({ settings: settings(null, { revision: 0, canConfigure: true, configureAvailable: true }) }) }))
  await registry(page)
  await seedConfigureCredential(page)
  await page.goto(configureEntry)
  await expect(page.locator(READY)).toBeVisible({ timeout: 20_000 })
  const panel = page.getByRole('region', { name: 'Customize' })
  // Arriving with configure=1 opens it.
  await expect(panel).toBeVisible()
  await expect(panel.getByRole('group', { name: 'Camera' })).toContainText('Default (frames the house)')
  await orbit(page, camera)
  await panel.getByRole('button', { name: 'Use current view' }).click()
  await expect(panel.getByRole('group', { name: 'Camera' })).toContainText('Custom')
  await expect(panel.getByRole('status')).toHaveText('Unsaved changes')
  await panel.getByRole('button', { name: 'Collapse customize' }).click()
  await expect(panel).toHaveCount(0)
  await expect(tab(page)).toHaveAttribute('aria-expanded', 'false')
  await expect(tab(page)).toHaveAttribute('data-dirty', 'true')
  await expect(tab(page)).toHaveAccessibleName('Customize, unsaved changes')
  await expect(tab(page)).toBeFocused()
  page.on('dialog', (dialog) => void dialog.accept())
  await page.reload()
  await expect(page.locator(READY)).toBeVisible({ timeout: 20_000 })
  // Closed stays closed for the tab; the draft is still there.
  await expect(panel).toHaveCount(0)
  await expect(tab(page)).toHaveAttribute('data-dirty', 'true')
  await tab(page).click()
  await expect(panel).toBeVisible()
  await expect(panel.getByRole('status')).toHaveText('Unsaved changes')
  await page.keyboard.press('Escape')
  await expect(panel).toHaveCount(0)
})
