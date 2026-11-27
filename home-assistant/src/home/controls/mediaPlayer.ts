/* Ported from home-assistant/frontend (Apache-2.0):
   - src/data/media-player.ts
   - src/data/feature/media-player_entity_feature.ts */

import {
  mdiPause,
  mdiPlay,
  mdiPlayPause,
  mdiPowerOff,
  mdiPowerOn,
  mdiPowerStandby,
  mdiRepeat,
  mdiRepeatOff,
  mdiRepeatOnce,
  mdiShuffle,
  mdiShuffleDisabled,
  mdiSkipNext,
  mdiSkipPrevious,
  mdiStop,
} from '@mdi/js'
import type { HassEntity } from '../entities'
import { type ServiceCallFn, stateActive, supportsFeature, UNAVAILABLE } from './stateColors'

export const MediaPlayerEntityFeature = {
  PAUSE: 1,
  SEEK: 2,
  VOLUME_SET: 4,
  VOLUME_MUTE: 8,
  PREVIOUS_TRACK: 16,
  NEXT_TRACK: 32,
  TURN_ON: 128,
  TURN_OFF: 256,
  PLAY_MEDIA: 512,
  VOLUME_STEP: 1024,
  SELECT_SOURCE: 2048,
  STOP: 4096,
  CLEAR_PLAYLIST: 8192,
  PLAY: 16384,
  SHUFFLE_SET: 32768,
  SELECT_SOUND_MODE: 65536,
  BROWSE_MEDIA: 131072,
  REPEAT_SET: 262144,
  GROUPING: 524288,
} as const

export type MediaControlAction =
  | 'turn_on'
  | 'turn_off'
  | 'shuffle_set'
  | 'media_previous_track'
  | 'media_play'
  | 'media_pause'
  | 'media_play_pause'
  | 'media_stop'
  | 'media_next_track'
  | 'repeat_set'

export type MediaControlButton = {
  icon: string
  action: MediaControlAction
}

export function getCurrentProgress(stateObj: HassEntity): number {
  let progress = Number(stateObj.attributes.media_position ?? 0)
  if (stateObj.state !== 'playing') {
    return progress < 0 ? 0 : progress
  }
  const updatedAt = stateObj.attributes.media_position_updated_at
  if (typeof updatedAt === 'string' || typeof updatedAt === 'number') {
    const ts = typeof updatedAt === 'number' ? updatedAt : Date.parse(updatedAt)
    if (!Number.isNaN(ts)) {
      progress += (Date.now() - ts) / 1000.0
    }
  }
  return progress < 0 ? 0 : progress
}

export function computeMediaDescription(stateObj: HassEntity): string {
  const a = stateObj.attributes
  const str = (v: unknown): string => (typeof v === 'string' ? v : '')
  switch (a.media_content_type) {
    case 'music':
    case 'image':
      return str(a.media_artist)
    case 'playlist':
      return str(a.media_playlist) || str(a.media_artist)
    case 'tvshow': {
      let secondaryTitle = str(a.media_series_title)
      if (a.media_season != null && a.media_season !== '') {
        secondaryTitle += ` S${String(a.media_season)}`
        if (a.media_episode != null && a.media_episode !== '') {
          secondaryTitle += `E${String(a.media_episode)}`
        }
      }
      return secondaryTitle
    }
    case 'channel':
      return str(a.media_channel)
    default:
      return str(a.app_name)
  }
}

export function computeMediaControls(
  stateObj: HassEntity,
  useExtendedControls = false,
): MediaControlButton[] | undefined {
  const state = stateObj.state
  if (state === UNAVAILABLE) {
    return undefined
  }

  const assumedState = stateObj.attributes.assumed_state === true

  if (!stateActive(stateObj) && !assumedState) {
    return supportsFeature(stateObj, MediaPlayerEntityFeature.TURN_ON)
      ? [{ icon: mdiPowerStandby, action: 'turn_on' }]
      : undefined
  }

  const buttons: MediaControlButton[] = []

  if (assumedState && supportsFeature(stateObj, MediaPlayerEntityFeature.TURN_ON)) {
    buttons.push({ icon: mdiPowerOn, action: 'turn_on' })
  }

  if (supportsFeature(stateObj, MediaPlayerEntityFeature.TURN_OFF)) {
    buttons.push({
      icon: assumedState ? mdiPowerOff : mdiPowerStandby,
      action: 'turn_off',
    })
  }

  const stateAttr = stateObj.attributes

  if (
    (state === 'playing' || state === 'paused' || assumedState) &&
    supportsFeature(stateObj, MediaPlayerEntityFeature.SHUFFLE_SET) &&
    useExtendedControls
  ) {
    buttons.push({
      icon: stateAttr.shuffle === true ? mdiShuffle : mdiShuffleDisabled,
      action: 'shuffle_set',
    })
  }

  if (
    (state === 'playing' || state === 'paused' || assumedState) &&
    supportsFeature(stateObj, MediaPlayerEntityFeature.PREVIOUS_TRACK)
  ) {
    buttons.push({ icon: mdiSkipPrevious, action: 'media_previous_track' })
  }

  if (
    !assumedState &&
    state === 'on' &&
    (supportsFeature(stateObj, MediaPlayerEntityFeature.PLAY) ||
      supportsFeature(stateObj, MediaPlayerEntityFeature.PAUSE))
  ) {
    buttons.push({ icon: mdiPlayPause, action: 'media_play' })
  }

  if (
    (assumedState || state === 'paused' || state === 'idle') &&
    supportsFeature(stateObj, MediaPlayerEntityFeature.PLAY)
  ) {
    buttons.push({ icon: mdiPlay, action: 'media_play' })
  }

  if (
    (assumedState || state === 'playing') &&
    supportsFeature(stateObj, MediaPlayerEntityFeature.PAUSE)
  ) {
    buttons.push({ icon: mdiPause, action: 'media_pause' })
  }

  if (
    (assumedState || state === 'playing' || state === 'paused') &&
    supportsFeature(stateObj, MediaPlayerEntityFeature.STOP)
  ) {
    buttons.push({ icon: mdiStop, action: 'media_stop' })
  }

  if (
    (state === 'playing' || state === 'paused' || assumedState) &&
    supportsFeature(stateObj, MediaPlayerEntityFeature.NEXT_TRACK)
  ) {
    buttons.push({ icon: mdiSkipNext, action: 'media_next_track' })
  }

  if (
    (state === 'playing' || state === 'paused' || assumedState) &&
    supportsFeature(stateObj, MediaPlayerEntityFeature.REPEAT_SET) &&
    useExtendedControls
  ) {
    buttons.push({
      icon:
        stateAttr.repeat === 'all'
          ? mdiRepeat
          : stateAttr.repeat === 'one'
            ? mdiRepeatOnce
            : mdiRepeatOff,
      action: 'repeat_set',
    })
  }

  return buttons.length > 0 ? buttons : undefined
}

/**
 * Removes stop when play or pause is available, as stop is then only shown as
 * a secondary control in the more-info dialog. Assumed state players keep
 * play, pause and stop together as main controls.
 */
export function removeSecondaryStopControl(
  stateObj: HassEntity,
  controls: MediaControlButton[] | undefined,
): MediaControlButton[] | undefined {
  if (
    !controls ||
    stateObj.attributes.assumed_state === true ||
    !controls.some((c) => c.action === 'media_play' || c.action === 'media_pause')
  ) {
    return controls
  }
  return controls.filter((c) => c.action !== 'media_stop')
}

export function formatMediaTime(seconds: number | undefined): string {
  if (seconds === undefined || !Number.isFinite(seconds)) {
    return ''
  }

  const totalSeconds = Math.max(0, Math.floor(seconds))
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const secs = totalSeconds % 60
  const pad = (value: number) => value.toString().padStart(2, '0')

  if (hours > 0) {
    return `${pad(hours)}:${pad(minutes)}:${pad(secs)}`
  }
  return `${pad(minutes)}:${pad(secs)}`
}

export function cleanupMediaTitle(title?: unknown): string | undefined {
  if (typeof title !== 'string' || !title) {
    return undefined
  }

  const index = title.indexOf('?authSig=')
  let cleanTitle = index > 0 ? title.slice(0, index) : title

  if (cleanTitle.startsWith('http')) {
    const last = cleanTitle.split('/').pop()
    if (last) {
      try {
        cleanTitle = decodeURIComponent(last)
      } catch {
        cleanTitle = last
      }
    }
  }

  return cleanTitle
}

export function handleMediaControlClick(
  call: ServiceCallFn,
  stateObj: HassEntity,
  action: string,
) {
  if (action === 'shuffle_set') {
    return call('media_player', action, {
      entity_id: stateObj.entity_id,
      shuffle: !stateObj.attributes.shuffle,
    })
  }
  if (action === 'repeat_set') {
    return call('media_player', action, {
      entity_id: stateObj.entity_id,
      repeat:
        stateObj.attributes.repeat === 'all'
          ? 'one'
          : stateObj.attributes.repeat === 'off'
            ? 'all'
            : 'off',
    })
  }
  return call('media_player', action, {
    entity_id: stateObj.entity_id,
  })
}

export function resolveHassMediaUrl(rawUrl: unknown, hassUrl: string): string {
  if (typeof rawUrl !== 'string' || !rawUrl.trim()) return ''
  const trimmed = rawUrl.trim()
  if (/^https?:\/\//i.test(trimmed)) return trimmed
  if (!hassUrl) return ''
  const base = hassUrl.replace(/\/+$/, '')
  return `${base}${trimmed.startsWith('/') ? trimmed : `/${trimmed}`}`
}
