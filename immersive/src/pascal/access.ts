import { getScene, PascalError } from './client'
import {
  type Descriptor, type Recovery, type StoredCredential, ExchangeFailed, ReopenRequired, SignInRefused, SignInUnavailable,
  clearRecovery, detectEntry, exchangeCallback, hasHandoffCallback,
  readCredential, readRecovery, rejectedAccess, rememberRejection, startAuthorize, storeCredential, writeRecovery,
} from './handoff'

export { ReopenRequired, SignInUnavailable } from './handoff'
export type Access = { kind: 'anonymous' } | { kind: 'opening' } | { kind: 'refused' } |
  { kind: 'credential'; credential: StoredCredential }

const descriptors = new Map<string, Promise<Descriptor | null>>()
const resolutions = new Map<string, Promise<Access>>()
const rejections = new Map<string, Promise<Access>>()
let callbackResult: Promise<StoredCredential> | undefined
let callbackCompleted = false
/** Share credentials rejected on this page; a rejected session is kept as a `Recovery` instead. */
const rejected = new Set<string>()
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
        (key.startsWith('pascal:credential:') || key.startsWith('pascal:reopen:') || key.startsWith('pascal:recovery:')) &&
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

function rejectShare(credential: StoredCredential): never {
  rejected.add(JSON.stringify([credential.issuer, credential.project_id]))
  throw new ReopenRequired('share')
}

/** Records that Pascal rejected a session this tab held. A record storage can't hold counts as spent. */
function noteRejection(issuer: string, viewer: string, projectId: string, spent: boolean): Recovery {
  const recovery = { spent: spent || readRecovery(issuer, viewer, projectId)?.spent === true }
  return writeRecovery(issuer, viewer, projectId, recovery) ? recovery : { spent: true }
}

/**
 * An independent tokenless read of the published revision. `public`: it answers. `private`: the
 * scene API says it is definitively not readable anonymously (404, 401, 403). Anything else
 * (offline, 5xx, 429, an answer this client does not understand) is indeterminate and comes back
 * as the error, for a retryable screen.
 */
async function probePublic(baseUrl: string, projectId: string): Promise<'public' | 'private' | PascalError> {
  try {
    await getScene(baseUrl, projectId)
    return 'public'
  } catch (error) {
    if (!(error instanceof PascalError)) return new PascalError('network', String(error))
    return error.code === 'not_found' || error.code === 'not_published' || error.code === 'unauthorized' ? 'private' : error
  }
}

/**
 * Shows a public project's public view on its anonymous address: `from` (the current address, or a
 * callback's validated return path) without the handoff parameters.
 */
function showPublic(issuer: string, projectId: string, from = location.href): Access {
  publicFallbacks.add(JSON.stringify([issuer, projectId]))
  const url = new URL(from, location.origin)
  for (const name of HANDOFF_PARAMS) url.searchParams.delete(name)
  url.searchParams.set('project', projectId)
  history.replaceState(history.state, '', url.pathname + url.search + url.hash)
  return { kind: 'anonymous' }
}

/**
 * Settles a session this tab held that Pascal rejected or would not restore. A public project shows
 * its public view. A project the tokenless read says is definitively not public takes the tab's one
 * round trip while it is unspent (Pascal refuses reader sessions on public projects, so never
 * before that answer), else asks to reopen. An indeterminate read throws a retryable error that
 * settles again on retry or reload; it never authorizes or shows the public view.
 */
async function settle(
  issuer: string, baseUrl: string, projectId: string, viewer: string, descriptor: Descriptor | null,
  recovery: Recovery, from?: string,
): Promise<Access> {
  const outcome = await probePublic(baseUrl, projectId)
  if (outcome === 'public') return showPublic(issuer, projectId, from)
  if (outcome !== 'private') throw outcome
  if (!recovery.spent && descriptor && writeRecovery(issuer, viewer, projectId, { spent: true })) {
    await startAuthorize(issuer, descriptor, projectId, 'session', false, false, true)
    return { kind: 'opening' }
  }
  throw new ReopenRequired('session')
}

async function renew(credential: StoredCredential, descriptor: Descriptor | null, baseUrl: string): Promise<Access> {
  const { issuer, project_id: projectId, viewer_id: viewer } = credential
  rememberRejection(credential)
  if (!descriptor || credential.renewalAttempted) {
    if (credential.access === 'share') return rejectShare(credential)
    return settle(issuer, baseUrl, projectId, viewer, descriptor, noteRejection(issuer, viewer, projectId, true))
  }
  await startAuthorize(issuer, descriptor, projectId, credential.access, true)
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
      if (rejected.has(key)) throw new ReopenRequired('share')
      if (hasHandoffCallback() && !callbackCompleted) {
        callbackResult ??= exchangeCallback(issuer, projectId, descriptor)
        let credential: StoredCredential
        try {
          credential = await callbackResult
        } catch (error) {
          // A validated answer (never an invalid or tampered callback): Pascal would not restore a
          // session this tab held. It settles from the transaction's validated return path.
          if ((error instanceof SignInRefused || error instanceof ExchangeFailed) && error.reauthorizes && descriptor) {
            callbackCompleted = true
            const viewer = descriptor.viewer_id
            return settle(issuer, baseUrl, projectId, viewer, descriptor, noteRejection(issuer, viewer, projectId, true),
              error.returnPath ?? undefined)
              .catch((failure: unknown): Access => {
                if (error instanceof SignInRefused && failure instanceof ReopenRequired) return { kind: 'refused' }
                throw failure
              })
          }
          if (error instanceof SignInRefused) return { kind: 'refused' }
          throw error
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
        // Pascal rejected a session this tab held: a reload or a re-entry never starts another
        // automatic authorize for it. Explicit sign-in still can.
        const recovery = readRecovery(issuer, descriptor.viewer_id, projectId)
        if (recovery && (!entry || entry.access === 'session')) {
          return settle(issuer, baseUrl, projectId, descriptor.viewer_id, descriptor, recovery)
        }
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
 * project a tokenless read says is definitively not public, since Pascal refuses reader sessions on
 * public projects. When the session can't be restored, a public project resolves as `anonymous`
 * (its public view, on its anonymous address); nothing else falls back. An indeterminate read
 * (offline, 5xx, 429) throws its `PascalError`, for a retryable screen.
 *
 * The outcome is kept per tab (`Recovery`), so reloads and re-entries settle it again without a
 * second automatic trip. Concurrent rejections on this page share one outcome.
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
  rememberRejection(credential)
  const descriptor = await resolveDescriptor(issuer)
  if (status === 401 && Date.parse(credential.expires_at) <= Date.now()) return renew(credential, descriptor, baseUrl)
  if (access === 'share') return rejectShare(credential)
  return settle(issuer, baseUrl, projectId, viewer, descriptor, noteRejection(issuer, viewer, projectId, status !== 401))
}

export function credentialReadSucceeded(credential: StoredCredential): void {
  clearRecovery(credential.issuer, credential.viewer_id, credential.project_id)
  if (credential.renewalAttempted && Date.parse(credential.expires_at) - Date.now() > RENEW_MARGIN) {
    credential.renewalAttempted = false
    storeCredential(credential)
  }
}

export function renewalDelay(credential: StoredCredential): number {
  return Math.max(0, Date.parse(credential.expires_at) - Date.now() - RENEW_MARGIN)
}
