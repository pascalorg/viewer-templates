import { getScene, PascalError } from './client'
import {
  type Descriptor, type Recovery, type StoredCredential, CustomizeRefused, ExchangeFailed, ReopenRequired, SignInRefused,
  SignInUnavailable, clearRecovery, customizeWasRefused, detectEntry, exchangeCallback, hasHandoffCallback,
  readCredential, readRecovery, rejectedAccess, rememberRejection, startAuthorize, storeCredential, writeRecovery,
} from './handoff'

export { CustomizeRefused, ReopenRequired, SignInUnavailable } from './handoff'
export type Access = { kind: 'anonymous' } | { kind: 'opening' } | { kind: 'refused' } |
  { kind: 'credential'; credential: StoredCredential }

const descriptors = new Map<string, Promise<Descriptor | null>>()
const resolutions = new Map<string, Promise<Access>>()
const rejections = new Map<string, Promise<Access>>()
let callbackResult: Promise<StoredCredential> | undefined
let callbackCompleted = false
/** Share credentials rejected on this page; a rejected session is kept as a `Recovery` instead. */
const rejected = new Set<string>()
/** Sessions that ended for good on this page, on public projects now shown read-only; `true`: it was Customize. */
const publicFallbacks = new Map<string, boolean>()
const RENEW_MARGIN = 120_000
const HANDOFF_PARAMS = ['viewer', 'access', 'configure', 'code', 'error', 'error_description', 'state', 'iss']

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

/**
 * Explicit user action: always start a new session transaction and PKCE verifier. `configure`: the
 * visitor was customising (`ReopenRequired.configure`), so this restarts Customize with
 * `scope=configure` (sign-in allowed) instead of a plain sign-in, which Pascal refuses on public projects.
 */
export async function signIn(
  projectId: string, baseUrl = 'https://editor.pascal.app', { configure = false }: { configure?: boolean } = {},
): Promise<void> {
  const issuer = new URL(baseUrl).origin
  const descriptor = await resolveDescriptor(issuer)
  if (!descriptor) throw new SignInUnavailable()
  if (configure) await startAuthorize(issuer, descriptor, projectId, 'session', false, false, true)
  else await startAuthorize(issuer, descriptor, projectId, 'session', false, true)
}

/**
 * Pascal ended the visitor's Customize session for good on this page and the project is public:
 * they see its public view, read-only, and Customize has to be opened again (`enterCustomize`).
 */
export function customizeNeedsReopen(projectId: string, baseUrl = 'https://editor.pascal.app'): boolean {
  return publicFallbacks.get(JSON.stringify([new URL(baseUrl).origin, projectId])) === true &&
    !customizeRefused(projectId, baseUrl)
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

/**
 * Records that Pascal rejected (or would not restore) a session this tab held, keeping the
 * Customize intent and a spent round trip. A record storage can't hold counts as spent.
 */
function noteRejection(issuer: string, viewer: string, projectId: string, configure: boolean, spent: boolean): Recovery {
  const previous = readRecovery(issuer, viewer, projectId)
  const recovery = { configure: configure || previous?.configure === true, spent: spent || previous?.spent === true }
  return writeRecovery(issuer, viewer, projectId, recovery) ? recovery : { ...recovery, spent: true }
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
 * Shows a public project's public view, read-only, on its anonymous address: `from` (the current
 * address, or a callback's validated return path) without the handoff and Customize parameters.
 */
function showPublic(issuer: string, projectId: string, configure: boolean, from = location.href): Access {
  const key = JSON.stringify([issuer, projectId])
  publicFallbacks.set(key, configure)
  const url = new URL(from, location.origin)
  for (const name of HANDOFF_PARAMS) url.searchParams.delete(name)
  url.searchParams.set('project', projectId)
  history.replaceState(history.state, '', url.pathname + url.search + url.hash)
  return { kind: 'anonymous' }
}

/**
 * Settles a session this tab held that Pascal rejected or would not restore (`recovery`). While the
 * tab's one round trip is unspent it is taken, in the same mode and never with the rejected token:
 * Customize at once (Pascal allows `scope=configure` on public projects), a reader's session only
 * once the tokenless read says the project is definitively not public, since Pascal refuses those
 * on public projects. Otherwise a public project shows its public view, a private or unpublished
 * one asks to reopen (keeping the Customize intent), and an indeterminate read throws a retryable
 * error that settles again on retry or reload; it never authorizes or shows the public view.
 */
async function settle(
  issuer: string, baseUrl: string, projectId: string, viewer: string, descriptor: Descriptor | null,
  recovery: Recovery, from?: string,
): Promise<Access> {
  const { configure } = recovery
  const recover = async () => {
    if (recovery.spent || !descriptor || !writeRecovery(issuer, viewer, projectId, { configure, spent: true })) return false
    await startAuthorize(issuer, descriptor, projectId, 'session', false, false, configure, false, true)
    return true
  }
  if (configure && await recover()) return { kind: 'opening' }
  const outcome = await probePublic(baseUrl, projectId)
  if (outcome === 'public') return showPublic(issuer, projectId, configure, from)
  if (outcome !== 'private') throw outcome
  if (!configure && await recover()) return { kind: 'opening' }
  throw new ReopenRequired('session', configure)
}

async function renew(credential: StoredCredential, descriptor: Descriptor | null, baseUrl: string): Promise<Access> {
  const { issuer, project_id: projectId, viewer_id: viewer } = credential
  const configure = credential.configure === true
  rememberRejection(credential)
  if (!descriptor || credential.renewalAttempted) {
    if (credential.access === 'share') return rejectShare(credential)
    return settle(issuer, baseUrl, projectId, viewer, descriptor, noteRejection(issuer, viewer, projectId, configure, true))
  }
  // A configure credential renews as one: the manager keeps customising after the round trip.
  await startAuthorize(issuer, descriptor, projectId, credential.access, true, false, configure)
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
        let credential: StoredCredential | 'customize-refused'
        try {
          credential = await callbackResult
        } catch (error) {
          // Customize from inside the viewer was refused: the address is the visitor's view again,
          // and the access they had resolves below as if they had never left.
          if (error instanceof CustomizeRefused) credential = 'customize-refused'
          // A validated answer (never an invalid or tampered callback): Pascal would not restore a
          // session this tab held. It settles from the transaction's validated return path.
          else if ((error instanceof SignInRefused || error instanceof ExchangeFailed) && error.reauthorizes && descriptor) {
            callbackCompleted = true
            const viewer = descriptor.viewer_id
            const recovery = noteRejection(issuer, viewer, projectId, error.configure, true)
            return settle(issuer, baseUrl, projectId, viewer, descriptor, recovery, error.returnPath ?? undefined)
              .catch((failure: unknown): Access => {
                if (error instanceof SignInRefused && failure instanceof ReopenRequired) return { kind: 'refused' }
                throw failure
              })
          } else if (error instanceof SignInRefused) return { kind: 'refused' }
          else throw error
        }
        callbackCompleted = true
        if (credential !== 'customize-refused') {
          if (Date.parse(credential.expires_at) - Date.now() <= RENEW_MARGIN) return renew(credential, descriptor, baseUrl)
          return { kind: 'credential', credential }
        }
      }
      const entry = detectEntry()
      const mode = entry?.access === 'share' ? 'share' : 'session'
      if (entry && (entry.project !== projectId || (descriptor && entry.viewer !== descriptor.viewer_id))) {
        throw new ReopenRequired(mode, entry.configure)
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
          if (Date.parse(credential.expires_at) - Date.now() <= RENEW_MARGIN) return renew(credential, descriptor, baseUrl)
          return { kind: 'credential', credential }
        }
        const refusal = rejectedAccess(issuer, descriptor.viewer_id, projectId)
        if (refusal && (!entry || entry.access === 'anonymous')) throw new ReopenRequired(refusal)
        // Pascal rejected a session this tab held: a reload or a re-entry never starts another
        // automatic authorize for it. Explicit sign-in and Customize still can.
        const recovery = readRecovery(issuer, descriptor.viewer_id, projectId)
        if (recovery && (arriving || !entry || entry.access === 'session')) {
          return settle(issuer, baseUrl, projectId, descriptor.viewer_id, descriptor,
            { ...recovery, configure: recovery.configure || entry?.configure === true })
        }
      }
      if (arriving) return arrive()
      if (entry && entry.access !== 'anonymous') {
        if (!descriptor) throw new ReopenRequired(mode, entry.configure)
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

/**
 * Handle scene-read rejection, including signed-URL renewal reads. An expired credential renews. A
 * session credential rejected before its expiry (revoked from the Share popover, the binding
 * changed, the parent session ended) gets one fresh top-level round trip per tab, in the same mode
 * and never with the rejected token: a configure credential asks for `scope=configure` again; a
 * reader's session only on a project a tokenless read says is definitively not public, since Pascal
 * refuses those on public projects. When the session can't be restored, a public project resolves
 * as `anonymous` (its public view, on its anonymous address); nothing else falls back. An
 * indeterminate read (offline, 5xx, 429) throws its `PascalError`, for a retryable screen.
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
  // What the visitor was doing, read before the rejection clears the stored credential.
  const configure = credential.configure === true
  rememberRejection(credential)
  const descriptor = await resolveDescriptor(issuer)
  if (status === 401 && Date.parse(credential.expires_at) <= Date.now()) return renew(credential, descriptor, baseUrl)
  if (access === 'share') return rejectShare(credential)
  return settle(issuer, baseUrl, projectId, viewer, descriptor, noteRejection(issuer, viewer, projectId, configure, status !== 401))
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
