import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'

test.setTimeout(90_000)

test('pool geometry renders, and its lazy entry is absent on a non-pool visit', async ({ page }) => {
  const manifest = JSON.parse(await readFile('dist/runtime-manifest.json', 'utf8')) as Record<string, { file: string }>
  const poolEntry = Object.entries(manifest).find(([key]) => key.includes('plugin-pool/') && key.endsWith('/render.ts'))?.[1].file
  expect(poolEntry, 'the test build must emit an independent pool render chunk').toBeTruthy()
  const requests: string[] = []
  const errors: string[] = []
  page.on('request', (request) => requests.push(new URL(request.url()).pathname))
  page.on('pageerror', (error) => errors.push(error.message))
  await page.route('https://**', (route) => route.abort())
  await page.goto('/tests/runtime.html')
  await expect(page.locator('[data-scene-ready=true]')).toBeVisible({ timeout: 60_000 })
  expect(requests).not.toContain(`/${poolEntry}`)
  expect(await page.evaluate(() => window.runtimeTest.meshes().some((mesh) => mesh.name === 'pool-water'))).toBe(false)

  await page.goto('/tests/runtime.html?pool=1')
  await expect(page.locator('[data-scene-ready=true]')).toBeVisible({ timeout: 60_000 })
  expect(requests).toContain(`/${poolEntry}`)
  await expect.poll(() => page.evaluate(() => window.runtimeTest.meshes()
    .filter((mesh) => ['pool-shell-floor', 'pool-shell-walls', 'pool-water', 'pool-coping'].includes(mesh.name))
    .filter((mesh) => mesh.vertices > 0).map((mesh) => mesh.name).sort()), { timeout: 20_000 })
    .toEqual(['pool-coping', 'pool-shell-floor', 'pool-shell-walls', 'pool-water'])
  // Read the composited canvas, since WebGL clears its drawing buffer after presenting.
  const screenshot = await page.locator('canvas').screenshot()
  const colorCount = await page.evaluate(async (base64) => {
    const source = new Image()
    source.src = `data:image/png;base64,${base64}`
    await source.decode()
    const copy = document.createElement('canvas')
    copy.width = copy.height = 96
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

test('unknown kinds warn once per kind and the rest of the scene renders with its library material', async ({ page }) => {
  const warnings: string[] = []
  const errors: string[] = []
  page.on('console', (message) => { if (message.type() === 'warning') warnings.push(message.text()) })
  page.on('pageerror', (error) => errors.push(error.message))
  await page.route('https://**', (route) => route.abort())
  await page.goto('/tests/runtime.html?unknown=1')
  await expect(page.locator('[data-scene-ready=true]')).toBeVisible({ timeout: 60_000 })
  const state = await page.evaluate(() => {
    const runtime = window.runtimeTest
    runtime.recheckUnknown()
    runtime.recheckUnknown()
    return { unknown: runtime.prepared!.unknownKinds, material: runtime.material(), meshes: runtime.meshes() }
  })
  expect(state.unknown).toEqual({ 'private:missing': 2 })
  expect(warnings.filter((message) => message.includes('unknown kind private:missing'))).toHaveLength(1)
  expect(warnings.filter((message) => /material.*(?:fallback|missing|unresolved|not found)/i.test(message))).toEqual([])
  expect(state.material.item).toMatchObject({ label: 'Fixture pink plaster', category: 'other', source: 'community' })
  expect(state.material.preset?.mapProperties.color).toBe('#e6428f')
  expect(state.meshes.some((mesh) => mesh.vertices > 0 && mesh.colors.includes('e6428f'))).toBe(true)
  expect(errors).toEqual([])
})

test('plugin install gates, legacy graphs and untrusted package data obey the allowlist', async ({ page }) => {
  await page.goto('/tests/runtime.html')
  await page.waitForFunction(() => !!window.runtimeTest)
  const result = await page.evaluate(() => {
    const { neededPlugins, pluginInstallStateOf } = window.runtimeTest
    const nodes = { pool: { type: 'pool:pool' }, street: { type: 'streetscape:road' }, tree: { type: 'trees:tree' }, remote: { type: 'https://evil.invalid/render' } }
    return {
      legacy: neededPlugins({ nodes }), empty: neededPlugins({ nodes, installedPlugins: [] }),
      explicit: neededPlugins({ nodes, installedPlugins: ['pascal:pool', 'https://evil.invalid/render'] }),
      malformed: pluginInstallStateOf({ installedPlugins: [1, 'pascal:pool'] }),
      nonArray: pluginInstallStateOf({ installedPlugins: 'broken' }).hasExplicitPluginInstallState,
    }
  })
  expect(result.legacy.sort()).toEqual(['@pascal-app/plugin-pool', '@pascal-app/plugin-streetscape'])
  expect(result.empty).toEqual([])
  expect(result.explicit).toEqual(['@pascal-app/plugin-pool'])
  expect(result.malformed).toEqual({ installedPlugins: ['pascal:pool'], hasExplicitPluginInstallState: true })
  expect(result.nonArray).toBe(false)
})

test('artifact routes omit cookies, prefetch private bytes once and strip bearer on storage redirects', async ({ page }) => {
  const apiReads: { authorization?: string; cookie?: string }[] = []
  const storageReads: { authorization?: string; cookie?: string }[] = []
  // Playwright routes only intercept the first URL of a redirect chain. Serve the
  // storage stand-in from the actual preview server to exercise native redirects.
  const storageUrl = new URL('/tests/compiled-artifact.txt', test.info().project.use.baseURL).href
  page.on('request', (request) => {
    if (request.url() === storageUrl) {
      const headers = request.headers()
      storageReads.push({ authorization: headers.authorization, cookie: headers.cookie })
    }
  })
  await page.route('https://editor.pascal.app/api/projects/**/artifacts/*', async (route) => {
    if (route.request().method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization', 'access-control-allow-methods': 'GET' } })
      return
    }
    const headers = await route.request().allHeaders()
    apiReads.push({ authorization: headers.authorization, cookie: headers.cookie })
    await route.fulfill({ status: 307, headers: { 'access-control-allow-origin': '*', location: storageUrl } })
  })
  // Even with ambient Pascal/storage cookies in this context, reads must omit them.
  await page.context().addCookies([
    { name: 'session', value: 'must-not-send', domain: 'editor.pascal.app', path: '/', secure: true, sameSite: 'None' },
    { name: 'storage', value: 'must-not-send', url: test.info().project.use.baseURL! },
  ])
  await page.goto('/tests/runtime.html')
  await page.waitForFunction(() => !!window.runtimeTest)
  const result = await page.evaluate(async () => {
    const { createProjectArtifactStore, referencedArtifactHashes } = window.runtimeTest
    const hash = 'a'.repeat(64)
    const graph = { item: { asset: { src: `artifact://${hash}` }, texture: [`artifact://${hash}`] }, ignored: 'artifact://not-a-hash' }
    const options = { baseUrl: 'https://editor.pascal.app/', projectId: 'project/fixture', graph }
    const anonymous = await createProjectArtifactStore(options)
    const publicUrl = anonymous.store.url(hash)
    const anonymousBytes = await (await fetch(publicUrl!, { credentials: 'omit' })).text()
    const privateStore = await createProjectArtifactStore({ ...options, token: 'pvh_fixture' })
    const privateUrl = privateStore.store.url(hash)!
    const privateBytes = await (await fetch(privateUrl)).text()
    const missing = privateStore.store.url('b'.repeat(64))
    const script = await privateStore.store.text(hash)
    let readOnly = false
    try { await privateStore.store.put(hash, new Uint8Array(), 'text/plain') } catch { readOnly = true }
    privateStore.dispose()
    let revoked = false
    try { await fetch(privateUrl) } catch { revoked = true }
    anonymous.dispose()
    return { hashes: referencedArtifactHashes(graph), publicUrl, anonymousBytes, privateBytes, privateUrl, missing, script, readOnly, revoked, disposed: privateStore.store.url(hash) }
  })
  expect(result.hashes).toEqual(['a'.repeat(64)])
  expect(result.publicUrl).toContain('/api/projects/project%2Ffixture/artifacts/')
  expect(result.anonymousBytes).toBe('compiled artifact bytes')
  expect(result.privateBytes).toBe('compiled artifact bytes')
  expect(result.privateUrl).toMatch(/^blob:/)
  expect(result).toMatchObject({ missing: null, script: null, readOnly: true, revoked: true, disposed: null })
  expect(apiReads).toEqual([{ authorization: undefined, cookie: undefined }, { authorization: 'Bearer pvh_fixture', cookie: undefined }])
  expect(storageReads).toEqual([{ authorization: undefined, cookie: undefined }, { authorization: undefined, cookie: undefined }])
})

test('failed and aborted artifact setup releases its read-only lease', async ({ page }) => {
  await page.route('https://editor.pascal.app/api/projects/rejected/artifacts/*', (route) => route.fulfill({ status: 401, headers: { 'access-control-allow-origin': '*' }, body: '{}' }))
  await page.goto('/tests/runtime.html')
  await expect(page.locator('[data-scene-ready=true]')).toBeVisible({ timeout: 60_000 })
  const result = await page.evaluate(async () => {
    const { createProjectArtifactStore, prepareSceneRuntime, isReadOnly } = window.runtimeTest
    const lockedBefore = isReadOnly()
    let status: number | null = null
    try {
      await prepareSceneRuntime({ projectId: 'rejected', token: 'pvh_fixture', graph: { nodes: { item: { id: 'item', type: 'item', asset: { src: `artifact://${'a'.repeat(64)}` } } }, rootNodeIds: ['item'] } })
    } catch (error) { status = (error as { status: number }).status }
    const controller = new AbortController()
    controller.abort()
    let aborted = false
    try { await createProjectArtifactStore({ projectId: 'aborted', baseUrl: 'https://editor.pascal.app', graph: {}, signal: controller.signal }) }
    catch (error) { aborted = (error as Error).name === 'AbortError' }
    // Repeated disposal must be safe for the assembly's unmount cleanup.
    window.runtimeTest.prepared!.dispose()
    window.runtimeTest.prepared!.dispose()
    return { status, aborted, lockedBefore, lockedAfter: isReadOnly() }
  })
  expect(result).toEqual({ status: 401, aborted: true, lockedBefore: true, lockedAfter: false })
})
