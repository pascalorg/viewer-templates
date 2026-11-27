import type { ProjectSceneRuntime } from '../useProjectScene'
import { prepareSceneRuntime } from './bootstrap'

/** Shared by App's live and baked paths; the hook owns this preparation's lifetime. */
export const projectSceneRuntime: ProjectSceneRuntime = {
  async prepare(scene, context) {
    const prepared = await prepareSceneRuntime({
      ...context,
      projectId: scene.project.id,
      graph: scene.graph,
      libraryMaterials: scene.libraryMaterials,
    })
    return prepared.dispose
  },
}
