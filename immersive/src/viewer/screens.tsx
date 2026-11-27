import { Button, buttonVariants, SceneLoader } from '@pascal-app/viewer/ui'
import { type ReactNode, useEffect, useState } from 'react'
import { canSignIn, signIn, SignInUnavailable, type PascalError, type SceneResponse } from '../pascal'

function eyebrowFor(state: string): string {
  switch (state) {
    case 'refused':
    case 'reopen':
    case 'not_found':
    case 'needs-access':
      return 'Access'
    case 'not_published':
    case 'no-file':
      return 'Unavailable'
    case 'missing-project':
      return 'Project'
    default:
      return 'Status'
  }
}

export function Status({ state, title, children }: {
  state: string
  title: string
  children?: ReactNode
}) {
  return (
    <main className="ui-stage-backdrop flex h-full items-center justify-center p-6 text-foreground" data-state={state}>
      <div className="w-full max-w-md">
        <p className="ui-eyebrow">{eyebrowFor(state)}</p>
        <h1 className="mt-2.5 font-light text-3xl text-foreground leading-[1.1] tracking-[-0.03em] sm:text-4xl">
          {title}
        </h1>
        <div aria-hidden="true" className="mt-4 h-px w-12 bg-foreground/25" />
        {children && <div className="mt-5 space-y-5 text-muted-foreground text-sm leading-relaxed sm:text-[15px]">{children}</div>}
      </div>
    </main>
  )
}

const primary = buttonVariants({ className: 'rounded-full px-5' })
const secondary = buttonVariants({ className: 'rounded-full px-5 text-foreground', variant: 'outline' })

/** A screen's buttons: the primary action first, then at most one secondary action. */
function Actions({ children }: { children: ReactNode }) {
  return <div className="relative flex flex-wrap items-center gap-3">{children}</div>
}

export function RetryButton({ onRetry }: { onRetry: () => void }) {
  return <Actions><Button className="rounded-full px-5" onClick={onRetry} type="button">Try again</Button></Actions>
}

/**
 * Calm editorial loader built around `@pascal-app/viewer/ui`'s `SceneLoader`. Shared by
 * `LoadingScreen` (scene fetch / download) and `ProjectViewer` (3D compile / opening camera).
 */
export function BrandedLoader({ label, projectName, progress, fixed = false }: {
  label: string
  projectName?: string | null
  progress?: number | null
  fixed?: boolean
}) {
  const percent = progress == null ? null : Math.round(progress * 100)
  return (
    <div
      className={`ui-stage-backdrop z-100 flex flex-col items-center justify-center px-6 text-center text-foreground ${
        fixed ? 'fixed inset-0' : 'h-full w-full'
      }`}
    >
      <div className="flex w-full max-w-sm flex-col items-center">
        <SceneLoader className="static inset-auto h-14 w-14 bg-transparent backdrop-blur-none" />
        <p className="ui-eyebrow mt-6">{label}</p>
        {projectName ? (
          <p className="mt-2 max-w-full truncate font-light text-2xl text-foreground leading-tight tracking-[-0.03em] sm:text-3xl">
            {projectName}
          </p>
        ) : null}
        <div className="mt-5 w-56 max-w-full">
          <div aria-hidden="true" className="h-[2px] w-full overflow-hidden rounded-full bg-foreground/15">
            {progress != null ? (
              <div
                className="h-full origin-left bg-foreground transition-transform duration-300 ease-out"
                style={{ transform: `scaleX(${Math.max(0, Math.min(1, progress))})` }}
              />
            ) : (
              <div className="h-full w-full bg-foreground/30" />
            )}
          </div>
          {percent != null ? (
            <p aria-hidden="true" className="mt-2 font-mono text-[11px] text-muted-foreground tabular-nums">
              {percent}%
            </p>
          ) : null}
        </div>
      </div>
    </div>
  )
}

/** The hosted viewer's full-screen loader while the project is read and prepared. */
export function LoadingScreen({ opening = false, progress, projectName }: {
  opening?: boolean
  progress?: number | null
  projectName?: string | null
}) {
  const label = opening ? 'Opening from Pascal' : progress == null ? 'Loading project' : 'Downloading 3D file'
  return (
    <main className="h-full" data-state={opening ? 'opening' : 'loading'}>
      <BrandedLoader label={label} progress={progress} projectName={projectName} />
      <p className="sr-only" role="status">
        {opening ? 'Opening from Pascal…'
          : progress == null ? 'Loading project…' : `Downloading 3D file: ${Math.round(progress * 100)}%`}
      </p>
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
  return <Button aria-busy={signIn.busy || undefined} className="rounded-full px-5" disabled={signIn.busy}
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
