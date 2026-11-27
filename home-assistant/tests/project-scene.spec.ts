import { expect, test } from '@playwright/test'
import { cors, glb, ISSUER, liveScene, mockPascal, PROJECT, sceneBody, seedCredential, TOKEN, VIEWER } from './pascal-mocks'

for (const status of ['none', 'failed', 'baking', 'ready'] as const) {
  test(`resolves a live scene for ${status} with no LODs`, async ({ page }) => {
    const calls = await mockPascal(page, () => ({ body: liveScene(status) }))
    await page.goto(`/?project=${PROJECT}`)
    await expect(page.locator('main[data-source="live"][data-scene-ready="true"]')).toBeVisible({ timeout: 60_000 })
    await expect(page.getByText('Fixture house', { exact: true })).toBeVisible()
    expect(calls.glb).toBe(0)
  })
}

test('downloads the ready bake into a blob URL before rendering the fixture', async ({ page, context, baseURL }) => {
  await context.addCookies([{ name: 'pascal_session', value: 'must-not-send', url: ISSUER }])
  const calls = await mockPascal(page)
  await page.addInitScript(() => {
    const original = URL.createObjectURL.bind(URL)
    URL.createObjectURL = (blob) => {
      const url = original(blob)
      if (blob instanceof Blob && blob.type === 'model/gltf-binary') sessionStorage.setItem('fixture:glb', url)
      return url
    }
  })
  await page.goto(`/?project=${PROJECT}`)
  await expect(page.locator('main[data-source="baked"][data-scene-ready="true"]')).toBeVisible({ timeout: 60_000 })
  const blob = await page.evaluate(async () => {
    const url = sessionStorage.getItem('fixture:glb')!
    return { url, bytes: [...new Uint8Array(await (await fetch(url)).arrayBuffer())] }
  })
  expect(blob.url.startsWith(`blob:${new URL(baseURL!).origin}/`)).toBe(true)
  expect(Buffer.from(blob.bytes)).toEqual(glb)
  expect(calls.scene).toBe(1)
  expect(calls.glb).toBe(1)
  expect(calls.authorization).toEqual([undefined])
  expect(calls.cookies).toEqual([undefined])
})

test('renews an expired 3D file URL by reading the scene again (listing regression)', async ({ page }) => {
  const calls = await mockPascal(page, (n) => {
    const scene = sceneBody()
    if (n === 1) scene.bake.lods[0]!.expiresAt = new Date(Date.now() - 1000).toISOString()
    return { body: scene }
  })
  await page.goto(`/?project=${PROJECT}`)
  await expect(page.locator('main[data-source="baked"][data-scene-ready="true"]')).toBeVisible({ timeout: 60_000 })
  expect(calls.scene).toBe(2)
  expect(calls.glb).toBe(1)
})

for (const status of [400, 403]) {
  test(`renews once when storage rejects the signed URL with ${status}`, async ({ page }) => {
    const calls = await mockPascal(page, undefined, (n) => n === 1 ? status : 200)
    await page.goto(`/?project=${PROJECT}`)
    await expect(page.locator('main[data-source="baked"][data-scene-ready="true"]')).toBeVisible({ timeout: 60_000 })
    expect(calls.scene).toBe(2)
    expect(calls.glb).toBe(2)
  })
}

for (const code of ['not_found', 'not_published']) {
  test(`shows ${code}`, async ({ page }) => {
    await mockPascal(page, () => ({ status: 404, body: { error: code } }))
    await page.goto(`/?project=${PROJECT}`)
    await expect(page.locator(`main[data-state="${code}"]`)).toBeVisible()
    await expect(page.getByRole('heading', { name: code === 'not_found' ? 'Project not found' : "This project isn't published yet" })).toBeVisible()
    await expect(page.locator('canvas')).toHaveCount(0)
  })
}

for (const access of ['session', 'share'] as const) {
  test(`a rejected ${access} credential requires reopening with no anonymous fallback`, async ({ page }) => {
    const calls = await mockPascal(page, () => ({ status: 401, body: { error: 'unauthorized' } }))
    await seedCredential(page, access)
    await page.goto(`/?project=${PROJECT}`)
    await expect(page.getByRole('heading', { name: access === 'share' ? 'Reopen your share link' : 'Reopen from Pascal' })).toBeVisible()
    expect(calls.scene).toBe(1)
    expect(calls.authorization).toEqual([`Bearer ${TOKEN}`])
    expect(await page.evaluate(() => Object.keys(sessionStorage).filter((key) => key.startsWith('pascal:credential:')))).toEqual([])
    await expect(page.getByRole('link', { name: 'Open project in Pascal' })).toHaveAttribute('href', `${ISSUER}/editor/${PROJECT}`)
    await page.reload()
    await expect(page.locator(`main[data-state="${access === 'share' ? 'reopen' : 'needs-access'}"]`)).toBeVisible()
    expect(calls.scene).toBe(access === 'share' ? 1 : 2)
  })
}

test('routes a 401 during signed URL renewal through the handoff', async ({ page }) => {
  const calls = await mockPascal(page, (n) => n === 1 ? { body: sceneBody() }
    : { status: 401, body: { error: 'unauthorized' } }, () => 400)
  await seedCredential(page)
  await page.goto(`/?project=${PROJECT}`)
  await expect(page.getByRole('heading', { name: 'Reopen from Pascal' })).toBeVisible()
  expect(calls.scene).toBe(2)
  expect(calls.glb).toBe(1)
  expect(calls.authorization).toEqual([`Bearer ${TOKEN}`, `Bearer ${TOKEN}`])
})

test('App prepares private artifacts with the scene credential and routes a rejection through access', async ({ page }) => {
  const scene = liveScene()
  scene.graph = structuredClone(scene.graph)
  const hash = 'a'.repeat(64)
  scene.graph.nodes.wall_south!.compiledArtifact = `artifact://${hash}`
  const calls = await mockPascal(page, () => ({ body: scene }))
  await seedCredential(page)
  const artifactReads: (string | undefined)[] = []
  await page.route(`${ISSUER}/api/projects/${PROJECT}/artifacts/${hash}`, (route) => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors })
    artifactReads.push(route.request().headers().authorization)
    return route.fulfill({ status: 401, headers: cors, json: { error: 'unauthorized' } })
  })
  await page.goto(`/?project=${PROJECT}`)
  await expect(page.getByRole('heading', { name: 'Reopen from Pascal' })).toBeVisible()
  await expect(page.locator('canvas')).toHaveCount(0)
  expect(artifactReads).toEqual([`Bearer ${TOKEN}`])
  expect(calls.scene).toBe(1)
})

test('captures and scrubs the callback before exchange, then resolves its project', async ({ page, baseURL }) => {
  const callbackUrl = new URL('/', baseURL).href
  const calls = await mockPascal(page, () => ({ body: liveScene() }))
  const state = 's'.repeat(43)
  const verifier = 'v'.repeat(43)
  const code = `pvc_${'c'.repeat(43)}`
  await page.addInitScript(({ issuer, project, viewer, state, verifier }) => {
    sessionStorage.setItem(`pascal:handoff:${issuer}`, JSON.stringify({ issuer, project, viewer,
      state, verifier, redirect_uri: location.origin + '/', access: 'share', createdAt: Date.now(),
      returnPath: `/?project=${project}&viewer=${viewer}&access=share` }))
  }, { issuer: ISSUER, project: PROJECT, viewer: VIEWER, state, verifier })
  await page.route('**/api/viewers/resolve?*', (route) => route.fulfill({ headers: cors, json: {
    viewer_id: VIEWER, redirect_uri: callbackUrl, availability: 'available',
  } }))
  let exchanges = 0
  await page.route('**/api/viewer-handoff/exchange', async (route) => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors })
    exchanges++
    expect(await page.evaluate(() => location.search)).not.toMatch(/code=|state=|iss=/)
    expect(route.request().postDataJSON()).toEqual({ code, code_verifier: verifier, viewer: VIEWER, redirect_uri: callbackUrl })
    await route.fulfill({ headers: cors, json: { access_token: TOKEN, token_type: 'Bearer',
      expires_at: new Date(Date.now() + 3_600_000).toISOString(), project_id: PROJECT, viewer_id: VIEWER, revision: 'published' } })
  })
  await page.goto(`/?code=${code}&state=${state}&iss=${encodeURIComponent(ISSUER)}`)
  await expect(page.locator('main[data-source="live"][data-scene-ready="true"]')).toBeVisible({ timeout: 60_000 })
  expect(exchanges).toBe(1)
  expect(calls.authorization).toEqual([`Bearer ${TOKEN}`])
  expect(page.url()).toBe(`${callbackUrl}?project=${PROJECT}&viewer=${VIEWER}&access=share`)
})

test('a failed download renews only once and provides retry', async ({ page }) => {
  const calls = await mockPascal(page, undefined, () => 403)
  await page.goto(`/?project=${PROJECT}`)
  await expect(page.locator('main[data-state="error"]')).toBeVisible()
  expect(calls.scene).toBe(2)
  expect(calls.glb).toBe(2)
  await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible()
})

test('retries a failed read and resolves the project', async ({ page }) => {
  const calls = await mockPascal(page, (n) => n === 1 ? { status: 500, body: { error: 'failed' } } : { body: liveScene() })
  await page.goto(`/?project=${PROJECT}`)
  await expect(page.locator('main[data-state="error"]')).toBeVisible()
  await page.getByRole('button', { name: 'Try again' }).click()
  await expect(page.locator('main[data-source="live"][data-scene-ready="true"]')).toBeVisible({ timeout: 60_000 })
  expect(calls.scene).toBe(2)
})

test('requires a project and makes no API or storage read', async ({ page }) => {
  const calls = await mockPascal(page)
  await page.goto('/')
  await expect(page.locator('main[data-state="missing-project"]')).toBeVisible()
  expect(calls.scene).toBe(0)
  expect(calls.glb).toBe(0)
})
