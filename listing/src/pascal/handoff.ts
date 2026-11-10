/** Browser-only protocol plumbing, with no framework or renderer dependencies. */
export type AccessMode = 'session' | 'share'
export type Entry = { project: string; viewer: string; access: AccessMode | 'anonymous' }
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
}

export class ReopenRequired extends Error {
  constructor(readonly access: AccessMode = 'session') {
    super(access === 'share' ? 'Reopen your share link' : 'Reopen from Pascal')
    this.name = 'ReopenRequired'
  }
}

const transactionKey = (issuer: string) => `pascal:handoff:${issuer}`
export const credentialKey = (issuer: string, viewer: string, project: string) =>
  `pascal:credential:${JSON.stringify([issuer, viewer, project, location.origin])}`
const reopenKey = (issuer: string, viewer: string, project: string) =>
  `pascal:reopen:${JSON.stringify([issuer, viewer, project, location.origin])}`

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
    !/^[A-Za-z0-9_-]{43}$/.test(value.state || '') ||
    !/^[A-Za-z0-9_-]{43}$/.test(value.verifier || '')
  ) throw new ReopenRequired()
  return value as Transaction
}

type Callback = { code: string | null; state: string | null; iss: string | null; valid: boolean }
let callback: Callback | null = null
let captured = false

/** Call before rendering or loading any scene/third-party scripts, including on invalid callbacks. */
export function captureHandoffCallback(): void {
  if (captured) return
  captured = true
  const url = new URL(location.href)
  const names = ['code', 'state', 'iss']
  if (!names.some((name) => url.searchParams.has(name))) return
  callback = {
    code: url.searchParams.get('code'),
    state: url.searchParams.get('state'),
    iss: url.searchParams.get('iss'),
    valid: names.every((name) => url.searchParams.getAll(name).length === 1),
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
  return { project: query.get('project')!, viewer: query.get('viewer')!, access: access as Entry['access'] }
}

/** Only local paths survive the round trip; protocol-relative paths and callback material do not. */
function localReturnPath(path: string): string {
  if (!path.startsWith('/') || path.startsWith('//') || path.includes('\\')) throw new ReopenRequired()
  const url = new URL(path, location.origin)
  if (url.origin !== location.origin) throw new ReopenRequired()
  for (const name of ['code', 'state', 'iss']) url.searchParams.delete(name)
  return url.pathname + url.search + url.hash
}

function base64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export async function startAuthorize(
  issuer: string, descriptor: Descriptor, project: string, access: AccessMode, renewal = false,
): Promise<void> {
  const state = base64url(crypto.getRandomValues(new Uint8Array(32)))
  const verifier = base64url(crypto.getRandomValues(new Uint8Array(32)))
  const challenge = base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))))
  const returnUrl = new URL(location.href)
  returnUrl.searchParams.set('project', project)
  returnUrl.searchParams.set('viewer', descriptor.viewer_id)
  returnUrl.searchParams.set('access', access)
  const transaction: Transaction = {
    verifier, state, issuer, viewer: descriptor.viewer_id, project,
    redirect_uri: descriptor.redirect_uri, access, createdAt: Date.now(),
    returnPath: localReturnPath(returnUrl.pathname + returnUrl.search + returnUrl.hash), renewal,
  }
  sessionStorage.setItem(transactionKey(issuer), JSON.stringify(transaction))
  const url = new URL('/viewer/authorize', issuer)
  url.search = new URLSearchParams({
    viewer: descriptor.viewer_id, project, access, code_challenge: challenge,
    code_challenge_method: 'S256', state, redirect_uri: descriptor.redirect_uri,
  }).toString()
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
    typeof stored.renewalAttempted !== 'boolean'
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

/** Keep a token-free refusal marker so a direct reload cannot silently become anonymous. */
export function rememberRejection(credential: StoredCredential): void {
  clearCredential(credential)
  sessionStorage.setItem(reopenKey(credential.issuer, credential.viewer_id, credential.project_id), credential.access)
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
    const transaction = readTransaction(issuer)
    if (transaction) access = transaction.access
    // Consume locally even on refusal: a lost response requires a new handoff.
    sessionStorage.removeItem(transactionKey(issuer))
    if (!callback || !transaction || !descriptor) throw new ReopenRequired(access)
    const age = Date.now() - transaction.createdAt
    const entry = detectEntry()
    const returnPath = localReturnPath(transaction.returnPath)
    const returnQuery = new URL(returnPath, location.origin).searchParams
    if (
      !callback.valid || !callback.code || !/^pvc_[A-Za-z0-9_-]{43}$/.test(callback.code) ||
      callback.state !== transaction.state || callback.iss !== issuer || age < 0 || age > 600_000 ||
      transaction.project !== project || transaction.viewer !== descriptor.viewer_id ||
      transaction.redirect_uri !== descriptor.redirect_uri ||
      location.origin + location.pathname !== transaction.redirect_uri ||
      (entry && (entry.project !== project || entry.viewer !== transaction.viewer || entry.access !== access)) ||
      returnQuery.get('project') !== project || returnQuery.get('viewer') !== transaction.viewer ||
      returnQuery.get('access') !== access
    ) throw new ReopenRequired(access)
    const response = await fetch(new URL('/api/viewer-handoff/exchange', issuer), {
      method: 'POST', credentials: 'omit', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: callback.code, code_verifier: transaction.verifier, viewer: transaction.viewer, redirect_uri: transaction.redirect_uri }),
    })
    const body = await response.json() as Partial<Credential> & { token_type?: string; revision?: string }
    if (
      !response.ok || typeof body.access_token !== 'string' || !body.access_token.startsWith('pvh_') ||
      body.project_id !== project || body.viewer_id !== transaction.viewer ||
      body.token_type !== 'Bearer' || body.revision !== 'published' ||
      typeof body.expires_at !== 'string' || !Number.isFinite(Date.parse(body.expires_at)) ||
      Date.parse(body.expires_at) <= Date.now()
    ) throw new ReopenRequired(access)
    const credential: StoredCredential = {
      access_token: body.access_token, expires_at: body.expires_at!,
      project_id: project, viewer_id: transaction.viewer, issuer, origin: location.origin, access,
      renewalAttempted: transaction.renewal === true,
    }
    storeCredential(credential)
    history.replaceState(history.state, '', returnPath)
    return credential
  } catch {
    throw new ReopenRequired(access)
  }
}
