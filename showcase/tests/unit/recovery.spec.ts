import { expect, test } from '@playwright/test'
import {
  credentialReadSucceeded, customizeNeedsReopen, rejectCredential, ReopenRequired, resolveAccess,
} from '../../src/pascal/access'
import type { StoredCredential } from '../../src/pascal/handoff'
import { sceneBody } from '../pascal-mocks'

// The access helpers over a stand-in browser: one tab's sessionStorage, its address and the
// top-level navigations it starts. Each test names its own project, so module state never leaks.

const issuer = 'https://editor.pascal.app'
const origin = 'https://showcase.pascal-viewer.app'
const viewer = 'viewer_pycMOT90TJ9Fmfrr'
const storage = new Map<string, string>()
let address = new URL(origin)
let navigations: URL[] = []
let publicProjects = new Set<string>()
let sceneReads: { project: string; authorization: string | null }[] = []

Object.assign(globalThis, {
  sessionStorage: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => void storage.set(key, String(value)),
    removeItem: (key: string) => void storage.delete(key),
    key: (index: number) => [...storage.keys()][index] ?? null,
    get length() { return storage.size },
  },
  location: {
    get href() { return address.href },
    get origin() { return address.origin },
    get pathname() { return address.pathname },
    get search() { return address.search },
    get hash() { return address.hash },
  },
  history: { state: null, replaceState: (_: unknown, __: string, path: string) => { address = new URL(path, origin) } },
  window: { top: { location: { set href(value: string) { navigations.push(new URL(value)) } } } },
  fetch: async (input: string | URL, init?: RequestInit) => {
    const url = new URL(input)
    if (url.pathname === '/api/viewers/resolve') {
      return Response.json({ availability: 'available', viewer_id: viewer, redirect_uri: origin + '/' })
    }
    const project = decodeURIComponent(url.pathname.split('/')[3]!)
    const authorization = new Headers(init?.headers).get('authorization')
    sceneReads.push({ project, authorization })
    if (authorization) return Response.json({ error: 'unauthorized' }, { status: 401 })
    if (!publicProjects.has(project)) return Response.json({ error: 'not_found' }, { status: 404 })
    return new Response(JSON.stringify(sceneBody()), { headers: { 'content-type': 'application/json' } })
  },
})

const recoveryKey = (project: string) => `pascal:recovery:${JSON.stringify([issuer, viewer, project, origin])}`

function credential(project: string, { configure = true, expiresInMs = 30 * 60_000 } = {}): StoredCredential {
  return {
    access_token: `pvh_${'r'.repeat(43)}`, expires_at: new Date(Date.now() + expiresInMs).toISOString(),
    project_id: project, viewer_id: viewer, issuer, origin, access: 'session', renewalAttempted: false,
    ...(configure ? { configure: true } : {}),
  }
}

test.beforeEach(() => {
  storage.clear()
  navigations = []
  publicProjects = new Set()
  sceneReads = []
})

test('concurrent rejections of one credential share a single configure round trip', async () => {
  const project = 'project_concurrent'
  address = new URL(`/?project=${project}&viewer=${viewer}&access=session&configure=1`, origin)
  const rejected = credential(project)
  const outcomes = await Promise.all([rejectCredential(rejected, 401, issuer), rejectCredential(rejected, 401, issuer)])
  expect(outcomes).toEqual([{ kind: 'opening' }, { kind: 'opening' }])
  expect(navigations).toHaveLength(1)
  expect(navigations[0]!.searchParams.get('scope')).toBe('configure')
  expect(navigations[0]!.searchParams.get('interaction')).toBe('sign_in')
  // A late failure while the page leaves for Pascal waits for the same navigation.
  expect(await rejectCredential(rejected, 401, issuer)).toEqual({ kind: 'opening' })
  expect(navigations).toHaveLength(1)
  expect(storage.has(recoveryKey(project))).toBe(true)
  expect(sceneReads).toEqual([])
})

test('with the round trip spent, a private project asks to reopen Customize', async () => {
  const project = 'project_private'
  address = new URL(`/?project=${project}&viewer=${viewer}&access=session&configure=1`, origin)
  storage.set(recoveryKey(project), '1')
  const failure = await rejectCredential(credential(project), 401, issuer).then(() => null, (error: unknown) => error)
  expect(failure).toBeInstanceOf(ReopenRequired)
  expect((failure as ReopenRequired).access).toBe('session')
  expect((failure as ReopenRequired).configure).toBe(true)
  expect(navigations).toEqual([])
  expect(address.search).toBe(`?project=${project}&viewer=${viewer}&access=session&configure=1`)
  expect(sceneReads).toEqual([{ project, authorization: null }])
})

test('with the round trip spent, a public project falls back to its anonymous address', async () => {
  const project = 'project_public'
  publicProjects.add(project)
  address = new URL(`/?project=${project}&viewer=${viewer}&access=session&configure=1&embed=1#camera`, origin)
  storage.set(recoveryKey(project), '1')
  expect(await rejectCredential(credential(project), 401, issuer)).toEqual({ kind: 'anonymous' })
  expect(address.pathname + address.search + address.hash).toBe(`/?project=${project}&embed=1#camera`)
  expect(customizeNeedsReopen(project, issuer)).toBe(true)
  expect(await resolveAccess(project, issuer)).toEqual({ kind: 'anonymous' })
  expect(navigations).toEqual([])
})

test("a reader's session on a public project never asks Pascal for a session it refuses", async () => {
  const project = 'project_public_reader'
  publicProjects.add(project)
  address = new URL(`/?project=${project}&viewer=${viewer}&access=session`, origin)
  expect(await rejectCredential(credential(project, { configure: false }), 401, issuer)).toEqual({ kind: 'anonymous' })
  expect(navigations).toEqual([])
  expect(storage.has(recoveryKey(project))).toBe(false)
  expect(customizeNeedsReopen(project, issuer)).toBe(false)
  expect(address.search).toBe(`?project=${project}`)
})

test('a successful credentialed read gives the round trip back', async () => {
  const project = 'project_restored'
  storage.set(recoveryKey(project), '1')
  credentialReadSucceeded(credential(project))
  expect(storage.has(recoveryKey(project))).toBe(false)
})

test('an expired credential still renews, without spending the recovery round trip', async () => {
  const project = 'project_expired'
  address = new URL(`/?project=${project}&viewer=${viewer}&access=session&configure=1`, origin)
  expect(await rejectCredential(credential(project, { expiresInMs: -1_000 }), 401, issuer)).toEqual({ kind: 'opening' })
  expect(navigations).toHaveLength(1)
  expect(navigations[0]!.searchParams.get('scope')).toBe('configure')
  expect(JSON.parse(storage.get(`pascal:handoff:${issuer}`)!)).toMatchObject({ renewal: true })
  expect(storage.has(recoveryKey(project))).toBe(false)
})
