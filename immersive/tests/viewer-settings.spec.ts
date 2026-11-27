import { expect, type Page, test } from '@playwright/test'
import type { ViewerSettings } from '../src/pascal'
import { liveFixture } from './fixtures/scenes'
import { cors, ISSUER, liveScene, mockPascal, PROJECT, sceneBody, TOKEN, VIEWER } from './pascal-mocks'

// The full viewer is slow under software rendering. The shared client's handoff (scope=configure,
// renewal, refusals) is tested in listing; these cover what immersive saves and opens on.
test.setTimeout(90_000)

const READY = 'main[data-scene-ready=true]'
const configureEntry = `/?project=${PROJECT}&viewer=${VIEWER}&access=session&configure=1`
const CAMERA = { position: [7, 3, 9], target: [0, 1, 0] }

const settings = (data: ViewerSettings['data'], options: { revision?: number; canConfigure?: boolean; configureAvailable?: boolean } = {}): ViewerSettings => {
  const { revision = 3, canConfigure = false, configureAvailable = canConfigure } = options
  return { viewerId: VIEWER, revision, data, canConfigure, configureAvailable }
}
const withSettings = (value: ViewerSettings) => ({ ...liveScene(), settings: value })

/** The live fixture's zone split in three rooms, left to right: Kitchen, Living room, Study. */
function threeRooms() {
  const graph = structuredClone(liveFixture)
  const room = graph.nodes.zone_fixture as Record<string, unknown>
  const strips: [string, string, number, number][] = [
    ['zone_fixture', 'Kitchen', -2.8, -1], ['zone_living', 'Living room', -1, 1], ['zone_study', 'Study', 1, 2.8],
  ]
  for (const [id, name, x0, x1] of strips) {
    graph.nodes[id] = { ...room, id, name, spaceRole: 'room', polygon: [[x0, -1.8], [x1, -1.8], [x1, 1.8], [x0, 1.8]] } as never
  }
  graph.nodes.level_fixture!.children!.push('zone_living', 'zone_study')
  return { ...liveScene(), graph }
}
const roomsWith = (value: ViewerSettings) => ({ ...threeRooms(), settings: value })

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

/** The camera position of the last frame drawn, through three's devtools hook (as in showcase). */
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

/** Answers PUT /viewer-settings with the next revision and records the bodies. */
async function settingsWrites(page: Page) {
  const writes: { revision: number; data: { other?: boolean; opening?: Record<string, unknown>; tour?: { autostart?: boolean } } }[] = []
  await page.route('**/api/projects/*/viewer-settings', (route) => {
    const headers = { ...cors, 'access-control-allow-methods': 'PUT, OPTIONS' }
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers })
    const body = route.request().postDataJSON()
    writes.push(body)
    return route.fulfill({ headers, json: { settings: settings(body.data, { revision: body.revision + 1, canConfigure: true }) } })
  })
  return writes
}

test('a visitor arrives on the saved opening: camera, time of day and walls, and no Customize', async ({ page }) => {
  const camera = await recordCamera(page)
  await mockPascal(page, () => ({ body: withSettings(settings({ v: 1, opening: { camera: CAMERA, time: 'night', walls: 'cutaway' } })) }))
  await page.goto(`/?project=${PROJECT}`)
  const main = page.locator(READY)
  await expect(main).toBeVisible({ timeout: 60_000 })
  await expect(main).toHaveAttribute('data-time-of-day', 'night')
  await expect(main).toHaveAttribute('data-wall-mode', 'cutaway')
  await expectCameraAt(camera, CAMERA.position)
  await expect(page.getByRole('region', { name: 'Customize' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /^Customize/ })).toHaveCount(0)
})

test('a camera in the link wins over the saved one; the saved time still applies', async ({ page }) => {
  const camera = await recordCamera(page)
  await mockPascal(page, () => ({ body: withSettings(settings({ v: 1, opening: { camera: CAMERA, time: 'golden' } })) }))
  await page.goto(`/?project=${PROJECT}&camera=-6,4,8,0,1,0`)
  await expect(page.locator(READY)).toBeVisible({ timeout: 60_000 })
  await expect(page.locator(READY)).toHaveAttribute('data-time-of-day', 'golden')
  await expectCameraAt(camera, [-6, 4, 8])
})

test('over a bake, the saved walls are left to the bake', async ({ page }) => {
  await mockPascal(page, () => ({ body: { ...sceneBody(), settings: settings({ v: 1, opening: { time: 'blue', walls: 'down' } }) } }))
  await page.goto(`/?project=${PROJECT}`)
  const main = page.locator(`${READY}[data-source="baked"]`)
  await expect(main).toBeVisible({ timeout: 60_000 })
  await expect(main).toHaveAttribute('data-time-of-day', 'blue')
  await expect(main).not.toHaveAttribute('data-wall-mode', 'down')
})

test('a saved tour start runs the guided tour once the scene is on screen, but not in an embed', async ({ page }) => {
  await mockPascal(page, () => ({ body: withSettings(settings({ v: 1, tour: { autostart: true } })) }))
  await page.goto(`/?project=${PROJECT}`)
  await expect(page.locator(READY)).toBeVisible({ timeout: 60_000 })
  await expect(page.locator('main[data-guided-tour-noir="on"]')).toBeVisible({ timeout: 20_000 })

  await page.goto(`/?project=${PROJECT}&embed=1`)
  await expect(page.locator(READY)).toBeVisible({ timeout: 60_000 })
  await page.waitForTimeout(1500)
  await expect(page.locator('main[data-guided-tour-noir="on"]')).toHaveCount(0)
})

test('a manager sets the opening and the tour in the panel: the screen follows and Save keeps exactly that', async ({ page }) => {
  await mockPascal(page, () => ({ body: withSettings(settings({ v: 1, other: true }, { canConfigure: true })) }))
  await seedConfigureCredential(page)
  const writes = await settingsWrites(page)
  await page.goto(configureEntry)
  const main = page.locator(READY)
  await expect(main).toBeVisible({ timeout: 60_000 })
  const panel = page.getByRole('region', { name: 'Customize' })
  await expect(panel).toBeVisible()
  const time = panel.getByRole('radiogroup', { name: 'Time of day' })
  await expect(panel.getByRole('radiogroup', { name: 'Levels' })).toHaveCount(0)
  const walls = panel.getByRole('radiogroup', { name: 'Walls' })
  await expect(time.getByRole('radio', { name: 'Default' })).toHaveAttribute('aria-checked', 'true')
  await expect(panel.getByRole('group', { name: 'Time of day' })).toContainText('Default (Midday)')
  await expect(panel.getByRole('group', { name: 'Camera' })).toContainText('Default (frames the house)')

  await time.getByRole('radio', { name: 'Night' }).click()
  await expect(main).toHaveAttribute('data-time-of-day', 'night')
  await walls.getByRole('radio', { name: 'Cutaway' }).click()
  await expect(main).toHaveAttribute('data-wall-mode', 'cutaway')
  await panel.getByRole('radiogroup', { name: 'Start the guided tour on arrival' }).getByRole('radio', { name: 'On' }).click()
  await expect(panel.getByRole('status')).toHaveText('Unsaved changes')
  await panel.getByRole('button', { name: 'Save' }).click()
  await expect(panel.getByRole('status')).toHaveText('Saved')
  expect(writes[0]).toEqual({ revision: 3, data: {
    v: 1, other: true, opening: { time: 'night', walls: 'cutaway' }, tour: { autostart: true },
  } })

  // "Use current view" takes the camera and the look from the screen.
  await walls.getByRole('radio', { name: 'Low' }).click()
  await expect(main).toHaveAttribute('data-wall-mode', 'down')
  await panel.getByRole('button', { name: 'Use current view' }).click()
  await expect(panel.getByRole('group', { name: 'Camera' })).toContainText('Custom')
  await panel.getByRole('button', { name: 'Save' }).click()
  await expect(panel.getByRole('status')).toHaveText('Saved')
  expect(writes[1]!.revision).toBe(4)
  expect(writes[1]!.data.opening).toMatchObject({ time: 'night', walls: 'down' })
  expect((writes[1]!.data.opening!.camera as { position: number[] }).position).toHaveLength(3)

  // Back to the defaults, field by field: nothing saved under opening or tour.
  await time.getByRole('radio', { name: 'Default' }).click()
  await walls.getByRole('radio', { name: 'Default' }).click()
  await panel.getByRole('button', { name: 'Clear camera' }).click()
  await panel.getByRole('radiogroup', { name: 'Start the guided tour on arrival' }).getByRole('radio', { name: 'Off' }).click()
  await panel.getByRole('button', { name: 'Save' }).click()
  await expect(panel.getByRole('status')).toHaveText('Saved')
  expect(writes[2]).toEqual({ revision: 5, data: { v: 1, other: true } })
})

test('a manager arriving from Open in Pascal holds the pass behind a collapsed Customize tab, and opens it in place', async ({ page }) => {
  await mockPascal(page, () => ({ body: withSettings(settings(null, { revision: 0, canConfigure: true })) }))
  await seedConfigureCredential(page)
  await page.goto(`/?project=${PROJECT}&viewer=${VIEWER}&access=session`)
  await expect(page.locator(READY)).toBeVisible({ timeout: 60_000 })
  const entry = page.getByRole('button', { name: 'Customize', exact: true })
  await expect(entry).toBeVisible()
  await expect(page.getByRole('region', { name: 'Customize' })).toHaveCount(0)
  await entry.click()
  await expect(page.getByRole('region', { name: 'Customize' })).toBeVisible()
  expect(new URL(page.url()).searchParams.has('configure')).toBe(false)
})

/** Starts the tour (T) and reads its route, by room id, from the route panel beside the scene. */
async function tourRoute(page: Page) {
  await page.locator('main').press('t')
  await expect(page.locator('main[data-guided-tour-noir="on"]')).toBeVisible({ timeout: 20_000 })
  const stops = page.locator('button[data-zone-id][title^="Show "]')
  await expect(stops.first()).toBeVisible()
  return stops.evaluateAll((buttons) => buttons.map((button) => button.getAttribute('data-zone-id')))
}

// The fixture's walls also enclose a room the viewer finds itself ("Room 1", a generated id): the
// route has four rooms, and the tests name the three they place.
const isGenerated = (id: string | null) => !!id && !['zone_fixture', 'zone_living', 'zone_study'].includes(id)

test("a visitor's tour follows the saved room order and skips the skipped rooms", async ({ page }) => {
  await mockPascal(page, () => ({ body: roomsWith(settings({ v: 1, tour: { order: ['zone_study', 'zone_fixture', 'zone_living'], skip: ['zone_living'] } })) }))
  await page.goto(`/?project=${PROJECT}`)
  await expect(page.locator(READY)).toBeVisible({ timeout: 60_000 })
  const route = await tourRoute(page)
  // Saved rooms first, in the saved order; the room the order doesn't name follows.
  expect(route.slice(0, 2)).toEqual(['zone_study', 'zone_fixture'])
  expect(route).toHaveLength(3)
  expect(isGenerated(route[2]!)).toBe(true)
})

test("with nothing saved the tour keeps the viewer's order; the manager's first change writes the whole route", async ({ page }) => {
  await mockPascal(page, () => ({ body: roomsWith(settings(null, { revision: 0, canConfigure: true })) }))
  await seedConfigureCredential(page)
  const writes = await settingsWrites(page)
  await page.goto(configureEntry)
  await expect(page.locator(READY)).toBeVisible({ timeout: 60_000 })
  const panel = page.getByRole('region', { name: 'Customize' })
  const rooms = panel.getByRole('list', { name: 'Rooms' }).getByRole('listitem')
  await expect(rooms).toHaveText(['Kitchen', 'Living room', 'Room 1', 'Study'])
  await expect(panel.getByRole('group', { name: 'Tour rooms' })).toContainText('Default order (4 rooms)')

  await panel.getByRole('button', { name: 'Move Study up' }).click()
  await panel.getByRole('button', { name: 'Move Study up' }).click()
  await expect(rooms).toHaveText(['Kitchen', 'Study', 'Living room', 'Room 1'])
  await panel.getByRole('checkbox', { name: 'Include Kitchen in the tour' }).uncheck()
  await expect(panel.getByRole('group', { name: 'Tour rooms' })).toContainText('3 of 4 in the tour')
  await panel.getByRole('button', { name: 'Save' }).click()
  await expect(panel.getByRole('status')).toHaveText('Saved')
  const saved = writes[0]!.data.tour as { order: string[]; skip: string[] }
  expect(writes[0]!.revision).toBe(0)
  expect(Object.keys(writes[0]!.data).sort()).toEqual(['tour', 'v'])
  expect(saved.order.slice(0, 3)).toEqual(['zone_fixture', 'zone_study', 'zone_living'])
  expect(saved.order).toHaveLength(4)
  expect(saved.skip).toEqual(['zone_fixture'])

  // The tour follows the panel at once.
  await panel.getByRole('button', { name: 'Collapse customize' }).click()
  const route = await tourRoute(page)
  expect(route).toEqual(saved.order.slice(1))
  await page.keyboard.press('Escape')
  await expect(page.locator('main[data-guided-tour-noir="on"]')).toHaveCount(0)

  // Back to the viewer's order: nothing saved under tour.
  await page.getByRole('button', { name: /^Customize/ }).click()
  await panel.getByRole('button', { name: 'Use the default order' }).click()
  await expect(rooms).toHaveText(['Kitchen', 'Living room', 'Room 1', 'Study'])
  await panel.getByRole('button', { name: 'Save' }).click()
  await expect(panel.getByRole('status')).toHaveText('Saved')
  expect(writes[1]).toEqual({ revision: 1, data: { v: 1 } })
})
