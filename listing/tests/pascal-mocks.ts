import { readFileSync } from 'node:fs'
import type { Page } from '@playwright/test'

const fixtures = new URL('./fixtures/', import.meta.url)
const glb = readFileSync(new URL('house.glb', fixtures))
const scene = JSON.parse(readFileSync(new URL('scene.json', fixtures), 'utf8'))
export const GLB_URL = 'https://fixtures.supabase.co/storage/lod0.glb'
export const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'Authorization, Content-Type',
}

export function sceneBody(overrides: { expiresAt?: string; bake?: object; graph?: object } = {}) {
  const expiresAt = overrides.expiresAt ?? new Date(Date.now() + 10 * 60_000).toISOString()
  return JSON.stringify({
    ...scene,
    graph: overrides.graph ?? scene.graph,
    bake: overrides.bake ?? {
      ...scene.bake,
      lods: [{ ...scene.bake.lods[0], url: GLB_URL, bytes: glb.byteLength, expiresAt }],
    },
  })
}

/** Answers the scene read with `answer(n)` for the n-th request and serves the fixture GLB. */
export async function mockPascal(
  page: Page,
  answer: (n: number) => { status?: number; body: string } = () => ({ body: sceneBody() }),
  glbStatus: (n: number) => number = () => 200,
) {
  const calls = { scene: 0, glb: 0 }
  await page.route('https://**', (route) => route.abort())
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

