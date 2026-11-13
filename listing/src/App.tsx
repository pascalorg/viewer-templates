import {
  Component,
  lazy,
  type ReactNode,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react'
import { PASCAL_BASE_URL, PASCAL_TOKEN_URL, projectIdFromLocation } from './config'
import { hasHandoffCallback } from './pascal/handoff'
import { canSignIn, signIn, SignInUnavailable, listLevels, type PascalError, type SceneResponse } from './pascal'
import { type ListingState, useListing } from './useListing'
import type { ModelInfo } from './viewer/Model'
import type { RoomHover } from './viewer/semantics'
import { hasWebGL2 } from './viewer/webgl'

// three and the renderer are the bulk of the bundle: load them as their own chunk, in
// parallel with the API read, so status screens and the poster paint first.
const loadViewer = () => import('./viewer/Viewer')
const Viewer = lazy(() => loadViewer().then((module) => ({ default: module.Viewer })))
const LiveViewer = lazy(() => import('./viewer/LiveViewer').then((module) => ({
  default: module.LiveViewer,
})))

export function App() {
  const projectId = useMemo(() => projectIdFromLocation(), [])
  const webgl = useMemo(() => hasWebGL2(), [])

  if (!projectId && !(hasHandoffCallback() && !PASCAL_TOKEN_URL)) {
    return (
      <Status title="No project selected" state="missing-project">
        Add <code>?project=&lt;id&gt;</code> to the address, or set{' '}
        <code>VITE_PASCAL_PROJECT_ID</code>.
      </Status>
    )
  }
  if (!webgl) {
    return (
      <Status title="3D isn't available in this browser" state="no-webgl">
        Turn on hardware acceleration, or open this page in another browser.
      </Status>
    )
  }
  return <Listing projectId={projectId || ''} />
}

function Listing({ projectId }: { projectId: string }) {
  const { state, reload } = useListing(PASCAL_BASE_URL, projectId)
  useEffect(() => {
    void loadViewer()
  }, [])

  if (state.kind === 'loading') return <Status title="Loading project…" state="loading" />
  if (state.kind === 'opening') return <Status title="Opening from Pascal…" state="opening" />
  if (state.kind === 'refused') return <RefusedStatus projectId={projectId} />
  if (state.kind === 'reopen') return <ReopenStatus access={state.access} projectId={projectId} />
  if (state.kind === 'error') return <ErrorStatus error={state.error} onRetry={reload} projectId={projectId} anonymous={state.anonymous} />
  if (state.kind === 'no-file') return <NoFileStatus scene={state.scene} onRetry={reload} />
  return <Scene key={state.kind === 'live' ? 'live' : 'baked'} state={state} onRetry={reload} />
}

function Scene({
  state,
  onRetry,
}: {
  state: Extract<ListingState, { kind: 'downloading' | 'ready' | 'live' }>
  onRetry: () => void
}) {
  const { scene } = state
  const levels = useMemo(() => listLevels(scene.graph), [scene.graph])
  const [levelId, setLevelId] = useState<string | null>(null)
  const [model, setModel] = useState<ModelInfo | null>(null)
  const [liveReady, setLiveReady] = useState(false)
  const [openError, setOpenError] = useState(false)
  const [hover, setHover] = useState<(RoomHover & { x: number; y: number }) | null>(null)
  const handleError = useCallback((error: unknown) => {
    console.error(error)
    setOpenError(true)
  }, [])

  if (openError) {
    return (
      <Status title="The 3D view couldn't be opened" state="error">
        <Actions>
          <button className="button primary" onClick={onRetry} type="button">
            Try again
          </button>
        </Actions>
      </Status>
    )
  }

  const live = state.kind === 'live'
  const ready = live ? liveReady : !!model
  const progress = state.kind === 'downloading' ? state.progress : live ? null : 1
  const hasOpenables = live
    ? Object.values(scene.graph.nodes).some((node) =>
        (node.type === 'door' || node.type === 'window') && node.openingKind !== 'opening')
    : model?.hasOpenables
  return (
    <main
      className="app"
      data-scene-ready={ready}
      data-source={live ? 'live' : 'baked'}
      data-state={ready ? 'ready' : 'loading'}
    >
      <ProjectHeader scene={scene} source={live ? 'Live view' : 'Baked view'} />

      {live || state.kind === 'ready' ? (
        <ViewerBoundary onError={handleError}>
          <Suspense fallback={null}>
            {live ? (
              <LiveViewer
                scene={scene}
                levelId={levelId}
                onError={handleError}
                onHover={setHover}
                onSceneReadyChange={setLiveReady}
              />
            ) : state.kind === 'ready' ? (
              <Viewer
                bytes={state.bytes}
                graph={scene.graph}
                label={`${projectName(scene)}, interactive 3D view`}
                levelId={levelId}
                onError={handleError}
                onHover={setHover}
                onReady={setModel}
              />
            ) : null}
          </Suspense>
        </ViewerBoundary>
      ) : null}

      {ready ? null : (
        <div className="loading-overlay">
          {scene.project.coverUrl ? (
            <img alt="" className="poster" src={scene.project.coverUrl} />
          ) : null}
          <div className="progress-card" role="status">
            <span>{live ? 'Building 3D view…' : 'Loading 3D file…'}</span>
            <div className="progress-track">
              <div
                className={progress === null ? 'progress-bar indeterminate' : 'progress-bar'}
                style={{ width: progress === null ? undefined : `${Math.round(progress * 100)}%` }}
              />
            </div>
          </div>
        </div>
      )}

      {ready && levels.length > 1 ? (
        <fieldset className="levels">
          <legend className="sr-only">Floors</legend>
          <LevelButton active={levelId === null} onClick={() => setLevelId(null)}>
            All floors
          </LevelButton>
          {[...levels].reverse().map((level) => (
            <LevelButton
              active={levelId === level.id}
              key={level.id}
              onClick={() => setLevelId(level.id)}
            >
              {level.name}
            </LevelButton>
          ))}
        </fieldset>
      ) : null}

      {ready && hasOpenables ? <p className="hint">Click a door or window to open it</p> : null}

      {hover ? (
        <div className="room-label" style={{ left: hover.x + 14, top: hover.y + 14 }}>
          <strong>{hover.label}</strong>
          <span>{formatArea(hover.area)}</span>
        </div>
      ) : null}
    </main>
  )
}

function projectName(scene: SceneResponse) {
  return scene.project.name?.trim() || 'Untitled project'
}

function formatArea(area: number) {
  return `${area.toLocaleString(undefined, { maximumFractionDigits: area < 10 ? 1 : 0 })} m²`
}

function LevelButton({
  active,
  children,
  onClick,
}: {
  active: boolean
  children: ReactNode
  onClick: () => void
}) {
  return (
    <button aria-pressed={active} className="button" onClick={onClick} type="button">
      {children}
    </button>
  )
}

function ProjectHeader({ scene, source }: { scene: SceneResponse; source: string }) {
  return (
    <header className="project-header">
      <h1>{projectName(scene)}</h1>
      {scene.project.owner ? <p>by {scene.project.owner.displayName}</p> : null}
      <p>{source}</p>
    </header>
  )
}

function NoFileStatus({ scene, onRetry }: { scene: SceneResponse; onRetry: () => void }) {
  if (scene.bake.status === 'baking') {
    return (
      <Status title="This project's 3D file is being prepared" state="baking">
        This page checks again every 30 seconds.
        <Actions>
          <button className="button primary" onClick={onRetry} type="button">
            Check now
          </button>
        </Actions>
      </Status>
    )
  }
  return (
    <Status title="No 3D file is available yet" state="no-file">
      {projectName(scene)} doesn't have a 3D file to show.
    </Status>
  )
}

/**
 * Sign in with Pascal is offered only when this origin is a registered viewer (`canSignIn`) and
 * no company token endpoint is set. Until that is known, screens show their no-button copy.
 */
function useSignIn(projectId: string, enabled = true) {
  const [registered, setRegistered] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const offered = enabled && !!projectId && !PASCAL_TOKEN_URL
  useEffect(() => {
    if (!offered) return
    let active = true
    void canSignIn(PASCAL_BASE_URL).then((value) => { if (active) setRegistered(value) })
    return () => { active = false }
  }, [offered])
  const start = async () => {
    setBusy(true)
    setError(null)
    try { await signIn(projectId, PASCAL_BASE_URL) } catch (failure) {
      setError(failure instanceof SignInUnavailable ? "Sign-in isn't available on this site."
        : "Sign-in couldn't start. Try again.")
      setBusy(false)
    }
  }
  return { available: offered && registered, busy, error, start }
}

type SignInState = ReturnType<typeof useSignIn>

/** A screen's buttons: the primary action first, then at most one secondary action. */
function Actions({ children }: { children: ReactNode }) {
  return <div className="status-actions">{children}</div>
}

/** Keeps its width while busy, so the label change does not move the layout. */
function SignInButton({ signIn }: { signIn: SignInState }) {
  return (
    <button aria-busy={signIn.busy || undefined} className="button primary" disabled={signIn.busy}
      onClick={() => void signIn.start()} type="button">
      <span className="button-labels">
        <span className={signIn.busy ? 'invisible' : undefined}>Sign in with Pascal</span>
        <span className={signIn.busy ? undefined : 'invisible'}>Opening Pascal…</span>
      </span>
    </button>
  )
}

/** Sits below the buttons without taking space, so an error does not move the layout. */
function SignInError({ signIn }: { signIn: SignInState }) {
  return <p className="status-error" role="alert">{signIn.error}</p>
}

function SignInActions({ signIn }: { signIn: SignInState }) {
  if (!signIn.available) return null
  return <Actions><SignInButton signIn={signIn} /><SignInError signIn={signIn} /></Actions>
}

function RefusedStatus({ projectId }: { projectId: string }) {
  const signIn = useSignIn(projectId)
  return (
    <Status title="This account can't open this project" state="refused">
      {signIn.available ? 'Another Pascal account may have access.'
        : 'Open this project from Pascal with another account.'}
      <SignInActions signIn={signIn} />
    </Status>
  )
}

function ReopenStatus({ access, projectId }: { access: 'session' | 'share'; projectId: string }) {
  const signIn = useSignIn(projectId, access === 'session')
  const projectUrl = new URL(
    projectId ? `/editor/${encodeURIComponent(projectId)}` : '/projects',
    PASCAL_BASE_URL,
  ).href
  return (
    <Status title={access === 'share' ? 'Reopen your share link' : 'Reopen from Pascal'} state="reopen">
      {access === 'share'
        ? 'Open the original Pascal share link again to restore access.'
        : signIn.available
          ? 'Sign in again, or open this project from Pascal.'
          : 'Open this project from Pascal again to restore access.'}
      <Actions>
        {signIn.available && <SignInButton signIn={signIn} />}
        <a className={signIn.available ? 'button' : 'button primary'} href={projectUrl}>
          Open project in Pascal
        </a>
        {signIn.available && <SignInError signIn={signIn} />}
      </Actions>
    </Status>
  )
}

/** An anonymous read was refused. The copy never says whether the project exists or is private. */
function AccessStatus({ anonymous, code, projectId }: {
  anonymous: boolean; code: 'not_found' | 'unauthorized'; projectId: string
}) {
  const signIn = useSignIn(projectId, anonymous)
  if (code === 'not_found') {
    return (
      <Status title="Project not found" state="not-found">
        {signIn.available ? 'Check the address, or sign in if you have access.'
          : 'Check the address, or open it from Pascal if you have access.'}
        <SignInActions signIn={signIn} />
      </Status>
    )
  }
  return (
    <Status title="This project needs access" state="needs-access">
      {signIn.available ? 'Sign in if you have access, or reopen your original share link.'
        : 'Open this project from Pascal or from your original share link.'}
      <SignInActions signIn={signIn} />
    </Status>
  )
}

function ErrorStatus({ error, onRetry, projectId, anonymous }: {
  error: PascalError; onRetry: () => void; projectId: string; anonymous: boolean
}) {
  const retry = (
    <Actions>
      <button className="button primary" onClick={onRetry} type="button">
        Try again
      </button>
    </Actions>
  )
  switch (error.code) {
    case 'not_found':
    case 'unauthorized':
      return <AccessStatus anonymous={anonymous} code={error.code} projectId={projectId} />
    case 'not_published':
      return (
        <Status title="This project isn't published yet" state="not-published">
          Its owner hasn't published a version to show.
        </Status>
      )
    case 'network':
      return (
        <Status title="Couldn't reach Pascal" state="error">
          Check your connection and try again.
          {retry}
        </Status>
      )
    case 'invalid_response':
      return (
        <Status title="This viewer doesn't understand Pascal's answer" state="error">
          It may need an update.
        </Status>
      )
    default:
      return (
        <Status title="Something went wrong loading this project" state="error">
          {retry}
        </Status>
      )
  }
}

function Status({
  title,
  state,
  children,
}: {
  title: string
  state: string
  children?: ReactNode
}) {
  return (
    <main className="status" data-state={state}>
      <h1>{title}</h1>
      {children ? <div className="status-body">{children}</div> : null}
    </main>
  )
}

/** Catches renderer failures (context creation, a shader that won't compile). */
class ViewerBoundary extends Component<
  { children: ReactNode; onError: (error: unknown) => void },
  { failed: boolean }
> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  componentDidCatch(error: unknown) {
    this.props.onError(error)
  }
  render() {
    return this.state.failed ? null : this.props.children
  }
}
