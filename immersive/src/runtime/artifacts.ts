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

const RATE_LIMIT_RETRIES = 3

/** Resolves after `ms`, or rejects as the signal's abort does. */
function wait(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const abort = () => { clearTimeout(timer); reject(signal!.reason) }
    const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve() }, ms)
    signal?.addEventListener('abort', abort, { once: true })
  })
}

/**
 * One private artifact. Pascal budgets these reads per visitor address, and a scene asks for
 * every file it references at once, so a heavy project (or a second open within the minute)
 * can be told to wait: `429` with `Retry-After`. Wait and ask again, rather than failing the
 * whole project over a file that is only late.
 */
async function readArtifact(url: string, token: string, signal?: AbortSignal): Promise<Blob> {
  for (let attempt = 0; ; attempt++) {
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` }, credentials: 'omit', signal,
    })
    if (response.status === 429 && attempt < RATE_LIMIT_RETRIES) {
      const seconds = Number(response.headers.get('Retry-After'))
      // The header is absent when Pascal's CORS does not expose it; its window is a minute.
      await wait(Math.min(seconds > 0 ? seconds : 5, 90) * 1000 + 250, signal)
      continue
    }
    if (!response.ok) throw new PascalError(response.status === 401 ? 'unauthorized' : 'http', `Artifact read failed (${response.status})`, response.status)
    return response.blob()
  }
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
    const artifacts = await Promise.all(referencedArtifactHashes(graph).map(async (hash) =>
      [hash, await readArtifact(`${base}/${hash}`, token, signal)] as const,
    ))
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
