import { expect, type Locator, type Page, test } from '@playwright/test'
import type { SceneResponse } from '../src/pascal'
import door from './fixtures/door.json' with { type: 'json' }
import { liveScene, mockPascal, PROJECT } from './pascal-mocks'

// The full viewer (post-processing, environment) is slow under software rendering.
test.setTimeout(90_000)

const READY = 'main[data-scene-ready=true]'
const CHROME = '.sc-chrome'

/**
 * Presses a dial sector. Sectors are clipped wedges whose box centre can fall outside the
 * wedge, so the press lands on the icon, which sits inside it.
 */
async function pressDial(scope: Page | Locator, name: string) {
  await scope.getByRole('button', { name, exact: true }).locator('svg').click({ force: true })
}

/** The live fixture with a published French door in the middle of its north wall (z = 2). */
function doorScene(): SceneResponse {
  const scene = liveScene()
  scene.graph = structuredClone(scene.graph)
  scene.graph.nodes.door_fixture = structuredClone(door)
  scene.graph.nodes.wall_north!.children = ['door_fixture']
  return scene
}

type CameraProbe = { ready: boolean; beforeReady: number[] | null; afterReady: number[][] }

/**
 * Records the poses the renderer draws from, without any hook in the page: three.js announces
 * each renderer to `__THREE_DEVTOOLS__`, and wrapping its render calls exposes the camera.
 */
async function recordCamera(page: Page) {
  await page.addInitScript(() => {
    const state: CameraProbe = { ready: false, beforeReady: null, afterReady: [] }
    ;(window as unknown as { cameraProbe: CameraProbe }).cameraProbe = state
    const devtools = new EventTarget()
    ;(window as unknown as { __THREE_DEVTOOLS__: EventTarget }).__THREE_DEVTOOLS__ = devtools
    devtools.addEventListener('observe', (event) => {
      const object = (event as CustomEvent).detail as Record<string, unknown>
      if (!object.isWebGPURenderer) return
      const original = object.render as (...args: unknown[]) => unknown
      type Camera = { isPerspectiveCamera?: boolean; parent: { type?: string } | null; position: { x: number; y: number; z: number } }
      object.render = function (this: unknown, scene: unknown, camera: Camera) {
        // Skip the environment probe's cube cameras; the view camera is the other one.
        if (camera?.isPerspectiveCamera && camera.parent?.type !== 'CubeCamera') {
          const pose = [camera.position.x, camera.position.y, camera.position.z]
          if (!state.ready) state.beforeReady = pose
          else if (state.afterReady.length < 3) state.afterReady.push(pose)
        }
        return original.apply(this, [scene, camera])
      }
    })
    new MutationObserver(() => {
      if (document.querySelector('main[data-scene-ready="true"]')) state.ready = true
    }).observe(document, { attributes: true, subtree: true, attributeFilter: ['data-scene-ready'] })
  })
  return () => page.evaluate(() => (window as unknown as { cameraProbe: CameraProbe }).cameraProbe)
}

test('the chrome sets its type in DM Sans, served from the template origin', async ({ page }) => {
  const fonts = new Map<string, number>()
  page.on('response', (response) => {
    const { pathname } = new URL(response.url())
    if (pathname.startsWith('/fonts/')) fonts.set(pathname, response.status())
  })
  await mockPascal(page, () => ({ body: liveScene() }))
  await page.goto(`/?project=${PROJECT}`)
  await expect(page.locator(READY)).toBeVisible({ timeout: 60_000 })
  await expect.poll(() => page.evaluate(() => document.fonts.check('16px "DM Sans"'))).toBe(true)
  expect(fonts.get('/fonts/dm-sans-latin.woff2')).toBe(200)
  expect(await page.getByRole('button', { name: 'Reset view' }).evaluate((node) => getComputedStyle(node).fontFamily)).toContain('DM Sans')
})

test('the opening camera is in place as the loader lifts', async ({ page }) => {
  const camera = await recordCamera(page)
  await mockPascal(page, () => ({ body: liveScene() }))
  await page.goto(`/?project=${PROJECT}&camera=7,3,9,0,1,0`)
  await expect(page.locator(READY)).toBeVisible({ timeout: 60_000 })
  await expect.poll(async () => (await camera()).afterReady.length, { timeout: 30_000 }).toBe(3)
  const probe = await camera()
  // The pose is placed before the loader lifts, so no frame shows the default view: the last
  // frame drawn behind the loader and every frame after it are already at the opening camera.
  for (const pose of [probe.beforeReady, ...probe.afterReady]) {
    for (const [axis, expected] of [7, 3, 9].entries()) {
      expect(pose![axis], JSON.stringify(probe)).toBeCloseTo(expected, 1)
    }
  }
})

test('opening a door from its callout plays the door sound', async ({ page }) => {
  // Count Web Audio playback by buffer length: Howler's unlock plays a one-sample buffer.
  await page.addInitScript(() => {
    const started: number[] = []
    ;(window as unknown as { soundStarts: number[] }).soundStarts = started
    const original = AudioBufferSourceNode.prototype.start
    AudioBufferSourceNode.prototype.start = function (...args: Parameters<typeof original>) {
      if (this.buffer) started.push(this.buffer.duration)
      return original.apply(this, args)
    }
  })
  await mockPascal(page, () => ({ body: doorScene() }))
  // Inside the room facing the door, so the middle of the canvas is the door.
  await page.goto(`/?project=${PROJECT}&embed=1&camera=0,1.1,-1.5,0,1.1,2`)
  await expect(page.locator(READY)).toBeVisible({ timeout: 60_000 })
  const canvas = page.locator('canvas').first()
  const box = (await canvas.boundingBox())!
  // Point at the door first, as a visitor's pointer does, then click it.
  const door = { x: box.x + box.width * 0.45, y: box.y + box.height * 0.74 }
  await page.mouse.move(door.x, door.y)
  await page.waitForTimeout(500)
  await page.mouse.click(door.x, door.y)
  const open = page.locator('button[data-control="opening"]')
  await expect(open).toBeVisible({ timeout: 15_000 })
  const doorOpen = await page.evaluate(async () => {
    const bytes = await (await fetch('/audios/sfx/door_open.mp3')).arrayBuffer()
    return (await new OfflineAudioContext(1, 1, 44_100).decodeAudioData(bytes)).duration
  })
  const doorSoundPlayed = () => page.evaluate((duration) => (window as unknown as { soundStarts: number[] }).soundStarts
    .some((played) => Math.abs(played - duration) < 0.01), doorOpen)
  expect(await doorSoundPlayed()).toBe(false)
  await open.click()
  await expect.poll(doorSoundPlayed, { timeout: 10_000 }).toBe(true)
})

test('discovery: hovering reveals the room, a click on the room pins nothing, a door pins its callout', async ({ page }) => {
  // Discovery settles on rendered frames, which the software renderer here draws seconds apart.
  test.slow()
  await mockPascal(page, () => ({ body: doorScene() }))
  // Inside, above the south wall, looking down at the door in the north wall.
  await page.goto(`/?project=${PROJECT}&embed=1&camera=0,2.4,-1.8,0,0,1`)
  await expect(page.locator(READY)).toBeVisible({ timeout: 60_000 })
  const box = (await page.locator('canvas').first().boundingBox())!
  // The wall beside the door: the room, named, with its area; no stock hover pill. (The ground
  // under the fixture belongs to no room.)
  const floor = { x: box.x + box.width * 0.8, y: box.y + box.height * 0.3 }
  await page.mouse.move(floor.x, floor.y)
  await page.mouse.move(floor.x + 2, floor.y)
  const label = page.locator('.sc-zone:not(.sc-item)')
  await expect(label).toHaveAttribute('data-visible', 'true', { timeout: 60_000 })
  await expect(label.locator('strong')).toHaveText('Live room')
  await expect(label.locator('.sc-zone-copy > span')).toHaveText(/\d+ (sq ft|m²)/)
  await expect(page.locator('[data-room-label-detail], [data-room-label-view]')).toHaveCount(0)
  // A click on the room's wall pins nothing.
  await page.mouse.click(floor.x + 2, floor.y)
  await page.waitForTimeout(500)
  await expect(page.locator('.sc-item')).toBeHidden()
  // A click on the door pins its callout; Escape dismisses it.
  const door = { x: box.x + box.width * 0.45, y: box.y + box.height * 0.25 }
  await page.mouse.move(door.x, door.y)
  await page.mouse.click(door.x, door.y)
  const callout = page.locator('.sc-item')
  await expect(callout).toHaveAttribute('data-visible', 'true', { timeout: 60_000 })
  await expect(callout.locator('strong')).toHaveText('Front door')
  await expect(label).toHaveAttribute('data-visible', 'false', { timeout: 30_000 })
  await page.keyboard.press('Escape')
  await expect(callout).toBeHidden()
})

test('no title or facts block (a host overlays its own), never the owner, and embed tells the parent frame it is ready', async ({ page, baseURL }) => {
  await mockPascal(page, () => ({ body: { ...liveScene(), project: { ...liveScene().project, owner: { displayName: 'Ada', avatarUrl: null } } } }))
  await page.goto(`/?project=${PROJECT}`)
  await expect(page.locator(READY)).toBeVisible({ timeout: 60_000 })
  // The project's name is the document's title only; no heading, no facts row over the scene.
  await expect(page).toHaveTitle('Fixture house')
  await expect(page.getByRole('heading', { name: 'Fixture house' })).toHaveCount(0)
  await expect(page.getByRole('region', { name: 'About the project' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /sound/i })).toBeVisible()
  await expect(page.getByText('Ada')).toHaveCount(0)
  await expect(page.getByText('Want to create your own 3D project?')).toHaveCount(0)

  await page.setContent(`<iframe src="${baseURL}/?project=${PROJECT}&embed=1" style="width:800px;height:500px"></iframe>`)
  const message = await page.evaluate(() => new Promise((resolve) => {
    addEventListener('message', (event) => resolve(event.data), { once: true })
  }))
  expect(message).toEqual({ type: 'pascal:viewer-ready', projectId: PROJECT })
  const frame = page.frameLocator('iframe')
  await expect(frame.locator(READY)).toBeVisible()
  await expect(frame.getByRole('heading', { name: 'Fixture house' })).toHaveCount(0)
  await expect(frame.getByRole('button', { name: 'Walkthrough' })).toBeVisible()
})

test('hideBottomBar removes the dial; hideHeader is accepted with nothing to hide', async ({ page }) => {
  await mockPascal(page, () => ({ body: liveScene() }))
  await page.goto(`/?project=${PROJECT}&hideHeader=1&hideBottomBar=true`)
  await expect(page.locator(READY)).toBeVisible({ timeout: 60_000 })
  await expect(page.locator(CHROME)).toBeAttached()
  await expect(page.getByText('Fixture house', { exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Walkthrough' })).toHaveCount(0)
})

test('the dial switches the viewer store: level mode, time of day and reset', async ({ page }) => {
  await mockPascal(page, () => ({ body: liveScene() }))
  await page.goto(`/?project=${PROJECT}`)
  await expect(page.locator(READY)).toBeVisible({ timeout: 60_000 })
  const chrome = page.locator(CHROME)
  // One floor: the house opens whole (Exterior), at dusk (the sun parked below the horizon).
  await expect(chrome).toHaveAttribute('data-level-mode', 'stacked')
  await expect(chrome).toHaveAttribute('data-sky', 'dusk')
  await expect(chrome).toHaveAttribute('data-time-of-day', /^minutes:/)
  await expect(page.getByRole('button', { name: 'Exterior' })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('button', { name: 'Dusk' })).toHaveAttribute('aria-pressed', 'true')

  await pressDial(page, 'Exploded')
  await expect(chrome).toHaveAttribute('data-level-mode', 'exploded')
  await expect(page.getByRole('button', { name: 'Exploded' })).toHaveAttribute('aria-pressed', 'true')
  await pressDial(page, 'Night')
  await expect(chrome).toHaveAttribute('data-time-of-day', 'night')
  await pressDial(page, 'Day')
  await expect(chrome).toHaveAttribute('data-time-of-day', 'midday')
  await pressDial(page, 'Dawn')
  await expect(chrome).toHaveAttribute('data-sky', 'dawn')
  await expect(page.getByRole('button', { name: 'Dawn' })).toHaveAttribute('aria-pressed', 'true')

  await page.getByRole('button', { name: 'Reset view' }).click()
  await expect(chrome).toHaveAttribute('data-level-mode', 'stacked')
  await expect(chrome).toHaveAttribute('data-sky', 'dusk')
})

test('Cut view assembles the house, cuts it through the ground floor and its controls drive the section', async ({ page }) => {
  await mockPascal(page, () => ({ body: liveScene() }))
  await page.goto(`/?project=${PROJECT}`)
  await expect(page.locator(READY)).toBeVisible({ timeout: 60_000 })
  const chrome = page.locator(CHROME)
  await expect(chrome).toHaveAttribute('data-section', 'off')
  await pressDial(page, 'Cut view')
  // One floor at ground level: 1.2 m up.
  await expect(chrome).toHaveAttribute('data-section', 'y:1.20')
  await expect(chrome).toHaveAttribute('data-level-mode', 'stacked')
  await expect(page.getByRole('button', { name: 'Cut view' })).toHaveAttribute('aria-pressed', 'true')
  const controls = page.getByRole('region', { name: 'Section controls' })
  await expect(controls).toBeVisible()

  await controls.getByRole('button', { name: 'Show the other side' }).click()
  await expect(chrome).toHaveAttribute('data-section', 'y:1.20:flipped')
  await controls.getByRole('button', { name: 'Cut from side' }).click()
  await expect(chrome).toHaveAttribute('data-section', /^x:-?\d+\.\d{2}:flipped$/)
  // The slider spans the model: its ends sit just outside it.
  const slider = controls.getByRole('slider')
  await slider.focus()
  // Positions reach the store on the next animation frame.
  const plane = async () => Number((await chrome.getAttribute('data-section'))!.split(':')[1])
  await page.keyboard.press('Home')
  await expect.poll(plane).toBeLessThan(-2.8)
  await page.keyboard.press('End')
  await expect.poll(plane).toBeGreaterThan(2.8)

  // A walk keeps the cut for afterwards; any other mode ends it.
  await pressDial(page, 'Walkthrough')
  await expect(chrome).toHaveAttribute('data-mode', 'walkthrough')
  await page.keyboard.press('Escape')
  await expect(chrome).toHaveAttribute('data-mode', 'cut')
  await pressDial(page, 'Exploded')
  await expect(chrome).toHaveAttribute('data-section', 'off')
  await expect(controls).toHaveCount(0)
  await pressDial(page, 'Cut view')
  await page.getByRole('button', { name: 'Reset view' }).click()
  await expect(chrome).toHaveAttribute('data-section', 'off')
})

test.describe('with motion', () => {
  test.use({ reducedMotion: 'no-preference' })

  test('the intro reveals the house once, hides the chrome meanwhile, and ends in the opening view', async ({ page }) => {
    await mockPascal(page, () => ({ body: liveScene() }))
    await page.goto(`/?project=${PROJECT}`)
    await expect(page.locator(READY)).toBeVisible({ timeout: 60_000 })
    const chrome = page.locator(CHROME)
    await expect(chrome).toHaveAttribute('data-intro', 'true')
    await expect(chrome).toHaveAttribute('data-section', /^y:/)
    await expect(page.getByRole('button', { name: 'Exterior' })).toHaveCount(0)
    await expect(page.getByRole('heading', { name: 'Fixture house' })).toHaveCount(0)
    // Software rendering is slow: the intro stretches, up to twice its 4.5 s.
    await expect(chrome).toHaveAttribute('data-intro', 'false', { timeout: 30_000 })
    await expect(chrome).toHaveAttribute('data-section', 'off')
    await expect(chrome).toHaveAttribute('data-mode', 'exterior')
    await expect(page.getByRole('button', { name: 'Exterior' })).toBeVisible()
  })

  test('Skip intro ends it at once in the opening view', async ({ page }) => {
    await mockPascal(page, () => ({ body: liveScene() }))
    await page.goto(`/?project=${PROJECT}`)
    await expect(page.locator(READY)).toBeVisible({ timeout: 60_000 })
    await page.getByRole('button', { name: 'Skip intro' }).click()
    const chrome = page.locator(CHROME)
    // One frame later, which software rendering can make a few seconds.
    await expect(chrome).toHaveAttribute('data-intro', 'false', { timeout: 10_000 })
    await expect(chrome).toHaveAttribute('data-section', 'off')
    await expect(chrome).toHaveAttribute('data-sky', 'dusk')
    await expect(page.getByRole('button', { name: 'Exterior' })).toHaveAttribute('aria-pressed', 'true')
  })

  test('a page opened on a given camera skips the intro', async ({ page }) => {
    await mockPascal(page, () => ({ body: liveScene() }))
    await page.goto(`/?project=${PROJECT}&camera=7,3,9,0,1,0`)
    await expect(page.locator(READY)).toBeVisible({ timeout: 60_000 })
    await expect(page.locator(CHROME)).toHaveAttribute('data-intro', 'false')
  })
})

test('the dial offers only the enabled modes and the help lists the viewer bindings', async ({ page }) => {
  await mockPascal(page, () => ({ body: liveScene() }))
  await page.goto(`/?project=${PROJECT}`)
  await expect(page.locator(READY)).toBeVisible({ timeout: 60_000 })
  const views = page.getByRole('navigation', { name: 'Views' }).getByRole('button')
  expect(await views.evaluateAll((buttons) => buttons.map((button) => button.getAttribute('aria-label')))).toEqual(['Exterior', 'Exploded', 'Cut view', 'X-ray', 'Walkthrough'])

  await page.getByRole('button', { name: 'Help with controls' }).click()
  const help = page.getByRole('dialog')
  // /next's orbit: left drag rotates, right drag (or Shift and drag) pans.
  await expect(help).toContainText('RotateLeft drag')
  await expect(help).toContainText('PanRight drag')
  await expect(help).toContainText('Or hold Shift and drag to pan.')
  await page.keyboard.press('Escape')
  await expect(help).toHaveCount(0)

  // Sound follows the viewer's audio settings.
  const sound = page.getByRole('button', { name: /sound/i })
  const before = await sound.getAttribute('aria-pressed')
  await sound.click()
  await expect(sound).not.toHaveAttribute('aria-pressed', before!)
})

test('walkthrough shows its HUD, Escape leaves it, and its help lists the walking keys', async ({ page }) => {
  await mockPascal(page, () => ({ body: liveScene() }))
  await page.goto(`/?project=${PROJECT}&embed=1`)
  await expect(page.locator(READY)).toBeVisible({ timeout: 60_000 })
  await pressDial(page, 'Walkthrough')
  await expect(page.locator('[data-walkthrough-hud]')).toBeVisible({ timeout: 20_000 })
  await expect(page.locator(CHROME)).toHaveAttribute('data-mode', 'walkthrough')
  await page.getByRole('button', { name: 'Help with controls' }).click()
  await expect(page.getByRole('dialog')).toContainText('W A S D')
  await expect(page.getByRole('dialog')).toContainText('ShuttersF')
  await expect(page.getByRole('dialog')).toContainText('CloseT')
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.keyboard.press('Escape')
  await expect(page.locator('[data-walkthrough-hud]')).toHaveCount(0)
  await expect(page.locator(CHROME)).toHaveAttribute('data-mode', 'exterior')
})

test('X-ray shows one family at a time, and leaving it shows everything again', async ({ page }) => {
  await mockPascal(page, () => ({ body: liveScene() }))
  await page.goto(`/?project=${PROJECT}`)
  await expect(page.locator(READY)).toBeVisible({ timeout: 60_000 })
  const chrome = page.locator(CHROME)
  await pressDial(page, 'X-ray')
  // The fixture's families: the site and its walls. X-ray opens on the walls.
  await expect(chrome).toHaveAttribute('data-xray', 'walls')
  await expect(chrome).toHaveAttribute('data-level-mode', 'stacked')
  const layers = page.getByRole('group', { name: 'X-ray layers' }).getByRole('button')
  await expect(layers).toHaveText(['Site', 'Walls'])
  await expect(page.getByRole('button', { name: 'Walls', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await page.getByRole('button', { name: 'Site', exact: true }).click()
  await expect(chrome).toHaveAttribute('data-xray', 'site')
  // Cut view and X-ray take turns.
  await pressDial(page, 'Cut view')
  await expect(chrome).toHaveAttribute('data-xray', 'off')
  await expect(chrome).toHaveAttribute('data-section', /^y:/)
  await pressDial(page, 'X-ray')
  await expect(chrome).toHaveAttribute('data-section', 'off')
  await expect(chrome).toHaveAttribute('data-xray', 'walls')
  await pressDial(page, 'Exploded')
  await expect(chrome).toHaveAttribute('data-xray', 'off')
  await pressDial(page, 'X-ray')
  await page.getByRole('button', { name: 'Reset view' }).click()
  await expect(chrome).toHaveAttribute('data-xray', 'off')
  // A walk shows the whole house, and X-ray stays off after it.
  await pressDial(page, 'X-ray')
  await pressDial(page, 'Walkthrough')
  await expect(chrome).toHaveAttribute('data-xray', 'off')
  await page.keyboard.press('Escape')
  await expect(chrome).toHaveAttribute('data-mode', 'exterior')
})

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })

  test('the bottom bar replaces the dial, with X-ray as a carousel and a walk by touch', async ({ page }) => {
    await mockPascal(page, () => ({ body: liveScene() }))
    await page.goto(`/?project=${PROJECT}`)
    await expect(page.locator(READY)).toBeVisible({ timeout: 60_000 })
    const chrome = page.locator(CHROME)
    await expect(chrome).toHaveAttribute('data-layout', 'bottom')
    await expect(page.locator('.sc-dial')).toHaveCount(0)
    await page.getByRole('button', { name: 'Time of day' }).tap()
    await page.getByRole('button', { name: 'Night' }).tap()
    await expect(chrome).toHaveAttribute('data-time-of-day', 'night')
    await page.getByRole('button', { name: 'Time of day' }).tap()

    await page.getByRole('button', { name: 'X-ray' }).tap()
    await expect(chrome).toHaveAttribute('data-xray', 'walls')
    await page.getByRole('button', { name: 'Previous layer' }).tap()
    await expect(chrome).toHaveAttribute('data-xray', 'site')

    // A touch press: the walk uses the touch controls, and the rest of the chrome steps aside.
    await page.getByRole('button', { name: 'Walkthrough' }).tap()
    await expect(chrome).toHaveAttribute('data-mode', 'walkthrough')
    await expect(chrome).toHaveAttribute('data-walk-input', 'touch')
    await expect(page.locator('[data-walkthrough-touch-controls]')).toBeVisible({ timeout: 20_000 })
    await expect(page.locator('.sc-mobile-bar')).toHaveCount(0)
    // The showcase's walk HUD (the package's own buttons give way to it), without keycaps.
    await expect(page.locator('[data-walkthrough-hud]')).toHaveCount(1)
    await expect(page.locator('.sc-walk kbd').first()).toBeHidden()
    await page.getByRole('button', { name: 'Return to view' }).tap()
    await expect(chrome).toHaveAttribute('data-mode', 'exterior')
    await expect(page.locator('.sc-mobile-bar')).toBeVisible()
  })
})

test.describe('walking by touch', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })

  test('the left thumb walks to the door ahead, "Come a little closer" turns into Open, and Open plays its sound', async ({ page, context }) => {
    await page.addInitScript(() => {
      const started: number[] = []
      ;(window as unknown as { soundStarts: number[] }).soundStarts = started
      const original = AudioBufferSourceNode.prototype.start
      AudioBufferSourceNode.prototype.start = function (...args: Parameters<typeof original>) {
        if (this.buffer) started.push(this.buffer.duration)
        return original.apply(this, args)
      }
    })
    await mockPascal(page, () => ({ body: doorScene() }))
    // No spawn in the fixture: the walk starts where the camera stands, inside, facing the door.
    await page.goto(`/?project=${PROJECT}&camera=0,1.1,-1.5,0,1.1,2`)
    await expect(page.locator(READY)).toBeVisible({ timeout: 60_000 })
    await page.getByRole('button', { name: 'Walkthrough' }).tap()
    const interact = page.locator('[data-walk-interact]')
    await expect(page.locator('[data-walkthrough-touch-controls]')).toBeVisible({ timeout: 20_000 })
    // Seen from 3.5 m, past the 2.5 m reach: named, with /next's prompt and no action yet.
    await expect(page.locator('.sc-walk-target')).toContainText('Come a little closer', { timeout: 20_000 })
    await expect(interact).toHaveCount(0)
    // Real touch points: the left half is the stick. Push forward until the door is in reach.
    const cdp = await context.newCDPSession(page)
    const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', points: [number, number][]) => cdp.send('Input.dispatchTouchEvent', {
      type, touchPoints: points.map(([x, y], id) => ({ x, y, id })),
    })
    for (let step = 0; step < 12 && await interact.count() === 0; step++) {
      await touch('touchStart', [[90, 640]])
      await touch('touchMove', [[90, 590]])
      await page.waitForTimeout(400)
      await touch('touchEnd', [])
      await page.waitForTimeout(300)
    }
    await expect(interact).toContainText('Open', { timeout: 10_000 })
    // A live door offers an explicit close too (the package's canClose).
    await expect(page.getByRole('button', { name: 'Close', exact: true })).toBeVisible()
    const before = await page.evaluate(() => (window as unknown as { soundStarts: number[] }).soundStarts.length)
    // Acts on press, so a second finger can open while the other walks.
    const box = (await interact.boundingBox())!
    await touch('touchStart', [[box.x + box.width / 2, box.y + box.height / 2]])
    await touch('touchEnd', [])
    await expect.poll(() => page.evaluate(() => (window as unknown as { soundStarts: number[] }).soundStarts.length), { timeout: 10_000 })
      .toBeGreaterThan(before)
  })
})

test('a desktop walk keeps keyboard input, even on a touch-capable screen used with a mouse', async ({ page }) => {
  await mockPascal(page, () => ({ body: liveScene() }))
  await page.goto(`/?project=${PROJECT}`)
  await expect(page.locator(READY)).toBeVisible({ timeout: 60_000 })
  await pressDial(page, 'Walkthrough')
  await expect(page.locator(CHROME)).toHaveAttribute('data-walk-input', 'desktop')
  await expect(page.locator('[data-walkthrough-touch-controls]')).toHaveCount(0)
  await expect(page.locator('[data-walkthrough-hud]')).toBeVisible({ timeout: 20_000 })
})

test('kinds from plugins the template cannot load are skipped without a notice', async ({ page }) => {
  const warnings: string[] = []
  const errors: string[] = []
  page.on('console', (message) => { if (message.type() === 'warning') warnings.push(message.text()) })
  page.on('pageerror', (error) => errors.push(error.message))
  const scene = liveScene()
  scene.graph = structuredClone(scene.graph)
  scene.graph.nodes.casework = { id: 'casework', type: 'home-designer:casework', parentId: 'level_fixture', children: [] }
  scene.graph.nodes.level_fixture!.children!.push('casework')
  await mockPascal(page, () => ({ body: scene }))
  await page.goto(`/?project=${PROJECT}`)
  await expect(page.locator('main[data-source=live][data-scene-ready=true]')).toBeVisible({ timeout: 60_000 })
  await expect(page.getByText(/can't be shown/i)).toHaveCount(0)
  expect(warnings.filter((message) => message.includes('unknown kind home-designer:casework'))).toHaveLength(1)
  expect(errors).toEqual([])
})
