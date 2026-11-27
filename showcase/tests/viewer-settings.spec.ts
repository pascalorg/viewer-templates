import { expect, type Page, test } from '@playwright/test'
import type { ViewerSettings } from '../src/pascal'
import { cors, ISSUER, liveScene, mockPascal, PROJECT, sceneBody, TOKEN, VIEWER } from './pascal-mocks'

// The full viewer is slow under software rendering. The shared client's handoff (scope=configure,
// renewal, refusals) is tested in listing; these cover what the showcase saves and opens on.
test.setTimeout(90_000)

const READY = 'main[data-scene-ready=true]'
const CHROME = '.sc-chrome'
const configureEntry = `/?project=${PROJECT}&viewer=${VIEWER}&access=session&configure=1`
const CAMERA = { position: [7, 3, 9], target: [0, 1, 0] }

const settings = (data: ViewerSettings['data'], options: { revision?: number; canConfigure?: boolean; configureAvailable?: boolean } = {}): ViewerSettings => {
  const { revision = 3, canConfigure = false, configureAvailable = canConfigure } = options
  return { viewerId: VIEWER, revision, data, canConfigure, configureAvailable }
}
const withSettings = (value: ViewerSettings) => ({ ...liveScene(), settings: value })

async function seedConfigureCredential(page: Page, { configure = true } = {}) {
  await page.addInitScript(({ issuer, project, viewer, token, configure }) => {
    if (sessionStorage.getItem('fixture:seeded')) return
    sessionStorage.setItem('fixture:seeded', '1')
    sessionStorage.setItem(`pascal:credential:${JSON.stringify([issuer, viewer, project, location.origin])}`,
      JSON.stringify({ issuer, project_id: project, viewer_id: viewer, origin: location.origin, access: 'session',
        ...(configure ? { configure: true } : {}), access_token: token, renewalAttempted: false,
        expires_at: new Date(Date.now() + 3_600_000).toISOString() }))
  }, { issuer: ISSUER, project: PROJECT, viewer: VIEWER, token: TOKEN, configure })
  await page.route('**/api/viewers/resolve?*', (route) => route.fulfill({ headers: cors, json: {
    viewer_id: VIEWER, redirect_uri: new URL(route.request().url()).searchParams.get('origin') + '/', availability: 'available',
  } }))
}

/** The camera position of the last frame drawn, through three's devtools hook (as in viewer.spec). */
async function recordCamera(page: Page) {
  await page.addInitScript(() => {
    const poses: number[][] = []
    ;(window as unknown as { cameraPoses: number[][] }).cameraPoses = poses
    const devtools = new EventTarget()
    ;(window as unknown as { __THREE_DEVTOOLS__: EventTarget }).__THREE_DEVTOOLS__ = devtools
    devtools.addEventListener('observe', (event) => {
      const object = (event as CustomEvent).detail as Record<string, unknown>
      if (!object.isWebGPURenderer) return
      const original = object.render as (...args: unknown[]) => unknown
      type Camera = { isPerspectiveCamera?: boolean; parent: { type?: string } | null; position: { x: number; y: number; z: number } }
      object.render = function (this: unknown, scene: unknown, camera: Camera) {
        if (camera?.isPerspectiveCamera && camera.parent?.type !== 'CubeCamera') poses.push([camera.position.x, camera.position.y, camera.position.z])
        return original.apply(this, [scene, camera])
      }
    })
  })
  return async () => (await page.evaluate(() => (window as unknown as { cameraPoses: number[][] }).cameraPoses)).at(-1)
}

async function expectCameraAt(camera: () => Promise<number[] | undefined>, expected: number[]) {
  await expect.poll(async () => {
    const pose = await camera()
    return pose ? Math.hypot(...expected.map((value, axis) => value - pose[axis]!)) : Infinity
  }, { timeout: 20_000 }).toBeLessThan(0.05)
}

test('a visitor settles into the saved opening view: camera, time of day and mode', async ({ page }) => {
  const camera = await recordCamera(page)
  await mockPascal(page, () => ({ body: withSettings(settings({ v: 1, opening: { camera: CAMERA, time: 'night', mode: 'exploded' } })) }))
  await page.goto(`/?project=${PROJECT}`)
  await expect(page.locator(READY)).toBeVisible({ timeout: 60_000 })
  const chrome = page.locator(CHROME)
  await expect(chrome).toHaveAttribute('data-time-of-day', 'night')
  await expect(chrome).toHaveAttribute('data-mode', 'exploded')
  await expectCameraAt(camera, CAMERA.position)
  await expect(page.getByRole('region', { name: 'Customize' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /^Customize/ })).toHaveCount(0)
  // Reset view returns to the opening view, not the template's.
  await page.getByRole('button', { name: 'Day', exact: true }).locator('svg').click({ force: true })
  await expect(chrome).toHaveAttribute('data-time-of-day', 'midday')
  await page.getByRole('button', { name: 'Reset view' }).click()
  await expect(chrome).toHaveAttribute('data-time-of-day', 'night')
  await expect(chrome).toHaveAttribute('data-mode', 'exploded')
})

test('a camera in the link wins over the saved one; the saved time still applies', async ({ page }) => {
  const camera = await recordCamera(page)
  await mockPascal(page, () => ({ body: withSettings(settings({ v: 1, opening: { camera: CAMERA, time: 'day' } })) }))
  await page.goto(`/?project=${PROJECT}&camera=-6,4,8,0,1,0`)
  await expect(page.locator(READY)).toBeVisible({ timeout: 60_000 })
  await expect(page.locator(CHROME)).toHaveAttribute('data-time-of-day', 'midday')
  await expectCameraAt(camera, [-6, 4, 8])
})

test('invalid saved values fall back field by field: walkthrough is never the opening mode', async ({ page }) => {
  await mockPascal(page, () => ({ body: withSettings(settings({ v: 1, opening: { camera: { position: 'front' }, time: 'noon', mode: 'walkthrough' } })) }))
  await page.goto(`/?project=${PROJECT}`)
  await expect(page.locator(READY)).toBeVisible({ timeout: 60_000 })
  const chrome = page.locator(CHROME)
  // One floor: the template's default is Exterior at dusk.
  await expect(chrome).toHaveAttribute('data-sky', 'dusk')
  await expect(chrome).toHaveAttribute('data-mode', 'exterior')
})

/** Answers PUT /viewer-settings with the next revision and records the bodies. */
async function settingsWrites(page: Page) {
  const writes: { revision: number; data: { other?: boolean; opening?: { camera?: { position: number[] }; time?: string; mode?: string } } }[] = []
  await page.route('**/api/projects/*/viewer-settings', (route) => {
    const headers = { ...cors, 'access-control-allow-methods': 'PUT, OPTIONS' }
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers })
    const body = route.request().postDataJSON()
    writes.push(body)
    return route.fulfill({ headers, json: { settings: settings(body.data, { revision: body.revision + 1, canConfigure: true }) } })
  })
  return writes
}

test('a manager picks the time of day and mode in the panel: the screen follows and Save keeps exactly that', async ({ page }) => {
  await mockPascal(page, () => ({ body: withSettings(settings({ v: 1, other: true }, { canConfigure: true })) }))
  await seedConfigureCredential(page)
  const writes = await settingsWrites(page)
  await page.goto(configureEntry)
  await expect(page.locator(READY)).toBeVisible({ timeout: 60_000 })
  const panel = page.getByRole('region', { name: 'Customize' })
  const chrome = page.locator(CHROME)
  await expect(panel).toBeVisible()
  const time = panel.getByRole('radiogroup', { name: 'Time of day' })
  const mode = panel.getByRole('radiogroup', { name: 'Mode' })
  await expect(time.getByRole('radio', { name: 'Default' })).toHaveAttribute('aria-checked', 'true')
  await expect(panel.getByRole('group', { name: 'Time of day' })).toContainText('Default (Dusk)')
  await expect(panel.getByRole('group', { name: 'Camera' })).toContainText('Default (frames the house)')
  await time.getByRole('radio', { name: 'Night' }).click()
  await expect(chrome).toHaveAttribute('data-time-of-day', 'night')
  await mode.getByRole('radio', { name: 'Cut view' }).click()
  await expect(chrome).toHaveAttribute('data-mode', 'cut')
  await expect(panel.getByRole('status')).toHaveText('Unsaved changes')
  await panel.getByRole('button', { name: 'Save' }).click()
  await expect(panel.getByRole('status')).toHaveText('Saved')
  expect(writes[0]).toEqual({ revision: 3, data: { v: 1, other: true, opening: { time: 'night', mode: 'cut' } } })
  // The dial changes the screen, not what is saved, and the panel says so.
  await page.getByRole('button', { name: 'Day', exact: true }).locator('svg').click({ force: true })
  await expect(chrome).toHaveAttribute('data-time-of-day', 'midday')
  await expect(panel.locator('[data-differs]')).toContainText('On screen now: Day')
  await expect(panel.getByRole('button', { name: 'Save' })).toBeDisabled()
  await expect(time.getByRole('radio', { name: 'Night' })).toHaveAttribute('aria-checked', 'true')
  // "Use current view" takes the screen as it is: the camera, Day and the Cut view.
  await panel.getByRole('button', { name: 'Use current view' }).click()
  await expect(time.getByRole('radio', { name: 'Day' })).toHaveAttribute('aria-checked', 'true')
  await expect(panel.getByRole('group', { name: 'Camera' })).toContainText('Custom')
  await expect(panel.locator('[data-differs]')).toHaveCount(0)
  await panel.getByRole('button', { name: 'Save' }).click()
  await expect(panel.getByRole('status')).toHaveText('Saved')
  expect(writes[1]!.revision).toBe(4)
  expect(writes[1]!.data.opening).toMatchObject({ time: 'day', mode: 'cut' })
  expect(writes[1]!.data.opening!.camera!.position).toHaveLength(3)
  // Back to the defaults, field by field: nothing saved under opening.
  await time.getByRole('radio', { name: 'Default' }).click()
  await mode.getByRole('radio', { name: 'Default' }).click()
  await panel.getByRole('button', { name: 'Clear camera' }).click()
  await panel.getByRole('button', { name: 'Save' }).click()
  await expect(panel.getByRole('status')).toHaveText('Saved')
  expect(writes[2]).toEqual({ revision: 5, data: { v: 1, other: true } })
})

test('a manager arriving from Open in Pascal holds the pass behind a collapsed Customize entry, and opens it in place', async ({ page }) => {
  await mockPascal(page, () => ({ body: withSettings(settings(null, { revision: 0, canConfigure: true })) }))
  await seedConfigureCredential(page)
  await page.goto(`/?project=${PROJECT}&viewer=${VIEWER}&access=session`)
  await expect(page.locator(READY)).toBeVisible({ timeout: 60_000 })
  const entry = page.getByRole('button', { name: 'Customize', exact: true })
  await expect(entry).toBeVisible()
  await expect(page.getByRole('region', { name: 'Customize' })).toHaveCount(0)
  // Clear of sound and full screen.
  const tab = (await entry.boundingBox())!
  for (const utility of await page.locator('.sc-utility').all()) {
    const box = (await utility.boundingBox())!
    expect(box.y + box.height <= tab.y || tab.y + tab.height <= box.y || box.x + box.width <= tab.x || tab.x + tab.width <= box.x).toBe(true)
  }
  await entry.click()
  await expect(page.getByRole('region', { name: 'Customize' })).toBeVisible()
  expect(new URL(page.url()).searchParams.has('configure')).toBe(false)
})

test.describe('with motion', () => {
  test.use({ reducedMotion: 'no-preference' })

  test('the intro ends in the saved opening view', async ({ page }) => {
    const camera = await recordCamera(page)
    await mockPascal(page, () => ({ body: withSettings(settings({ v: 1, opening: { camera: CAMERA, time: 'day', mode: 'exterior' } })) }))
    await page.goto(`/?project=${PROJECT}`)
    await expect(page.locator(READY)).toBeVisible({ timeout: 60_000 })
    const chrome = page.locator(CHROME)
    await expect(chrome).toHaveAttribute('data-intro', 'true')
    await expect(chrome).toHaveAttribute('data-intro', 'false', { timeout: 30_000 })
    await expect(chrome).toHaveAttribute('data-time-of-day', 'midday')
    await expect(chrome).toHaveAttribute('data-mode', 'exterior')
    await expectCameraAt(camera, CAMERA.position)
  })

  test('over a bake, the intro ends at the saved time of day (a sun height, placed at the site)', async ({ page }) => {
    await mockPascal(page, () => ({ body: { ...sceneBody(), settings: settings({ v: 1, opening: { time: 'dawn', mode: 'exterior' } }) } }))
    await page.goto(`/?project=${PROJECT}`)
    await expect(page.locator(`${READY}[data-source="baked"]`)).toBeVisible({ timeout: 60_000 })
    const chrome = page.locator(CHROME)
    await expect(chrome).toHaveAttribute('data-intro', 'false', { timeout: 30_000 })
    await expect(chrome).toHaveAttribute('data-sky', 'dawn')
    await expect(chrome).toHaveAttribute('data-mode', 'exterior')
  })
})

// A configure credential Pascal rejects before its expiry, with this tab's one recovery round trip
// already spent (the replacement was rejected too).
async function spentRecovery(page: Page) {
  await page.addInitScript(({ issuer, project, viewer }) => {
    sessionStorage.setItem(`pascal:recovery:${JSON.stringify([issuer, viewer, project, location.origin])}`, '1')
  }, { issuer: ISSUER, project: PROJECT, viewer: VIEWER })
}

function rejectingScenes(page: Page, publicProject: boolean) {
  return page.route('**/api/projects/*/scene*', (route) => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors })
    if (route.request().headers().authorization) return route.fulfill({ status: 401, json: { error: 'unauthorized' }, headers: cors })
    if (!publicProject) return route.fulfill({ status: 404, json: { error: 'not_found' }, headers: cors })
    return route.fulfill({ json: withSettings(settings(null, { revision: 0 })), headers: cors })
  })
}

test('the reopen screen after Customize restarts Customize with scope=configure', async ({ page }) => {
  await mockPascal(page)
  await rejectingScenes(page, false)
  await seedConfigureCredential(page)
  await spentRecovery(page)
  await page.route('**/viewer/authorize?*', (route) => route.fulfill({ contentType: 'text/html', body: '<p>Pascal authorize</p>' }))
  await page.goto(configureEntry)
  await expect(page.getByRole('heading', { name: 'Reopen from Pascal' })).toBeVisible()
  await expect(page.getByText('Sign in again to keep customizing, or open this project from Pascal.')).toBeVisible()
  await page.getByRole('button', { name: 'Sign in with Pascal' }).click()
  await page.waitForURL(`${ISSUER}/viewer/authorize?*`)
  const query = new URL(page.url()).searchParams
  expect(query.get('scope')).toBe('configure')
  expect(query.get('interaction')).toBe('sign_in')
})

test('a public project falls back to its public view, read-only, and says Customize needs reopening', async ({ page, baseURL }) => {
  await mockPascal(page)
  await rejectingScenes(page, true)
  await seedConfigureCredential(page)
  await spentRecovery(page)
  await page.goto(configureEntry)
  await expect(page.locator(READY)).toBeVisible({ timeout: 60_000 })
  expect(page.url()).toBe(new URL(`/?project=${PROJECT}`, baseURL).href)
  await expect(page.getByRole('region', { name: 'Customize' })).toHaveCount(0)
  await expect(page.getByText('Your Customize session ended.', { exact: false })).toBeVisible()
})
