import { callbackProject } from './pascal/handoff'

/** Where the viewer reads from. Both are public values; no secret belongs here. */
export const PASCAL_BASE_URL = (
  import.meta.env.VITE_PASCAL_BASE_URL || 'https://editor.pascal.app'
).replace(/\/+$/, '')

/**
 * Optional: your own endpoint that returns `{ token }` for `?project=<id>` after your
 * own login check. When set, this takes precedence over the Pascal handoff.
 */
export const PASCAL_TOKEN_URL = import.meta.env.VITE_PASCAL_TOKEN_URL?.trim() || null

/** Asks your token endpoint for a viewer token; it sends your site's own cookies. */
export async function fetchViewerToken(projectId: string, signal: AbortSignal): Promise<string> {
  const url = new URL(PASCAL_TOKEN_URL!, window.location.href)
  url.searchParams.set('project', projectId)
  const response = await fetch(url, { signal, credentials: 'include' })
  const body = (await response.json().catch(() => null)) as { token?: unknown } | null
  if (!response.ok || typeof body?.token !== 'string') {
    throw new Error(`Your token endpoint answered ${response.status}`)
  }
  return body.token
}

/** `?project=<id>` wins, so one deployment can show any public project. */
export function projectIdFromLocation(search = window.location.search): string | null {
  const fromQuery = new URLSearchParams(search).get('project')?.trim()
  return fromQuery || (!PASCAL_TOKEN_URL && callbackProject(new URL(PASCAL_BASE_URL).origin)) ||
    import.meta.env.VITE_PASCAL_PROJECT_ID?.trim() || null
}
