import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { expect, type Page, test } from '@playwright/test'

const fixtures = new URL('./fixtures/', import.meta.url)
const glb = readFileSync(new URL('house.glb', fixtures))
const scene = JSON.parse(readFileSync(new URL('scene.json', fixtures), 'utf8'))
const GLB_URL = 'https://fixtures.supabase.co/storage/lod0.glb'
const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'Authorization, Content-Type',
}

function sceneBody(overrides: { expiresAt?: string; bake?: object } = {}) {
  const expiresAt = overrides.expiresAt ?? new Date(Date.now() + 10 * 60_000).toISOString()
  return JSON.stringify({
    ...scene,
    bake: overrides.bake ?? {
      ...scene.bake,
      lods: [{ ...scene.bake.lods[0], url: GLB_URL, bytes: glb.byteLength, expiresAt }],
    },
  })
}

/** Answers the scene read with `answer(n)` for the n-th request and serves the fixture GLB. */
async function mockPascal(
  page: Page,
  answer: (n: number) => { status?: number; body: string } = () => ({ body: sceneBody() }),
  glbStatus: (n: number) => number = () => 200,
) {
  const calls = { scene: 0, glb: 0 }
  await page.route('**/api/viewers/resolve?*', (route) =>
    route.fulfill({ status: 404, json: { availability: 'unavailable' }, headers: cors }))
  await page.route('**/api/projects/*/scene*', (route) => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors })
    const { status = 200, body } = answer(++calls.scene)
    return route.fulfill({ status, body, contentType: 'application/json', headers: cors })
  })
  await page.route(GLB_URL, (route) => {
    const status = glbStatus(++calls.glb)
    return status === 200
      ? route.fulfill({ body: glb, contentType: 'model/gltf-binary', headers: cors })
      : route.fulfill({ status, body: 'expired', headers: cors })
  })
  return calls
}

/** Distinct colours in the rendered canvas: 1 for an empty clear colour, many for a model. */
async function canvasColours(page: Page) {
  const png = await page.locator('canvas').screenshot()
  return page.evaluate(async (base64) => {
    const image = new Image()
    image.src = `data:image/png;base64,${base64}`
    await image.decode()
    const canvas = document.createElement('canvas')
    canvas.width = image.width
    canvas.height = image.height
    const context = canvas.getContext('2d')!
    context.drawImage(image, 0, 0)
    const { data } = context.getImageData(0, 0, image.width, image.height)
    const colours = new Set<number>()
    for (let i = 0; i < data.length; i += 4 * 7) {
      colours.add((data[i]! << 16) | (data[i + 1]! << 8) | data[i + 2]!)
    }
    return colours.size
  }, png.toString('base64'))
}

test('renders the baked model and lists its floors', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => message.type() === 'error' && errors.push(message.text()))
  await mockPascal(page)

  await page.goto('/?project=fixture-house')
  await expect(page.locator('main[data-state="ready"]')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Fixture house' })).toBeVisible()
  await expect(page.locator('canvas')).toBeVisible()
  expect(await canvasColours(page)).toBeGreaterThan(50)

  const floors = page.getByRole('group', { name: 'Floors' }).getByRole('button')
  await expect(floors).toHaveText(['All floors', 'First floor', 'Ground floor'])
  await page.getByRole('button', { name: 'Ground floor' }).click()
  await expect(page.getByRole('button', { name: 'Ground floor' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await expect(page.getByText('Click a door or window to open it')).toBeVisible()
  expect(errors).toEqual([])
})

test('names the room under the pointer with its area', async ({ page }) => {
  await mockPascal(page)
  await page.goto('/?project=fixture-house')
  await expect(page.locator('main[data-state="ready"]')).toBeVisible()
  await page.getByRole('button', { name: 'Ground floor' }).click()

  const box = (await page.locator('canvas').boundingBox())!
  const label = page.locator('.room-label')
  const seen = new Set<string>()
  for (let y = 0.3; y <= 0.8; y += 0.1) {
    for (let x = 0.2; x <= 0.8; x += 0.1) {
      await page.mouse.move(box.x + box.width * x, box.y + box.height * y)
      if (await label.isVisible()) seen.add((await label.innerText()).replace(/\s+/g, ' '))
    }
  }
  expect([...seen]).toEqual(
    expect.arrayContaining([expect.stringMatching(/^(Living room 30|Kitchen 18) m²$/)]),
  )
})

test('opens a door on click and closes it on a second click', async ({ page }) => {
  await mockPascal(page)
  await page.goto('/?project=fixture-house')
  await expect(page.locator('main[data-state="ready"]')).toBeVisible()
  await page.getByRole('button', { name: 'Ground floor' }).click()

  const canvas = page.locator('canvas')
  const box = (await canvas.boundingBox())!
  let door: { x: number; y: number } | null = null
  // The fixture's front door faces the camera, low and left of centre.
  for (let y = 0.95; y >= 0.4 && !door; y -= 0.03) {
    for (let x = 0.3; x <= 0.7 && !door; x += 0.03) {
      const point = { x: box.x + box.width * x, y: box.y + box.height * y }
      await page.mouse.move(point.x, point.y)
      if ((await canvas.evaluate((element) => element.style.cursor)) === 'pointer') door = point
    }
  }
  expect(door).not.toBeNull()

  const closed = await canvas.screenshot()
  await page.mouse.click(door!.x, door!.y)
  await page.waitForTimeout(1300)
  const opened = await canvas.screenshot()
  expect(opened.equals(closed)).toBe(false)
  await page.mouse.click(door!.x, door!.y)
  await page.waitForTimeout(1300)
  expect((await canvas.screenshot()).equals(opened)).toBe(false)
})

test('renews an expired 3D file URL by reading the scene again', async ({ page }) => {
  const calls = await mockPascal(page, (n) => ({
    body: sceneBody(n === 1 ? { expiresAt: new Date(Date.now() - 1000).toISOString() } : {}),
  }))
  await page.goto('/?project=fixture-house')
  await expect(page.locator('main[data-state="ready"]')).toBeVisible()
  expect(calls).toEqual({ scene: 2, glb: 1 })
})

test('renews once when storage rejects the signed URL', async ({ page }) => {
  const calls = await mockPascal(page, undefined, (n) => (n === 1 ? 400 : 200))
  await page.goto('/?project=fixture-house')
  await expect(page.locator('main[data-state="ready"]')).toBeVisible()
  expect(calls).toEqual({ scene: 2, glb: 2 })
})

test('says when the 3D file is still being prepared', async ({ page }) => {
  await mockPascal(page, () => ({
    body: sceneBody({ bake: { status: 'baking', bakeVersion: null, hash: null, lods: [] } }),
  }))
  await page.goto('/?project=fixture-house')
  await expect(
    page.getByRole('heading', { name: "This project's 3D file is being prepared" }),
  ).toBeVisible()
})

test('says when the project is not published', async ({ page }) => {
  await mockPascal(page, () => ({ status: 404, body: JSON.stringify({ error: 'not_published' }) }))
  await page.goto('/?project=fixture-house')
  await expect(
    page.getByRole('heading', { name: "This project isn't published yet" }),
  ).toBeVisible()
})

const ISSUER = 'https://editor.pascal.app'
const VIEWER = 'viewer_fixture'
const PROJECT = 'fixture-house'
const STATE = 's'.repeat(43)
const VERIFIER = 'v'.repeat(43)
const CODE = `pvc_${'c'.repeat(43)}`
const TOKEN = `pvh_${'t'.repeat(43)}`
const HANDOFF_KEY = `pascal:handoff:${ISSUER}`
const origin = 'http://localhost:4179'
const redirectUri = origin + '/'
const CREDENTIAL_KEY = `pascal:credential:${JSON.stringify([ISSUER, VIEWER, PROJECT, origin])}`
const entryPath = `/?project=${PROJECT}&viewer=${VIEWER}&access=share`
const callbackPath = `/?code=${CODE}&state=${STATE}&iss=${encodeURIComponent(ISSUER)}`

async function mockDescriptor(page: Page) {
  const calls = { resolve: 0 }
  await page.route('**/api/viewers/resolve?*', (route) => {
    calls.resolve++
    expect(new URL(route.request().url()).searchParams.get('origin')).toBe(origin)
    return route.fulfill({ headers: cors, json: {
      viewer_id: VIEWER, display_name: 'Fixture viewer', entry_url: redirectUri,
      redirect_uri: redirectUri, availability: 'available',
    } })
  })
  return calls
}

async function seedTransaction(page: Page, overrides: Record<string, unknown> = {}) {
  await page.addInitScript(({ key, value, origin }) => {
    if (location.origin !== origin || sessionStorage.getItem(`fixture:seeded:${key}`)) return
    sessionStorage.setItem(key, JSON.stringify(value))
    sessionStorage.setItem(`fixture:seeded:${key}`, 'true')
  }, {
    key: HANDOFF_KEY, origin,
    value: { verifier: VERIFIER, state: STATE, issuer: ISSUER, viewer: VIEWER, project: PROJECT,
      redirect_uri: redirectUri, access: 'share', createdAt: Date.now(), returnPath: entryPath, ...overrides },
  })
}

async function seedCredential(page: Page, overrides: Record<string, unknown> = {}, key = CREDENTIAL_KEY) {
  await page.addInitScript(({ key, value, origin }) => {
    if (location.origin !== origin || sessionStorage.getItem(`fixture:seeded:${key}`)) return
    sessionStorage.setItem(key, JSON.stringify(value))
    sessionStorage.setItem(`fixture:seeded:${key}`, 'true')
  }, {
    key, origin,
    value: { access_token: TOKEN, expires_at: new Date(Date.now() + 3_600_000).toISOString(),
      project_id: PROJECT, viewer_id: VIEWER, issuer: ISSUER, origin, access: 'share',
      renewalAttempted: false, ...overrides },
  })
}

async function mockExchange(page: Page, expiresAt = new Date(Date.now() + 3_600_000).toISOString()) {
  const calls = { exchange: 0, scrubbed: false }
  await page.route('**/api/viewer-handoff/exchange', async (route) => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors })
    calls.exchange++
    calls.scrubbed = await page.evaluate(() => !['code', 'state', 'iss'].some((key) => new URLSearchParams(location.search).has(key)))
    expect(route.request().method()).toBe('POST')
    expect(route.request().postDataJSON()).toEqual({ code: CODE, code_verifier: VERIFIER, viewer: VIEWER, redirect_uri: redirectUri })
    expect(route.request().headers()['cookie']).toBeUndefined()
    expect(route.request().headers()['authorization']).toBeUndefined()
    await route.fulfill({ headers: cors, json: { access_token: TOKEN, token_type: 'Bearer',
      expires_at: expiresAt, project_id: PROJECT, viewer_id: VIEWER, revision: 'published' } })
  })
  return calls
}

async function mockAuthorize(page: Page) {
  await page.route('**/viewer/authorize?*', (route) => route.fulfill({ contentType: 'text/html', body: '<p>Pascal authorize</p>' }))
}

test('starts the share handoff with independent state, S256 PKCE and the exact callback', async ({ page }) => {
  const reads = await mockPascal(page)
  const registry = await mockDescriptor(page)
  await mockAuthorize(page)
  await page.goto(entryPath)
  await page.waitForURL(`${ISSUER}/viewer/authorize?*`)
  const query = new URL(page.url()).searchParams
  expect([...query.keys()].sort()).toEqual(['access', 'code_challenge', 'code_challenge_method', 'project', 'redirect_uri', 'state', 'viewer'])
  expect(query.get('access')).toBe('share')
  expect(query.get('viewer')).toBe(VIEWER)
  expect(query.get('project')).toBe(PROJECT)
  expect(query.get('redirect_uri')).toBe(redirectUri)
  expect(query.get('code_challenge_method')).toBe('S256')
  expect(query.get('state')).toMatch(/^[A-Za-z0-9_-]{43}$/)
  // Return to the viewer origin without running its app to inspect the saved transaction.
  await page.route(`${origin}/inspect`, (route) => route.fulfill({ contentType: 'text/html', body: '<p>Inspect</p>' }))
  await page.goto('/inspect')
  const transaction = await page.evaluate((key) => JSON.parse(sessionStorage.getItem(key)!), HANDOFF_KEY)
  expect(transaction.state).toBe(query.get('state'))
  expect(transaction.verifier).toMatch(/^[A-Za-z0-9_-]{43}$/)
  expect(transaction.verifier).not.toBe(transaction.state)
  expect(query.get('code_challenge')).toBe(createHash('sha256').update(transaction.verifier).digest('base64url'))
  expect(transaction.returnPath).toBe(entryPath)
  expect(reads.scene).toBe(0)
  expect(registry.resolve).toBe(1)
})

test('exchanges the callback once, scrubs before exchange and reads with the child bearer', async ({ page, context }) => {
  await context.addCookies([{ name: 'pascal_session', value: 'must-not-send', url: ISSUER }])
  await mockPascal(page)
  const registry = await mockDescriptor(page)
  await seedTransaction(page)
  const exchange = await mockExchange(page)
  const read = page.waitForRequest('**/api/projects/*/scene*')
  const storage = page.waitForRequest(GLB_URL)
  await page.goto(callbackPath)
  await expect(page.locator('main[data-state="ready"]')).toBeVisible()
  expect((await read).headers()['authorization']).toBe(`Bearer ${TOKEN}`)
  expect((await read).headers()['cookie']).toBeUndefined()
  expect((await storage).headers()['authorization']).toBeUndefined()
  expect(exchange).toEqual({ exchange: 1, scrubbed: true })
  expect(page.url()).toBe(origin + entryPath)
  const stored = await page.evaluate((key) => JSON.parse(sessionStorage.getItem(key)!), CREDENTIAL_KEY)
  expect(stored.access_token).toBe(TOKEN)
  expect(stored.access).toBe('share')
  expect(await page.evaluate(() => localStorage.length)).toBe(0)
  expect(registry.resolve).toBe(1)
  await page.reload()
  await expect(page.locator('main[data-state="ready"]')).toBeVisible()
  expect(exchange.exchange).toBe(1)
  expect(registry.resolve).toBe(2)
})

for (const invalid of ['state', 'issuer', 'age', 'viewer', 'project', 'callback', 'return path', 'unsolicited', 'duplicate state']) {
  test(`refuses a callback with invalid ${invalid} without exchanging or reading`, async ({ page }) => {
    const reads = await mockPascal(page)
    await mockDescriptor(page)
    if (invalid !== 'unsolicited') await seedTransaction(page, {
      ...(invalid === 'age' ? { createdAt: Date.now() - 600_001 } : {}),
      ...(invalid === 'viewer' ? { viewer: 'viewer_other' } : {}),
      ...(invalid === 'project' ? { project: 'project_other' } : {}),
      ...(invalid === 'callback' ? { redirect_uri: origin + '/wrong' } : {}),
      ...(invalid === 'return path' ? { returnPath: '//evil.example/' } : {}),
    })
    const exchange = await mockExchange(page)
    const path = invalid === 'state' ? callbackPath.replace(STATE, 'w'.repeat(43))
      : invalid === 'issuer' ? callbackPath.replace(encodeURIComponent(ISSUER), encodeURIComponent('https://other.example'))
      : invalid === 'duplicate state' ? callbackPath + '&state=duplicate' : callbackPath
    await page.goto(path)
    await expect(page.locator('main[data-state="reopen"]')).toBeVisible()
    expect(exchange.exchange).toBe(0)
    expect(reads.scene).toBe(0)
    expect(new URL(page.url()).searchParams.has('code')).toBe(false)
    expect(new URL(page.url()).searchParams.has('state')).toBe(false)
    expect(new URL(page.url()).searchParams.has('iss')).toBe(false)
  })
}

for (const status of [401, 403]) {
  test(`clears a stored credential after a ${status} read and shows reopen without anonymous fallback`, async ({ page }) => {
    const reads = await mockPascal(page, () => ({ status, body: JSON.stringify({ error: 'unauthorized' }) }))
    await mockDescriptor(page)
    await seedCredential(page)
    await page.goto(`/?project=${PROJECT}`)
    await expect(page.getByRole('heading', { name: 'Reopen your share link' })).toBeVisible()
    expect(await page.evaluate((key) => sessionStorage.getItem(key), CREDENTIAL_KEY)).toBeNull()
    expect(reads.scene).toBe(1)
    await expect(page.getByRole('link', { name: 'Open project in Pascal' })).toHaveAttribute('href', `${ISSUER}/editor/${PROJECT}`)
    await page.reload()
    await expect(page.getByRole('heading', { name: 'Reopen your share link' })).toBeVisible()
    expect(reads.scene).toBe(1)
  })
}

test('renews a credential near expiry with its original session mode', async ({ page }) => {
  const reads = await mockPascal(page)
  await mockDescriptor(page)
  await seedCredential(page, { expires_at: new Date(Date.now() + 90_000).toISOString(), access: 'session' })
  await mockAuthorize(page)
  await page.goto(`/?project=${PROJECT}`)
  await page.waitForURL(`${ISSUER}/viewer/authorize?*`)
  expect(new URL(page.url()).searchParams.get('access')).toBe('session')
  expect(reads.scene).toBe(0)
})

test('stops a renewal loop when the renewed credential is already near expiry', async ({ page }) => {
  const reads = await mockPascal(page)
  await mockDescriptor(page)
  await seedTransaction(page, { renewal: true })
  const exchange = await mockExchange(page, new Date(Date.now() + 90_000).toISOString())
  await page.goto(callbackPath)
  await expect(page.getByRole('heading', { name: 'Reopen your share link' })).toBeVisible()
  expect(exchange.exchange).toBe(1)
  expect(reads.scene).toBe(0)
  expect(await page.evaluate((key) => sessionStorage.getItem(key), CREDENTIAL_KEY)).toBeNull()
})

test('ignores credentials stored for another project and reads public projects anonymously', async ({ page }) => {
  await mockPascal(page)
  await mockDescriptor(page)
  await seedCredential(page, { project_id: 'another-project' }, `pascal:credential:${JSON.stringify([ISSUER, VIEWER, 'another-project', origin])}`)
  const read = page.waitForRequest('**/api/projects/*/scene*')
  await page.goto(`/?project=${PROJECT}`)
  await expect(page.locator('main[data-state="ready"]')).toBeVisible()
  expect((await read).headers()['authorization']).toBeUndefined()
})
