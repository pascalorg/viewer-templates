import { useMemo } from 'react'
import { PASCAL_BASE_URL, projectIdFromLocation } from './config'
import { hasHandoffCallback } from './pascal/handoff'
import { projectSceneRuntime } from './runtime/project-scene'
import { useProjectScene } from './useProjectScene'
import { FixtureViewer } from './viewer/FixtureViewer'
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
      const sceneKey = `${state.kind}:${state.scene.revision.modelId}:${state.scene.revision.version}:${state.runtimeRevision}`
      return <FixtureViewer key={sceneKey} sceneKey={sceneKey}
        graph={state.scene.graph} source={state.kind}
        title={state.scene.project.name || 'Pascal viewer'} onRetry={reload} />
    }
  }
}
