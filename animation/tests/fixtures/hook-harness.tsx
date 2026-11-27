import { createRoot } from 'react-dom/client'
import { useProjectScene, type ProjectSceneOptions, type ProjectSceneRuntime, type ProjectSceneState } from '../../src/useProjectScene'

type Input = ProjectSceneOptions & { projectId?: string }
type Preparation = Parameters<ProjectSceneRuntime['prepare']>[1] & {
  scene: Parameters<ProjectSceneRuntime['prepare']>[0]
  finish: () => void
  fail: () => void
}

declare global {
  interface Window {
    s3: {
      mount: (input?: Input) => void
      unmount: () => void
      reload: () => void
      state: ProjectSceneState | null
      block: boolean
      preparations: Preparation[]
      disposed: number
      urls: string[]
      revoked: string[]
    }
  }
}

const createUrl = URL.createObjectURL.bind(URL)
const revokeUrl = URL.revokeObjectURL.bind(URL)
URL.createObjectURL = (blob) => {
  const url = createUrl(blob)
  window.s3.urls.push(url)
  return url
}
URL.revokeObjectURL = (url) => { window.s3.revoked.push(url); revokeUrl(url) }
const root = createRoot(document.getElementById('root')!)
window.s3 = {
  mount: (input = {}) => root.render(<Harness input={input} />),
  unmount: () => root.render(null),
  reload: () => {},
  state: null,
  block: false,
  preparations: [],
  disposed: 0,
  urls: [],
  revoked: [],
}
const runtime: ProjectSceneRuntime = {
  async prepare(scene, context) {
    let finish!: () => void
    let fail!: () => void
    const pending = new Promise<void>((resolve, reject) => {
      finish = resolve
      fail = () => reject(new Error('Preparation failed'))
    })
    window.s3.preparations.push({ ...context, scene, finish, fail })
    // Deliberately ignore abort to exercise stale runtime completion handling.
    if (window.s3.block) await pending
    return () => { window.s3.disposed++ }
  },
}
function Harness({ input }: { input: Input }) {
  const { state, reload } = useProjectScene('https://editor.pascal.app', input.projectId ?? 'fixture-house', runtime, input)
  window.s3.state = state
  window.s3.reload = reload
  return <output data-kind={state.kind}>{JSON.stringify(state)}</output>
}
