import { expect, type Page, test } from '@playwright/test'
import { cors, mockPascal, sceneBody } from './pascal-mocks'

// The shared client's handoff (scope=configure, renewal, refusals) is tested in listing; these
// tests cover what the drawing saves and opens on.
const issuer = 'https://editor.pascal.app'
const project = 'fixture-house'
const viewer = 'viewer_fixture'
const token = `pvh_${'t'.repeat(43)}`
const configureEntry = `/?project=${project}&viewer=${viewer}&access=session&configure=1`
const READY = 'main[data-state="ready"]'
const OPENING = { projection: 'plan', turns: 2, zoom: 2, target: [0.5, 0, -0.5] }

const settings = (data: unknown, { revision = 3, canConfigure = false } = {}) =>
  ({ viewerId: viewer, revision, data, canConfigure })

async function registry(page: Page) {
  await page.route('**/api/viewers/resolve?*', (route) => route.fulfill({ headers: cors, json: {
    availability: 'available', viewer_id: viewer, redirect_uri: new URL(route.request().url()).searchParams.get('origin') + '/',
  } }))
}

async function seedConfigureCredential(page: Page) {
  await page.addInitScript(({ issuer, project, viewer, token }) => {
    if (sessionStorage.getItem('fixture:seeded')) return
    sessionStorage.setItem('fixture:seeded', '1')
    sessionStorage.setItem(`pascal:credential:${JSON.stringify([issuer, viewer, project, location.origin])}`,
      JSON.stringify({ issuer, project_id: project, viewer_id: viewer, origin: location.origin, access: 'session',
        configure: true, access_token: token, renewalAttempted: false,
        expires_at: new Date(Date.now() + 3_600_000).toISOString() }))
  }, { issuer, project, viewer, token })
}

async function settingsWrites(page: Page, answer: (body: { revision: number; data: unknown }) => { status?: number; json: unknown }) {
  const calls: { revision: number; data: { opening?: typeof OPENING } }[] = []
  await page.route('**/api/projects/*/viewer-settings', (route) => {
    const headers = { ...cors, 'access-control-allow-methods': 'PUT, OPTIONS' }
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers })
    calls.push(route.request().postDataJSON())
    const { status = 200, json } = answer(route.request().postDataJSON())
    return route.fulfill({ status, json, headers })
  })
  return calls
}

/** The orthographic camera of the last frame drawn: position and zoom. */
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
      type Camera = { isOrthographicCamera?: boolean; zoom: number; position: { x: number; y: number; z: number } }
      object.render = function (this: unknown, scene: unknown, camera: Camera) {
        if (camera?.isOrthographicCamera && camera.zoom !== 1) poses.push([camera.position.x, camera.position.y, camera.position.z, camera.zoom])
        return original.apply(this, [scene, camera])
      }
    })
  })
  return async () => (await page.evaluate(() => (window as unknown as { cameraPoses: number[][] }).cameraPoses)).at(-1)
}

const plan = (page: Page) => page.getByRole('button', { name: 'Plan', exact: true })

test('a visitor opens on the saved view: plan, its side, zoom and centre', async ({ page }) => {
  const camera = await recordCamera(page)
  await mockPascal(page, () => ({ body: sceneBody({ settings: settings({ v: 1, opening: OPENING }) }) }))
  await page.goto(`/?project=${project}`)
  await expect(page.locator(READY)).toBeVisible({ timeout: 20_000 })
  await expect(plan(page)).toHaveAttribute('aria-pressed', 'true')
  await expect.poll(camera).toBeTruthy()
  const [x, , z] = (await camera())!
  // Straight down onto the saved centre.
  expect(x).toBeCloseTo(OPENING.target[0]!, 1)
  expect(z).toBeCloseTo(OPENING.target[2]!, 1)
  await expect(page.getByRole('region', { name: 'Customize' })).toHaveCount(0)
})

for (const [name, body] of [
  ['without a settings field', sceneBody()],
  ['with invalid data', sceneBody({ settings: settings({ v: 1, opening: { ...OPENING, projection: 'elevation' } }) })],
] as const) {
  test(`a read ${name} opens on the first corner`, async ({ page }) => {
    await mockPascal(page, () => ({ body }))
    await page.goto(`/?project=${project}`)
    await expect(page.locator(READY)).toBeVisible({ timeout: 20_000 })
    await expect(page.getByRole('button', { name: 'Axo', exact: true })).toHaveAttribute('aria-pressed', 'true')
  })
}

test('a manager saves the view on screen with the read revision, and a draft survives a reload', async ({ page }) => {
  await mockPascal(page, () => ({ body: sceneBody({ settings: settings(null, { revision: 0, canConfigure: true }) }) }))
  await registry(page)
  await seedConfigureCredential(page)
  const writes = await settingsWrites(page, (body) => ({ json: { settings: settings(body.data, { revision: 1, canConfigure: true }) } }))
  await page.goto(configureEntry)
  await expect(page.locator(READY)).toBeVisible({ timeout: 20_000 })
  const bar = page.getByRole('region', { name: 'Customize' })
  await expect(bar.getByRole('button', { name: 'Clear opening view' })).toBeDisabled()
  await page.keyboard.press('ArrowRight')
  await plan(page).click()
  await bar.getByRole('button', { name: 'Use current view' }).click()
  await expect(bar.getByRole('status')).toHaveText('Unsaved changes')

  page.on('dialog', (dialog) => void dialog.accept())
  await page.reload()
  await expect(page.locator(READY)).toBeVisible({ timeout: 20_000 })
  await expect(bar.getByRole('status')).toHaveText('Unsaved changes')
  await expect(plan(page)).toHaveAttribute('aria-pressed', 'true')

  await bar.getByRole('button', { name: 'Save' }).click()
  await expect(bar.getByRole('status')).toHaveText('Saved')
  expect(writes).toHaveLength(1)
  expect(writes[0]!.revision).toBe(0)
  const opening = writes[0]!.data.opening!
  expect(opening.projection).toBe('plan')
  expect([0, 1, 2, 3]).toContain(opening.turns)
  expect(opening.zoom).toBeCloseTo(1, 1)
  expect(opening.target).toHaveLength(3)
})

test('a conflict says so and loads the latest', async ({ page }) => {
  await mockPascal(page, () => ({ body: sceneBody({ settings: settings({ v: 1 }, { canConfigure: true }) }) }))
  await registry(page)
  await seedConfigureCredential(page)
  const writes = await settingsWrites(page, () => ({ status: 409, json: { error: 'conflict',
    settings: settings({ v: 1, opening: OPENING }, { revision: 4, canConfigure: true }) } }))
  await page.goto(configureEntry)
  await expect(page.locator(READY)).toBeVisible({ timeout: 20_000 })
  const bar = page.getByRole('region', { name: 'Customize' })
  await bar.getByRole('button', { name: 'Use current view' }).click()
  await bar.getByRole('button', { name: 'Save' }).click()
  await expect(bar.getByRole('status')).toHaveText('Someone else saved changes.')
  expect(writes[0]!.revision).toBe(3)
  await bar.getByRole('button', { name: 'Load the latest' }).click()
  await expect(bar.getByRole('button', { name: 'Save' })).toBeDisabled()
  await expect(bar.getByRole('button', { name: 'Clear opening view' })).toBeEnabled()
})

test('the panel fits a 360 px screen', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 })
  await mockPascal(page, () => ({ body: sceneBody({ settings: settings(null, { revision: 0, canConfigure: true }) }) }))
  await registry(page)
  await seedConfigureCredential(page)
  await page.goto(configureEntry)
  await expect(page.locator(READY)).toBeVisible({ timeout: 20_000 })
  const box = (await page.getByRole('region', { name: 'Customize' }).boundingBox())!
  expect(box.x).toBeGreaterThanOrEqual(0)
  expect(box.x + box.width).toBeLessThanOrEqual(360)
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360)
})

test('the panel shows projection, turn and zoom; choosing one turns the drawing and goes in the draft', async ({ page }) => {
  await mockPascal(page, () => ({ body: sceneBody({ settings: settings({ v: 1 }, { canConfigure: true }) }) }))
  await registry(page)
  await seedConfigureCredential(page)
  const writes = await settingsWrites(page, (body) => ({ json: { settings: settings(body.data, { revision: 4, canConfigure: true }) } }))
  await page.goto(configureEntry)
  await expect(page.locator(READY)).toBeVisible({ timeout: 20_000 })
  const panel = page.getByRole('region', { name: 'Customize' })
  await expect(panel.getByRole('group', { name: 'Projection' })).toContainText('Default (axonometric)')
  await expect(panel.getByRole('group', { name: 'Zoom' })).toContainText('Default (fits the building)')
  await panel.getByRole('radiogroup', { name: 'Projection' }).getByRole('radio', { name: 'Plan' }).click()
  await expect(plan(page)).toHaveAttribute('aria-pressed', 'true')
  await panel.getByRole('radiogroup', { name: 'Turn' }).getByRole('radio', { name: '180°' }).click()
  await expect(panel.getByRole('group', { name: 'Projection' })).toContainText('Plan')
  await expect(panel.getByRole('group', { name: 'Turn' })).toContainText('180° round')
  await expect(panel.getByRole('status')).toHaveText('Unsaved changes')
  // The drawing turned there too: "Use current view" reads the same turn back.
  await panel.getByRole('button', { name: 'Use current view' }).click()
  await expect(panel.getByRole('radiogroup', { name: 'Turn' }).getByRole('radio', { name: '180°' })).toHaveAttribute('aria-checked', 'true')
  await panel.getByRole('button', { name: 'Fit the building' }).click()
  await panel.getByRole('button', { name: 'Save' }).click()
  await expect(panel.getByRole('status')).toHaveText('Saved')
  expect(writes[0]!.data.opening).toMatchObject({ projection: 'plan', turns: 2, zoom: 1 })
  expect(writes[0]!.data.opening!.target).toBeUndefined()
})

test('a manager from Open in Pascal gets a collapsed entry; a visitor without the right gets none', async ({ page }) => {
  await mockPascal(page, () => ({ body: sceneBody({ settings: { ...settings(null, { revision: 0 }), configureAvailable: true } }) }))
  await registry(page)
  await page.addInitScript(({ issuer, project, viewer, token }) => {
    sessionStorage.setItem(`pascal:credential:${JSON.stringify([issuer, viewer, project, location.origin])}`,
      JSON.stringify({ issuer, project_id: project, viewer_id: viewer, origin: location.origin, access: 'session',
        access_token: token, renewalAttempted: false, expires_at: new Date(Date.now() + 3_600_000).toISOString() }))
  }, { issuer, project, viewer, token })
  await page.goto(`/?project=${project}&viewer=${viewer}&access=session`)
  await expect(page.locator(READY)).toBeVisible({ timeout: 20_000 })
  await expect(page.getByRole('button', { name: 'Customize', exact: true })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Customize' })).toHaveCount(0)
})
