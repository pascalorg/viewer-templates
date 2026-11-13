import { SceneLoader } from '@pascal-app/viewer/ui'
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

export function RetryButton({ onRetry }: { onRetry: () => void }) {
  return <button className="block rounded-full bg-foreground px-5 py-2 text-background"
    onClick={onRetry} type="button">Try again</button>
}

/** The hosted viewer's full-screen loader while the project is read and prepared. */
export function LoadingScreen({ opening = false, progress }: { opening?: boolean; progress?: number | null }) {
  return <main className="h-full" data-state={opening ? 'opening' : 'loading'}>
    <SceneLoader className="bg-background" fullScreen />
    <p className="sr-only" role="status">{opening ? 'Opening from Pascal…'
      : progress == null ? 'Loading project…' : `Downloading 3D file: ${Math.round(progress * 100)}%`}</p>
  </main>
}

function SignInButton({ baseUrl, projectId }: { baseUrl: string; projectId: string }) {
  const [available, setAvailable] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let active = true
    void canSignIn(baseUrl).then((value) => { if (active) setAvailable(value) })
    return () => { active = false }
  }, [baseUrl])
  const start = async () => {
    setBusy(true)
    setError(null)
    try { await signIn(projectId, baseUrl) } catch (failure) {
      setError(failure instanceof SignInUnavailable ? failure.message : "Sign-in couldn't be started. Please try again.")
      setBusy(false)
    }
  }
  return <>
    {available && projectId && <button className="block rounded-full bg-foreground px-5 py-2 text-background"
      disabled={busy} onClick={() => void start()} type="button">Sign in with Pascal</button>}
    {error && <p role="alert">{error}</p>}
  </>
}

export function RefusedScreen({ baseUrl, projectId }: { baseUrl: string; projectId: string }) {
  return <Status state="refused" title="This account can't open this project">
    <p>Another Pascal account may have access.</p>
    <SignInButton baseUrl={baseUrl} projectId={projectId} />
  </Status>
}

export function NeedsAccessScreen({ access, baseUrl, projectId }: {
  access: 'share' | 'session'
  baseUrl: string
  projectId: string
}) {
  return <Status state="reopen" title={access === 'share' ? 'Reopen your share link' : 'Reopen from Pascal'}>
    <p>{access === 'share' ? 'Open the original Pascal share link again to restore access.'
      : 'Open this project from Pascal again to restore access.'}</p>
    {access === 'session' && <SignInButton baseUrl={baseUrl} projectId={projectId} />}
    <a className="inline-block rounded-full bg-foreground px-5 py-2 text-background"
      href={new URL(projectId ? `/editor/${encodeURIComponent(projectId)}` : '/projects', baseUrl).href}>
      Open project in Pascal
    </a>
  </Status>
}

export function ErrorScreen({ error, onRetry, baseUrl, projectId, anonymous }: {
  error: PascalError; onRetry: () => void; baseUrl: string; projectId: string; anonymous: boolean
}) {
  if (error.code === 'not_found') return <Status state="not_found" title="Project not found">
    <p>Check the address, or sign in with a Pascal account that may have access.</p>
    {anonymous && <SignInButton baseUrl={baseUrl} projectId={projectId} />}
  </Status>
  if (error.code === 'not_published') return <Status state="not_published" title="This project isn't published yet">
    <p>Ask the owner to publish this project, then try again.</p><RetryButton onRetry={onRetry} />
  </Status>
  if (error.code === 'unauthorized') return <Status state="needs-access" title="This project needs access">
    <p>Sign in with a Pascal account that may have access, or reopen your original share link.</p>
    {anonymous && <SignInButton baseUrl={baseUrl} projectId={projectId} />}
  </Status>
  return <Status state="error" title="The project couldn't be opened">
    <p>{error.code === 'network' ? 'Check your connection, then try again.' : 'Please try again.'}</p>
    <RetryButton onRetry={onRetry} />
  </Status>
}

export function NoFileScreen({ scene, onRetry }: { scene: SceneResponse; onRetry: () => void }) {
  return <Status state="no-file" title="3D file not ready">
    <p>{scene.bake.status === 'baking' ? 'The 3D file is being prepared. Try again shortly.'
      : 'Ask the owner to prepare a 3D file for this project.'}</p>
    <RetryButton onRetry={onRetry} />
  </Status>
}
