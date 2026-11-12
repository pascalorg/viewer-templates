import { resolve } from 'node:path'
import { expect, test } from '@playwright/test'
import { createServer, type ViteDevServer } from 'vite'
import { liveScene, mockPascal, sceneBody, seedCredential, ISSUER, TOKEN } from './pascal-mocks'

// An isolated fixture entry exercises the public hook API and runtime boundary.
// App's production smoke still runs against vite preview on 4180.
let server: ViteDevServer
let harnessUrl: string
test.beforeAll(async () => {
  server = await createServer({ configFile: resolve('vite.config.ts'), server: { port: 0, host: 'localhost' } })
  await server.listen()
  harnessUrl = server.resolvedUrls!.local[0]! + 'tests/fixtures/hook.html'
})
test.afterAll(async () => { await server?.close() })

test('waits for preparation, passes the renewed graph, and cleans up the bake and late plugins', async ({ page }) => {
  const calls = await mockPascal(page, (n) => {
    const scene = sceneBody()
    if (n === 1) scene.bake.lods[0]!.expiresAt = new Date(Date.now() - 1000).toISOString()
    else scene.revision.version = 2
    return { body: scene }
  })
  await page.goto(harnessUrl)
  await page.evaluate(() => { window.s3.block = true; window.s3.mount() })
  await expect.poll(() => page.evaluate(() => window.s3.preparations.length)).toBe(1)
  await expect(page.locator('output')).toHaveAttribute('data-kind', 'downloading')
  expect(await page.evaluate(() => ({ version: window.s3.preparations[0]!.scene.revision.version,
    token: window.s3.preparations[0]!.token, aborted: window.s3.preparations[0]!.signal.aborted })))
    .toEqual({ version: 2, token: undefined, aborted: false })
  await page.evaluate(() => window.s3.preparations[0]!.finish())
  await expect(page.locator('output')).toHaveAttribute('data-kind', 'baked')
  expect(calls.scene).toBe(2)
  expect(calls.glb).toBe(1)
  await page.evaluate(() => window.s3.preparations[0]!.onLate())
  await expect.poll(() => page.evaluate(() => window.s3.state && 'runtimeRevision' in window.s3.state ? window.s3.state.runtimeRevision : null)).toBe(1)
  await page.evaluate(() => window.s3.unmount())
  await expect(page.locator('output')).toHaveCount(0)
  const resources = await page.evaluate(() => ({ urls: window.s3.urls, revoked: window.s3.revoked,
    disposed: window.s3.disposed, aborted: window.s3.preparations[0]!.signal.aborted }))
  expect(resources.urls).toHaveLength(1)
  expect(resources.revoked).toEqual(resources.urls)
  expect(resources.disposed).toBe(1)
  expect(resources.aborted).toBe(true)
  await page.evaluate(() => window.s3.preparations[0]!.onLate())
  await expect(page.locator('output')).toHaveCount(0)
})

test('ignores stale runtime completions and late callbacks after switching projects', async ({ page }) => {
  await mockPascal(page, (n) => ({ body: sceneBody({ project: {
    id: n === 1 ? 'fixture-house' : 'other-project', name: `Project ${n}`, owner: null, coverUrl: null,
  } }) }))
  await page.goto(harnessUrl)
  await page.evaluate(() => { window.s3.block = true; window.s3.mount() })
  await expect.poll(() => page.evaluate(() => window.s3.preparations.length)).toBe(1)
  await page.evaluate(() => window.s3.mount({ projectId: 'other-project' }))
  await expect.poll(() => page.evaluate(() => window.s3.preparations.length)).toBe(2)
  expect(await page.evaluate(() => window.s3.preparations[0]!.signal.aborted)).toBe(true)
  await page.evaluate(() => window.s3.preparations[1]!.finish())
  await expect(page.locator('output')).toHaveAttribute('data-kind', 'baked')
  await page.evaluate(() => { window.s3.preparations[0]!.finish(); window.s3.preparations[0]!.onLate() })
  await expect.poll(() => page.evaluate(() => window.s3.disposed)).toBe(1)
  expect(await page.evaluate(() => window.s3.state && 'scene' in window.s3.state ? {
    project: window.s3.state.scene.project.id, revision: 'runtimeRevision' in window.s3.state ? window.s3.state.runtimeRevision : null,
  } : null)).toEqual({ project: 'other-project', revision: 0 })
  await page.evaluate(() => window.s3.unmount())
  await expect.poll(() => page.evaluate(() => window.s3.disposed)).toBe(2)
  expect(await page.evaluate(() => window.s3.revoked)).toEqual(await page.evaluate(() => window.s3.urls))
})

test('cancels an in-flight scene read on unmount without preparing a stale scene', async ({ page }) => {
  await mockPascal(page)
  let finish!: () => void
  const pending = new Promise<void>((resolve) => { finish = resolve })
  let reads = 0
  await page.route('**/api/projects/*/scene', async (route) => {
    reads++
    await pending
    await route.fulfill({ json: liveScene(), headers: { 'access-control-allow-origin': '*' } }).catch(() => {})
  })
  await page.goto(harnessUrl)
  await page.evaluate(() => window.s3.mount())
  await expect.poll(() => reads).toBe(1)
  const failed = page.waitForEvent('requestfailed', (request) => request.url().includes('/scene'))
  await page.evaluate(() => window.s3.unmount())
  await failed
  finish()
  await expect(page.locator('output')).toHaveCount(0)
  expect(await page.evaluate(() => window.s3.preparations.length)).toBe(0)
})

for (const source of ['live', 'baked'] as const) {
  test(`honours forced ${source} mode`, async ({ page }) => {
    const calls = await mockPascal(page, () => ({ body: source === 'live' ? sceneBody() : liveScene() }))
    await page.goto(harnessUrl)
    await page.evaluate((source) => window.s3.mount({ source }), source)
    await expect(page.locator('output')).toHaveAttribute('data-kind', source === 'live' ? 'live' : 'no-file')
    expect(calls.glb).toBe(0)
    expect(await page.evaluate(() => window.s3.preparations.length)).toBe(source === 'live' ? 1 : 0)
  })
}

test('does not poll a baking scene by default', async ({ page }) => {
  const calls = await mockPascal(page, () => ({ body: liveScene('baking') }))
  await page.clock.install()
  await page.goto(harnessUrl)
  await page.evaluate(() => window.s3.mount())
  await expect(page.locator('output')).toHaveAttribute('data-kind', 'live')
  await page.clock.fastForward(90_000)
  expect(calls.scene).toBe(1)
  expect(calls.glb).toBe(0)
})

test('opt-in polling preserves unchanged live scenes, swaps to a bake, and cancels timers', async ({ page }) => {
  const calls = await mockPascal(page, (n) => ({ body: n < 3 ? liveScene('baking') : sceneBody() }))
  await page.clock.install()
  await page.goto(harnessUrl)
  await page.evaluate(() => window.s3.mount({ pollBake: true }))
  await expect(page.locator('output')).toHaveAttribute('data-kind', 'live')
  await page.clock.fastForward(30_000)
  await expect.poll(() => calls.scene).toBe(2)
  expect(await page.evaluate(() => window.s3.preparations.length)).toBe(1)
  expect(await page.evaluate(() => window.s3.disposed)).toBe(0)
  await page.clock.fastForward(30_000)
  await expect(page.locator('output')).toHaveAttribute('data-kind', 'baked')
  expect(calls.scene).toBe(3)
  expect(calls.glb).toBe(1)
  expect(await page.evaluate(() => window.s3.preparations.length)).toBe(2)
  expect(await page.evaluate(() => window.s3.preparations[0]!.signal.aborted)).toBe(true)
  await page.evaluate(() => window.s3.unmount())
  await expect(page.locator('output')).toHaveCount(0)
  await page.clock.fastForward(90_000)
  expect(calls.scene).toBe(3)
})

test('aborts preparation and revokes its blob URL on runtime failure, then reloads', async ({ page }) => {
  await mockPascal(page)
  await page.goto(harnessUrl)
  await page.evaluate(() => { window.s3.block = true; window.s3.mount() })
  await expect.poll(() => page.evaluate(() => window.s3.preparations.length)).toBe(1)
  await page.evaluate(() => window.s3.preparations[0]!.fail())
  await expect(page.locator('output')).toHaveAttribute('data-kind', 'error')
  expect(await page.evaluate(() => window.s3.preparations[0]!.signal.aborted)).toBe(true)
  expect(await page.evaluate(() => window.s3.revoked)).toEqual(await page.evaluate(() => window.s3.urls))
  await page.evaluate(() => { window.s3.block = false; window.s3.reload() })
  await expect(page.locator('output')).toHaveAttribute('data-kind', 'baked')
  expect(await page.evaluate(() => window.s3.preparations.length)).toBe(2)
})

test('passes the credential to runtime preparation and renews near expiry in its original mode', async ({ page }) => {
  const calls = await mockPascal(page, () => ({ body: liveScene() }))
  await page.clock.install()
  await seedCredential(page, 'share', 180_000)
  await page.route('**/viewer/authorize?*', (route) => route.fulfill({ contentType: 'text/html', body: '<p>Pascal authorize</p>' }))
  await page.goto(harnessUrl)
  await page.evaluate(() => window.s3.mount())
  await expect(page.locator('output')).toHaveAttribute('data-kind', 'live')
  expect(await page.evaluate(() => window.s3.preparations[0]!.token)).toBe(TOKEN)
  await page.clock.fastForward(60_001)
  await page.waitForURL(`${ISSUER}/viewer/authorize?*`)
  expect(new URL(page.url()).searchParams.get('access')).toBe('share')
  expect(calls.scene).toBe(1)
})
