import {
  Component,
  lazy,
  type ReactNode,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { PASCAL_BASE_URL, PASCAL_TOKEN_URL, projectIdFromLocation } from './config'
import { hasHandoffCallback } from './pascal/handoff'
import { canSignIn, signIn, SignInUnavailable, type PascalError, type SceneResponse } from './pascal'
import { SettingsPanel, useViewerSettings } from './pascal-react'
import { DEFAULT_SETTINGS, parseDrawingSettings } from './settings'
import { readSpaces, roomContents, thingOf } from './spaces'
import { Dock, type Tool } from './ui/Dock'
import { Inspector } from './ui/Inspector'
import { OpeningSettings } from './ui/OpeningSettings'
import { Help, MeasureMarks, PointerTag, RoomTags, Toast } from './ui/Marks'
import { Masthead, SpacesPanel } from './ui/SpacesPanel'
import { type ListingState, useListing } from './useListing'
import { measure } from './viewer/measure'
import type { FocusProps, ModelInfo } from './viewer/Model'
import { navigation } from './viewer/navigation'
import { roomTags } from './viewer/roomTags'
import type { PointerHover } from './viewer/semantics'
import { hasWebGL2 } from './viewer/webgl'

// three and the renderer are the bulk of the bundle: load them as their own chunk, in
// parallel with the API read, so status screens and the loader paint first.
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

  if (state.kind === 'loading') return <LoaderScreen label="Loading project" state="loading" />
  if (state.kind === 'opening') return <LoaderScreen label="Opening from Pascal" state="opening" />
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
  const spaces = useMemo(() => readSpaces(scene.graph), [scene.graph])
  const [levelId, setLevelId] = useState<string | null>(null)
  const [roomId, setRoomId] = useState<string | null>(null)
  const [thingId, setThingId] = useState<string | null>(null)
  const [pointed, setPointed] = useState<readonly string[]>(NONE)
  const [previewRoom, setPreviewRoom] = useState<string | null>(null)
  const [navOpen, setNavOpen] = useState(false)
  const [tool, setTool] = useState<Tool | null>(null)
  const [helpOpen, setHelpOpen] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [model, setModel] = useState<ModelInfo | null>(null)
  const [openError, setOpenError] = useState(false)
  const [hover, setHover] = useState<PointerHover | null>(null)
  const narrow = useNarrow()
  const searchRef = useRef<HTMLInputElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  // The floor to go back to when a room closes: the one shown before it was picked.
  const returnLevel = useRef<string | null>(null)
  const shown = useRef({ levelId, roomId })
  shown.current = { levelId, roomId }

  const handleError = useCallback((error: unknown) => {
    console.error(error)
    setOpenError(true)
  }, [])

  const settings = useViewerSettings({
    settings: scene.settings, token: state.token, baseUrl: PASCAL_BASE_URL, projectId: scene.project.id,
    parse: parseDrawingSettings, defaults: DEFAULT_SETTINGS,
  })
  // The drawing opens on the saved view, set before it first frames; a manager's later changes
  // don't move it.
  useState(() => navigation.setOpening(settings.value.opening ?? null))

  const room = roomId ? (spaces.rooms.get(roomId) ?? null) : null
  const floor = room ? (spaces.floors.find((candidate) => candidate.id === room.levelId) ?? null) : null
  const contents = useMemo(() => (room ? roomContents(scene.graph, room) : []), [scene.graph, room])
  const thing = useMemo(() => (thingId ? thingOf(scene.graph, thingId) : null), [scene.graph, thingId])
  // With a floor shown alone, its rooms carry pinned tags; the open room's is drawn current.
  const tagged = useMemo(() => {
    if (levelId === null || tool === 'measure') return []
    return spaces.floors.find((candidate) => candidate.id === levelId)?.rooms ?? []
  }, [spaces, levelId, tool])
  useEffect(() => {
    roomTags.setSpots(tagged.map((each) => ({ id: each.id, point: each.labelPoint })))
  }, [tagged])
  useEffect(() => () => roomTags.setSpots([]), [])

  /** Shows a floor alone, or every floor (`null`), and closes any room. */
  const setLevel = useCallback((id: string | null) => {
    setRoomId(null)
    setThingId(null)
    setHover(null)
    setLevelId(id)
    returnLevel.current = id
  }, [])

  /** Opens a room: its floor shows alone and the drawing frames it. */
  const selectRoom = useCallback(
    (id: string) => {
      const next = spaces.rooms.get(id)
      if (!next) return
      if (!shown.current.roomId) returnLevel.current = shown.current.levelId
      setRoomId(id)
      setThingId(null)
      setHover(null)
      setPreviewRoom(null)
      setLevelId(next.levelId)
      if (narrow) setNavOpen(false)
    },
    [spaces, narrow],
  )

  /** One level back: from an item to its room, from a room to the floor shown before. */
  const back = useCallback(() => {
    setHover(null)
    if (thingId) return setThingId(null)
    setRoomId(null)
    setLevelId(returnLevel.current)
  }, [thingId])

  const toggleTool = useCallback((next: Tool) => setTool((current) => (current === next ? null : next)), [])

  useEffect(() => {
    measure.setActive(tool === 'measure')
    if (tool === 'measure') setHover(null)
  }, [tool])
  useEffect(() => () => measure.setActive(false), [])

  const showToast = useCallback((message: string) => setToast(message), [])
  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(null), 3600)
    return () => clearTimeout(timer)
  }, [toast])

  const toggleFullScreen = useCallback(() => {
    if (document.fullscreenElement) {
      void document.exitFullscreen()
      return
    }
    const root = document.documentElement
    if (!root.requestFullscreen) return showToast("Full screen isn't available in this browser.")
    root.requestFullscreen().catch(() => showToast('Full screen was blocked by the page that shows this viewer.'))
  }, [showToast])

  // Framing centres what it frames in the part of the screen the panels leave clear. Set before
  // the viewers' effects run, so a room picked from the list is framed beside its details.
  useLayoutEffect(() => {
    const sheet = navOpen || !!room
    navigation.setInsets(
      narrow
        ? { top: 0, right: 0, left: 0, bottom: sheet ? Math.round(window.innerHeight * 0.46) + 76 : 72 }
        : { top: 0, left: navOpen ? 296 : 0, right: room ? 336 : 0, bottom: tool ? 148 : 76 },
    )
  }, [narrow, navOpen, room, tool])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (helpOpen || event.metaKey || event.ctrlKey || event.altKey) return
      const typing = event.target instanceof HTMLElement && !!event.target.closest('input, textarea, select')
      if (typing) return
      const key = event.key.length === 1 ? event.key.toLowerCase() : event.key
      if (key === 'Escape') {
        if (tool) setTool(null)
        else if (roomId) back()
        else if (navOpen) setNavOpen(false)
        else if (levelId !== null && spaces.floors.length > 1) setLevel(null)
        else return
      } else if (key === 'ArrowLeft') navigation.rotate(-1)
      else if (key === 'ArrowRight') navigation.rotate(1)
      else if (key === 'p') navigation.setProjection(navigation.projection === 'plan' ? 'axonometric' : 'plan')
      else if (key === 'f') navigation.fit()
      else if (key === 's') setNavOpen((open) => !open)
      else if (key === '/') {
        setNavOpen(true)
        requestAnimationFrame(() => searchRef.current?.focus())
      } else if (key === 'm') toggleTool('measure')
      else if (key === 'x') toggleTool('section')
      else if (key === '?') setHelpOpen(true)
      else if (/^[1-9]$/.test(key)) {
        // 1 is every floor, then each floor from the top, as the spaces panel lists them.
        const several = spaces.floors.length > 1
        const order = several ? [null, ...spaces.floors.map((each) => each.id)] : spaces.floors.map((each) => each.id)
        const pick = order[Number(key) - 1]
        if (pick === undefined) return
        setLevel(pick)
      } else return
      event.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [back, helpOpen, levelId, navOpen, roomId, setLevel, spaces, toggleTool, tool])

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
  const ready = !!model
  const progress = state.kind === 'downloading' ? state.progress : live ? null : 1
  const focus: FocusProps = {
    levelId,
    selectedRoomId: roomId,
    selectedThingId: thingId,
    pointedThingIds: pointed,
    previewRoomId: previewRoom,
    onHover: setHover,
    onSelectLevel: setLevel,
    onSelectRoom: selectRoom,
    onSelectThing: setThingId,
  }
  const owner = scene.project.owner ? `${scene.project.owner.displayName} · ` : ''
  // A level under the pointer is named from Spaces, like its row there (a roof has no area).
  const hoveredFloor = hover?.kind === 'level' ? spaces.floors.find((each) => each.id === hover.id) : undefined
  const pointerHover =
    hover?.kind === 'level'
      ? hoveredFloor
        ? { ...hover, label: hoveredFloor.name, area: hoveredFloor.rooms.length ? hoveredFloor.area : undefined }
        : null
      : hover
  return (
    <main
      className="app"
      data-scene-ready={ready}
      data-source={live ? 'live' : 'baked'}
      data-state={ready ? 'ready' : 'loading'}
    >
      {live || state.kind === 'ready' ? (
        <ViewerBoundary onError={handleError}>
          <Suspense fallback={null}>
            {live ? (
              <LiveViewer
                {...focus}
                label={`${projectName(scene)}, interactive 3D view`}
                onError={handleError}
                onReady={setModel}
                scene={scene}
              />
            ) : state.kind === 'ready' ? (
              <Viewer
                {...focus}
                source={state.bytes}
                graph={scene.graph}
                label={`${projectName(scene)}, interactive 3D view`}
                onError={handleError}
                onReady={setModel}
              />
            ) : null}
          </Suspense>
        </ViewerBoundary>
      ) : null}

      {ready ? null : (
        <div className="loading-overlay">
          <Loader label={live ? 'Building the drawing' : 'Loading the drawing'} progress={progress} />
        </div>
      )}

      <Masthead
        onToggle={() => setNavOpen((open) => !open)}
        open={navOpen && ready}
        ready={ready}
        spaces={spaces}
        subtitle={`${owner}${live ? 'Live view' : 'Baked view'}`}
        title={projectName(scene)}
      />

      {ready ? (
        <>
          <SpacesPanel
            hotId={previewRoom ?? (hover?.kind === 'room' || hover?.kind === 'level' ? (hover.id ?? null) : null)}
            levelId={levelId}
            onLevel={setLevel}
            onPreview={setPreviewRoom}
            onRoom={selectRoom}
            open={navOpen}
            roomId={roomId}
            searchRef={searchRef}
            spaces={spaces}
          />
          <Inspector
            allFloors={spaces.floors.length > 1}
            closeRef={closeRef}
            contents={contents}
            floor={floor}
            onClose={back}
            onLevel={setLevel}
            onPoint={setPointed}
            onThing={setThingId}
            room={room}
            thing={thing}
          />
          <Dock
            floors={spaces.floors}
            levelId={levelId}
            onFullScreen={toggleFullScreen}
            onHelp={() => setHelpOpen(true)}
            onLevel={setLevel}
            onTool={toggleTool}
            tool={tool}
          />
          <RoomTags
            currentId={roomId}
            hotId={previewRoom ?? (hover?.kind === 'room' ? (hover.id ?? null) : null)}
            onPreview={setPreviewRoom}
            onRoom={selectRoom}
            rooms={ready ? tagged : []}
          />
          <MeasureMarks />
          <Help onClose={() => setHelpOpen(false)} open={helpOpen} />
          <Toast message={toast} />
          <SettingsPanel description={`How visitors first see ${scene.project.name?.trim() || 'this project'} in this viewer.`} settings={settings}>
            <OpeningSettings settings={settings} />
          </SettingsPanel>
        </>
      ) : null}

      {/* A room with a pinned tag lights that tag instead of getting a second one. */}
      {pointerHover && tool !== 'measure' && !(pointerHover.kind === 'room' && tagged.some((each) => each.id === pointerHover.id)) ? (
        <PointerTag hover={pointerHover} />
      ) : null}
    </main>
  )
}

const NONE: readonly string[] = []

/** Phones and narrow embeds: panels become sheets above the dock. */
function useNarrow() {
  const query = '(max-width: 767px)'
  const [narrow, setNarrow] = useState(() => window.matchMedia(query).matches)
  useEffect(() => {
    const media = window.matchMedia(query)
    const change = () => setNarrow(media.matches)
    media.addEventListener('change', change)
    return () => media.removeEventListener('change', change)
  }, [])
  return narrow
}

/**
 * Pascal's mark drawn like the rest of the page: three stepped bars in outline ink, each filling
 * in turn. Below it, a hairline that follows the download when its size is known.
 */
function Loader({ label, progress = null }: { label: string; progress?: number | null }) {
  return (
    <div className="loader" role="status">
      <svg aria-hidden className="loader-mark" viewBox="-2 -2 104 104">
        <rect className="loader-bar" height="40" width="20" x="0" y="60" />
        <rect className="loader-bar" height="40" width="20" x="40" y="30" />
        <rect className="loader-bar" height="40" width="20" x="80" y="0" />
      </svg>
      <span className="loader-label">{label}</span>
      <div className="loader-track">
        <div
          className={progress === null ? 'loader-progress indeterminate' : 'loader-progress'}
          style={{ transform: progress === null ? undefined : `scaleX(${progress})` }}
        />
      </div>
    </div>
  )
}

function LoaderScreen({ label, state }: { label: string; state: string }) {
  return (
    <main className="status" data-state={state}>
      <h1 className="sr-only">{label}…</h1>
      <Loader label={label} />
    </main>
  )
}

function projectName(scene: SceneResponse) {
  return scene.project.name?.trim() || 'Untitled project'
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
