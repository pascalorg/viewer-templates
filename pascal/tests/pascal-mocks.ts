import { readFileSync } from 'node:fs'
import type { Page } from '@playwright/test'
import type { SceneResponse } from '../src/pascal'

const graph = JSON.parse(readFileSync(new URL('./fixtures/live-scene.json', import.meta.url), 'utf8')) as SceneResponse['graph']

export const ISSUER = 'https://editor.pascal.app'
export const PROJECT = 'fixture-house'
export const VIEWER = 'viewer_fixture'
export const TOKEN = `pvh_${'t'.repeat(43)}`
export const GLB_URL = 'https://fixtures.supabase.co/storage/lod0.glb'
export const glb = readFileSync(new URL('./fixtures/house.glb', import.meta.url))
export const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'Authorization, Content-Type',
}

export function sceneBody(overrides: Partial<SceneResponse> = {}): SceneResponse {
  return {
    contractVersion: 1,
    project: { id: PROJECT, name: 'Fixture house', owner: null, coverUrl: null },
    revision: { kind: 'published', version: 1, modelId: 'model_fixture', disclosurePolicyVersion: 1 },
    graph,
    libraryMaterials: [],
    bake: { status: 'ready', bakeVersion: 3, hash: 'fixture', lods: [{
      level: 0, url: GLB_URL, bytes: glb.length, triangles: null,
      expiresAt: new Date(Date.now() + 600_000).toISOString(),
    }] },
    ...overrides,
  }
}

export function liveScene(status: 'none' | 'baking' | 'failed' | 'ready' = 'none') {
  return sceneBody({ bake: { status, bakeVersion: null, hash: null, lods: [] } })
}

export async function mockPascal(
  page: Page,
  answer: (n: number) => { status?: number; body: unknown } = () => ({ body: sceneBody() }),
  glbStatus: (n: number) => number = () => 200,
) {
  const calls = { scene: 0, glb: 0, authorization: [] as (string | undefined)[], cookies: [] as (string | undefined)[] }
  // The mocks are the only external responses allowed, including during rendering.
  await page.route('https://**', (route) => route.abort())
  await page.route('**/api/viewers/resolve?*', (route) =>
    route.fulfill({ status: 404, json: { availability: 'unavailable' }, headers: cors }))
  await page.route('**/api/projects/*/scene*', (route) => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors })
    calls.authorization.push(route.request().headers()['authorization'])
    calls.cookies.push(route.request().headers()['cookie'])
    const { status = 200, body } = answer(++calls.scene)
    return route.fulfill({ status, json: body, headers: cors })
  })
  await page.route(GLB_URL, (route) => {
    const headers = route.request().headers()
    if (headers['authorization'] || headers['cookie']) throw new Error('Credential leaked to storage')
    const status = glbStatus(++calls.glb)
    return status === 200
      ? route.fulfill({ body: glb, contentType: 'model/gltf-binary', headers: cors })
      : route.fulfill({ status, body: 'expired', headers: cors })
  })
  return calls
}

export async function seedCredential(page: Page, access: 'share' | 'session' = 'session', remainingMs = 3_600_000) {
  await page.addInitScript(({ issuer, project, viewer, token, access, remainingMs }) => {
    const key = `pascal:credential:${JSON.stringify([issuer, viewer, project, location.origin])}`
    if (sessionStorage.getItem('fixture:seeded')) return
    sessionStorage.setItem('fixture:seeded', '1')
    sessionStorage.setItem(key, JSON.stringify({ issuer, project_id: project, viewer_id: viewer,
      origin: location.origin, access, access_token: token, renewalAttempted: false,
      expires_at: new Date(Date.now() + remainingMs).toISOString() }))
  }, { issuer: ISSUER, project: PROJECT, viewer: VIEWER, token: TOKEN, access, remainingMs })
  await page.route('**/api/viewers/resolve?*', (route) => route.fulfill({ headers: cors, json: {
    viewer_id: VIEWER, redirect_uri: new URL(route.request().url()).searchParams.get('origin') + '/', availability: 'available',
  } }))
}
