import { useMemo } from 'react'
import { PASCAL_BASE_URL, projectIdFromLocation } from './config'
import { hasHandoffCallback } from './pascal/handoff'
import { projectSceneRuntime } from './runtime/project-scene'
import { useProjectScene } from './useProjectScene'
import { ProjectViewer } from './viewer/ProjectViewer'
import { ErrorScreen, LoadingScreen, NeedsAccessScreen, NoFileScreen, Status } from './viewer/screens'

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
    case 'reopen': return <NeedsAccessScreen access={state.access} baseUrl={PASCAL_BASE_URL} projectId={projectId} />
    case 'error': return <ErrorScreen error={state.error} onRetry={reload} />
    case 'no-file': return <NoFileScreen scene={state.scene} onRetry={reload} />
    case 'live':
    case 'baked': {
      // A late plugin bumps runtimeRevision without remounting; the viewer rebuilds what it draws.
      const glbUrl = state.kind === 'baked' ? state.url : null
      return <ProjectViewer key={`${state.scene.revision.modelId}:${state.scene.revision.version}:${glbUrl}`}
        scene={state.scene} glbUrl={glbUrl} runtimeRevision={state.runtimeRevision} />
    }
  }
}
