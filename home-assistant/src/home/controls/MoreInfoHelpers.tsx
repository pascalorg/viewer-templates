/* Ported from home-assistant/frontend (Apache-2.0):
   - src/dialogs/more-info/controls/more-info-remote.ts
   - src/dialogs/more-info/controls/more-info-date.ts
   - src/dialogs/more-info/controls/more-info-time.ts
   - src/dialogs/more-info/controls/more-info-datetime.ts
   - src/dialogs/more-info/controls/more-info-input_datetime.ts
   - src/dialogs/more-info/controls/more-info-script.ts
   - src/dialogs/more-info/controls/more-info-automation.ts
   - src/dialogs/more-info/controls/more-info-timer.ts
   - src/dialogs/more-info/controls/more-info-counter.ts
   - src/dialogs/more-info/controls/more-info-sun.ts
   - src/dialogs/more-info/controls/more-info-group.ts
   - src/dialogs/more-info/controls/more-info-person.ts */

import { mdiPlay, mdiRemote, mdiStop } from '@mdi/js'
import { type ReactNode, useEffect, useState } from 'react'
import { type HassEntities, type HassEntity, nameOf } from '../entities'
import type { EntityFormatters } from '../hass/names'
import { ControlButton, ControlButtonGroup } from './ControlButton'
import { MdiIcon } from './MdiIcon'
import { SelectMenu } from './SelectMenu'
import { type ServiceCallFn, supportsFeature, UNAVAILABLE, UNKNOWN } from './stateColors'
import { formatRelativeTime, StateHeader } from './StateHeader'

export const RemoteEntityFeature = {
  LEARN_COMMAND: 1,
  DELETE_COMMAND: 2,
  ACTIVITY: 4,
} as const

type HelperProps = {
  entity: HassEntity
  call: ServiceCallFn
  formatters: EntityFormatters
}

export function MoreInfoRemote({
  entity,
  call,
  formatters,
  children,
}: HelperProps & { children?: ReactNode }) {
  const a = entity.attributes
  const supportsActivity = supportsFeature(entity, RemoteEntityFeature.ACTIVITY)
  const activityList = Array.isArray(a.activity_list) ? (a.activity_list as string[]) : []
  const currentActivity = typeof a.current_activity === 'string' ? a.current_activity : undefined

  return (
    <div className="flex flex-col gap-3">
      <StateHeader entity={entity} formatters={formatters} />
      {supportsActivity && activityList.length > 0 && (
        <SelectMenu
          label={formatters.localize('ui.dialogs.more_info_control.remote.activity') || 'Activity'}
          value={currentActivity}
          disabled={entity.state === UNAVAILABLE}
          fullWidth
          defaultIconPath={mdiRemote}
          options={activityList.map((act) => ({
            value: act,
            label: formatters.formatEntityAttributeValue(entity, 'activity', act),
          }))}
          onSelect={(activity) => {
            if (!activity || activity === currentActivity) return
            void call('remote', 'turn_on', { entity_id: entity.entity_id, activity })
          }}
        />
      )}
      {children}
    </div>
  )
}

export function MoreInfoDate({ entity, call, formatters }: HelperProps) {
  if (entity.state === UNAVAILABLE) {
    return <StateHeader entity={entity} formatters={formatters} />
  }
  const value = entity.state === UNKNOWN ? '' : entity.state.slice(0, 10)
  return (
    <div className="flex flex-col gap-3">
      <StateHeader entity={entity} formatters={formatters} />
      <input
        type="date"
        value={value}
        aria-label={String(entity.attributes.friendly_name ?? entity.entity_id)}
        onChange={(ev) => {
          if (!ev.target.value) return
          void call('date', 'set_value', { entity_id: entity.entity_id, date: ev.target.value })
        }}
        className="w-full rounded-full border border-border bg-transparent px-3 py-1.5 text-sm outline-none focus:border-foreground/40"
      />
    </div>
  )
}

export function MoreInfoTime({ entity, call, formatters }: HelperProps) {
  if (entity.state === UNAVAILABLE) {
    return <StateHeader entity={entity} formatters={formatters} />
  }
  const value = entity.state === UNKNOWN ? '' : entity.state.slice(0, 8)
  return (
    <div className="flex flex-col gap-3">
      <StateHeader entity={entity} formatters={formatters} />
      <input
        type="time"
        step={1}
        value={value}
        aria-label={String(entity.attributes.friendly_name ?? entity.entity_id)}
        onChange={(ev) => {
          if (!ev.target.value) return
          const time = ev.target.value.length === 5 ? `${ev.target.value}:00` : ev.target.value
          void call('time', 'set_value', { entity_id: entity.entity_id, time })
        }}
        className="w-full rounded-full border border-border bg-transparent px-3 py-1.5 text-sm outline-none focus:border-foreground/40"
      />
    </div>
  )
}

export function MoreInfoDatetime({ entity, call, formatters }: HelperProps) {
  if (entity.state === UNAVAILABLE) {
    return <StateHeader entity={entity} formatters={formatters} />
  }
  const parsed = entity.state === UNKNOWN ? null : new Date(entity.state)
  const valid = parsed && !Number.isNaN(parsed.getTime())
  const pad = (n: number) => String(n).padStart(2, '0')
  const dateStr = valid
    ? `${parsed.getFullYear()}-${pad(parsed.getMonth() + 1)}-${pad(parsed.getDate())}`
    : ''
  const timeStr = valid
    ? `${pad(parsed.getHours())}:${pad(parsed.getMinutes())}:${pad(parsed.getSeconds())}`
    : ''

  const commitDate = (nextDate: string, nextTime: string) => {
    const base = valid ? new Date(parsed.getTime()) : new Date()
    if (nextDate) {
      const [y, m, d] = nextDate.split('-').map(Number)
      if (y && m && d) base.setFullYear(y, m - 1, d)
    }
    if (nextTime) {
      const [h = 0, min = 0, s = 0] = nextTime.split(':').map(Number)
      base.setHours(h, min, s, 0)
    }
    void call('datetime', 'set_value', {
      entity_id: entity.entity_id,
      datetime: base.toISOString(),
    })
  }

  return (
    <div className="flex flex-col gap-3">
      <StateHeader entity={entity} formatters={formatters} />
      <div className="grid grid-cols-2 gap-2">
        <input
          type="date"
          value={dateStr}
          aria-label="Date"
          onChange={(ev) => ev.target.value && commitDate(ev.target.value, timeStr)}
          className="min-w-0 rounded-full border border-border bg-transparent px-3 py-1.5 text-sm outline-none focus:border-foreground/40"
        />
        <input
          type="time"
          step={1}
          value={timeStr}
          aria-label="Time"
          onChange={(ev) => ev.target.value && commitDate(dateStr, ev.target.value)}
          className="min-w-0 rounded-full border border-border bg-transparent px-3 py-1.5 text-sm outline-none focus:border-foreground/40"
        />
      </div>
    </div>
  )
}

export function MoreInfoInputDatetime({ entity, call, formatters }: HelperProps) {
  const a = entity.attributes
  const unavailable = entity.state === UNAVAILABLE
  const hasDate = Boolean(a.has_date)
  const hasTime = Boolean(a.has_time)

  const pad = (n: unknown, len = 2) => String(n ?? 0).padStart(len, '0')
  const dateVal =
    hasDate && a.year != null
      ? `${pad(a.year, 4)}-${pad(a.month)}-${pad(a.day)}`
      : hasDate && entity.state !== UNKNOWN && entity.state !== UNAVAILABLE
        ? entity.state.split(' ')[0] ?? ''
        : ''
  const timeVal =
    entity.state === UNKNOWN || entity.state === UNAVAILABLE
      ? ''
      : hasDate
        ? (entity.state.split(' ')[1] ?? '')
        : entity.state

  return (
    <div className="flex flex-col gap-3">
      <StateHeader entity={entity} formatters={formatters} />
      <div className={`grid gap-2 ${hasDate && hasTime ? 'grid-cols-2' : 'grid-cols-1'}`}>
        {hasDate && (
          <input
            type="date"
            disabled={unavailable}
            value={dateVal}
            aria-label="Date"
            onChange={(ev) => {
              if (!ev.target.value) return
              void call('input_datetime', 'set_datetime', {
                entity_id: entity.entity_id,
                date: ev.target.value,
                ...(hasTime && timeVal ? { time: timeVal } : {}),
              })
            }}
            className="min-w-0 rounded-full border border-border bg-transparent px-3 py-1.5 text-sm outline-none focus:border-foreground/40 disabled:opacity-40"
          />
        )}
        {hasTime && (
          <input
            type="time"
            step={1}
            disabled={unavailable}
            value={timeVal}
            aria-label="Time"
            onChange={(ev) => {
              if (!ev.target.value) return
              const t = ev.target.value.length === 5 ? `${ev.target.value}:00` : ev.target.value
              void call('input_datetime', 'set_datetime', {
                entity_id: entity.entity_id,
                time: t,
                ...(hasDate && dateVal ? { date: dateVal } : {}),
              })
            }}
            className="min-w-0 rounded-full border border-border bg-transparent px-3 py-1.5 text-sm outline-none focus:border-foreground/40 disabled:opacity-40"
          />
        )}
      </div>
    </div>
  )
}

export function MoreInfoScript({ entity, call, formatters }: HelperProps) {
  const a = entity.attributes
  const unavailable = entity.state === UNAVAILABLE
  const current = typeof a.current === 'number' ? a.current : 0
  const isQueued = a.mode === 'queued'
  const isParallel = a.mode === 'parallel'
  const maxRuns = typeof a.max === 'number' ? a.max : 1
  const canRun = a.mode === 'single' ? current === 0 : current < maxRuns

  const stateOverride =
    current > 0
      ? isParallel && current > 1
        ? formatters.localize('ui.card.script.running_parallel', { active: current }) ||
          `Running (${current})`
        : formatters.localize('ui.card.script.running_single') || 'Running'
      : formatters.localize('ui.card.script.idle') || 'Idle'

  return (
    <div className="flex flex-col items-center gap-3">
      <StateHeader
        entity={entity}
        formatters={formatters}
        stateOverride={stateOverride}
        changedOverride={typeof a.last_triggered === 'string' ? a.last_triggered : undefined}
      />
      {isQueued && current > 1 && (
        <p className="m-0 text-xs text-muted-foreground">
          {formatters.localize('ui.card.script.running_queued', { queued: current - 1 }) ||
            `${current - 1} queued`}
        </p>
      )}
      <ControlButtonGroup className="w-full">
        <ControlButton
          disabled={!current}
          borderRadius="9999px"
          className="h-10 w-auto flex-1 gap-1.5 px-3 text-sm"
          onClick={() => void call('script', 'turn_off', { entity_id: entity.entity_id })}
        >
          <MdiIcon path={mdiStop} size={18} />
          <span>
            {(isQueued || isParallel) && current > 1
              ? formatters.localize('ui.card.script.cancel_all') || 'Cancel all'
              : formatters.localize('ui.card.script.cancel') || 'Cancel'}
          </span>
        </ControlButton>
        <ControlButton
          disabled={unavailable || !canRun}
          borderRadius="9999px"
          className="h-10 w-auto flex-1 gap-1.5 px-3 text-sm"
          onClick={() => void call('script', 'turn_on', { entity_id: entity.entity_id })}
        >
          <MdiIcon path={mdiPlay} size={18} />
          <span>{formatters.localize('ui.card.script.run') || 'Run'}</span>
        </ControlButton>
      </ControlButtonGroup>
    </div>
  )
}

export function MoreInfoAutomation({ entity, call, formatters }: HelperProps) {
  const unavailable = entity.state === UNAVAILABLE
  const on = entity.state === 'on'
  const neverLabel = formatters.localize('ui.components.relative_time.never') || 'Never'
  const lastTriggered =
    typeof entity.attributes.last_triggered === 'string'
      ? formatRelativeTime(entity.attributes.last_triggered, formatters.language, neverLabel)
      : neverLabel

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3 rounded-xl bg-foreground/5 px-3 py-2">
        <span className="text-sm font-medium text-foreground">
          {formatters.formatEntityState(entity)}
        </span>
        <button
          type="button"
          role="switch"
          aria-checked={on}
          disabled={unavailable}
          onClick={() =>
            void call('automation', on ? 'turn_off' : 'turn_on', { entity_id: entity.entity_id })
          }
          className={`relative h-6 w-10 shrink-0 cursor-pointer rounded-full transition-colors disabled:opacity-40 ${
            on ? 'bg-foreground' : 'bg-foreground/20'
          }`}
        >
          <i
            className={`absolute top-0.5 left-0.5 size-5 rounded-full bg-background shadow transition-transform ${
              on ? 'translate-x-4' : ''
            }`}
          />
        </button>
      </div>

      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="text-muted-foreground">
          {formatters.localize('ui.card.automation.last_triggered') || 'Last triggered'}
        </span>
        <span className="text-foreground">{lastTriggered}</span>
      </div>

      <button
        type="button"
        disabled={unavailable}
        onClick={() =>
          void call('automation', 'trigger', {
            entity_id: entity.entity_id,
            skip_condition: true,
          })
        }
        className="w-full cursor-pointer rounded-full bg-foreground/8 px-3 py-1.5 text-sm font-medium text-foreground transition-colors hover:bg-foreground/15 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {formatters.localize('ui.card.automation.trigger') || 'Run actions'}
      </button>
    </div>
  )
}

function parseDurationSeconds(raw: unknown): number {
  if (typeof raw !== 'string') return 0
  const parts = raw.split(':').map(Number)
  if (parts.some((n) => Number.isNaN(n))) return 0
  if (parts.length === 3) return parts[0]! * 3600 + parts[1]! * 60 + parts[2]!
  if (parts.length === 2) return parts[0]! * 60 + parts[1]!
  return parts[0] ?? 0
}

function formatTimerClock(seconds: number): string {
  const s = Math.max(0, Math.round(seconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const rem = s % 60
  const pad = (n: number) => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${pad(m)}:${pad(rem)}` : `${pad(m)}:${pad(rem)}`
}

export function MoreInfoTimer({ entity, call, formatters }: HelperProps) {
  const [, setTick] = useState(0)
  const state = entity.state

  useEffect(() => {
    if (state !== 'active') return
    const id = window.setInterval(() => setTick((t) => (t + 1) % 100000), 1000)
    return () => window.clearInterval(id)
  }, [state])

  const a = entity.attributes
  let stateOverride: string | undefined
  if (state === 'active' && typeof a.finishes_at === 'string') {
    const endMs = Date.parse(a.finishes_at)
    if (!Number.isNaN(endMs)) {
      stateOverride = formatTimerClock((endMs - Date.now()) / 1000)
    }
  } else if (state === 'paused' && typeof a.remaining === 'string') {
    stateOverride = formatTimerClock(parseDurationSeconds(a.remaining))
  }

  return (
    <div className="flex flex-col items-center gap-3">
      <StateHeader entity={entity} formatters={formatters} stateOverride={stateOverride} />
      <div className="flex flex-wrap justify-center gap-2">
        {(state === 'idle' || state === 'paused') && (
          <button
            type="button"
            onClick={() => void call('timer', 'start', { entity_id: entity.entity_id })}
            className="cursor-pointer rounded-full bg-[#009ac7] px-3.5 py-1.5 text-sm font-medium text-white hover:opacity-90"
          >
            {formatters.localize('ui.card.timer.actions.start') || 'Start'}
          </button>
        )}
        {state === 'active' && (
          <button
            type="button"
            onClick={() => void call('timer', 'pause', { entity_id: entity.entity_id })}
            className="cursor-pointer rounded-full bg-foreground/8 px-3.5 py-1.5 text-sm font-medium text-foreground hover:bg-foreground/15"
          >
            {formatters.localize('ui.card.timer.actions.pause') || 'Pause'}
          </button>
        )}
        {(state === 'active' || state === 'paused') && (
          <>
            <button
              type="button"
              onClick={() => void call('timer', 'cancel', { entity_id: entity.entity_id })}
              className="cursor-pointer rounded-full bg-foreground/8 px-3.5 py-1.5 text-sm font-medium text-foreground hover:bg-foreground/15"
            >
              {formatters.localize('ui.card.timer.actions.cancel') || 'Cancel'}
            </button>
            <button
              type="button"
              onClick={() => void call('timer', 'finish', { entity_id: entity.entity_id })}
              className="cursor-pointer rounded-full bg-foreground/8 px-3.5 py-1.5 text-sm font-medium text-foreground hover:bg-foreground/15"
            >
              {formatters.localize('ui.card.timer.actions.finish') || 'Finish'}
            </button>
          </>
        )}
      </div>
    </div>
  )
}

export function MoreInfoCounter({ entity, call, formatters }: HelperProps) {
  const unavailable = entity.state === UNAVAILABLE
  const val = Number(entity.state)
  const atMax = typeof entity.attributes.maximum === 'number' && val === entity.attributes.maximum
  const atMin = typeof entity.attributes.minimum === 'number' && val === entity.attributes.minimum

  return (
    <div className="flex flex-col items-center gap-3">
      <StateHeader entity={entity} formatters={formatters} />
      <div className="flex flex-wrap justify-center gap-2">
        <button
          type="button"
          disabled={unavailable || atMax}
          onClick={() => void call('counter', 'increment', { entity_id: entity.entity_id })}
          className="cursor-pointer rounded-full bg-foreground/8 px-3 py-1.5 text-sm font-medium text-foreground hover:bg-foreground/15 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {formatters.localize('ui.card.counter.actions.increment') || 'Increment'}
        </button>
        <button
          type="button"
          disabled={unavailable || atMin}
          onClick={() => void call('counter', 'decrement', { entity_id: entity.entity_id })}
          className="cursor-pointer rounded-full bg-foreground/8 px-3 py-1.5 text-sm font-medium text-foreground hover:bg-foreground/15 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {formatters.localize('ui.card.counter.actions.decrement') || 'Decrement'}
        </button>
        <button
          type="button"
          disabled={unavailable}
          onClick={() => void call('counter', 'reset', { entity_id: entity.entity_id })}
          className="cursor-pointer rounded-full bg-foreground/8 px-3 py-1.5 text-sm font-medium text-foreground hover:bg-foreground/15 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {formatters.localize('ui.card.counter.actions.reset') || 'Reset'}
        </button>
      </div>
    </div>
  )
}

export function MoreInfoSun({
  entity,
  formatters,
}: {
  entity: HassEntity
  formatters: EntityFormatters
}) {
  const a = entity.attributes
  const risingMs = typeof a.next_rising === 'string' ? Date.parse(a.next_rising) : Number.NaN
  const settingMs = typeof a.next_setting === 'string' ? Date.parse(a.next_setting) : Number.NaN
  const order: ('ris' | 'set')[] =
    !Number.isNaN(risingMs) && !Number.isNaN(settingMs) && risingMs > settingMs
      ? ['set', 'ris']
      : ['ris', 'set']
  const neverLabel = formatters.localize('ui.components.relative_time.never') || 'Never'
  const fmtClock = (ms: number) =>
    Number.isNaN(ms)
      ? '—'
      : new Intl.DateTimeFormat(formatters.language, {
          hour: 'numeric',
          minute: '2-digit',
        }).format(new Date(ms))

  return (
    <div className="flex flex-col gap-3">
      <StateHeader entity={entity} formatters={formatters} />
      <div className="grid gap-1.5 border-t border-border/60 pt-2 text-sm">
        {order.map((item) => {
          const ms = item === 'ris' ? risingMs : settingMs
          const label =
            item === 'ris'
              ? formatters.localize('ui.dialogs.more_info_control.sun.rising') || 'Rising'
              : formatters.localize('ui.dialogs.more_info_control.sun.setting') || 'Setting'
          return (
            <div key={item} className="flex items-center justify-between gap-2">
              <span className="text-muted-foreground">
                {label} · {formatRelativeTime(ms, formatters.language, neverLabel)}
              </span>
              <span className="font-mono text-foreground">{fmtClock(ms)}</span>
            </div>
          )
        })}
        {a.elevation != null && (
          <div className="flex items-center justify-between gap-2">
            <span className="text-muted-foreground">
              {formatters.localize('ui.dialogs.more_info_control.sun.elevation') || 'Elevation'}
            </span>
            <span className="font-mono text-foreground">
              {formatters.formatEntityAttributeValue(entity, 'elevation')}
            </span>
          </div>
        )}
        {a.azimuth != null && (
          <div className="flex items-center justify-between gap-2">
            <span className="text-muted-foreground">
              {formatters.localize('ui.dialogs.more_info_control.sun.azimuth') || 'Azimuth'}
            </span>
            <span className="font-mono text-foreground">
              {formatters.formatEntityAttributeValue(entity, 'azimuth')}
            </span>
          </div>
        )}
      </div>
    </div>
  )
}

export function MoreInfoPerson({
  entity,
  formatters,
  children,
}: {
  entity: HassEntity
  formatters: EntityFormatters
  children?: ReactNode
}) {
  const a = entity.attributes
  return (
    <div className="flex flex-col gap-3">
      <StateHeader entity={entity} formatters={formatters} />
      {(typeof a.source_type === 'string' || typeof a.battery_level === 'number') && (
        <div className="grid gap-1 text-xs">
          {typeof a.source_type === 'string' && (
            <div className="flex justify-between gap-2">
              <span className="text-muted-foreground">
                {formatters.formatEntityAttributeName(entity, 'source_type')}
              </span>
              <span className="text-foreground">
                {formatters.formatEntityAttributeValue(entity, 'source_type')}
              </span>
            </div>
          )}
          {typeof a.battery_level === 'number' && (
            <div className="flex justify-between gap-2">
              <span className="text-muted-foreground">
                {formatters.formatEntityAttributeName(entity, 'battery_level')}
              </span>
              <span className="font-mono text-foreground">{Math.round(a.battery_level)}%</span>
            </div>
          )}
        </div>
      )}
      {children}
    </div>
  )
}

export function MoreInfoGroup({
  entity,
  entities,
  formatters,
  onSelect,
}: {
  entity: HassEntity
  entities: HassEntities
  formatters: EntityFormatters
  onSelect?: (id: string) => void
}) {
  const memberIds = Array.isArray(entity.attributes.entity_id)
    ? (entity.attributes.entity_id as string[])
    : []
  return (
    <div className="flex flex-col gap-3">
      <StateHeader entity={entity} formatters={formatters} />
      {memberIds.length > 0 && (
        <div className="grid gap-1 border-t border-border/60 pt-2">
          {memberIds.map((id) => {
            const member = entities[id]
            if (!member) return null
            return (
              <button
                key={id}
                type="button"
                onClick={() => onSelect?.(id)}
                className="flex w-full cursor-pointer items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left text-xs transition-colors hover:bg-foreground/5"
              >
                <span className="truncate font-medium text-foreground">{nameOf(member)}</span>
                <span className="shrink-0 text-muted-foreground">
                  {formatters.formatEntityState(member)}
                </span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
