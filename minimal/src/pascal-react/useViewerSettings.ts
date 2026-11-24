import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { customizeHinted, customizeRefused, enterCustomize, saveSettings, type ViewerSettings, ViewerSettingsError } from '../pascal'
import { handoffNavigating } from '../pascal/handoff'
import { rememberPanelOpen } from './panelState'

export type SettingsStatus = 'idle' | 'saving' | 'saved' | 'conflict' | 'expired' | 'error'

export type ViewerSettingsOptions<T> = {
  /** `scene.settings` from the read (null or absent when Pascal sent none). */
  settings: ViewerSettings | null | undefined
  /** The credential the scene was read with; only a configure credential can save. */
  token: string | undefined
  baseUrl: string
  projectId: string
  /** Turns saved `data` (any JSON object, possibly another build's) into this template's settings. */
  parse: (data: unknown) => T
  /** What the template does with nothing saved. */
  defaults: T
}

export type ViewerSettingsHandle<T> = {
  /** What to present: the unsaved draft for a manager, the saved settings for everyone else. */
  value: T
  /** What visitors get now. */
  saved: T
  /** This visitor is in Customize mode (a configure credential): they may change and save. */
  canConfigure: boolean
  /**
   * Offer Customize: the visitor is in it, or may enter it (the read's `configureAvailable` or the
   * entry's `configure=available` hint), and Pascal has not refused it in this tab.
   */
  available: boolean
  /** Enters Customize: leaves for Pascal and comes back in configure mode (or, refused, where it was). */
  enter(): Promise<void>
  /** `enter` is on its way to Pascal. */
  entering: boolean
  /** `enter` could not start (this page is not a registered viewer, or the address is not one Pascal makes). */
  enterError: Error | null
  /** A draft differs from what is saved. */
  dirty: boolean
  status: SettingsStatus
  /** The last save's failure, for `error`, `conflict` and `expired`. */
  error: ViewerSettingsError | null
  /** Changes the draft. Managers only; for anyone else it does nothing. */
  set(update: T | ((current: T) => T)): void
  save(): Promise<void>
  discard(): void
  /** After a conflict: drop the draft and take what the other manager saved. */
  reloadLatest(): void
}

type Base = { viewerId: string; revision: number; data: unknown }
type Draft<T> = { revision: number; value: T }

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

/** Drafts live in the tab, per Pascal issuer, viewer, project and page origin, like credentials. */
function draftKey(baseUrl: string, viewerId: string, projectId: string) {
  return `pascal:settings-draft:${JSON.stringify([new URL(baseUrl).origin, viewerId, projectId, location.origin])}`
}

function readDraft<T>(key: string, parse: (data: unknown) => T): Draft<T> | null {
  try {
    const stored = JSON.parse(sessionStorage.getItem(key) || 'null') as { revision?: unknown; data?: unknown } | null
    if (!stored || !Number.isInteger(stored.revision) || (stored.revision as number) < 0) return null
    return { revision: stored.revision as number, value: parse(stored.data) }
  } catch {
    return null
  }
}

function writeDraft<T>(key: string | null, draft: Draft<T> | null) {
  if (!key) return
  try {
    if (draft) sessionStorage.setItem(key, JSON.stringify({ revision: draft.revision, data: draft.value }))
    else sessionStorage.removeItem(key)
  } catch {
    // Storage denied or full: the draft lasts as long as the page.
  }
}

/**
 * A template's settings for this project and viewer. Everyone gets the saved value; a manager who
 * opened the viewer with Customize edits a draft that survives a reload and the credential's renewal
 * round trip, and saves it for every later visitor.
 */
export function useViewerSettings<T>({ settings, token, baseUrl, projectId, parse, defaults }: ViewerSettingsOptions<T>): ViewerSettingsHandle<T> {
  const parseRef = useRef(parse)
  parseRef.current = parse
  const defaultsRef = useRef(defaults)
  defaultsRef.current = defaults
  const read = useCallback((data: unknown): T => (data === null || data === undefined ? defaultsRef.current : parseRef.current(data)), [])

  const canConfigure = settings?.canConfigure === true
  // The entry's hint is read once: the address changes on the way in, not while the page is open.
  const [hinted] = useState(() => customizeHinted(projectId, baseUrl))
  const available = canConfigure ||
    ((settings?.configureAvailable === true || hinted) && !customizeRefused(projectId, baseUrl))
  const [entering, setEntering] = useState(false)
  const [enterError, setEnterError] = useState<Error | null>(null)
  const viewerId = settings?.viewerId ?? null
  const key = useMemo(() => (viewerId ? draftKey(baseUrl, viewerId, projectId) : null), [baseUrl, viewerId, projectId])

  const [base, setBase] = useState<Base | null>(() => settings ? { viewerId: settings.viewerId, revision: settings.revision, data: settings.data } : null)
  const [draft, setDraftState] = useState<Draft<T> | null>(() => (canConfigure && key ? readDraft(key, read) : null))
  const [status, setStatus] = useState<SettingsStatus>('idle')
  const [error, setError] = useState<ViewerSettingsError | null>(null)
  const latest = useRef<ViewerSettings | null>(null)
  const draftRef = useRef(draft)
  draftRef.current = draft
  const inFlight = useRef<AbortController | null>(null)

  // A later read (a poll, a renewal) may bring a newer revision: take it.
  if (settings && (!base || base.viewerId !== settings.viewerId || settings.revision > base.revision)) {
    setBase({ viewerId: settings.viewerId, revision: settings.revision, data: settings.data })
  }

  const saved = useMemo(() => read(base?.data), [base, read])
  const value = canConfigure && draft ? draft.value : saved
  const dirty = canConfigure && draft !== null

  const setDraft = useCallback((next: Draft<T> | null) => {
    draftRef.current = next
    setDraftState(next)
    writeDraft(key, next)
  }, [key])

  useEffect(() => () => inFlight.current?.abort(), [])

  // Closing the tab loses the draft; reloading keeps it, but the browser cannot tell them apart.
  // Leaving for Pascal's authorize page (credential renewal) keeps it too, so it never asks then.
  useEffect(() => {
    if (!dirty) return
    const warn = (event: BeforeUnloadEvent) => {
      if (handoffNavigating()) return
      event.preventDefault()
      event.returnValue = ''
    }
    addEventListener('beforeunload', warn)
    return () => removeEventListener('beforeunload', warn)
  }, [dirty])

  const set = useCallback((update: T | ((current: T) => T)) => {
    if (!canConfigure) return
    const current = draftRef.current?.value ?? saved
    const next = typeof update === 'function' ? (update as (current: T) => T)(current) : update
    setDraft(same(next, saved) ? null : { revision: draftRef.current?.revision ?? base?.revision ?? 0, value: next })
    setStatus((previous) => (previous === 'saved' || previous === 'error' ? 'idle' : previous))
  }, [canConfigure, saved, base, setDraft])

  const save = useCallback(async () => {
    const pending = draftRef.current
    if (!canConfigure || !pending || inFlight.current) return
    if (!token) {
      setStatus('expired')
      return
    }
    const controller = new AbortController()
    inFlight.current = controller
    setStatus('saving')
    setError(null)
    try {
      const result = await saveSettings(baseUrl, projectId, {
        token, revision: pending.revision, data: pending.value as Record<string, unknown>, signal: controller.signal,
      })
      if (controller.signal.aborted) return
      setBase({ viewerId: result.viewerId, revision: result.revision, data: result.data })
      // Changed again while saving: keep the newer draft, now based on this save.
      const now = draftRef.current
      setDraft(now && !same(now.value, pending.value) ? { revision: result.revision, value: now.value } : null)
      setStatus('saved')
    } catch (failure) {
      if (controller.signal.aborted) return
      const known = failure instanceof ViewerSettingsError ? failure : new ViewerSettingsError('http', String(failure))
      setError(known)
      if (known.code === 'conflict') latest.current = known.current
      setStatus(known.code === 'conflict' ? 'conflict' : known.code === 'unauthorized' ? 'expired' : 'error')
    } finally {
      if (inFlight.current === controller) inFlight.current = null
    }
  }, [canConfigure, token, baseUrl, projectId, setDraft])

  const discard = useCallback(() => {
    setDraft(null)
    setStatus((previous) => (previous === 'expired' ? previous : 'idle'))
    setError((previous) => (previous?.code === 'unauthorized' ? previous : null))
  }, [setDraft])

  const reloadLatest = useCallback(() => {
    const current = latest.current
    latest.current = null
    if (current) setBase({ viewerId: current.viewerId, revision: current.revision, data: current.data })
    setDraft(null)
    setStatus('idle')
    setError(null)
  }, [setDraft])

  const enter = useCallback(async () => {
    if (canConfigure || entering) return
    setEntering(true)
    setEnterError(null)
    // Back in configure mode, the panel opens.
    rememberPanelOpen(true)
    try {
      await enterCustomize(projectId, baseUrl)
    } catch (failure) {
      setEntering(false)
      setEnterError(failure instanceof Error ? failure : new Error(String(failure)))
    }
  }, [canConfigure, entering, projectId, baseUrl])

  return { value, saved, canConfigure, available, enter, entering, enterError, dirty, status, error, set, save, discard, reloadLatest }
}
