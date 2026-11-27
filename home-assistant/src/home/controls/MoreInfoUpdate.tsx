/* Ported from home-assistant/frontend (Apache-2.0):
   - src/dialogs/more-info/controls/more-info-update.ts
   - src/data/update.ts */

import { useEffect, useState } from 'react'
import type { HassEntity } from '../entities'
import { useHass } from '../hass/connection'
import type { EntityFormatters } from '../hass/names'
import { type ServiceCallFn, supportsFeature, UNAVAILABLE, UNKNOWN } from './stateColors'
import { StateHeader } from './StateHeader'

export const UpdateEntityFeature = {
  INSTALL: 1,
  SPECIFIC_VERSION: 2,
  PROGRESS: 4,
  BACKUP: 8,
  RELEASE_NOTES: 16,
} as const

type ReleaseNotesResponse = {
  release_notes?: string | null
  messages?: { severity?: string; message: string }[]
}

function sanitizeHttpUrl(raw: unknown): string | undefined {
  if (typeof raw !== 'string' || !raw.trim()) return undefined
  try {
    const url = new URL(raw)
    if (url.protocol === 'http:' || url.protocol === 'https:') return url.toString()
  } catch {
    return undefined
  }
  return undefined
}

export type MoreInfoUpdateProps = {
  entity: HassEntity
  call: ServiceCallFn
  formatters: EntityFormatters
}

export function MoreInfoUpdate({ entity, call, formatters }: MoreInfoUpdateProps) {
  const connection = useHass((s) => s.connection)
  const language = useHass((s) => s.language)
  const [createBackup, setCreateBackup] = useState(false)
  const [releaseNotes, setReleaseNotes] = useState<string | null | undefined>(undefined)

  const supportsReleaseNotes = supportsFeature(entity, UpdateEntityFeature.RELEASE_NOTES)

  useEffect(() => {
    if (!connection || !supportsReleaseNotes) {
      setReleaseNotes(undefined)
      return
    }
    let cancelled = false
    connection
      .sendMessagePromise<ReleaseNotesResponse | string | null>({
        type: 'update/release_notes',
        entity_id: entity.entity_id,
        language,
      })
      .then((res) => {
        if (cancelled) return
        if (typeof res === 'string') setReleaseNotes(res)
        else setReleaseNotes(res?.release_notes ?? null)
      })
      .catch(() => {
        if (!cancelled) setReleaseNotes(null)
      })
    return () => {
      cancelled = true
    }
  }, [connection, entity.entity_id, language, supportsReleaseNotes])

  if (entity.state === UNAVAILABLE || entity.state === UNKNOWN) {
    return <StateHeader entity={entity} formatters={formatters} />
  }

  const a = entity.attributes
  const inProgress = Boolean(a.in_progress)
  const supportsInstall = supportsFeature(entity, UpdateEntityFeature.INSTALL)
  const supportsSpecific = supportsFeature(entity, UpdateEntityFeature.SPECIFIC_VERSION)
  const supportsProgress = supportsFeature(entity, UpdateEntityFeature.PROGRESS)
  const supportsBackup = supportsFeature(entity, UpdateEntityFeature.BACKUP)

  const installedVersion =
    typeof a.installed_version === 'string' && a.installed_version
      ? a.installed_version
      : formatters.localize('state.default.unavailable') || 'Unavailable'
  const latestVersion =
    typeof a.latest_version === 'string' && a.latest_version
      ? a.latest_version
      : formatters.localize('state.default.unavailable') || 'Unavailable'
  const skippedVersion = typeof a.skipped_version === 'string' ? a.skipped_version : null
  const latestVersionIsSkipped = Boolean(
    a.latest_version && skippedVersion && skippedVersion === a.latest_version,
  )
  const updatePercentage =
    typeof a.update_percentage === 'number' ? Math.max(0, Math.min(100, a.update_percentage)) : null

  const releaseUrl = sanitizeHttpUrl(a.release_url)
  const notesText =
    (typeof releaseNotes === 'string' && releaseNotes.trim() ? releaseNotes : undefined) ??
    (typeof a.release_summary === 'string' && a.release_summary.trim()
      ? a.release_summary
      : undefined)

  const updateButtonDisabled =
    (entity.state === 'off' && !latestVersionIsSkipped) || inProgress
  const skipButtonDisabled =
    latestVersionIsSkipped || entity.state === 'off' || inProgress

  const handleInstall = () => {
    const data: Record<string, unknown> & { entity_id: string } = {
      entity_id: entity.entity_id,
    }
    if (supportsBackup && createBackup) data.backup = true
    if (supportsSpecific && typeof a.latest_version === 'string' && a.latest_version) {
      data.version = a.latest_version
    }
    void call('update', 'install', data)
  }

  return (
    <div className="flex flex-col gap-3">
      {inProgress && (
        <div className="h-2 w-full overflow-hidden rounded-full bg-foreground/10">
          {supportsProgress && updatePercentage !== null ? (
            <div
              className="h-full rounded-full bg-[#009ac7] transition-[width] duration-300"
              style={{ width: `${updatePercentage}%` }}
            />
          ) : (
            <div className="h-full w-1/2 animate-pulse rounded-full bg-[#009ac7]" />
          )}
        </div>
      )}

      {typeof a.title === 'string' && a.title && (
        <h4 className="m-0 text-base font-medium text-foreground">{a.title}</h4>
      )}

      <div className="grid gap-1.5 text-sm">
        <div className="flex items-center justify-between gap-2">
          <span className="text-muted-foreground">
            {formatters.formatEntityAttributeName(entity, 'installed_version')}
          </span>
          <span className="font-mono text-foreground">{installedVersion}</span>
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="text-muted-foreground">
            {formatters.formatEntityAttributeName(entity, 'latest_version')}
          </span>
          <span className="font-mono text-foreground">{latestVersion}</span>
        </div>
        {releaseUrl && (
          <a
            href={releaseUrl}
            target="_blank"
            rel="noreferrer"
            className="text-xs text-[#009ac7] underline decoration-[#009ac7]/40 hover:decoration-[#009ac7]"
          >
            {formatters.localize('ui.dialogs.more_info_control.update.release_announcement') ||
              'Release announcement'}
          </a>
        )}
      </div>

      {notesText && (
        <div className="ui-scroll max-h-40 overflow-y-auto border-t border-border/60 pt-2.5 text-xs leading-relaxed whitespace-pre-wrap text-muted-foreground">
          {notesText}
        </div>
      )}

      {supportsBackup && entity.state === 'on' && !inProgress && (
        <label className="flex cursor-pointer items-center gap-2 text-xs text-foreground">
          <input
            type="checkbox"
            checked={createBackup}
            onChange={(ev) => setCreateBackup(ev.target.checked)}
            className="size-4 accent-[#009ac7]"
          />
          <span>
            {formatters.localize('ui.dialogs.more_info_control.update.create_backup') ||
              'Create backup before updating'}
          </span>
        </label>
      )}

      <div className="flex items-center justify-end gap-2 border-t border-border/60 pt-2">
        {entity.state === 'off' && skippedVersion ? (
          <button
            type="button"
            onClick={() => void call('update', 'clear_skipped', { entity_id: entity.entity_id })}
            className="cursor-pointer rounded-full px-3 py-1.5 text-sm font-medium text-[#009ac7] transition-colors hover:bg-foreground/5"
          >
            {formatters.localize('ui.dialogs.more_info_control.update.clear_skipped') ||
              'Clear skipped'}
          </button>
        ) : (
          <button
            type="button"
            disabled={skipButtonDisabled}
            onClick={() => void call('update', 'skip', { entity_id: entity.entity_id })}
            className="cursor-pointer rounded-full px-3 py-1.5 text-sm font-medium text-foreground transition-colors hover:bg-foreground/5 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {formatters.localize('ui.dialogs.more_info_control.update.skip') || 'Skip'}
          </button>
        )}

        {supportsInstall && (
          <button
            type="button"
            disabled={updateButtonDisabled}
            onClick={handleInstall}
            className="cursor-pointer rounded-full bg-[#009ac7] px-4 py-1.5 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {formatters.localize('ui.dialogs.more_info_control.update.update') || 'Update'}
          </button>
        )}
      </div>
    </div>
  )
}
