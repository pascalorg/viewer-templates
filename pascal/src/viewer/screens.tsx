import { Button, buttonVariants, SceneLoader } from '@pascal-app/viewer/ui'
import { type ReactNode, useEffect, useState } from 'react'
import { canSignIn, signIn, SignInUnavailable, type PascalError, type SceneResponse } from '../pascal'

export function Status({ state, title, children }: {
  state: string
  title: string
  children?: ReactNode
}) {
  return (
    <main className="flex h-full items-center justify-center p-6" data-state={state}>
      <div className="max-w-md space-y-4">
        <h1 className="text-xl font-semibold">{title}</h1>
        {children && <div className="space-y-4 text-muted-foreground">{children}</div>}
      </div>
    </main>
  )
}

const primary = buttonVariants({ className: 'rounded-full' })
const secondary = buttonVariants({ className: 'rounded-full text-foreground', variant: 'outline' })

/** A screen's buttons: the primary action first, then at most one secondary action. */
function Actions({ children }: { children: ReactNode }) {
  return <div className="relative flex flex-wrap items-center gap-3">{children}</div>
}

export function RetryButton({ onRetry }: { onRetry: () => void }) {
  return <Actions><Button className="rounded-full" onClick={onRetry} type="button">Try again</Button></Actions>
}

/** The hosted viewer's full-screen loader while the project is read and prepared. */
export function LoadingScreen({ opening = false, progress }: { opening?: boolean; progress?: number | null }) {
  return <main className="h-full" data-state={opening ? 'opening' : 'loading'}>
    <SceneLoader className="bg-background" fullScreen />
    <p className="sr-only" role="status">{opening ? 'Opening from Pascal…'
      : progress == null ? 'Loading project…' : `Downloading 3D file: ${Math.round(progress * 100)}%`}</p>
  </main>
}

/**
 * Sign in with Pascal is offered only when this origin is a registered viewer (`canSignIn`).
 * Until that is known, and on unregistered sites, screens show their no-button copy.
 */
function useSignIn(baseUrl: string, projectId: string, enabled = true) {
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
    try { await signIn(projectId, baseUrl) } catch (failure) {
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
  return <Button aria-busy={signIn.busy || undefined} className="rounded-full" disabled={signIn.busy}
    onClick={() => void signIn.start()} type="button">
    <span className="grid">
      <span className={`[grid-area:1/1] ${signIn.busy ? 'invisible' : ''}`}>Sign in with Pascal</span>
      <span className={`[grid-area:1/1] ${signIn.busy ? '' : 'invisible'}`}>Opening Pascal…</span>
    </span>
  </Button>
}

/** Sits below the buttons without taking space, so an error does not move the layout. */
function SignInError({ signIn }: { signIn: SignInState }) {
  return <p className="absolute inset-x-0 top-full mt-3 text-destructive text-sm" role="alert">{signIn.error}</p>
}

export function RefusedScreen({ baseUrl, projectId }: { baseUrl: string; projectId: string }) {
  const signIn = useSignIn(baseUrl, projectId)
  return <Status state="refused" title="This account can't open this project">
    <p>{signIn.available ? 'Another Pascal account may have access.'
      : 'Open this project from Pascal with another account.'}</p>
    {signIn.available && <Actions><SignInButton signIn={signIn} /><SignInError signIn={signIn} /></Actions>}
  </Status>
}

export function NeedsAccessScreen({ access, baseUrl, projectId }: {
  access: 'share' | 'session'
  baseUrl: string
  projectId: string
}) {
  const signIn = useSignIn(baseUrl, projectId, access === 'session')
  const projectUrl = new URL(projectId ? `/editor/${encodeURIComponent(projectId)}` : '/projects', baseUrl).href
  return <Status state="reopen" title={access === 'share' ? 'Reopen your share link' : 'Reopen from Pascal'}>
    <p>{access === 'share' ? 'Open the original Pascal share link again to restore access.'
      : signIn.available ? 'Sign in again, or open this project from Pascal.'
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
