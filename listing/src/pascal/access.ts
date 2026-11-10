import {
  type AccessMode, type Descriptor, type StoredCredential, ReopenRequired,
  detectEntry, exchangeCallback, hasHandoffCallback,
  readCredential, rejectedAccess, rememberRejection, startAuthorize, storeCredential,
} from './handoff'

export { ReopenRequired } from './handoff'
export type Access = { kind: 'anonymous' } | { kind: 'opening' } |
  { kind: 'credential'; credential: StoredCredential }

const descriptors = new Map<string, Promise<Descriptor | null>>()
const resolutions = new Map<string, Promise<Access>>()
let callbackResult: Promise<StoredCredential> | undefined
let callbackCompleted = false
const rejected = new Map<string, AccessMode>()
const RENEW_MARGIN = 120_000

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

async function renew(credential: StoredCredential, descriptor: Descriptor | null): Promise<Access> {
  rememberRejection(credential)
  rejected.set(JSON.stringify([credential.issuer, credential.project_id]), credential.access)
  if (!descriptor || credential.renewalAttempted) throw new ReopenRequired(credential.access)
  await startAuthorize(credential.issuer, descriptor, credential.project_id, credential.access, true)
  return { kind: 'opening' }
}

/** Company-token callers bypass this helper entirely. Concurrent callers share a single exchange/navigation. */
export function resolveAccess(projectId: string, baseUrl = 'https://editor.pascal.app'): Promise<Access> {
  const issuer = new URL(baseUrl).origin
  const key = JSON.stringify([issuer, projectId])
  if (!resolutions.has(key)) {
    const resolution = (async (): Promise<Access> => {
      if (!handoffInvolved(issuer, projectId) && !rejected.has(key)) return { kind: 'anonymous' }
      const descriptor = await resolveDescriptor(issuer)
      if (rejected.has(key)) throw new ReopenRequired(rejected.get(key))
      if (hasHandoffCallback() && !callbackCompleted) {
        callbackResult ??= exchangeCallback(issuer, projectId, descriptor)
        const credential = await callbackResult
        callbackCompleted = true
        if (Date.parse(credential.expires_at) - Date.now() <= RENEW_MARGIN) return renew(credential, descriptor)
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
          if (Date.parse(credential.expires_at) - Date.now() <= RENEW_MARGIN) return renew(credential, descriptor)
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

/** Handle scene-read rejection, including signed-URL renewal reads, without anonymous fallback. */
export async function rejectCredential(credential: StoredCredential, status: number): Promise<Access> {
  rememberRejection(credential)
  rejected.set(JSON.stringify([credential.issuer, credential.project_id]), credential.access)
  if (status === 401 && Date.parse(credential.expires_at) <= Date.now()) {
    return renew(credential, await resolveDescriptor(credential.issuer))
  }
  throw new ReopenRequired(credential.access)
}

export function credentialReadSucceeded(credential: StoredCredential): void {
  if (credential.renewalAttempted && Date.parse(credential.expires_at) - Date.now() > RENEW_MARGIN) {
    credential.renewalAttempted = false
    storeCredential(credential)
  }
}

export function renewalDelay(credential: StoredCredential): number {
  return Math.max(0, Date.parse(credential.expires_at) - Date.now() - RENEW_MARGIN)
}
