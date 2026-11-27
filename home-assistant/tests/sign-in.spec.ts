import { createHash } from 'node:crypto'
import { expect, type Page, test } from '@playwright/test'
import { cors, mockPascal, sceneBody } from './pascal-mocks'

const issuer = 'https://editor.pascal.app'
const project = 'fixture-house'
const viewer = 'viewer_fixture'
const state = 's'.repeat(43)
const verifier = 'v'.repeat(43)
const code = `pvc_${'c'.repeat(43)}`
const token = `pvh_${'t'.repeat(43)}`
const transactionKey = `pascal:handoff:${issuer}`
const returnPath = `/?project=${project}&embed=1#camera`
const sensitive = ['code', 'error', 'error_description', 'state', 'iss']
const errorBody = (error: string) => ({ error })

async function registry(page: Page, available = true) {
  const calls = { resolve: 0 }
  await page.route('**/api/viewers/resolve?*', (route) => {
    calls.resolve++
    const origin = new URL(route.request().url()).searchParams.get('origin')
    return route.fulfill({ headers: cors, json: available
      ? { availability: 'available', viewer_id: viewer, redirect_uri: origin + '/' }
      : { availability: 'unavailable' } })
  })
  return calls
}

async function transaction(page: Page, overrides: Record<string, unknown> = {}) {
  await page.addInitScript(({ issuer, project, viewer, state, verifier, transactionKey, returnPath, overrides }) => {
    if (sessionStorage.getItem('fixture:transaction')) return
    sessionStorage.setItem('fixture:transaction', '1')
    sessionStorage.setItem(transactionKey, JSON.stringify({ issuer, project, viewer, state, verifier,
      access: 'session', signIn: true, redirect_uri: location.origin + '/',
      createdAt: Date.now(), returnPath, ...overrides }))
  }, { issuer, project, viewer, state, verifier, transactionKey, returnPath, overrides })
}

async function exchanges(page: Page) {
  const calls = { exchange: 0, bodies: [] as unknown[] }
  await page.route('**/api/viewer-handoff/exchange', (route) => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors })
    calls.exchange++
    calls.bodies.push(route.request().postDataJSON())
    expect(route.request().headers().cookie).toBeUndefined()
    expect(route.request().headers().authorization).toBeUndefined()
    return route.fulfill({ headers: cors, json: { access_token: token, token_type: 'Bearer',
      expires_at: new Date(Date.now() + 3_600_000).toISOString(), project_id: project,
      viewer_id: viewer, revision: 'published' } })
  })
  return calls
}

async function authorize(page: Page) {
  await page.route('**/viewer/authorize?*', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<p>Pascal authorize</p>' }))
}

async function scrubbedBeforeApp(page: Page) {
  // Observe the dynamic app import: its scripts cannot load until capture has run.
  const observations: string[] = []
  await page.route('**/assets/bootstrap-*.js', async (route) => {
    observations.push(await page.evaluate(() => location.search))
    await route.continue()
  })
  return observations
}

function expectScrubbed(url: string) {
  const query = new URL(url).searchParams
  for (const key of sensitive) expect(query.has(key), key).toBe(false)
}

test('a successful public visit skips viewer registration discovery', async ({ page }) => {
  await mockPascal(page)
  const calls = await registry(page)
  await page.goto(returnPath)
  await expect(page.locator('main[data-scene-ready="true"]')).toBeVisible({ timeout: 60_000 })
  expect(calls.resolve).toBe(0)
  await expect(page.getByRole('button', { name: 'Sign in with Pascal' })).toHaveCount(0)
})

for (const available of [true, false]) {
  for (const status of [404, 401]) {
    test(`anonymous ${status} offers sign-in only with registration: ${available}`, async ({ page }) => {
      const reads = await mockPascal(page, () => ({ status, body: errorBody(status === 404 ? 'not_found' : 'unauthorized') }))
      const calls = await registry(page, available)
      await page.goto(returnPath)
      await expect(page.getByRole('heading', { name: status === 404 ? 'Project not found' : 'This project needs access' })).toBeVisible()
      await expect.poll(() => calls.resolve).toBe(1)
      await expect(page.getByRole('button', { name: 'Sign in with Pascal' })).toHaveCount(available ? 1 : 0)
      expect(reads.scene).toBe(1)
      expect(page.url()).toContain(`?project=${project}`)
    })
  }
}

test('private direct link signs in with fresh PKCE and loads the successful callback', async ({ page, baseURL }) => {
  const reads = await mockPascal(page, (n) => n === 1
    ? { status: 404, body: errorBody('not_found') } : { body: sceneBody() })
  await registry(page)
  await transaction(page)
  await authorize(page)
  const exchange = await exchanges(page)
  const observations = await scrubbedBeforeApp(page)
  await page.goto(returnPath)
  await page.getByRole('button', { name: 'Sign in with Pascal' }).click()
  await page.waitForURL(`${issuer}/viewer/authorize?*`)
  const query = new URL(page.url()).searchParams
  expect([...query.keys()].sort()).toEqual(['access', 'code_challenge', 'code_challenge_method', 'interaction', 'project', 'redirect_uri', 'state', 'viewer'])
  expect(query.get('interaction')).toBe('sign_in')
  expect(query.get('access')).toBe('session')
  expect(query.get('project')).toBe(project)
  expect(query.get('viewer')).toBe(viewer)
  expect(query.get('redirect_uri')).toBe(new URL('/', baseURL).href)
  expect(query.get('code_challenge_method')).toBe('S256')
  expect(query.get('state')).toMatch(/^[A-Za-z0-9_-]{43}$/)
  expect(query.get('state')).not.toBe(state)
  await page.route('**/inspect', (route) => route.fulfill({ contentType: 'text/html', body: '<p>Inspect</p>' }))
  await page.goto('/inspect')
  const saved = await page.evaluate((key) => JSON.parse(sessionStorage.getItem(key)!), transactionKey)
  expect(saved.verifier).toMatch(/^[A-Za-z0-9_-]{43}$/)
  expect(saved.verifier).not.toBe(verifier)
  expect(saved.verifier).not.toBe(saved.state)
  expect(query.get('code_challenge')).toBe(createHash('sha256').update(saved.verifier).digest('base64url'))
  expect(saved.returnPath).toBe(returnPath)
  const request = page.waitForRequest((request) => request.url().includes(`/api/projects/${project}/scene`) && request.method() === 'GET')
  await page.goto(`/?code=${code}&state=${saved.state}&iss=${encodeURIComponent(issuer)}`)
  await expect(page.locator('main[data-scene-ready="true"]')).toBeVisible({ timeout: 60_000 })
  expect((await request).headers().authorization).toBe(`Bearer ${token}`)
  expect(exchange.exchange).toBe(1)
  expect(exchange.bodies).toEqual([{ code, code_verifier: saved.verifier, viewer, redirect_uri: new URL('/', baseURL).href }])
  expect(reads.scene).toBe(2)
  expect(page.url()).toBe(new URL(returnPath, baseURL).href)
  expect(observations.length).toBeGreaterThan(0)
  for (const search of observations) expectScrubbed(new URL('/' + search, baseURL).href)
  expect(await page.evaluate((key) => sessionStorage.getItem(key), transactionKey)).toBeNull()
})

for (const error of ['access_denied', 'unexpected_server_error']) {
  test(`validated ${error} callback is refused without exchange or reading another principal`, async ({ page }) => {
    const reads = await mockPascal(page)
    await registry(page)
    await transaction(page)
    await page.addInitScript(({ issuer, project, viewer, token }) => {
      sessionStorage.setItem(`pascal:credential:${JSON.stringify([issuer, viewer, project, location.origin])}`,
        JSON.stringify({ issuer, project_id: project, viewer_id: viewer, origin: location.origin,
          access: 'session', access_token: token, expires_at: new Date(Date.now() + 3_600_000).toISOString(), renewalAttempted: false }))
    }, { issuer, project, viewer, token })
    const exchange = await exchanges(page)
    const observations = await scrubbedBeforeApp(page)
    await page.goto(`/?error=${error}&error_description=secret-server-description&state=${state}&iss=${encodeURIComponent(issuer)}`)
    await expect(page.getByRole('heading', { name: "This account can't open this project" })).toBeVisible()
    await expect(page.getByText('Another Pascal account may have access.')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Sign in with Pascal' })).toBeVisible()
    await expect(page.getByText('secret-server-description')).toHaveCount(0)
    expect(exchange.exchange).toBe(0)
    expect(reads.scene).toBe(0)
    expectScrubbed(page.url())
    expect(observations.length).toBeGreaterThan(0)
    for (const search of observations) expectScrubbed('https://viewer.example/' + search)
    expect(await page.evaluate((key) => sessionStorage.getItem(key), transactionKey)).toBeNull()
    await authorize(page)
    await page.getByRole('button', { name: 'Sign in with Pascal' }).click()
    await page.waitForURL(`${issuer}/viewer/authorize?*`)
    const query = new URL(page.url()).searchParams
    expect(query.get('state')).not.toBe(state)
    expect(query.get('interaction')).toBe('sign_in')
  })
}

for (const outcome of ['code', 'error']) {
  for (const invalid of ['mixed', 'duplicate outcome', 'duplicate state', 'duplicate issuer', 'duplicate description', 'missing outcome', 'missing state', 'missing issuer', 'unsolicited', 'state', 'issuer', 'age', 'future', 'viewer', 'project', 'callback', 'return path', 'entry']) {
    test(`${outcome} callback rejects invalid ${invalid}`, async ({ page }) => {
      const reads = await mockPascal(page)
      await registry(page)
      if (invalid !== 'unsolicited') await transaction(page, {
        ...(invalid === 'age' ? { createdAt: Date.now() - 600_001 } : {}),
        ...(invalid === 'future' ? { createdAt: Date.now() + 600_000 } : {}),
        ...(invalid === 'viewer' ? { viewer: 'another-viewer' } : {}),
        ...(invalid === 'project' ? { project: 'another-project' } : {}),
        ...(invalid === 'callback' ? { redirect_uri: 'https://wrong.example/' } : {}),
        ...(invalid === 'return path' ? { returnPath: '//wrong.example/' } : {}),
      })
      const exchange = await exchanges(page)
      const query = new URLSearchParams({ [outcome]: outcome === 'code' ? code : 'access_denied', state, iss: issuer })
      if (invalid === 'mixed') query.set(outcome === 'code' ? 'error' : 'code', outcome === 'code' ? 'access_denied' : code)
      if (invalid === 'duplicate outcome') query.append(outcome, query.get(outcome)!)
      if (invalid === 'duplicate state') query.append('state', state)
      if (invalid === 'duplicate issuer') query.append('iss', issuer)
      if (invalid === 'duplicate description') { query.append('error_description', 'private'); query.append('error_description', 'private') }
      if (invalid === 'missing outcome') query.delete(outcome)
      if (invalid === 'missing state') query.delete('state')
      if (invalid === 'missing issuer') query.delete('iss')
      if (invalid === 'state') query.set('state', 'w'.repeat(43))
      if (invalid === 'issuer') query.set('iss', 'https://wrong.example')
      if (invalid === 'entry') { query.set('project', project); query.set('viewer', 'wrong'); query.set('access', 'session') }
      await page.goto('/?' + query)
      await expect(page.locator('main[data-state="reopen"]')).toBeVisible()
      expect(exchange.exchange).toBe(0)
      expect(reads.scene).toBe(0)
      expectScrubbed(page.url())
    })
  }
}

for (const access of ['session', 'share']) {
  test(`${access} Pascal entry sends the correct interaction`, async ({ page }) => {
    const reads = await mockPascal(page)
    await registry(page)
    await authorize(page)
    await page.goto(`/?project=${project}&viewer=${viewer}&access=${access}`)
    await page.waitForURL(`${issuer}/viewer/authorize?*`)
    expect(new URL(page.url()).searchParams.get('interaction')).toBe(access === 'session' ? 'sign_in' : null)
    expect(reads.scene).toBe(0)
  })

  test(`${access} renewal sends the correct interaction with fresh PKCE`, async ({ page }) => {
    const reads = await mockPascal(page)
    await registry(page)
    await transaction(page)
    await page.addInitScript(({ issuer, project, viewer, token, access }) => {
      sessionStorage.setItem(`pascal:credential:${JSON.stringify([issuer, viewer, project, location.origin])}`,
        JSON.stringify({ issuer, project_id: project, viewer_id: viewer, origin: location.origin,
          access, access_token: token, expires_at: new Date(Date.now() + 90_000).toISOString(), renewalAttempted: false }))
    }, { issuer, project, viewer, token, access })
    await authorize(page)
    await page.goto(`/?project=${project}`)
    await page.waitForURL(`${issuer}/viewer/authorize?*`)
    const query = new URL(page.url()).searchParams
    expect(query.get('interaction')).toBe(access === 'session' ? 'sign_in' : null)
    expect(query.get('access')).toBe(access)
    expect(query.get('state')).not.toBe(state)
    expect(query.get('code_challenge')).not.toBe(createHash('sha256').update(verifier).digest('base64url'))
    expect(reads.scene).toBe(0)
  })
}

for (const available of [true, false]) {
  test(`session reopen offers sign-in only with registration: ${available}`, async ({ page }) => {
    const reads = await mockPascal(page)
    await registry(page, available)
    await page.goto(`/?project=${project}&viewer=${viewer}&access=session&state=unsolicited`)
    await expect(page.getByRole('heading', { name: 'Reopen from Pascal' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Sign in with Pascal' })).toHaveCount(available ? 1 : 0)
    expect(reads.scene).toBe(0)
  })
}

test('a refused session stays refused for this load; a reload can read anonymously', async ({ page }) => {
  const reads = await mockPascal(page, () => ({ status: 404, body: errorBody('not_found') }))
  await registry(page)
  await transaction(page)
  const exchange = await exchanges(page)
  await page.goto(`/?error=access_denied&state=${state}&iss=${encodeURIComponent(issuer)}`)
  await expect(page.locator('main[data-state="refused"]')).toBeVisible()
  expect(reads.scene).toBe(0)
  expect(exchange.exchange).toBe(0)
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Project not found' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Sign in with Pascal' })).toBeVisible()
  expect(reads.scene).toBe(1)
  expect(exchange.exchange).toBe(0)
})

test('sign-in preserves an anonymous Pascal entry as the current return page', async ({ page, baseURL }) => {
  const path = `/?project=${project}&viewer=${viewer}&access=anonymous&embed=1`
  await mockPascal(page, (n) => n === 1 ? { status: 404, body: errorBody('not_found') } : { body: sceneBody() })
  await registry(page)
  await authorize(page)
  await exchanges(page)
  await page.goto(path)
  await page.getByRole('button', { name: 'Sign in with Pascal' }).click()
  await page.waitForURL(`${issuer}/viewer/authorize?*`)
  const query = new URL(page.url()).searchParams
  await page.goto(`/?code=${code}&state=${query.get('state')}&iss=${encodeURIComponent(issuer)}`)
  await expect(page.locator('main[data-scene-ready="true"]')).toBeVisible({ timeout: 60_000 })
  expect(page.url()).toBe(new URL(path, baseURL).href)
})
