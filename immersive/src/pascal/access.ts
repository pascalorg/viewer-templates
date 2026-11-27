import { getScene } from './client'
import {
  type AccessMode, type Descriptor, type StoredCredential, ReopenRequired, SignInRefused, SignInUnavailable,
  callbackReauthorizes, detectEntry, exchangeCallback, hasHandoffCallback,
  readCredential, rejectedAccess, rememberRejection, restoreRecovery, spendRecovery, startAuthorize, storeCredential,
} from './handoff'

export { ReopenRequired, SignInUnavailable } from './handoff'
export type Access = { kind: 'anonymous' } | { kind: 'opening' } | { kind: 'refused' } |
  { kind: 'credential'; credential: StoredCredential }

const descriptors = new Map<string, Promise<Descriptor | null>>()
const resolutions = new Map<string, Promise<Access>>()
const rejections = new Map<string, Promise<Access>>()
let callbackResult: Promise<StoredCredential> | undefined
let callbackReauth = false
let callbackCompleted = false
const rejected = new Map<string, AccessMode>()
/** Sessions that ended for good on this page, on public projects now shown read-only. */
const publicFallbacks = new Set<string>()
const RENEW_MARGIN = 120_000
const HANDOFF_PARAMS = ['viewer', 'access', 'code', 'error', 'error_description', 'state', 'iss']

/** One public registry lookup per issuer/page; an unavailable registry supports public reads only. */
function resolveDescriptor(issuer: string): Promise<Descriptor | null> {
  if (!descriptors.has(issuer)) descriptors.set(issuer, (async () => {
    try {
      const url = new URL('/api/viewers/resolve', issuer)
      url.searchParams.set('origin', location.origin)
      const response = await fetch(url, { credentials: 'omit' })
      const body = await response.json() as Descriptor & { availability?: string }
      // This template deliberately registers the root page as its exact callback.
      return response.ok && body.availability === 'available' && typeof body.viewer_id === 'string' &&
        body.viewer_id && body.redirect_uri === location.origin + '/' ? body : null
    } catch { return null }
  })())
  return descriptors.get(issuer)!
}

/** Resolve registration only when an access screen needs to offer sign-in. */
export async function canSignIn(baseUrl = 'https://editor.pascal.app'): Promise<boolean> {
  return !!await resolveDescriptor(new URL(baseUrl).origin)
}

/** Explicit user action: always start a new session transaction and PKCE verifier. */
export async function signIn(projectId: string, baseUrl = 'https://editor.pascal.app'): Promise<void> {
  const issuer = new URL(baseUrl).origin
  const descriptor = await resolveDescriptor(issuer)
  if (!descriptor) throw new SignInUnavailable()
  await startAuthorize(issuer, descriptor, projectId, 'session', false, true)
}

/**
 * Whether Pascal sent this visitor or this tab already holds handoff state for the
 * project. Plain public visits skip the registry lookup entirely.
 */
function handoffInvolved(issuer: string, projectId: string): boolean {
  if (hasHandoffCallback() || detectEntry()) return true
  try {
    for (let i = 0; i < sessionStorage.length; i++) {
      const key = sessionStorage.key(i) ?? ''
      if (
        (key.startsWith('pascal:credential:') || key.startsWith('pascal:reopen:')) &&
        key.includes(JSON.stringify(issuer)) &&
        key.includes(JSON.stringify(projectId))
      )
        return true
    }
  } catch {
    // Storage denied: nothing stored to resume.
  }
  return false
}

function reject(credential: StoredCredential) {
  rememberRejection(credential)
  rejected.set(JSON.stringify([credential.issuer, credential.project_id]), credential.access)
}

/** A tokenless read of the published revision: true only for a public, published project. */
async function readsAnonymously(baseUrl: string, projectId: string): Promise<boolean> {
  try {
    await getScene(baseUrl, projectId)
    return true
  } catch {
    return false
  }
}

/**
 * A session the tab held can't be restored on this page. A public, published project (an
 * independent tokenless read says so) then shows its public view on its anonymous address, with
 * the handoff parameters dropped; anything else, and share access, asks to reopen.
 */
async function showPublic(
  issuer: string, baseUrl: string, projectId: string, access: AccessMode, readable?: boolean,
): Promise<Access> {
  if (access !== 'session' || !(readable ?? await readsAnonymously(baseUrl, projectId))) throw new ReopenRequired(access)
  const key = JSON.stringify([issuer, projectId])
  publicFallbacks.add(key)
  rejected.delete(key)
  const url = new URL(location.href)
  for (const name of HANDOFF_PARAMS) url.searchParams.delete(name)
  url.searchParams.set('project', projectId)
  history.replaceState(history.state, '', url.pathname + url.search + url.hash)
  return { kind: 'anonymous' }
}

async function renew(credential: StoredCredential, descriptor: Descriptor | null, baseUrl: string): Promise<Access> {
  reject(credential)
  if (!descriptor || credential.renewalAttempted) return showPublic(credential.issuer, baseUrl, credential.project_id, credential.access)
  await startAuthorize(credential.issuer, descriptor, credential.project_id, credential.access, true)
  return { kind: 'opening' }
}

/** Company-token callers bypass this helper entirely. Concurrent callers share a single exchange/navigation. */
export function resolveAccess(projectId: string, baseUrl = 'https://editor.pascal.app'): Promise<Access> {
  const issuer = new URL(baseUrl).origin
  const key = JSON.stringify([issuer, projectId])
  if (!resolutions.has(key)) {
    const resolution = (async (): Promise<Access> => {
      if (publicFallbacks.has(key)) return { kind: 'anonymous' }
      if (!handoffInvolved(issuer, projectId) && !rejected.has(key)) return { kind: 'anonymous' }
      const descriptor = await resolveDescriptor(issuer)
      if (rejected.has(key)) throw new ReopenRequired(rejected.get(key))
      if (hasHandoffCallback() && !callbackCompleted) {
        if (!callbackResult) {
          callbackReauth = callbackReauthorizes(issuer)
          callbackResult = exchangeCallback(issuer, projectId, descriptor)
        }
        let credential: StoredCredential | null
        try {
          credential = await callbackResult.catch((error: unknown) => {
            if (error instanceof SignInRefused) return null
            throw error
          })
        } catch (error) {
          // Pascal would not restore a session this tab held: a public project shows its public view.
          if (!callbackReauth || !(error instanceof ReopenRequired)) throw error
          callbackCompleted = true
          return showPublic(issuer, baseUrl, projectId, 'session')
        }
        if (!credential) {
          if (!callbackReauth) return { kind: 'refused' }
          callbackCompleted = true
          return showPublic(issuer, baseUrl, projectId, 'session').catch((): Access => ({ kind: 'refused' }))
        }
        callbackCompleted = true
        if (Date.parse(credential.expires_at) - Date.now() <= RENEW_MARGIN) return renew(credential, descriptor, baseUrl)
        return { kind: 'credential', credential }
      }
      const entry = detectEntry()
      const mode = entry?.access === 'share' ? 'share' : 'session'
      if (entry && (entry.project !== projectId || (descriptor && entry.viewer !== descriptor.viewer_id))) {
        throw new ReopenRequired(mode)
      }
      if (descriptor) {
        const credential = readCredential(issuer, descriptor.viewer_id, projectId)
        if (credential) {
          if (Date.parse(credential.expires_at) - Date.now() <= RENEW_MARGIN) return renew(credential, descriptor, baseUrl)
          return { kind: 'credential', credential }
        }
        const refusal = rejectedAccess(issuer, descriptor.viewer_id, projectId)
        if (refusal && (!entry || entry.access === 'anonymous')) throw new ReopenRequired(refusal)
      }
      if (entry && entry.access !== 'anonymous') {
        if (!descriptor) throw new ReopenRequired(mode)
        await startAuthorize(issuer, descriptor, projectId, entry.access)
        return { kind: 'opening' }
      }
      return { kind: 'anonymous' }
    })()
    resolutions.set(key, resolution)
    void resolution.finally(() => resolutions.delete(key)).catch(() => {})
  }
  return resolutions.get(key)!
}

/**
 * Handle scene-read rejection, including signed-URL renewal reads. An expired credential renews. A
 * session credential rejected before its expiry (revoked, the binding changed, the parent session
 * ended) gets one fresh top-level round trip per tab, never with the rejected token, and only on a
 * project that does not read anonymously, since Pascal refuses reader sessions on public projects.
 * When the session can't be restored, a public project resolves as `anonymous` (its public view, on
 * its anonymous address); nothing else falls back.
 *
 * Concurrent rejections on this page share one outcome.
 */
export function rejectCredential(
  credential: StoredCredential, status: number, baseUrl = credential.issuer,
): Promise<Access> {
  const key = JSON.stringify([credential.issuer, credential.project_id])
  if (!rejections.has(key)) {
    const rejection = handleRejection(credential, status, baseUrl)
    rejections.set(key, rejection)
    // While the page leaves for Pascal, a later rejection waits for the same navigation.
    void rejection.then((access) => { if (access.kind !== 'opening') rejections.delete(key) },
      () => { rejections.delete(key) })
  }
  return rejections.get(key)!
}

async function handleRejection(credential: StoredCredential, status: number, baseUrl: string): Promise<Access> {
  const { issuer, project_id: projectId, viewer_id: viewer, access } = credential
  reject(credential)
  const descriptor = await resolveDescriptor(issuer)
  if (status === 401 && Date.parse(credential.expires_at) <= Date.now()) return renew(credential, descriptor, baseUrl)
  if (status !== 401 || access !== 'session' || !descriptor) return showPublic(issuer, baseUrl, projectId, access)
  const readable = await readsAnonymously(baseUrl, projectId)
  if (readable || !spendRecovery(issuer, viewer, projectId)) return showPublic(issuer, baseUrl, projectId, access, readable)
  await startAuthorize(issuer, descriptor, projectId, 'session', false, false, true)
  return { kind: 'opening' }
}

export function credentialReadSucceeded(credential: StoredCredential): void {
  restoreRecovery(credential.issuer, credential.viewer_id, credential.project_id)
  if (credential.renewalAttempted && Date.parse(credential.expires_at) - Date.now() > RENEW_MARGIN) {
    credential.renewalAttempted = false
    storeCredential(credential)
  }
}

export function renewalDelay(credential: StoredCredential): number {
  return Math.max(0, Date.parse(credential.expires_at) - Date.now() - RENEW_MARGIN)
}
