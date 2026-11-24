import { expect, type Page, test } from '@playwright/test'
import type { ViewerSettings } from '../src/pascal'
import { cors, ISSUER, liveScene, mockPascal, PROJECT, TOKEN, VIEWER } from './pascal-mocks'

// The full viewer is slow under software rendering. The shared client's handoff (scope=configure,
// renewal, refusals) is tested in listing; these cover what the showcase saves and opens on.
test.setTimeout(90_000)

const READY = 'main[data-scene-ready=true]'
const CHROME = '.sc-chrome'
const configureEntry = `/?project=${PROJECT}&viewer=${VIEWER}&access=session&configure=1`
const CAMERA = { position: [7, 3, 9], target: [0, 1, 0] }

const settings = (data: ViewerSettings['data'], { revision = 3, canConfigure = false } = {}): ViewerSettings =>
  ({ viewerId: VIEWER, revision, data, canConfigure })
const withSettings = (value: ViewerSettings) => ({ ...liveScene(), settings: value })

async function seedConfigureCredential(page: Page) {
  await page.addInitScript(({ issuer, project, viewer, token }) => {
    if (sessionStorage.getItem('fixture:seeded')) return
    sessionStorage.setItem('fixture:seeded', '1')
    sessionStorage.setItem(`pascal:credential:${JSON.stringify([issuer, viewer, project, location.origin])}`,
      JSON.stringify({ issuer, project_id: project, viewer_id: viewer, origin: location.origin, access: 'session',
        configure: true, access_token: token, renewalAttempted: false,
        expires_at: new Date(Date.now() + 3_600_000).toISOString() }))
  }, { issuer: ISSUER, project: PROJECT, viewer: VIEWER, token: TOKEN })
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
  await expect(page.getByRole('region', { name: 'Customize this viewer' })).toHaveCount(0)
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

test('a manager sets the view on screen as the opening view and saves it with the read revision', async ({ page }) => {
  await mockPascal(page, () => ({ body: withSettings(settings({ v: 1, other: true }, { canConfigure: true })) }))
  await seedConfigureCredential(page)
  const writes: { revision: number; data: { other?: boolean; opening?: { camera?: { position: number[] }; time?: string; mode?: string } } }[] = []
  await page.route('**/api/projects/*/viewer-settings', (route) => {
    const headers = { ...cors, 'access-control-allow-methods': 'PUT, OPTIONS' }
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers })
    const body = route.request().postDataJSON()
    writes.push(body)
    return route.fulfill({ headers, json: { settings: settings(body.data, { revision: 4, canConfigure: true }) } })
  })
  await page.goto(configureEntry)
  await expect(page.locator(READY)).toBeVisible({ timeout: 60_000 })
  const bar = page.getByRole('region', { name: 'Customize this viewer' })
  await expect(bar).toBeVisible()
  await page.getByRole('button', { name: 'Night', exact: true }).locator('svg').click({ force: true })
  await expect(page.locator(CHROME)).toHaveAttribute('data-time-of-day', 'night')
  await page.getByRole('button', { name: 'Exploded', exact: true }).locator('svg').click({ force: true })
  await bar.getByRole('button', { name: 'Set current view as opening view' }).click()
  await expect(bar.getByRole('status')).toHaveText('Unsaved changes')
  await bar.getByRole('button', { name: 'Save' }).click()
  await expect(bar.getByRole('status')).toHaveText('Saved')
  expect(writes).toHaveLength(1)
  expect(writes[0]!.revision).toBe(3)
  expect(writes[0]!.data.other).toBe(true)
  expect(writes[0]!.data.opening).toMatchObject({ time: 'night', mode: 'exploded' })
  expect(writes[0]!.data.opening!.camera!.position).toHaveLength(3)
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
})
