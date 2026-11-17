import { expect, test } from '@playwright/test'

// The walk HUD's Shutters and Close actions, driven through the HUD store the controllers write.
const harness = '/tests/fixtures/walk-hud.html'
const ready = (page: import('@playwright/test').Page) => page.waitForFunction(() => !!window.walk)

test.describe('on touch', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })

  test('Shutters and Close show while the package offers them and act on press, without keycaps', async ({ page }) => {
    await page.goto(harness)
    await ready(page)
    await page.evaluate(() => window.walk.setTouch(true))
    const shutters = page.getByRole('button', { name: 'Shutters' })
    const close = page.getByRole('button', { name: 'Close' })
    await expect(shutters).toHaveCount(0)
    await expect(close).toHaveCount(0)

    // A baked window with shutters in reach.
    await page.evaluate(() => window.walk.setHud({ interact: { label: 'Window', verb: 'open' }, shuttersInView: true }))
    await expect(shutters).toBeVisible()
    await expect(shutters.locator('kbd')).toBeHidden()
    await shutters.tap()
    await expect.poll(() => page.evaluate(() => window.walk.requests.shutters)).toBe(1)
    expect(await page.evaluate(() => window.walk.requests.interact)).toBe(0)

    // A live door in reach: Close beside Open.
    await page.evaluate(() => window.walk.setHud({ interact: { label: 'Door', verb: 'open' }, shuttersInView: false, canClose: true }))
    await expect(shutters).toHaveCount(0)
    await expect(close).toBeVisible()
    await close.tap()
    await expect.poll(() => page.evaluate(() => window.walk.requests.close)).toBe(1)
    // No crouch button, as on /next.
    await expect(page.getByRole('button', { name: /crouch/i })).toHaveCount(0)
  })
})

test('with a keyboard the buttons carry F and T and press those keys', async ({ page }) => {
  await page.goto(harness)
  await ready(page)
  await page.evaluate(() => {
    window.walk.setTouch(false)
    window.walk.setHud({ interact: { label: 'Window', verb: 'open' }, shuttersInView: true, canClose: true })
  })
  const shutters = page.getByRole('button', { name: 'Shutters' })
  const close = page.getByRole('button', { name: 'Close' })
  await expect(shutters.locator('kbd')).toHaveText('F')
  await expect(close.locator('kbd')).toHaveText('T')
  await shutters.click()
  await close.click()
  await expect.poll(() => page.evaluate(() => window.walk.keys)).toEqual(['KeyF', 'KeyT'])
  // The keyboard path: the controllers listen for the keys, not the touch channel.
  expect(await page.evaluate(() => window.walk.requests)).toEqual({ interact: 0, jump: 0, shutters: 0, close: 0 })
})
