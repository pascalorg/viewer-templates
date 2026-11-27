import { getScene } from './client'
import {
  type AccessMode, type Descriptor, type StoredCredential, CustomizeRefused, ReopenRequired, SignInRefused, SignInUnavailable,
  callbackReauthorizes, customizeWasRefused, detectEntry, exchangeCallback, hasHandoffCallback,
  readCredential, rejectedAccess, rememberRejection, restoreRecovery, spendRecovery, startAuthorize, storeCredential,
} from './handoff'

export { CustomizeRefused, ReopenRequired, SignInUnavailable } from './handoff'
export type Access = { kind: 'anonymous' } | { kind: 'opening' } | { kind: 'refused' } |
  { kind: 'credential'; credential: StoredCredential }

const descriptors = new Map<string, Promise<Descriptor | null>>()
const resolutions = new Map<string, Promise<Access>>()
const rejections = new Map<string, Promise<Access>>()
let callbackResult: Promise<StoredCredential> | undefined
let callbackReauth: { configure: boolean } | null = null
let callbackCompleted = false
const rejected = new Map<string, { access: AccessMode; configure: boolean }>()
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
  rejected.set(JSON.stringify([credential.issuer, credential.project_id]),
    { access: credential.access, configure: credential.configure === true })
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
 * the handoff and Customize parameters dropped; anything else, and share access, asks to reopen.
 */
async function showPublic(
  issuer: string, baseUrl: string, projectId: string, access: AccessMode, configure: boolean, readable?: boolean,
): Promise<Access> {
  if (access !== 'session' || !(readable ?? await readsAnonymously(baseUrl, projectId))) {
    throw new ReopenRequired(access, configure)
  }
  const key = JSON.stringify([issuer, projectId])
  publicFallbacks.set(key, configure)
  rejected.delete(key)
  const url = new URL(location.href)
  for (const name of HANDOFF_PARAMS) url.searchParams.delete(name)
  url.searchParams.set('project', projectId)
  history.replaceState(history.state, '', url.pathname + url.search + url.hash)
  return { kind: 'anonymous' }
}

async function renew(credential: StoredCredential, descriptor: Descriptor | null, baseUrl: string): Promise<Access> {
  reject(credential)
  if (!descriptor || credential.renewalAttempted) {
    return showPublic(credential.issuer, baseUrl, credential.project_id, credential.access, credential.configure === true)
  }
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
      if (publicFallbacks.has(key)) return { kind: 'anonymous' }
      if (!handoffInvolved(issuer, projectId) && !rejected.has(key)) return { kind: 'anonymous' }
      const descriptor = await resolveDescriptor(issuer)
      const rejection = rejected.get(key)
      if (rejection) throw new ReopenRequired(rejection.access, rejection.configure)
      if (hasHandoffCallback() && !callbackCompleted) {
        if (!callbackResult) {
          callbackReauth = callbackReauthorizes(issuer)
          callbackResult = exchangeCallback(issuer, projectId, descriptor)
        }
        let credential: StoredCredential | null | 'customize-refused'
        try {
          credential = await callbackResult.catch((error: unknown) => {
            if (error instanceof SignInRefused) return null
            // Customize from inside the viewer was refused: the address is the visitor's view again,
            // and the access they had resolves below as if they had never left.
            if (error instanceof CustomizeRefused) return 'customize-refused' as const
            throw error
          })
        } catch (error) {
          // Pascal would not restore a session this tab held: a public project shows its public view.
          if (!callbackReauth || !(error instanceof ReopenRequired)) throw error
          callbackCompleted = true
          return showPublic(issuer, baseUrl, projectId, 'session', callbackReauth.configure || error.configure)
        }
        if (!credential) {
          if (!callbackReauth) return { kind: 'refused' }
          callbackCompleted = true
          return showPublic(issuer, baseUrl, projectId, 'session', callbackReauth.configure)
            .catch((): Access => ({ kind: 'refused' }))
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
 * reader's session only on a project that does not read anonymously, since Pascal refuses those
 * on public projects. When the session can't be restored, a public project resolves as
 * `anonymous` (its public view, on its anonymous address); nothing else falls back.
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
  // What the visitor was doing, read before the rejection clears the stored credential.
  const configure = credential.configure === true
  reject(credential)
  const descriptor = await resolveDescriptor(issuer)
  if (status === 401 && Date.parse(credential.expires_at) <= Date.now()) return renew(credential, descriptor, baseUrl)
  if (status !== 401 || access !== 'session' || !descriptor) return showPublic(issuer, baseUrl, projectId, access, configure)
  const readable = configure ? undefined : await readsAnonymously(baseUrl, projectId)
  if (readable || !spendRecovery(issuer, viewer, projectId)) {
    return showPublic(issuer, baseUrl, projectId, access, configure, readable)
  }
  await startAuthorize(issuer, descriptor, projectId, 'session', false, false, configure, false, true)
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
