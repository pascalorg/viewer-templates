import { pluginRenderEntry, renderedColorCount } from './rendering'
import { expect, test } from '@playwright/test'
import { liveScene, mockPascal, PROJECT } from './pascal-mocks'
import { libraryMaterials, pluginFixture } from './fixtures/scenes'

test('the public Viewer builds and renders the local live scene', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  // API and external assets are intercepted; this graph needs no network assets.
  await mockPascal(page, () => ({ body: liveScene() }))
  await page.goto(`/?project=${PROJECT}`)
  await expect(page.locator('main[data-scene-ready=true]')).toBeVisible({ timeout: 60_000 })
  await expect(page.getByRole('status')).toContainText('Live fixture ready')
  const canvas = page.locator('canvas')
  await expect(canvas).toBeVisible()
  expect(await renderedColorCount(page.locator('canvas'))).toBeGreaterThan(30)
  expect(errors).toEqual([])
})

test('App renders a mocked live pool project and loads its plugin only on demand', async ({ page }) => {
  // Bound software rasterization work; the pool's water shader is costly in SwiftShader.
  await page.setViewportSize({ width: 480, height: 320 })
  const poolEntry = await pluginRenderEntry('plugin-pool')
  expect(poolEntry).toBeTruthy()
  const requests: string[] = []
  const errors: string[] = []
  page.on('request', (request) => requests.push(new URL(request.url()).pathname))
  page.on('pageerror', (error) => errors.push(error.message))
  const graph = structuredClone(pluginFixture)
  // Start without a pool; add it at the scaffold camera's target on the next visit.
  const pool = graph.nodes.pool_fixture!
  pool.position = [0, 0.2, 0]
  delete graph.nodes.pool_fixture
  graph.nodes.level_fixture!.children = graph.nodes.level_fixture!.children!.filter((id) => id !== pool.id)
  const calls = await mockPascal(page, () => ({ body: { ...liveScene(), graph, libraryMaterials } }))
  await page.goto(`/?project=${PROJECT}`)
  await expect(page.locator('main[data-source=live][data-scene-ready=true]')).toBeVisible({ timeout: 60_000 })
  expect(requests).not.toContain(`/${poolEntry}`)
  const before = (await page.locator('canvas').screenshot()).toString('base64')
  graph.nodes.pool_fixture = pool
  graph.nodes.level_fixture!.children!.push(pool.id)
  await page.reload()
  await expect(page.locator('main[data-source=live][data-scene-ready=true]')).toBeVisible({ timeout: 60_000 })
  expect(requests).toContain(`/${poolEntry}`)
  const after = (await page.locator('canvas').screenshot()).toString('base64')
  const changed = await page.evaluate(async ({ before, after }) => {
    const frames = await Promise.all([before, after].map(async (base64) => {
      const image = new Image()
      image.src = `data:image/png;base64,${base64}`
      await image.decode()
      const canvas = document.createElement('canvas')
      canvas.width = canvas.height = 96
      const ctx = canvas.getContext('2d')!
      ctx.drawImage(image, 0, 0, 96, 96)
      return ctx.getImageData(0, 0, 96, 96).data
    }))
    let count = 0
    for (let i = 0; i < frames[0]!.length; i += 4) {
      if ([0, 1, 2].some((channel) => Math.abs(frames[0]![i + channel]! - frames[1]![i + channel]!) > 20)) count++
    }
    return count
  }, { before, after })
  expect(changed, 'pool visibility from the resolved project graph must change rendered pixels').toBeGreaterThan(50)
  expect(calls.glb).toBe(0)
  expect(errors).toEqual([])
})
