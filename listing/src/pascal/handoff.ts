/** Browser-only protocol plumbing, with no framework or renderer dependencies. */
export type AccessMode = 'session' | 'share'
/**
 * `configure`: a manager opened the viewer to customise it (Pascal's Share popover, Customize).
 * `configureAvailable`: Pascal's hint that this visitor manages the project and may enter Customize
 * from inside the viewer (`configure=available`). It grants nothing; authorize decides.
 */
export type Entry = {
  project: string
  viewer: string
  access: AccessMode | 'anonymous'
  configure: boolean
  configureAvailable: boolean
}
export type Descriptor = { viewer_id: string; redirect_uri: string }
export type Transaction = {
  verifier: string
  state: string
  issuer: string
  viewer: string
  project: string
  redirect_uri: string
  access: AccessMode
  createdAt: number
  returnPath: string
  renewal?: boolean
  signIn?: boolean
  /** Asked for `scope=configure`; session access only. */
  configure?: boolean
  /**
   * Customize started from inside the viewer (`enterCustomize`): a refusal returns to
   * `fallbackPath`, the view the visitor had, instead of the refusal screen.
   */
  customize?: boolean
  fallbackPath?: string
}
export type Credential = {
  access_token: string
  expires_at: string
  project_id: string
  viewer_id: string
}
export type StoredCredential = Credential & {
  issuer: string
  origin: string
  access: AccessMode
  renewalAttempted: boolean
  /** Granted `scope=configure`: may save viewer settings. Absent on every other credential. */
  configure?: boolean
}

export class ReopenRequired extends Error {
  constructor(readonly access: AccessMode = 'session') {
    super(access === 'share' ? 'Reopen your share link' : 'Reopen from Pascal')
    this.name = 'ReopenRequired'
  }
}

export class SignInRefused extends Error {
  constructor() {
    super("This account can't open this project")
    this.name = 'SignInRefused'
  }
}

/** Pascal refused Customize started from inside the viewer: the visitor is back on the view they had. */
export class CustomizeRefused extends Error {
  constructor() {
    super("Customize isn't available for this account")
    this.name = 'CustomizeRefused'
  }
}

export class SignInUnavailable extends Error {
  constructor() {
    super('This site is not a registered Pascal viewer.')
    this.name = 'SignInUnavailable'
  }
}

const transactionKey = (issuer: string) => `pascal:handoff:${issuer}`
export const credentialKey = (issuer: string, viewer: string, project: string) =>
  `pascal:credential:${JSON.stringify([issuer, viewer, project, location.origin])}`
const reopenKey = (issuer: string, viewer: string, project: string) =>
  `pascal:reopen:${JSON.stringify([issuer, viewer, project, location.origin])}`
/** One viewer per origin, so issuer and project name it. */
const customizeRefusedKey = (issuer: string, project: string) =>
  `pascal:customize-refused:${JSON.stringify([issuer, project, location.origin])}`

/** Pascal refused Customize from inside the viewer in this tab: the entry stays hidden until the tab closes. */
export function customizeWasRefused(issuer: string, project: string): boolean {
  try { return sessionStorage.getItem(customizeRefusedKey(issuer, project)) === '1' } catch { return false }
}

function rememberCustomize(issuer: string, project: string, refused: boolean) {
  try {
    if (refused) sessionStorage.setItem(customizeRefusedKey(issuer, project), '1')
    else sessionStorage.removeItem(customizeRefusedKey(issuer, project))
  } catch {
    // Storage denied: the entry shows again on the next page load.
  }
}

function readStored(key: string): unknown {
  try {
    return JSON.parse(sessionStorage.getItem(key) || 'null')
  } catch {
    throw new ReopenRequired()
  }
}

export function readTransaction(issuer: string): Transaction | null {
  const value = readStored(transactionKey(issuer)) as Partial<Transaction> | null
  if (!value) return null
  if (
    value.issuer !== issuer || typeof value.project !== 'string' || !value.project ||
    typeof value.viewer !== 'string' || !value.viewer ||
    !['session', 'share'].includes(value.access || '') ||
    typeof value.createdAt !== 'number' || typeof value.returnPath !== 'string' ||
    typeof value.redirect_uri !== 'string' ||
    (value.configure !== undefined && (typeof value.configure !== 'boolean' || (value.configure && value.access !== 'session'))) ||
    (value.customize !== undefined && (value.customize !== true || value.configure !== true || typeof value.fallbackPath !== 'string')) ||
    (value.customize === undefined && value.fallbackPath !== undefined) ||
    !/^[A-Za-z0-9_-]{43}$/.test(value.state || '') ||
    !/^[A-Za-z0-9_-]{43}$/.test(value.verifier || '')
  ) throw new ReopenRequired()
  return value as Transaction
}

type Callback = { code: string | null; error: string | null; state: string | null; iss: string | null; valid: boolean }
let callback: Callback | null = null
let captured = false

/** Call before rendering or loading any scene/third-party scripts, including on invalid callbacks. */
export function captureHandoffCallback(): void {
  if (captured) return
  captured = true
  const url = new URL(location.href)
  const names = ['code', 'error', 'error_description', 'state', 'iss']
  if (!names.some((name) => url.searchParams.has(name))) return
  callback = {
    code: url.searchParams.get('code'),
    error: url.searchParams.get('error'),
    state: url.searchParams.get('state'),
    iss: url.searchParams.get('iss'),
    valid: names.every((name) => url.searchParams.getAll(name).length <= 1) &&
      ['state', 'iss'].every((name) => url.searchParams.getAll(name).length === 1) &&
      Number(url.searchParams.has('code')) + Number(url.searchParams.has('error')) === 1,
  }
  for (const name of names) url.searchParams.delete(name)
  history.replaceState(history.state, '', url.pathname + url.search + url.hash)
}

export function hasHandoffCallback(): boolean {
  return callback !== null
}

export function callbackProject(issuer: string): string | null {
  if (!callback) return null
  try { return readTransaction(issuer)?.project || null } catch { return null }
}

export function detectEntry(): Entry | null {
  const query = new URLSearchParams(location.search)
  if (!query.has('viewer') && !query.has('access')) return null
  const access = query.get('access')
  if (
    !['project', 'viewer', 'access'].every((key) => query.getAll(key).length === 1 && query.get(key)) ||
    !['session', 'share', 'anonymous'].includes(access || '')
  ) throw new ReopenRequired(access === 'share' ? 'share' : 'session')
  // `configure=1` (enter Customize now) comes only with session access; `configure=available` (the
  // visitor may enter it) with any. Anything else is not a link Pascal makes.
  const configure = query.get('configure')
  if (
    query.getAll('configure').length > 1 ||
    (configure !== null && configure !== '1' && configure !== 'available') ||
    (configure === '1' && access !== 'session')
  ) throw new ReopenRequired(access === 'share' ? 'share' : 'session')
  return {
    project: query.get('project')!, viewer: query.get('viewer')!, access: access as Entry['access'],
    configure: configure === '1', configureAvailable: configure === 'available',
  }
}

/** A return or fallback path's `configure`: absent, or Pascal's hint. Never `configure=1`. */
function hintOnly(query: URLSearchParams): boolean {
  return query.getAll('configure').length <= 1 && [null, 'available'].includes(query.get('configure'))
}

/** Only local paths survive the round trip; protocol-relative paths and callback material do not. */
function localReturnPath(path: string): string {
  if (!path.startsWith('/') || path.startsWith('//') || path.includes('\\')) throw new ReopenRequired()
  const url = new URL(path, location.origin)
  if (url.origin !== location.origin) throw new ReopenRequired()
  for (const name of ['code', 'error', 'error_description', 'state', 'iss']) url.searchParams.delete(name)
  return url.pathname + url.search + url.hash
}

function base64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

let navigating = false

/** True once this page is leaving for Pascal's authorize page: an unsaved-changes prompt must not hold it. */
export function handoffNavigating(): boolean {
  return navigating
}

/**
 * `customize`: Customize started from inside the viewer (implies `configure`). The page it starts
 * from is the fallback a refusal returns to; it must not itself be asking for configure mode.
 */
export async function startAuthorize(
  issuer: string, descriptor: Descriptor, project: string, access: AccessMode, renewal = false, signIn = false,
  configure = false, customize = false,
): Promise<void> {
  if (configure && (access !== 'session' || signIn)) throw new ReopenRequired(access)
  if (customize && (!configure || renewal)) throw new ReopenRequired(access)
  const state = base64url(crypto.getRandomValues(new Uint8Array(32)))
  const verifier = base64url(crypto.getRandomValues(new Uint8Array(32)))
  const challenge = base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))))
  const here = localReturnPath(location.pathname + location.search + location.hash)
  if (customize && !hintOnly(new URL(here, location.origin).searchParams)) throw new ReopenRequired(access)
  const returnUrl = new URL(location.href)
  if (!signIn) {
    returnUrl.searchParams.set('project', project)
    returnUrl.searchParams.set('viewer', descriptor.viewer_id)
    returnUrl.searchParams.set('access', access)
  }
  // Configure mode survives the round trip in the return path, and so does Pascal's hint that the
  // visitor may enter it; nothing else asks for either.
  const hinted = returnUrl.searchParams.getAll('configure').length === 1 && returnUrl.searchParams.get('configure') === 'available'
  if (configure) returnUrl.searchParams.set('configure', '1')
  else if (hinted) returnUrl.searchParams.set('configure', 'available')
  else returnUrl.searchParams.delete('configure')
  const transaction: Transaction = {
    verifier, state, issuer, viewer: descriptor.viewer_id, project,
    redirect_uri: descriptor.redirect_uri, access, createdAt: Date.now(),
    returnPath: localReturnPath(returnUrl.pathname + returnUrl.search + returnUrl.hash), renewal, signIn,
    ...(configure ? { configure } : {}),
    ...(customize ? { customize, fallbackPath: here } : {}),
  }
  sessionStorage.setItem(transactionKey(issuer), JSON.stringify(transaction))
  const url = new URL('/viewer/authorize', issuer)
  url.search = new URLSearchParams({
    viewer: descriptor.viewer_id, project, access, code_challenge: challenge,
    code_challenge_method: 'S256', state, redirect_uri: descriptor.redirect_uri,
  }).toString()
  if (access === 'session') url.searchParams.set('interaction', 'sign_in')
  if (configure) url.searchParams.set('scope', 'configure')
  navigating = true
  window.top!.location.href = url.href
}

export function readCredential(issuer: string, viewer: string, project: string): StoredCredential | null {
  const stored = readStored(credentialKey(issuer, viewer, project)) as Partial<StoredCredential> | null
  if (!stored) return null
  if (
    stored.issuer !== issuer || stored.viewer_id !== viewer || stored.project_id !== project ||
    stored.origin !== location.origin || !['session', 'share'].includes(stored.access || '') ||
    typeof stored.access_token !== 'string' || !stored.access_token.startsWith('pvh_') ||
    typeof stored.expires_at !== 'string' || !Number.isFinite(Date.parse(stored.expires_at)) ||
    typeof stored.renewalAttempted !== 'boolean' ||
    (stored.configure !== undefined && (stored.configure !== true || stored.access !== 'session'))
  ) throw new ReopenRequired(stored.access === 'share' ? 'share' : 'session')
  return stored as StoredCredential
}

export function storeCredential(credential: StoredCredential): void {
  sessionStorage.setItem(credentialKey(credential.issuer, credential.viewer_id, credential.project_id), JSON.stringify(credential))
  sessionStorage.removeItem(reopenKey(credential.issuer, credential.viewer_id, credential.project_id))
}

export function clearCredential(credential: StoredCredential): void {
  sessionStorage.removeItem(credentialKey(credential.issuer, credential.viewer_id, credential.project_id))
}

/** Share readers still need their original durable link on a later reload. */
export function rememberRejection(credential: StoredCredential): void {
  clearCredential(credential)
  if (credential.access === 'share') {
    sessionStorage.setItem(reopenKey(credential.issuer, credential.viewer_id, credential.project_id), credential.access)
  }
}

export function rejectedAccess(issuer: string, viewer: string, project: string): AccessMode | null {
  const mode = sessionStorage.getItem(reopenKey(issuer, viewer, project))
  return mode === 'session' || mode === 'share' ? mode : null
}

export async function exchangeCallback(
  issuer: string, project: string, descriptor: Descriptor | null,
): Promise<StoredCredential> {
  let access: AccessMode = 'session'
  try {
    let transaction: Transaction | null
    try { transaction = readTransaction(issuer) } finally {
      // A lost response or invalid transaction requires a new handoff.
      sessionStorage.removeItem(transactionKey(issuer))
    }
    if (transaction) access = transaction.access
    if (!callback || !transaction || !descriptor) throw new ReopenRequired(access)
    const age = Date.now() - transaction.createdAt
    const entry = detectEntry()
    const returnPath = localReturnPath(transaction.returnPath)
    const returnQuery = new URL(returnPath, location.origin).searchParams
    const fallbackPath = transaction.customize ? localReturnPath(transaction.fallbackPath!) : null
    const fallbackQuery = fallbackPath ? new URL(fallbackPath, location.origin).searchParams : null
    if (
      !callback.valid ||
      (callback.code !== null && !/^pvc_[A-Za-z0-9_-]{43}$/.test(callback.code)) ||
      callback.state !== transaction.state || callback.iss !== issuer || age < 0 || age > 600_000 ||
      transaction.project !== project || transaction.viewer !== descriptor.viewer_id ||
      transaction.redirect_uri !== descriptor.redirect_uri ||
      location.origin + location.pathname !== transaction.redirect_uri ||
      (entry && (entry.project !== project || entry.viewer !== transaction.viewer ||
        (entry.access !== access && !(transaction.signIn === true && entry.access === 'anonymous')))) ||
      (transaction.signIn === true
        ? (returnQuery.has('project') && (returnQuery.getAll('project').length !== 1 || returnQuery.get('project') !== project)) ||
          ((returnQuery.has('viewer') || returnQuery.has('access')) &&
            (returnQuery.getAll('viewer').length !== 1 || returnQuery.get('viewer') !== transaction.viewer ||
              returnQuery.getAll('access').length !== 1 || ![access, 'anonymous'].includes(returnQuery.get('access') || ''))) ||
          !hintOnly(returnQuery)
        : returnQuery.get('project') !== project || returnQuery.get('viewer') !== transaction.viewer ||
          returnQuery.get('access') !== access ||
          (transaction.configure === true
            ? returnQuery.getAll('configure').length !== 1 || returnQuery.get('configure') !== '1'
            : !hintOnly(returnQuery))) ||
      // The view Customize started from: this project, this viewer, and not itself configure mode.
      (fallbackQuery !== null &&
        (!hintOnly(fallbackQuery) ||
          fallbackQuery.getAll('project').length > 1 || ![null, project].includes(fallbackQuery.get('project')) ||
          fallbackQuery.getAll('viewer').length > 1 || ![null, transaction.viewer].includes(fallbackQuery.get('viewer'))))
    ) throw new ReopenRequired(access)
    if (callback.error !== null) {
      if (fallbackPath !== null) {
        // Customize from inside the viewer was refused (a forged hint, a demoted manager): back to
        // the view the visitor had, with the entry hidden for the rest of the tab.
        history.replaceState(history.state, '', fallbackPath)
        rememberCustomize(issuer, project, true)
        throw new CustomizeRefused()
      }
      history.replaceState(history.state, '', returnPath)
      throw new SignInRefused()
    }
    const response = await fetch(new URL('/api/viewer-handoff/exchange', issuer), {
      method: 'POST', credentials: 'omit', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: callback.code, code_verifier: transaction.verifier, viewer: transaction.viewer, redirect_uri: transaction.redirect_uri }),
    })
    const body = await response.json() as Partial<Credential> & { token_type?: string; revision?: string; scope?: unknown }
    if (
      !response.ok || typeof body.access_token !== 'string' || !body.access_token.startsWith('pvh_') ||
      body.project_id !== project || body.viewer_id !== transaction.viewer ||
      body.token_type !== 'Bearer' || body.revision !== 'published' ||
      typeof body.expires_at !== 'string' || !Number.isFinite(Date.parse(body.expires_at)) ||
      Date.parse(body.expires_at) <= Date.now()
    ) throw new ReopenRequired(access)
    // Asked for configure and not granted it: never silently continue as a reader. From inside the
    // viewer that is a refusal (the credential is dropped); a Customize link from Pascal reopens.
    if (transaction.configure === true && body.scope !== 'configure') {
      if (fallbackPath === null) throw new ReopenRequired(access)
      history.replaceState(history.state, '', fallbackPath)
      rememberCustomize(issuer, project, true)
      throw new CustomizeRefused()
    }
    const credential: StoredCredential = {
      access_token: body.access_token, expires_at: body.expires_at!,
      project_id: project, viewer_id: transaction.viewer, issuer, origin: location.origin, access,
      renewalAttempted: transaction.renewal === true,
      ...(transaction.configure === true ? { configure: true } : {}),
    }
    storeCredential(credential)
    if (transaction.configure === true) rememberCustomize(issuer, project, false)
    history.replaceState(history.state, '', returnPath)
    return credential
  } catch (error) {
    if (error instanceof SignInRefused || error instanceof CustomizeRefused) throw error
    throw new ReopenRequired(access)
  }
}
