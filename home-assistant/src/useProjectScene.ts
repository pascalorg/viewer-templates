import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { PASCAL_POLL_BAKE, PASCAL_SOURCE } from './config'
import { fetchGlb, getScene, PascalError, type SceneResponse } from './pascal'
import {
  type Access, credentialReadSucceeded, rejectCredential, renewalDelay, ReopenRequired, resolveAccess,
} from './pascal/access'

export type ProjectSceneState =
  | { kind: 'loading' }
  | { kind: 'opening' }
  | { kind: 'refused' }
  | { kind: 'reopen'; access: 'session' | 'share' }
  | { kind: 'error'; error: PascalError; anonymous: boolean }
  | { kind: 'no-file'; scene: SceneResponse }
  | { kind: 'downloading'; scene: SceneResponse; progress: number | null }
  | { kind: 'live'; scene: SceneResponse; runtimeRevision: number }
  | { kind: 'baked'; scene: SceneResponse; url: string; runtimeRevision: number }

/**
 * Assembly supplies a stable runtime object. Before either resolved state is published,
 * prepare must register library materials, configure the read-only artifact store
 * (prefetch private artifact:// references with token and credentials: 'omit'), and
 * await allowlisted plugin loading with a 20_000 ms deadline. Never send token to signed storage URLs.
 * signal lasts for this scene's lifetime; cancel work and suppress global mutations
 * after abort. onLate requests a remount when a plugin arrives after the deadline.
 * Return a disposer for artifact blob URLs/subscriptions; clean partial work on errors.
 * Preparation owns the read-only lease; the assembly owns live setScene/spatial sync and baked
 * buildGlbInteractiveItems/buildGlbReferenceNodes({scans:true,guides:true})/
 * buildGlbReplaceNodes. The complete graph remains available for plan, rooms and picking.
 */
export interface ProjectSceneRuntime {
  prepare(scene: SceneResponse, context: {
    baseUrl: string
    token?: string
    signal: AbortSignal
    onLate: () => void
  }): Promise<void | (() => void)>
}

export interface ProjectSceneOptions {
  source?: 'auto' | 'baked' | 'live'
  /** Opt in to listing's 30 s baking poll. Hosted behaviour leaves this off. */
  pollBake?: boolean
}

type Resources = {
  controller: AbortController
  key: string
  revision: number
  url?: string
  dispose?: () => void
}

function release(resources: Resources | null) {
  if (!resources || resources.controller.signal.aborted) return
  resources.controller.abort()
  if (resources.url) URL.revokeObjectURL(resources.url)
  resources.dispose?.()
}

// Signed links change without changing the already downloaded scene. Compare the
// rendering inputs so quiet credential renewal preserves the mounted viewer.
function sceneKey(scene: SceneResponse, kind: 'live' | 'baked') {
  return JSON.stringify([
    kind, scene.project, scene.revision, scene.graph, scene.libraryMaterials,
    kind === 'baked' ? [scene.bake.hash, scene.bake.bakeVersion] : null,
  ])
}

/** Resolve a published project into the hosted hybrid bake or a full live graph. */
export function useProjectScene(
  baseUrl: string,
  projectId: string,
  runtime: ProjectSceneRuntime,
  { source = PASCAL_SOURCE, pollBake = PASCAL_POLL_BAKE }: ProjectSceneOptions = {},
): { state: ProjectSceneState; reload: () => void } {
  const scope = useMemo(() => ({}), [baseUrl, projectId, runtime, source, pollBake])
  const [snapshot, setSnapshot] = useState<{ scope: object; state: ProjectSceneState }>({
    scope, state: { kind: 'loading' },
  })
  const [attempt, setAttempt] = useState({ quiet: false })
  const reload = useCallback(() => setAttempt({ quiet: false }), [])
  const active = useRef<Resources | null>(null)

  useEffect(() => () => {
    release(active.current)
    active.current = null
  }, [scope])

  useEffect(() => {
    const controller = new AbortController()
    const { signal } = controller
    let poll: ReturnType<typeof setTimeout> | undefined
    let renewal: ReturnType<typeof setTimeout> | undefined
    let access: Access = { kind: 'anonymous' }
    let pending: Resources | null = null
    const publish = (state: ProjectSceneState) => {
      if (!signal.aborted) setSnapshot({ scope, state })
    }
    const clearActive = () => {
      release(active.current)
      active.current = null
    }
    if (!attempt.quiet) {
      clearActive()
      publish({ kind: 'loading' })
    }
    const schedule = (scene: SceneResponse) => {
      const again = () => { if (!signal.aborted) setAttempt({ quiet: true }) }
      if (access.kind === 'credential') {
        renewal = setTimeout(again, renewalDelay(access.credential))
      }
      if (pollBake && source !== 'live' && scene.bake.status === 'baking') {
        poll = setTimeout(again, 30_000)
      }
    }

    const run = async () => {
      if (!attempt.quiet) publish({ kind: 'opening' })
      // The shared handoff API has no AbortSignal parameter. Ignore stale
      // results here; an authorization navigation it starts cannot be recalled.
      access = await resolveAccess(projectId, baseUrl)
      if (signal.aborted) return
      if (access.kind === 'refused') {
        clearActive()
        publish({ kind: 'refused' })
        return
      }
      if (access.kind === 'opening') {
        clearActive()
        publish({ kind: 'opening' })
        return
      }
      if (!attempt.quiet) publish({ kind: 'loading' })
      const token = access.kind === 'credential' ? access.credential.access_token : undefined
      let scene = await getScene(baseUrl, projectId, { signal, token })
      if (signal.aborted) return
      if (access.kind === 'credential') credentialReadSucceeded(access.credential)
      const bakeReady = scene.bake.status === 'ready' && scene.bake.lods.length > 0
      if (source === 'baked' && !bakeReady) {
        clearActive()
        publish({ kind: 'no-file', scene })
        schedule(scene)
        return
      }
      const kind = source !== 'live' && bakeReady ? 'baked' : 'live'
      if (attempt.quiet && active.current?.key === sceneKey(scene, kind)) {
        schedule(scene)
        return
      }
      pending = { controller: new AbortController(), key: '', revision: 0 }
      const resources = pending
      if (kind === 'baked') {
        if (!attempt.quiet) publish({ kind: 'downloading', scene, progress: null })
        const glb = await fetchGlb(baseUrl, projectId, scene, {
          signal, token,
          onProgress: (loaded, total) => {
            if (!attempt.quiet) publish({ kind: 'downloading', scene,
              progress: total ? Math.min(1, loaded / total) : null })
          },
        })
        if (signal.aborted) return
        scene = glb.scene
        resources.url = URL.createObjectURL(new Blob([glb.bytes], { type: 'model/gltf-binary' }))
      }
      resources.key = sceneKey(scene, kind)
      // The old scene's artifact URLs cannot outlive its runtime. An unchanged
      // quiet read above keeps it mounted; a changed scene waits for preparation.
      if (attempt.quiet) publish({ kind: 'loading' })
      clearActive()
      const dispose = await runtime.prepare(scene, {
        baseUrl, token, signal: resources.controller.signal,
        onLate: () => {
          if (resources.controller.signal.aborted) return
          resources.revision++
          if (active.current !== resources) return
          setSnapshot((current) => current.scope === scope &&
            (current.state.kind === 'live' || current.state.kind === 'baked')
            ? { scope, state: { ...current.state, runtimeRevision: resources.revision } } : current)
        },
      })
      if (signal.aborted) {
        // A non-cooperative runtime can finish after cleanup already aborted it.
        if (dispose) dispose()
        return
      }
      resources.dispose = dispose || undefined
      active.current = resources
      pending = null
      publish(kind === 'baked'
        ? { kind, scene, url: resources.url!, runtimeRevision: resources.revision }
        : { kind, scene, runtimeRevision: resources.revision })
      schedule(scene)
    }

    void run().catch(async (error: unknown) => {
      if (signal.aborted) return
      release(pending)
      pending = null
      clearActive()
      clearTimeout(poll)
      clearTimeout(renewal)
      try {
        if (error instanceof PascalError && error.code === 'unauthorized' && access.kind === 'credential') {
          publish({ kind: 'opening' })
          await rejectCredential(access.credential, error.status!)
          return
        }
        throw error
      } catch (failure) {
        publish(failure instanceof ReopenRequired
          ? { kind: 'reopen', access: failure.access }
          : { kind: 'error', anonymous: access.kind === 'anonymous', error: failure instanceof PascalError
            ? failure : new PascalError('http', String(failure)) })
      }
    })
    return () => {
      controller.abort()
      release(pending)
      clearTimeout(poll)
      clearTimeout(renewal)
    }
  }, [baseUrl, projectId, runtime, source, pollBake, scope, attempt])

  return { state: snapshot.scope === scope ? snapshot.state : { kind: 'loading' }, reload }
}
