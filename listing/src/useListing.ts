import { useCallback, useEffect, useState } from 'react'
import { fetchViewerToken, PASCAL_TOKEN_URL } from './config'
import { fetchGlb, getScene, PascalError, type SceneResponse } from './pascal'
import {
  type Access, credentialReadSucceeded, rejectCredential, renewalDelay, ReopenRequired, resolveAccess,
} from './pascal/access'

export type ListingState =
  | { kind: 'loading' }
  | { kind: 'opening' }
  | { kind: 'reopen'; access: 'session' | 'share' }
  | { kind: 'error'; error: PascalError }
  /** The project is readable but its 3D file is not ready (`bake.status` other than ready). */
  | { kind: 'no-file'; scene: SceneResponse }
  | { kind: 'downloading'; scene: SceneResponse; progress: number | null }
  | { kind: 'ready'; scene: SceneResponse; bytes: ArrayBuffer }

/** While a 3D file is being prepared, look again this often. */
const BAKING_POLL_MS = 30_000

function asPascalError(error: unknown): PascalError {
  return error instanceof PascalError ? error : new PascalError('http', String(error))
}

/** Reads the project, then downloads its best 3D file. `reload` starts over. */
export function useListing(baseUrl: string, projectId: string) {
  const [state, setState] = useState<ListingState>({ kind: 'loading' })
  // A quiet attempt (the baking poll) keeps the current screen instead of flashing a loader.
  const [attempt, setAttempt] = useState({ quiet: false })
  const reload = useCallback(() => setAttempt({ quiet: false }), [])

  useEffect(() => {
    const controller = new AbortController()
    const { signal } = controller
    let poll: ReturnType<typeof setTimeout> | undefined
    let renewal: ReturnType<typeof setTimeout> | undefined
    let access: Access = { kind: 'anonymous' }
    if (!attempt.quiet) setState({ kind: 'loading' })

    const run = async () => {
      // A fresh token each attempt: tokens last an hour at most, and a renewal re-reads.
      let token: string | undefined
      if (PASCAL_TOKEN_URL) {
        token = await fetchViewerToken(projectId, signal)
      } else {
        if (!attempt.quiet) setState({ kind: 'opening' })
        access = await resolveAccess(projectId, baseUrl)
        if (signal.aborted) return
        if (access.kind === 'opening') {
          setState({ kind: 'opening' })
          return
        }
        if (access.kind === 'credential') token = access.credential.access_token
        if (!attempt.quiet) setState({ kind: 'loading' })
      }
      if (signal.aborted) return
      const scene = await getScene(baseUrl, projectId, { signal, token })
      if (signal.aborted) return
      if (access.kind === 'credential') {
        credentialReadSucceeded(access.credential)
        renewal = setTimeout(() => setAttempt({ quiet: true }), renewalDelay(access.credential))
      }
      if (scene.bake.status !== 'ready' || scene.bake.lods.length === 0) {
        setState({ kind: 'no-file', scene })
        if (scene.bake.status === 'baking') {
          poll = setTimeout(() => setAttempt({ quiet: true }), BAKING_POLL_MS)
        }
        return
      }
      setState({ kind: 'downloading', scene, progress: null })
      const glb = await fetchGlb(baseUrl, projectId, scene, {
        signal,
        token,
        onProgress: (loaded, total) =>
          setState({
            kind: 'downloading',
            scene,
            progress: total ? Math.min(1, loaded / total) : null,
          }),
      })
      if (!signal.aborted) setState({ kind: 'ready', scene: glb.scene, bytes: glb.bytes })
    }

    run().catch(async (error: unknown) => {
      if (signal.aborted) return
      clearTimeout(renewal)
      try {
        if (error instanceof PascalError && error.code === 'unauthorized' && access.kind === 'credential') {
          setState({ kind: 'opening' })
          await rejectCredential(access.credential, error.status!)
          return
        }
        throw error
      } catch (failure) {
        if (signal.aborted) return
        setState(failure instanceof ReopenRequired
          ? { kind: 'reopen', access: failure.access }
          : { kind: 'error', error: asPascalError(failure) })
      }
    })
    return () => {
      controller.abort()
      clearTimeout(poll)
      clearTimeout(renewal)
    }
  }, [baseUrl, projectId, attempt])

  return { state, reload }
}
