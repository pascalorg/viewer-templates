/* Ported from home-assistant/frontend (Apache-2.0):
   - src/dialogs/more-info/components/ha-more-info-state-header.ts
   - src/components/ha-relative-time.ts
   - src/common/datetime/relative_time.ts
   - src/common/util/select-unit.ts */

import { type ReactNode, useEffect, useState } from 'react'
import type { HassEntity } from '../entities'
import type { EntityFormatters } from '../hass/names'
import { UNAVAILABLE, UNKNOWN } from './stateColors'

type RelativeUnit = 'second' | 'minute' | 'hour' | 'day' | 'week' | 'month' | 'year'

const MS_PER_SECOND = 1000
const SECS_PER_MIN = 60
const SECS_PER_HOUR = 3600
const MS_PER_DAY = 86_400_000

const THRESHOLDS = {
  second: 59,
  minute: 59,
  hour: 22,
  day: 5,
  week: 4,
  month: 11,
} as const

const relTimeCache = new Map<string, Intl.RelativeTimeFormat>()
const absTimeCache = new Map<string, Intl.DateTimeFormat>()

function getRelativeFormatter(language: string): Intl.RelativeTimeFormat {
  let fmt = relTimeCache.get(language)
  if (!fmt) {
    fmt = new Intl.RelativeTimeFormat(language, { numeric: 'auto', style: 'long' })
    relTimeCache.set(language, fmt)
  }
  return fmt
}

function getAbsoluteFormatter(language: string): Intl.DateTimeFormat {
  let fmt = absTimeCache.get(language)
  if (!fmt) {
    fmt = new Intl.DateTimeFormat(language, { dateStyle: 'medium', timeStyle: 'short' })
    absTimeCache.set(language, fmt)
  }
  return fmt
}

function selectUnit(fromMs: number, toMs: number): { value: number; unit: RelativeUnit } {
  const secs = (fromMs - toMs) / MS_PER_SECOND
  if (Math.abs(secs) < THRESHOLDS.second) {
    return { value: Math.round(secs), unit: 'second' }
  }
  const mins = secs / SECS_PER_MIN
  if (Math.abs(mins) < THRESHOLDS.minute) {
    return { value: Math.round(mins), unit: 'minute' }
  }
  const hours = secs / SECS_PER_HOUR
  if (Math.abs(hours) < THRESHOLDS.hour) {
    return { value: Math.round(hours), unit: 'hour' }
  }

  const fromDay = new Date(fromMs)
  const toDay = new Date(toMs)
  fromDay.setHours(0, 0, 0, 0)
  toDay.setHours(0, 0, 0, 0)
  const days = Math.round((fromDay.getTime() - toDay.getTime()) / MS_PER_DAY)
  if (days === 0) {
    return { value: Math.round(hours), unit: 'hour' }
  }
  if (Math.abs(days) < THRESHOLDS.day) {
    return { value: days, unit: 'day' }
  }
  const weeks = Math.round(days / 7)
  if (weeks === 0) {
    return { value: days, unit: 'day' }
  }
  if (Math.abs(weeks) < THRESHOLDS.week) {
    return { value: weeks, unit: 'week' }
  }
  const years = fromDay.getFullYear() - toDay.getFullYear()
  const months = years * 12 + fromDay.getMonth() - toDay.getMonth()
  if (months === 0) {
    return { value: weeks, unit: 'week' }
  }
  if (Math.abs(months) < THRESHOLDS.month || years === 0) {
    return { value: months, unit: 'month' }
  }
  return { value: Math.round(years), unit: 'year' }
}

function capitalize(text: string): string {
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : text
}

function parseTimestamp(value: number | string | undefined): number | null {
  if (value === undefined || value === null || value === '') return null
  const ms = typeof value === 'number' ? value : Date.parse(value)
  return Number.isNaN(ms) ? null : ms
}

export function formatRelativeTime(
  value: number | string | undefined,
  language: string,
  neverLabel: string,
  nowMs = Date.now(),
): string {
  const ts = parseTimestamp(value)
  if (ts === null) return neverLabel
  const { value: amount, unit } = selectUnit(ts, nowMs)
  return capitalize(getRelativeFormatter(language).format(amount, unit))
}

export function formatAbsoluteTime(
  value: number | string | undefined,
  language: string,
  neverLabel: string,
): string {
  const ts = parseTimestamp(value)
  if (ts === null) return neverLabel
  return getAbsoluteFormatter(language).format(new Date(ts))
}

export type StateHeaderProps = {
  entity: HassEntity
  formatters: EntityFormatters
  stateOverride?: string
  changedOverride?: number | string
  changedTextOverride?: string
  stateAccent?: boolean
  afterTime?: ReactNode
}

export function StateHeader({
  entity,
  formatters,
  stateOverride,
  changedOverride,
  changedTextOverride,
  stateAccent = false,
  afterTime,
}: StateHeaderProps) {
  const [absoluteTime, setAbsoluteTime] = useState(false)
  const [nowMs, setNowMs] = useState(() => Date.now())

  const rawChanged = changedOverride ?? entity.last_changed
  const changedMs = parseTimestamp(rawChanged)

  const isTimestampState =
    stateOverride === undefined &&
    entity.attributes.device_class === 'timestamp' &&
    entity.state !== UNAVAILABLE &&
    entity.state !== UNKNOWN
  const stateMs = isTimestampState ? parseTimestamp(entity.state) : null

  useEffect(() => {
    const needsTick = (!changedTextOverride && !absoluteTime && changedMs !== null) || stateMs !== null
    if (!needsTick) return

    const refMs = changedMs ?? stateMs ?? Date.now()
    const ageMs = Math.abs(Date.now() - refMs)
    const intervalMs = ageMs < 60_000 ? 1000 : 60_000
    const id = window.setInterval(() => setNowMs(Date.now()), intervalMs)
    return () => window.clearInterval(id)
  }, [absoluteTime, changedMs, changedTextOverride, stateMs, nowMs])

  const neverLabel = formatters.localize('ui.components.relative_time.never') || 'Never'
  const stateDisplay =
    stateOverride !== undefined
      ? stateOverride
      : isTimestampState
        ? formatRelativeTime(entity.state, formatters.language, neverLabel, nowMs)
        : formatters.formatEntityState(entity)

  const timeText = absoluteTime
    ? formatAbsoluteTime(rawChanged, formatters.language, neverLabel)
    : formatRelativeTime(rawChanged, formatters.language, neverLabel, nowMs)

  return (
    <div className="flex w-full flex-col items-center">
      <p
        className={`m-0 text-center text-[36px] leading-[1.2] font-normal ${
          stateAccent ? 'text-[#009ac7]' : 'text-foreground'
        }`}
      >
        {stateDisplay}
      </p>
      <div className="relative mt-0.5 mb-5 flex w-full items-center justify-center">
        {changedTextOverride ? (
          <p
            aria-hidden="true"
            className="m-0 cursor-default py-1 text-center text-[16px] leading-normal font-medium tracking-[0.1px] text-muted-foreground select-none"
          >
            {changedTextOverride}
          </p>
        ) : (
          <button
            type="button"
            onClick={() => setAbsoluteTime((v) => !v)}
            className="m-0 cursor-pointer border-0 bg-transparent px-1 py-1 text-center text-[16px] leading-normal font-medium tracking-[0.1px] text-muted-foreground select-none hover:text-foreground focus-visible:rounded-md focus-visible:outline-2 focus-visible:outline-ring"
          >
            {timeText}
          </button>
        )}
        {afterTime && (
          <div className="absolute right-0 top-1/2 -translate-y-1/2">{afterTime}</div>
        )}
      </div>
      <span className="sr-only" aria-live="polite">
        {changedTextOverride ?? ''}
      </span>
    </div>
  )
}
