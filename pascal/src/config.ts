import { callbackProject } from './pascal/handoff'

/** Public build-time settings, consumed by the later project/runtime slices. */
export const PASCAL_BASE_URL = (
  import.meta.env.VITE_PASCAL_BASE_URL || 'https://editor.pascal.app'
).replace(/\/+$/, '')
export const PASCAL_ASSETS_URL = (
  import.meta.env.VITE_PASCAL_ASSETS_URL || PASCAL_BASE_URL
).replace(/\/+$/, '')
export const PASCAL_SOURCE: 'auto' | 'baked' | 'live' =
  import.meta.env.VITE_PASCAL_SOURCE === 'baked' || import.meta.env.VITE_PASCAL_SOURCE === 'live'
    ? import.meta.env.VITE_PASCAL_SOURCE
    : 'auto'
export const PASCAL_PLUGIN_TREES = import.meta.env.VITE_PASCAL_PLUGIN_TREES === '1'
export const PASCAL_POLL_BAKE = import.meta.env.VITE_PASCAL_POLL_BAKE === '1'

/** Query, captured callback, then deployment default, in that order. */
export function projectIdFromLocation(search = window.location.search): string | null {
  return new URLSearchParams(search).get('project')?.trim() ||
    callbackProject(new URL(PASCAL_BASE_URL).origin) ||
    import.meta.env.VITE_PASCAL_PROJECT_ID?.trim() || null
}

/** The hosted viewer's URL flags; "1", "true" and "yes" turn a flag on. */
export function viewerFlagsFromLocation(search = window.location.search) {
  const params = new URLSearchParams(search)
  const on = (name: string) => ['1', 'true', 'yes'].includes(params.get(name) ?? '')
  return {
    embed: on('embed'),
    hideHeader: on('hideHeader'),
    hideBottomBar: on('hideBottomBar'),
    /** `px,py,pz,tx,ty,tz[,fov]` or `saved`; anything else opens on the default view. */
    camera: params.get('camera'),
  }
}
