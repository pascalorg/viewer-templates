import { artifactHash, type ArtifactStore } from '@pascal-app/core'
import { PascalError } from '../pascal/client'

export type ProjectArtifactOptions = {
  baseUrl: string
  projectId: string
  graph: unknown
  token?: string
  signal?: AbortSignal
}

/** Visit nested item/script/texture fields; deduplicate content hashes. */
export function referencedArtifactHashes(graph: unknown): string[] {
  const hashes = new Set<string>()
  const seen = new Set<object>()
  const visit = (value: unknown) => {
    if (typeof value === 'string') {
      const hash = artifactHash(value)
      if (hash) hashes.add(hash)
    } else if (value && typeof value === 'object' && !seen.has(value)) {
      seen.add(value)
      for (const child of Object.values(value)) visit(child)
    }
  }
  visit(graph)
  return [...hashes]
}

/**
 * Anonymous loaders follow the public route's signed redirect. Private loaders cannot
 * add headers, so fetch their referenced artifacts before mount and serve blob URLs.
 * Native fetch strips Authorization at the cross-origin storage redirect.
 */
export async function createProjectArtifactStore({ baseUrl, projectId, graph, token, signal }: ProjectArtifactOptions): Promise<{ store: ArtifactStore; dispose: () => void }> {
  const base = `${baseUrl.replace(/\/+$/, '')}/api/projects/${encodeURIComponent(projectId)}/artifacts`
  const local = new Map<string, string>()
  let disposed = false
  signal?.throwIfAborted()
  if (token) {
    // Allocate URLs only after all fetches succeed, so failures cannot leak blob URLs.
    const artifacts = await Promise.all(referencedArtifactHashes(graph).map(async (hash) => {
      const response = await fetch(`${base}/${hash}`, {
        headers: { Authorization: `Bearer ${token}` }, credentials: 'omit', signal,
      })
      if (!response.ok) throw new PascalError(response.status === 401 ? 'unauthorized' : 'http', `Artifact read failed (${response.status})`, response.status)
      return [hash, await response.blob()] as const
    }))
    signal?.throwIfAborted()
    for (const [hash, blob] of artifacts) local.set(hash, URL.createObjectURL(blob))
  }
  return {
    store: {
      url: (hash) => {
        if (disposed || !/^[0-9a-f]{64}$/.test(hash)) return null
        return token ? local.get(hash) ?? null : `${base}/${hash}`
      },
      put: async () => { throw new Error('The viewer artifact store is read-only') },
      // Authored script text is editor-only; viewers consume the compiled artifact.
      text: async () => null,
    },
    dispose: () => {
      disposed = true
      for (const url of local.values()) URL.revokeObjectURL(url)
      local.clear()
    },
  }
}
