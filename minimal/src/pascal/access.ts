import {
  type AccessMode, type Descriptor, type StoredCredential, CustomizeRefused, ReopenRequired, SignInRefused, SignInUnavailable,
  customizeWasRefused, detectEntry, exchangeCallback, hasHandoffCallback,
  readCredential, rejectedAccess, rememberRejection, startAuthorize, storeCredential,
} from './handoff'

export { CustomizeRefused, ReopenRequired, SignInUnavailable } from './handoff'
export type Access = { kind: 'anonymous' } | { kind: 'opening' } | { kind: 'refused' } |
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
 * Whether this visitor may be offered Customize from the entry URL alone: Pascal's
 * `configure=available` hint for this project, unless Pascal refused Customize in this tab. The
 * scene read's `settings.configureAvailable` is the other signal; either is enough to offer it.
 *
 * `resolveAccess` uses the hint on arrival (it asks Pascal for the configure pass and drops the
 * hint from the address), so this is true only on a page that has not resolved its access yet.
 */
export function customizeHinted(projectId: string, baseUrl = 'https://editor.pascal.app'): boolean {
  if (customizeRefused(projectId, baseUrl)) return false
  try {
    const entry = detectEntry()
    return !!entry && entry.project === projectId && entry.configureAvailable
  } catch {
    return false
  }
}

/**
 * Pascal's Customize link (`configure=1`) brought the visitor to this project: the panel opens on
 * arrival. A manager who arrives any other way holds the same pass with the panel collapsed.
 */
export function customizeRequested(projectId: string): boolean {
  try {
    const entry = detectEntry()
    return !!entry && entry.project === projectId && entry.configure
  } catch {
    return false
  }
}

/** Pascal refused Customize from inside the viewer in this tab: do not offer it again until the tab closes. */
export function customizeRefused(projectId: string, baseUrl = 'https://editor.pascal.app'): boolean {
  return customizeWasRefused(new URL(baseUrl).origin, projectId)
}

/**
 * Explicit user action: enter Customize from inside the viewer, for a manager who does not hold
 * the configure pass yet (they arrived without Pascal's hint, and the read says
 * `configureAvailable`). Leaves for Pascal's authorize page (session access, `scope=configure`,
 * sign-in allowed) and comes back to this page with the pass, the scene read then saying
 * `canConfigure: true`. If Pascal refuses, the visitor comes back to this exact page with the
 * access they had, and `customizeRefused` is true for the rest of the tab.
 */
export async function enterCustomize(projectId: string, baseUrl = 'https://editor.pascal.app'): Promise<void> {
  const issuer = new URL(baseUrl).origin
  const descriptor = await resolveDescriptor(issuer)
  if (!descriptor) throw new SignInUnavailable()
  await startAuthorize(issuer, descriptor, projectId, 'session', false, false, true, true)
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
  // A configure credential renews as one: the manager keeps customising after the round trip.
  await startAuthorize(credential.issuer, descriptor, credential.project_id, credential.access, true, false,
    credential.configure === true)
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
        const credential = await callbackResult.catch((error: unknown) => {
          if (error instanceof SignInRefused) return null
          // Customize from inside the viewer was refused: the address is the visitor's view again,
          // and the access they had resolves below as if they had never left.
          if (error instanceof CustomizeRefused) return 'customize-refused' as const
          throw error
        })
        if (!credential) return { kind: 'refused' }
        callbackCompleted = true
        if (credential !== 'customize-refused') {
          if (Date.parse(credential.expires_at) - Date.now() <= RENEW_MARGIN) return renew(credential, descriptor)
          return { kind: 'credential', credential }
        }
      }
      const entry = detectEntry()
      const mode = entry?.access === 'share' ? 'share' : 'session'
      if (entry && (entry.project !== projectId || (descriptor && entry.viewer !== descriptor.viewer_id))) {
        throw new ReopenRequired(mode)
      }
      // Pascal's hint says this visitor manages the project: ask for the configure pass on the way
      // in, so Customize opens with no second trip. Refused, they keep the access the entry gives.
      const arriving = !!descriptor && !!entry && entry.configureAvailable && !customizeWasRefused(issuer, projectId)
      const arrive = async (): Promise<Access> => {
        await startAuthorize(issuer, descriptor!, projectId, 'session', false, false, true, true)
        return { kind: 'opening' }
      }
      if (descriptor) {
        const credential = readCredential(issuer, descriptor.viewer_id, projectId)
        // Pascal's Customize link gets the pass it asks for. A configure pass already held is kept.
        if (credential && credential.configure !== true && entry?.access === 'session' && entry.configure) {
          await startAuthorize(issuer, descriptor, projectId, 'session', false, false, true)
          return { kind: 'opening' }
        }
        if (credential && credential.configure !== true && arriving) return arrive()
        if (credential) {
          if (Date.parse(credential.expires_at) - Date.now() <= RENEW_MARGIN) return renew(credential, descriptor)
          return { kind: 'credential', credential }
        }
        const refusal = rejectedAccess(issuer, descriptor.viewer_id, projectId)
        if (refusal && (!entry || entry.access === 'anonymous')) throw new ReopenRequired(refusal)
      }
      if (arriving) return arrive()
      if (entry && entry.access !== 'anonymous') {
        if (!descriptor) throw new ReopenRequired(mode)
        await startAuthorize(issuer, descriptor, projectId, entry.access, false, false, entry.configure)
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
