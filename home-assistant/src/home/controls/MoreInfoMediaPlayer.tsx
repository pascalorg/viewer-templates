/* Ported from home-assistant/frontend (Apache-2.0):
   - src/dialogs/more-info/controls/more-info-media_player.ts
   - src/common/controllers/media-progress-controller.ts
   - src/common/util/volume-slider.ts */

import {
  mdiCheck,
  mdiLoginVariant,
  mdiMusicNote,
  mdiMusicNoteEighth,
  mdiVolumeHigh,
  mdiVolumeMinus,
  mdiVolumeOff,
  mdiVolumePlus,
} from '@mdi/js'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { HassEntity } from '../entities'
import { useHass } from '../hass/connection'
import type { EntityFormatters } from '../hass/names'
import { ControlSlider } from './ControlSlider'
import {
  cleanupMediaTitle,
  computeMediaControls,
  computeMediaDescription,
  formatMediaTime,
  getCurrentProgress,
  handleMediaControlClick,
  MediaPlayerEntityFeature,
  removeSecondaryStopControl,
  resolveHassMediaUrl,
} from './mediaPlayer'
import { MdiIcon } from './MdiIcon'
import { createDebounce } from './pendingSync'
import {
  HA_COLORS,
  type ServiceCallFn,
  stateActive,
  supportsFeature,
  UNAVAILABLE,
} from './stateColors'

const PENDING_SEEK_TIMEOUT_MS = 5000
const PENDING_SEEK_TOLERANCE_S = 2
const PROGRESS_INTERVAL_MS = 1000
const VOLUME_STEP = 2

type MediaActionDropdownProps = {
  icon: string
  label: string
  value?: string
  options: { value: string; label: string }[]
  onSelect: (value: string) => void
}

function MediaActionDropdown({ icon, label, value, options, onSelect }: MediaActionDropdownProps) {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onPointerDown = (ev: PointerEvent) => {
      if (containerRef.current && !containerRef.current.contains(ev.target as Node)) {
        setOpen(false)
      }
    }
    const onKeyDown = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') {
        ev.stopPropagation()
        setOpen(false)
      }
    }
    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        aria-label={label}
        title={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="grid size-10 cursor-pointer place-items-center rounded-full bg-foreground/8 text-foreground transition-colors hover:bg-foreground/15 focus-visible:outline-2 focus-visible:outline-ring"
      >
        <MdiIcon path={icon} size={20} />
      </button>
      {open && (
        <div
          role="listbox"
          aria-label={label}
          className="ui-scroll absolute right-0 bottom-[calc(100%+6px)] z-30 max-h-52 min-w-44 overflow-y-auto rounded-xl border border-border bg-background/95 p-1 shadow-lg backdrop-blur"
        >
          {options.map((opt) => {
            const selected = opt.value === value
            return (
              <button
                key={opt.value}
                type="button"
                role="option"
                aria-selected={selected}
                onClick={() => {
                  setOpen(false)
                  onSelect(opt.value)
                }}
                className={`flex w-full cursor-pointer items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm transition-colors ${
                  selected
                    ? 'bg-foreground/10 font-medium text-foreground'
                    : 'text-foreground/85 hover:bg-foreground/5'
                }`}
              >
                <span className="truncate">{opt.label}</span>
                {selected && <MdiIcon path={mdiCheck} size={16} className="shrink-0" />}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

export type MoreInfoMediaPlayerProps = {
  entity: HassEntity
  call: ServiceCallFn
  formatters: EntityFormatters
}

export function MoreInfoMediaPlayer({ entity, call, formatters }: MoreInfoMediaPlayerProps) {
  const hassUrl = useHass((s) => s.hassUrl)
  const [failedCoverUrl, setFailedCoverUrl] = useState<string | null>(null)
  const [draggingSeek, setDraggingSeek] = useState<number | undefined>(undefined)
  const [, setTick] = useState(0)

  const pendingSeekRef = useRef<{ position: number; since: number } | null>(null)
  const entityRef = useRef(entity)
  entityRef.current = entity
  const callRef = useRef(call)
  callRef.current = call
  const lastEntityIdRef = useRef(entity.entity_id)

  if (lastEntityIdRef.current !== entity.entity_id) {
    lastEntityIdRef.current = entity.entity_id
    pendingSeekRef.current = null
  }

  const sendVolume = useCallback((value: number) => {
    void callRef.current('media_player', 'volume_set', {
      entity_id: entityRef.current.entity_id,
      volume_level: Math.max(0, Math.min(1, value / 100)),
    })
  }, [])

  const debouncedVolumeSet = useMemo(() => createDebounce(sendVolume, 100), [sendVolume])
  useEffect(() => () => debouncedVolumeSet.cancel(), [debouncedVolumeSet])

  const a = entity.attributes
  const duration = Math.max(typeof a.media_duration === 'number' ? a.media_duration : 0, 0)
  const hasPosition = typeof a.media_position === 'number' && duration > 0

  useEffect(() => {
    if (entity.state !== 'playing' || !hasPosition) return
    const id = window.setInterval(() => setTick((t) => (t + 1) % 100000), PROGRESS_INTERVAL_MS)
    return () => window.clearInterval(id)
  }, [entity.state, hasPosition])

  if (entity.state === UNAVAILABLE) {
    const unavailText = formatters.formatEntityState(entity)
    return (
      <div className="flex w-full items-center justify-center py-2">
        <div
          role="img"
          aria-label={unavailText}
          className="flex size-48 items-center justify-center rounded-xl bg-foreground/8 text-lg text-muted-foreground shadow-sm"
        >
          {unavailText}
        </div>
      </div>
    )
  }

  const computeProgress = (): number => {
    if (!hasPosition) return 0
    const current = Math.min(getCurrentProgress(entity), duration)
    const pending = pendingSeekRef.current
    if (!pending) return current
    const elapsedMs = Date.now() - pending.since
    const target = Math.min(
      pending.position + (entity.state === 'playing' ? elapsedMs / 1000 : 0),
      duration,
    )
    if (
      elapsedMs > PENDING_SEEK_TIMEOUT_MS ||
      Math.abs(current - target) <= PENDING_SEEK_TOLERANCE_S
    ) {
      pendingSeekRef.current = null
      return current
    }
    return target
  }

  const progress = computeProgress()
  const shownPosition = Math.max(Math.floor(draggingSeek ?? progress), 0)

  const controls = computeMediaControls(entity, true)
  const coverUrlRaw = a.entity_picture_local || a.entity_picture
  const coverUrl = resolveHassMediaUrl(coverUrlRaw, hassUrl)
  const showCoverImage = Boolean(coverUrl) && failedCoverUrl !== coverUrl

  const primaryTitle = cleanupMediaTitle(a.media_title)
  const secondaryTitle = computeMediaDescription(entity)
  const turnOn = controls?.find((c) => c.action === 'turn_on')
  const turnOff = controls?.find((c) => c.action === 'turn_off')
  const mainControls = removeSecondaryStopControl(entity, controls)
  const stop = controls?.find((c) => c.action === 'media_stop')
  const secondaryStop = Boolean(stop && !mainControls?.includes(stop))

  const active = stateActive(entity)
  const assumedState = a.assumed_state === true
  const isPlaying = entity.state === 'playing'
  const labArt = Array.isArray(a._art) ? (a._art as string[]) : undefined

  const supportsMute = supportsFeature(entity, MediaPlayerEntityFeature.VOLUME_MUTE)
  const supportsSliding = supportsFeature(entity, MediaPlayerEntityFeature.VOLUME_SET)
  const supportsStep = supportsFeature(entity, MediaPlayerEntityFeature.VOLUME_STEP)
  const showVolume = (supportsSliding || supportsStep) && (active || assumedState)
  const isMuted = a.is_volume_muted === true
  const volumePct =
    typeof a.volume_level === 'number' ? Math.round(a.volume_level * 100) : 0

  const supportsSource = supportsFeature(entity, MediaPlayerEntityFeature.SELECT_SOURCE)
  const sourceList = Array.isArray(a.source_list) ? (a.source_list as string[]) : []
  const supportsSoundMode = supportsFeature(entity, MediaPlayerEntityFeature.SELECT_SOUND_MODE)
  const soundModeList = Array.isArray(a.sound_mode_list) ? (a.sound_mode_list as string[]) : []

  const hasControlsRow =
    secondaryStop ||
    (supportsSource && sourceList.length > 0) ||
    (supportsSoundMode && soundModeList.length > 0) ||
    Boolean(turnOn) ||
    Boolean(turnOff)

  const actionLabel = (action: string) =>
    formatters.localize(`ui.card.media_player.${action}`) || action.replace(/_/g, ' ')

  return (
    <div className="flex flex-col gap-5">
      {/* Cover artwork */}
      <div className="flex h-[220px] w-full items-center justify-center">
        {showCoverImage ? (
          <img
            src={coverUrl}
            alt={primaryTitle ?? ''}
            referrerPolicy="no-referrer"
            onError={() => setFailedCoverUrl(coverUrl)}
            className={`max-h-full max-w-full rounded-xl object-cover shadow-md transition-[width,height] duration-300 ${
              isPlaying ? 'size-[216px]' : 'size-[180px]'
            }`}
          />
        ) : (
          <div
            role="img"
            aria-label={formatters.formatEntityState(entity)}
            className={`flex items-center justify-center rounded-xl shadow-sm transition-[width,height] duration-300 ${
              isPlaying ? 'size-[216px]' : 'size-[180px]'
            } ${labArt && active ? 'text-white/90' : 'bg-foreground/8 text-muted-foreground'}`}
            style={
              labArt && active
                ? { background: `linear-gradient(135deg, ${labArt.join(', ')})` }
                : undefined
            }
          >
            <MdiIcon path={mdiMusicNote} size={44} />
          </div>
        )}
      </div>

      {/* Media title & description */}
      {(primaryTitle || secondaryTitle) && (
        <div className="flex min-w-0 flex-col gap-0.5 px-1">
          {primaryTitle && (
            <p
              title={primaryTitle}
              className="m-0 truncate text-lg leading-snug font-bold text-foreground"
            >
              {primaryTitle}
            </p>
          )}
          {secondaryTitle && (
            <p
              title={secondaryTitle}
              className="m-0 truncate text-sm leading-snug text-muted-foreground"
            >
              {secondaryTitle}
            </p>
          )}
        </div>
      )}

      {/* Position / seek bar */}
      {duration > 0 && (
        <div className="flex flex-col gap-1.5" dir="ltr">
          <ControlSlider
            value={Math.min(progress, duration)}
            min={0}
            max={duration}
            step={1}
            thickness={8}
            borderRadius={9999}
            showHandle
            color={HA_COLORS.primary}
            tooltipMode="never"
            disabled={!active || !supportsFeature(entity, MediaPlayerEntityFeature.SEEK)}
            label={
              formatters.localize('ui.card.media_player.track_position') || 'Track position'
            }
            onSliderMoved={(v) => setDraggingSeek(v)}
            onValueChanged={(v) => {
              setDraggingSeek(undefined)
              pendingSeekRef.current = { position: v, since: Date.now() }
              setTick((t) => (t + 1) % 100000)
              void call('media_player', 'media_seek', {
                entity_id: entity.entity_id,
                seek_position: v,
              })
            }}
          />
          <div className="flex items-center justify-between font-mono text-xs text-muted-foreground">
            <span>{formatMediaTime(shownPosition)}</span>
            <span>{formatMediaTime(duration)}</span>
          </div>
        </div>
      )}

      {/* Bottom controls */}
      <div className="flex w-full flex-col gap-5">
        {/* Main 5-column transport bar */}
        {controls && controls.length > 0 && (
          <div className="flex items-center justify-between" dir="ltr">
            {(['repeat_set', 'media_previous_track'] as const).map((action) => {
              const control = controls.find((c) => c.action === action)
              return control ? (
                <button
                  key={action}
                  type="button"
                  aria-label={actionLabel(control.action)}
                  title={actionLabel(control.action)}
                  onClick={() => void handleMediaControlClick(call, entity, control.action)}
                  className="grid size-10 cursor-pointer place-items-center rounded-full text-foreground/85 transition-colors hover:bg-foreground/10 hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
                >
                  <MdiIcon path={control.icon} size={22} />
                </button>
              ) : (
                <span key={action} className="size-10" aria-hidden="true" />
              )
            })}

            <div className="flex items-center justify-center gap-2">
              {(['media_play_pause', 'media_pause', 'media_play', 'media_stop'] as const).map(
                (action) => {
                  const control = mainControls?.find((c) => c.action === action)
                  if (!control) return null
                  return (
                    <button
                      key={action}
                      type="button"
                      aria-label={actionLabel(control.action)}
                      title={actionLabel(control.action)}
                      onClick={() => void handleMediaControlClick(call, entity, control.action)}
                      className="grid h-14 min-w-14 cursor-pointer place-items-center rounded-full bg-[#009ac7] px-4 text-white shadow-sm transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                    >
                      <MdiIcon path={control.icon} size={26} />
                    </button>
                  )
                },
              )}
            </div>

            {(['media_next_track', 'shuffle_set'] as const).map((action) => {
              const control = controls.find((c) => c.action === action)
              return control ? (
                <button
                  key={action}
                  type="button"
                  aria-label={actionLabel(control.action)}
                  title={actionLabel(control.action)}
                  onClick={() => void handleMediaControlClick(call, entity, control.action)}
                  className="grid size-10 cursor-pointer place-items-center rounded-full text-foreground/85 transition-colors hover:bg-foreground/10 hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
                >
                  <MdiIcon path={control.icon} size={22} />
                </button>
              ) : (
                <span key={action} className="size-10" aria-hidden="true" />
              )
            })}
          </div>
        )}

        {/* Volume row */}
        {showVolume && (
          <div className="flex items-center justify-center gap-3 px-1" dir="ltr">
            {supportsMute && (
              <button
                type="button"
                aria-label={actionLabel(isMuted ? 'media_volume_unmute' : 'media_volume_mute')}
                title={actionLabel(isMuted ? 'media_volume_unmute' : 'media_volume_mute')}
                onClick={() =>
                  void call('media_player', 'volume_mute', {
                    entity_id: entity.entity_id,
                    is_volume_muted: !isMuted,
                  })
                }
                className="grid size-8 shrink-0 cursor-pointer place-items-center rounded-full text-foreground/85 transition-colors hover:bg-foreground/10 hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
              >
                <MdiIcon path={isMuted ? mdiVolumeOff : mdiVolumeHigh} size={18} />
              </button>
            )}

            {supportsStep && !supportsSliding && (
              <>
                <button
                  type="button"
                  aria-label={actionLabel('media_volume_down')}
                  title={actionLabel('media_volume_down')}
                  onClick={() => void handleMediaControlClick(call, entity, 'volume_down')}
                  className="grid size-8 cursor-pointer place-items-center rounded-full text-foreground/85 transition-colors hover:bg-foreground/10 hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
                >
                  <MdiIcon path={mdiVolumeMinus} size={18} />
                </button>
                <button
                  type="button"
                  aria-label={actionLabel('media_volume_up')}
                  title={actionLabel('media_volume_up')}
                  onClick={() => void handleMediaControlClick(call, entity, 'volume_up')}
                  className="grid size-8 cursor-pointer place-items-center rounded-full text-foreground/85 transition-colors hover:bg-foreground/10 hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
                >
                  <MdiIcon path={mdiVolumePlus} size={18} />
                </button>
              </>
            )}

            {supportsSliding && (
              <>
                {!supportsMute && (
                  <span className="grid size-8 shrink-0 place-items-center text-muted-foreground">
                    <MdiIcon path={mdiVolumeHigh} size={18} />
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <ControlSlider
                    value={volumePct}
                    min={0}
                    max={100}
                    step={VOLUME_STEP}
                    roundValue
                    thickness={10}
                    borderRadius={9999}
                    showHandle
                    unit="%"
                    formatters={formatters}
                    color={HA_COLORS.primary}
                    label={formatters.formatEntityAttributeName(entity, 'volume_level')}
                    onSliderMoved={(v) => {
                      if (v !== undefined) debouncedVolumeSet(v)
                    }}
                    onValueChanged={(v) => {
                      debouncedVolumeSet.cancel()
                      sendVolume(v)
                    }}
                  />
                </div>
              </>
            )}
          </div>
        )}

        {/* Secondary controls row: stop, source, sound mode, power */}
        {hasControlsRow && (
          <div className="flex items-center justify-around gap-2">
            {secondaryStop && stop && (
              <button
                type="button"
                aria-label={actionLabel('media_stop')}
                title={actionLabel('media_stop')}
                onClick={() => void handleMediaControlClick(call, entity, stop.action)}
                className="grid size-10 cursor-pointer place-items-center rounded-full bg-foreground/8 text-foreground transition-colors hover:bg-foreground/15 focus-visible:outline-2 focus-visible:outline-ring"
              >
                <MdiIcon path={stop.icon} size={20} />
              </button>
            )}

            {supportsSource && sourceList.length > 0 && (
              <MediaActionDropdown
                icon={mdiLoginVariant}
                label={actionLabel('source')}
                value={typeof a.source === 'string' ? a.source : undefined}
                options={sourceList.map((src) => ({
                  value: src,
                  label: formatters.formatEntityAttributeValue(entity, 'source', src),
                }))}
                onSelect={(source) => {
                  if (source === a.source) return
                  void call('media_player', 'select_source', {
                    entity_id: entity.entity_id,
                    source,
                  })
                }}
              />
            )}

            {supportsSoundMode && soundModeList.length > 0 && (
              <MediaActionDropdown
                icon={mdiMusicNoteEighth}
                label={actionLabel('sound_mode')}
                value={typeof a.sound_mode === 'string' ? a.sound_mode : undefined}
                options={soundModeList.map((mode) => ({
                  value: mode,
                  label: formatters.formatEntityAttributeValue(entity, 'sound_mode', mode),
                }))}
                onSelect={(sound_mode) => {
                  if (sound_mode === a.sound_mode) return
                  void call('media_player', 'select_sound_mode', {
                    entity_id: entity.entity_id,
                    sound_mode,
                  })
                }}
              />
            )}

            {turnOn && (
              <button
                type="button"
                aria-label={actionLabel(turnOn.action)}
                title={actionLabel(turnOn.action)}
                onClick={() => void handleMediaControlClick(call, entity, turnOn.action)}
                className="grid size-10 cursor-pointer place-items-center rounded-full bg-foreground/8 text-foreground transition-colors hover:bg-foreground/15 focus-visible:outline-2 focus-visible:outline-ring"
              >
                <MdiIcon path={turnOn.icon} size={20} />
              </button>
            )}

            {turnOff && (
              <button
                type="button"
                aria-label={actionLabel(turnOff.action)}
                title={actionLabel(turnOff.action)}
                onClick={() => void handleMediaControlClick(call, entity, turnOff.action)}
                className="grid size-10 cursor-pointer place-items-center rounded-full bg-foreground/8 text-foreground transition-colors hover:bg-foreground/15 focus-visible:outline-2 focus-visible:outline-ring"
              >
                <MdiIcon path={turnOff.icon} size={20} />
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
