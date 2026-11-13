import { expect, type Page, test } from '@playwright/test'
import type { SceneResponse } from '../src/pascal'
import door from './fixtures/door.json' with { type: 'json' }
import { liveScene, mockPascal, PROJECT } from './pascal-mocks'

// The full viewer (post-processing, environment) is slow under software rendering.
test.setTimeout(90_000)

const READY = 'main[data-scene-ready=true]'

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

test('the controls bar loads its icons from the template origin', async ({ page }) => {
  const icons = new Map<string, number>()
  page.on('response', (response) => {
    const { pathname } = new URL(response.url())
    if (pathname.startsWith('/icons/')) icons.set(pathname, response.status())
  })
  await mockPascal(page, () => ({ body: liveScene() }))
  await page.goto(`/?project=${PROJECT}`)
  await expect(page.locator(READY)).toBeVisible({ timeout: 60_000 })
  await expect(page.getByRole('button', { name: /walkthrough/i })).toBeVisible()
  await expect.poll(() => icons.size).toBeGreaterThan(0)
  for (const status of icons.values()) expect(status).toBe(200)
  expect([...icons.keys()].every((path) => /^\/icons\/[a-z]+\.webp$/.test(path))).toBe(true)
})

test('the opening camera is in place as the loader lifts', async ({ page }) => {
  const camera = await recordCamera(page)
  await mockPascal(page, () => ({ body: liveScene() }))
  await page.goto(`/?project=${PROJECT}&camera=7,3,9,0,1,0`)
  await expect(page.locator(READY)).toBeVisible({ timeout: 60_000 })
  await expect.poll(async () => (await camera()).afterReady.length, { timeout: 30_000 }).toBe(3)
  const probe = await camera()
  // Behind the loader the scene was drawn from the default view.
  expect(probe.beforeReady?.[0], JSON.stringify(probe)).not.toBeCloseTo(7, 1)
  // Readiness follows the hosted timing: the pose is set on the controls before the loader
  // lifts. Under a slow software renderer the controls can draw it a frame or two later (the
  // same package code runs on editor.pascal.app), so check the third frame.
  for (const [axis, expected] of [7, 3, 9].entries()) {
    expect(probe.afterReady[2]![axis], JSON.stringify(probe)).toBeCloseTo(expected, 1)
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
  await expect(page.getByTestId('viewer-breadcrumb')).toContainText('Front door')
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

test('embed hides the owner line and guest prompt and tells the parent frame it is ready', async ({ page, baseURL }) => {
  await mockPascal(page, () => ({ body: { ...liveScene(), project: { ...liveScene().project, owner: { displayName: 'Ada', avatarUrl: null } } } }))
  await page.goto(`/?project=${PROJECT}`)
  await expect(page.locator(READY)).toBeVisible({ timeout: 60_000 })
  await expect(page.getByText('Want to create your own 3D project?')).toBeVisible()
  await expect(page.getByRole('link', { name: 'Get started' })).toHaveAttribute('href', 'https://editor.pascal.app')
  await expect(page.getByText('@Ada', { exact: true })).toHaveCount(0)
  await expect(page.getByText('Ada', { exact: true })).toBeVisible()

  await page.setContent(`<iframe src="${baseURL}/?project=${PROJECT}&embed=1" style="width:800px;height:500px"></iframe>`)
  const message = await page.evaluate(() => new Promise((resolve) => {
    addEventListener('message', (event) => resolve(event.data), { once: true })
  }))
  expect(message).toEqual({ type: 'pascal:viewer-ready', projectId: PROJECT })
  const frame = page.frameLocator('iframe')
  await expect(frame.locator(READY)).toBeVisible()
  await expect(frame.getByText('Fixture house', { exact: true })).toBeVisible()
  await expect(frame.getByText('Want to create your own 3D project?')).toHaveCount(0)
  await expect(frame.getByText('Ada', { exact: true })).toHaveCount(0)
  await expect(frame.getByRole('button', { name: /walkthrough/i })).toBeVisible()
})

test('hideHeader and hideBottomBar remove the header and the controls bar', async ({ page }) => {
  await mockPascal(page, () => ({ body: liveScene() }))
  await page.goto(`/?project=${PROJECT}&hideHeader=1&hideBottomBar=true`)
  await expect(page.locator(READY)).toBeVisible({ timeout: 60_000 })
  await expect(page.getByText('Fixture house', { exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /walkthrough/i })).toHaveCount(0)
})

test('walkthrough shows its HUD in place of the controls bar and Escape leaves it', async ({ page }) => {
  await mockPascal(page, () => ({ body: liveScene() }))
  await page.goto(`/?project=${PROJECT}&embed=1`)
  await expect(page.locator(READY)).toBeVisible({ timeout: 60_000 })
  await page.getByRole('button', { name: /walkthrough/i }).click()
  await expect(page.locator('[data-walkthrough-hud]')).toBeVisible({ timeout: 20_000 })
  await expect(page.getByRole('button', { name: /walkthrough/i })).toHaveCount(0)
  await page.keyboard.press('Escape')
  await expect(page.locator('[data-walkthrough-hud]')).toHaveCount(0)
  await expect(page.getByRole('button', { name: /walkthrough/i })).toBeVisible()
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
