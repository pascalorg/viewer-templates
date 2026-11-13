import { SceneLoader } from '@pascal-app/viewer/ui'
import type { ReactNode } from 'react'
import type { PascalError, SceneResponse } from '../pascal'

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

export function NeedsAccessScreen({ access, baseUrl, projectId }: {
  access: 'share' | 'session'
  baseUrl: string
  projectId: string
}) {
  return <Status state="reopen" title={access === 'share' ? 'Reopen your share link' : 'Reopen from Pascal'}>
    <p>{access === 'share' ? 'Open the original Pascal share link again to restore access.'
      : 'Open this project from Pascal again to restore access.'}</p>
    <a className="inline-block rounded-full bg-foreground px-5 py-2 text-background"
      href={new URL(projectId ? `/editor/${encodeURIComponent(projectId)}` : '/projects', baseUrl).href}>
      Open project in Pascal
    </a>
  </Status>
}

export function ErrorScreen({ error, onRetry }: { error: PascalError; onRetry: () => void }) {
  if (error.code === 'not_found') return <Status state="not_found" title="Project not found">
    <p>This project may be private, or the address may be incorrect. Open it from Pascal if you have access.</p>
  </Status>
  if (error.code === 'not_published') return <Status state="not_published" title="This project isn't published yet">
    <p>Ask the owner to publish this project, then try again.</p><RetryButton onRetry={onRetry} />
  </Status>
  if (error.code === 'unauthorized') return <Status state="needs-access" title="This project needs access">
    <p>Open this project from Pascal or your original share link.</p>
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
