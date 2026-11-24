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

const settings = (data: unknown, { revision = 3, canConfigure = false } = {}) =>
  ({ viewerId: viewer, revision, data, canConfigure })

async function registry(page: Page) {
  await page.route('**/api/viewers/resolve?*', (route) => route.fulfill({ headers: cors, json: {
    availability: 'available', viewer_id: viewer, redirect_uri: new URL(route.request().url()).searchParams.get('origin') + '/',
  } }))
}

async function authorize(page: Page) {
  await page.route('**/viewer/authorize?*', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<p>Pascal authorize</p>' }))
}

/** A configure credential in the tab, as the exchange leaves it. */
async function seedConfigureCredential(page: Page, remainingMs = 3_600_000) {
  await page.addInitScript(({ issuer, project, viewer, token, remainingMs }) => {
    if (sessionStorage.getItem('fixture:seeded')) return
    sessionStorage.setItem('fixture:seeded', '1')
    sessionStorage.setItem(`pascal:credential:${JSON.stringify([issuer, viewer, project, location.origin])}`,
      JSON.stringify({ issuer, project_id: project, viewer_id: viewer, origin: location.origin, access: 'session',
        configure: true, access_token: token, renewalAttempted: false,
        expires_at: new Date(Date.now() + remainingMs).toISOString() }))
  }, { issuer, project, viewer, token, remainingMs })
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
  }, { intervals: [250] }).toBe(true)
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
  await page.route('**/inspect', (route) => route.fulfill({ contentType: 'text/html', body: '<p>Inspect</p>' }))
  await page.goto('/inspect')
  const saved = await page.evaluate((key) => JSON.parse(sessionStorage.getItem(key)!), transactionKey)
  expect(saved.configure).toBe(true)
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

for (const entry of ['access=share&configure=1', 'access=anonymous&configure=1', 'access=session&configure=true', 'access=session&configure=1&configure=1']) {
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
    await expect(page.getByRole('region', { name: 'Customize this viewer' })).toBeVisible()
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

test('a visitor opens on the saved opening view, with no settings bar', async ({ page }) => {
  const camera = await recordCamera(page)
  await mockPascal(page, () => ({ body: sceneBody({ settings: settings({ v: 1, opening: { camera: OPENING } }) }) }))
  await page.goto(`/?project=${project}`)
  await expect(page.locator(READY)).toBeVisible({ timeout: 20_000 })
  await expect.poll(camera).toBeTruthy()
  expectNear(await camera(), OPENING.position)
  await expect(page.getByRole('region', { name: 'Customize this viewer' })).toHaveCount(0)
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
  const bar = page.getByRole('region', { name: 'Customize this viewer' })
  await expect(bar.getByRole('button', { name: 'Save' })).toBeDisabled()
  await expect(bar.getByRole('button', { name: 'Reset opening view' })).toBeDisabled()
  await orbit(page, camera)
  await bar.getByRole('button', { name: 'Set current view as opening view' }).click()
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
  // Reset is a change too: back to the template's default.
  await bar.getByRole('button', { name: 'Reset opening view' }).click()
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
  const bar = page.getByRole('region', { name: 'Customize this viewer' })
  await bar.getByRole('button', { name: 'Set current view as opening view' }).click()
  await bar.getByRole('button', { name: 'Save' }).click()
  await expect(bar.getByRole('status')).toHaveText('Someone else saved changes.')
  expect(writes[0]!.body.revision).toBe(0)
  await bar.getByRole('button', { name: 'Load the latest' }).click()
  await expect(bar.getByRole('status')).toHaveText('')
  await expect(bar.getByRole('button', { name: 'Save' })).toBeDisabled()
  await expect(bar.getByRole('button', { name: 'Reset opening view' })).toBeEnabled()
  await expect(bar.getByRole('button', { name: 'Load the latest' })).toHaveCount(0)
})

test('an ended session asks to reopen from Pascal', async ({ page }) => {
  await mockPascal(page, () => ({ body: sceneBody({ settings: settings(null, { revision: 0, canConfigure: true }) }) }))
  await registry(page)
  await seedConfigureCredential(page)
  await settingsWrites(page, () => ({ status: 401, json: { error: 'unauthorized' } }))
  await page.goto(configureEntry)
  await expect(page.locator(READY)).toBeVisible({ timeout: 20_000 })
  const bar = page.getByRole('region', { name: 'Customize this viewer' })
  await bar.getByRole('button', { name: 'Set current view as opening view' }).click()
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
  const bar = page.getByRole('region', { name: 'Customize this viewer' })
  await orbit(page, camera)
  await bar.getByRole('button', { name: 'Set current view as opening view' }).click()
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
  await expect(bar.getByRole('status')).toHaveText('')
  expect(await page.evaluate(() => Object.keys(sessionStorage).filter((key) => key.startsWith('pascal:settings-draft:')))).toEqual([])
  expect(writes).toHaveLength(0)
})
