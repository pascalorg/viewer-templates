import { Button, buttonVariants, SceneLoader } from '@pascal-app/viewer/ui'
import { AlertCircle, Clock, Compass, Lock, SearchX, ShieldAlert } from 'lucide-react'
import { type ReactNode, useEffect, useState } from 'react'
import { canSignIn, signIn, SignInUnavailable, type PascalError, type SceneResponse } from '../pascal'

function statusVisual(state: string) {
  switch (state) {
    case 'missing-project':
      return { Icon: Compass, destructive: false }
    case 'not_found':
      return { Icon: SearchX, destructive: false }
    case 'needs-access':
    case 'reopen':
      return { Icon: Lock, destructive: false }
    case 'not_published':
    case 'no-file':
      return { Icon: Clock, destructive: false }
    case 'refused':
      return { Icon: ShieldAlert, destructive: true }
    default:
      return { Icon: AlertCircle, destructive: true }
  }
}

export function Status({ state, title, children }: {
  state: string
  title: string
  children?: ReactNode
}) {
  const { Icon, destructive } = statusVisual(state)
  return (
    <main className="studio-backdrop flex h-full items-center justify-center p-4 sm:p-6" data-state={state}>
      <div className="corner-smooth w-full max-w-md rounded-2xl border border-border/80 bg-card/95 p-7 pb-11 text-card-foreground shadow-elevation-5 backdrop-blur-xl sm:p-8 sm:pb-12">
        <div
          aria-hidden
          className={`mb-5 flex size-11 items-center justify-center rounded-xl border ${
            destructive
              ? 'border-destructive/20 bg-destructive/10 text-destructive'
              : 'border-border/70 bg-secondary text-foreground'
          }`}
        >
          <Icon className="size-5" />
        </div>
        <div className="space-y-3">
          <h1 className="font-semibold text-2xl text-card-foreground leading-tight tracking-[-0.02em]">{title}</h1>
          {children && <div className="space-y-4 text-muted-foreground text-sm leading-relaxed">{children}</div>}
        </div>
      </div>
    </main>
  )
}

const primary = buttonVariants({ className: 'studio-interactive h-10 rounded-full px-5 font-medium' })
const secondary = buttonVariants({ className: 'studio-interactive h-10 rounded-full px-5 font-medium text-foreground', variant: 'outline' })

/** A screen's buttons: the primary action first, then at most one secondary action. */
function Actions({ children }: { children: ReactNode }) {
  return <div className="relative flex flex-wrap items-center gap-2.5 pt-2">{children}</div>
}

export function RetryButton({ onRetry }: { onRetry: () => void }) {
  return (
    <Actions>
      <Button className="studio-interactive h-10 rounded-full px-5 font-medium" onClick={onRetry} type="button">
        Try again
      </Button>
    </Actions>
  )
}

/** The hosted viewer's full-screen loader while the project is read and prepared. */
export function LoadingScreen({ opening = false, progress }: { opening?: boolean; progress?: number | null }) {
  const pct = progress == null ? null : Math.round(Math.min(1, Math.max(0, progress)) * 100)
  const statusText = opening
    ? 'Opening from Pascal…'
    : pct == null ? 'Loading project…' : `Downloading 3D file: ${pct}%`
  return (
    <main className="studio-backdrop relative h-full" data-state={opening ? 'opening' : 'loading'}>
      <SceneLoader className="bg-transparent" fullScreen />
      {(opening || pct != null) && (
        <div aria-hidden className="pointer-events-none fixed inset-x-0 top-1/2 z-[101] mt-11 flex flex-col items-center gap-2.5 px-4">
          <span className="font-mono text-muted-foreground text-xs tracking-wide tabular-nums">
            {opening ? 'Opening from Pascal…' : `Downloading 3D file · ${pct}%`}
          </span>
          {pct != null && (
            <div className="h-1 w-40 overflow-hidden rounded-full bg-border/80">
              <div className="studio-interactive h-full rounded-full bg-foreground transition-[width] duration-200 ease-out" style={{ width: `${pct}%` }} />
            </div>
          )}
        </div>
      )}
      <p className="sr-only" role="status">{statusText}</p>
    </main>
  )
}

/**
 * Sign in with Pascal is offered only when this origin is a registered viewer (`canSignIn`).
 * Until that is known, and on unregistered sites, screens show their no-button copy.
 */
function useSignIn(baseUrl: string, projectId: string, enabled = true, configure = false) {
  const [registered, setRegistered] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const offered = enabled && !!projectId
  useEffect(() => {
    if (!offered) return
    let active = true
    void canSignIn(baseUrl).then((value) => { if (active) setRegistered(value) })
    return () => { active = false }
  }, [baseUrl, offered])
  const start = async () => {
    setBusy(true)
    setError(null)
    try { await signIn(projectId, baseUrl, { configure }) } catch (failure) {
      setError(failure instanceof SignInUnavailable ? "Sign-in isn't available on this site."
        : "Sign-in couldn't start. Try again.")
      setBusy(false)
    }
  }
  return { available: offered && registered, busy, error, start }
}

type SignInState = ReturnType<typeof useSignIn>

/** Keeps its width while busy, so the label change does not move the layout. */
function SignInButton({ signIn }: { signIn: SignInState }) {
  return <Button aria-busy={signIn.busy || undefined} className="studio-interactive h-10 rounded-full px-5 font-medium" disabled={signIn.busy}
    onClick={() => void signIn.start()} type="button">
    <span className="grid">
      <span className={`[grid-area:1/1] ${signIn.busy ? 'invisible' : ''}`}>Sign in with Pascal</span>
      <span className={`[grid-area:1/1] ${signIn.busy ? '' : 'invisible'}`}>Opening Pascal…</span>
    </span>
  </Button>
}

/** Sits below the buttons without taking space, so an error does not move the layout. */
function SignInError({ signIn }: { signIn: SignInState }) {
  return <p className="absolute inset-x-0 top-full mt-2.5 font-medium text-destructive text-xs leading-snug" role="alert">{signIn.error}</p>
}

export function RefusedScreen({ baseUrl, projectId }: { baseUrl: string; projectId: string }) {
  const signIn = useSignIn(baseUrl, projectId)
  return <Status state="refused" title="This account can't open this project">
    <p>{signIn.available ? 'Another Pascal account may have access.'
      : 'Open this project from Pascal with another account.'}</p>
    {signIn.available && <Actions><SignInButton signIn={signIn} /><SignInError signIn={signIn} /></Actions>}
  </Status>
}

/** After Customize (`configure`), the button restarts Customize (`scope=configure`), not a plain sign-in. */
export function NeedsAccessScreen({ access, baseUrl, configure = false, projectId }: {
  access: 'share' | 'session'
  baseUrl: string
  configure?: boolean
  projectId: string
}) {
  const signIn = useSignIn(baseUrl, projectId, access === 'session', configure)
  const projectUrl = new URL(projectId ? `/editor/${encodeURIComponent(projectId)}` : '/projects', baseUrl).href
  return <Status state="reopen" title={access === 'share' ? 'Reopen your share link' : 'Reopen from Pascal'}>
    <p>{access === 'share' ? 'Open the original Pascal share link again to restore access.'
      : signIn.available ? configure ? 'Sign in again to keep customizing, or open this project from Pascal.'
        : 'Sign in again, or open this project from Pascal.'
        : 'Open this project from Pascal again to restore access.'}</p>
    <Actions>
      {signIn.available && <SignInButton signIn={signIn} />}
      <a className={signIn.available ? secondary : primary} href={projectUrl}>Open project in Pascal</a>
      {signIn.available && <SignInError signIn={signIn} />}
    </Actions>
  </Status>
}

export function ErrorScreen({ error, onRetry, baseUrl, projectId, anonymous }: {
  error: PascalError; onRetry: () => void; baseUrl: string; projectId: string; anonymous: boolean
}) {
  if (error.code === 'not_found' || error.code === 'unauthorized') {
    return <AccessScreen anonymous={anonymous} baseUrl={baseUrl} code={error.code} projectId={projectId} />
  }
  if (error.code === 'not_published') return <Status state="not_published" title="This project isn't published yet">
    <p>Ask the owner to publish this project, then try again.</p><RetryButton onRetry={onRetry} />
  </Status>
  return <Status state="error" title="The project couldn't be opened">
    <p>{error.code === 'network' ? 'Check your connection, then try again.' : 'Please try again.'}</p>
    <RetryButton onRetry={onRetry} />
  </Status>
}

/** An anonymous read was refused. The copy never says whether the project exists or is private. */
function AccessScreen({ anonymous, baseUrl, code, projectId }: {
  anonymous: boolean; baseUrl: string; code: 'not_found' | 'unauthorized'; projectId: string
}) {
  const signIn = useSignIn(baseUrl, projectId, anonymous)
  const actions = signIn.available && <Actions><SignInButton signIn={signIn} /><SignInError signIn={signIn} /></Actions>
  if (code === 'not_found') return <Status state="not_found" title="Project not found">
    <p>{signIn.available ? 'Check the address, or sign in if you have access.'
      : 'Check the address, or open it from Pascal if you have access.'}</p>
    {actions}
  </Status>
  return <Status state="needs-access" title="This project needs access">
    <p>{signIn.available ? 'Sign in if you have access, or reopen your original share link.'
      : 'Open this project from Pascal or from your original share link.'}</p>
    {actions}
  </Status>
}

export function NoFileScreen({ scene, onRetry }: { scene: SceneResponse; onRetry: () => void }) {
  return <Status state="no-file" title="3D file not ready">
    <p>{scene.bake.status === 'baking' ? 'The 3D file is being prepared. Try again shortly.'
      : 'Ask the owner to prepare a 3D file for this project.'}</p>
    <RetryButton onRetry={onRetry} />
  </Status>
}
