import { expect, test } from '@playwright/test'
import { liveScene, mockPascal, PROJECT } from './pascal-mocks'

test('the public Viewer builds and renders the local live scene', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  // The S3 API is mocked; the temporary S1 fixture needs no network assets.
  await mockPascal(page, () => ({ body: liveScene() }))
  await page.goto(`/?project=${PROJECT}`)
  await expect(page.locator('main[data-scene-ready=true]')).toBeVisible({ timeout: 60_000 })
  await expect(page.getByRole('status')).toContainText('Live fixture ready')
  const canvas = page.locator('canvas')
  await expect(canvas).toBeVisible()
  // Check rendered pixels, not just the presence of a canvas or a readiness callback.
  // Capture the composited frame: WebGL clears its drawing buffer after presenting.
  const screenshot = await canvas.screenshot()
  const colorCount = await page.evaluate(async (base64) => {
    const source = new Image()
    source.src = `data:image/png;base64,${base64}`
    await source.decode()
    const copy = document.createElement('canvas')
    copy.width = 96
    copy.height = 96
    const ctx = copy.getContext('2d')!
    ctx.drawImage(source, 0, 0, 96, 96)
    const { data } = ctx.getImageData(0, 0, 96, 96)
    const colors = new Set<string>()
    for (let i = 0; i < data.length; i += 4) colors.add(`${data[i]},${data[i + 1]},${data[i + 2]}`)
    return colors.size
  }, screenshot.toString('base64'))
  expect(colorCount).toBeGreaterThan(30)
  expect(errors).toEqual([])
})
