import { lazy, Suspense, useMemo } from 'react'
import { PASCAL_BASE_URL, projectIdFromLocation } from './config'
import { hasHandoffCallback } from './pascal/handoff'
import { projectSceneRuntime } from './runtime/project-scene'
import { useProjectScene } from './useProjectScene'
import { ErrorScreen, LoadingScreen, NeedsAccessScreen, NoFileScreen, RefusedScreen, Status } from './viewer/screens'

/** A project with the visitor's own Home Assistant. */
const HomeProjectViewer = lazy(() => import('./home/HomeProjectViewer').then((m) => ({ default: m.HomeProjectViewer })))

export function App() {
  const projectId = useMemo(() => projectIdFromLocation(), [])
  if (!projectId && !hasHandoffCallback()) return <Status state="missing-project" title="No project selected">
    <p>Add <code>?project=&lt;id&gt;</code> to the address, or set <code>VITE_PASCAL_PROJECT_ID</code>.</p>
  </Status>
  return <Project projectId={projectId || ''} />
}

function Project({ projectId }: { projectId: string }) {
  const { state, reload } = useProjectScene(PASCAL_BASE_URL, projectId, projectSceneRuntime)
  switch (state.kind) {
    case 'loading': return <LoadingScreen />
    case 'opening': return <LoadingScreen opening />
    case 'downloading': return <LoadingScreen progress={state.progress} />
    case 'refused': return <RefusedScreen baseUrl={PASCAL_BASE_URL} projectId={projectId} />
    case 'reopen': return <NeedsAccessScreen access={state.access} baseUrl={PASCAL_BASE_URL} projectId={projectId} />
    case 'error': return <ErrorScreen error={state.error} onRetry={reload} baseUrl={PASCAL_BASE_URL} projectId={projectId} anonymous={state.anonymous} />
    case 'no-file': return <NoFileScreen scene={state.scene} onRetry={reload} />
    case 'live':
    case 'baked': {
      // As the lab: the graph rebuilt live whatever the bake (the wireframe restyles live meshes).
      // A late plugin bumps runtimeRevision without remounting; the graph is set again to draw it.
      return <Suspense fallback={<LoadingScreen />}>
        <HomeProjectViewer key={`${state.scene.revision.modelId}:${state.scene.revision.version}`} scene={state.scene} runtimeRevision={state.runtimeRevision} />
      </Suspense>
    }
  }
}
