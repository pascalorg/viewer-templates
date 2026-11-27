/* Ported from home-assistant/frontend (Apache-2.0):
   - src/dialogs/more-info/ha-more-info-details.ts
   - src/components/ha-attribute-value.ts
   - src/dialogs/more-info/controls/more-info-default.ts
   - src/dialogs/more-info/const.ts */

import { mdiCheck, mdiChevronDown, mdiContentCopy } from '@mdi/js'
import { type ReactNode, useEffect, useRef, useState } from 'react'
import {
  domainOf,
  fieldColor,
  fieldOf,
  FIELDS,
  type FieldKind,
  type HassEntity,
} from '../entities'
import type { EntityFormatters } from '../hass/names'
import { MdiIcon } from './MdiIcon'
import { formatAbsoluteTime, StateHeader } from './StateHeader'

/** Domains where Home Assistant hides the default attributes section (`DOMAINS_HIDE_DEFAULT_MORE_INFO` + `DOMAINS_NO_INFO`). */
export const DOMAINS_HIDE_ATTRIBUTES = new Set<string>([
  'camera',
  'configurator',
  'input_number',
  'input_select',
  'input_text',
  'number',
  'scene',
  'select',
  'text',
  'update',
])

const REDACTED_ATTRIBUTES = new Set<string>(['access_token', 'token'])

function isObjectValue(value: unknown): boolean {
  return (
    (Array.isArray(value) && value.some((v) => v !== null && typeof v === 'object')) ||
    (!Array.isArray(value) && value !== null && typeof value === 'object')
  )
}

function renderAttributeValue(
  entity: HassEntity,
  attribute: string,
  formatters: EntityFormatters,
): ReactNode {
  const raw = entity.attributes[attribute]

  if (typeof raw === 'string' && raw.startsWith('http')) {
    try {
      const url = new URL(raw)
      if (url.protocol === 'http:' || url.protocol === 'https:') {
        return (
          <a
            href={raw}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[#009ac7] underline decoration-[#009ac7]/40 hover:decoration-[#009ac7]"
          >
            {raw}
          </a>
        )
      }
    } catch {
      // fall through to text display
    }
  }

  if (isObjectValue(raw)) {
    try {
      return (
        <pre className="m-0 max-w-full overflow-x-auto font-mono text-[11px] leading-snug whitespace-pre-wrap">
          {JSON.stringify(raw, null, 2)}
        </pre>
      )
    } catch {
      return String(raw)
    }
  }

  if (Array.isArray(raw)) {
    return raw.map((item) => String(item)).join(', ')
  }

  return formatters.formatEntityAttributeValue(entity, attribute)
}

export type EntityDetailsProps = {
  entity: HassEntity
  formatters: EntityFormatters
}

export function EntityDetails({ entity, formatters }: EntityDetailsProps) {
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const copyTimerRef = useRef<number | undefined>(undefined)

  useEffect(
    () => () => {
      if (copyTimerRef.current !== undefined) window.clearTimeout(copyTimerRef.current)
    },
    [],
  )

  const domain = domainOf(entity.entity_id)
  if (DOMAINS_HIDE_ATTRIBUTES.has(domain)) return null

  const attributes = Object.keys(entity.attributes)
    .filter((key) => !key.startsWith('_') && !REDACTED_ATTRIBUTES.has(key))
    .map((name) => ({
      name,
      label: formatters.formatEntityAttributeName(entity, name),
    }))
    .sort((a, b) => a.label.localeCompare(b.label, formatters.language))

  const handleCopyId = () => {
    void navigator.clipboard?.writeText(entity.entity_id).then(() => {
      setCopied(true)
      if (copyTimerRef.current !== undefined) window.clearTimeout(copyTimerRef.current)
      copyTimerRef.current = window.setTimeout(() => setCopied(false), 2500)
    })
  }

  const neverLabel = formatters.localize('ui.components.relative_time.never') || 'Never'
  const headerLabel = formatters.localize('ui.dialogs.more_info_control.attributes') || 'Attributes'

  return (
    <div className="border-t border-border/60 pt-2">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full cursor-pointer items-center justify-between rounded-xl px-2 py-1.5 text-left text-xs font-medium text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
      >
        <span>{headerLabel}</span>
        <MdiIcon
          path={mdiChevronDown}
          size={18}
          className={`transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        <div className="mt-1.5 grid gap-1.5 rounded-xl bg-foreground/4 p-2.5 text-xs">
          <div className="flex items-center justify-between gap-2">
            <span className="text-muted-foreground">
              {formatters.localize('ui.dialogs.more_info_control.entity_id') || 'Entity ID'}
            </span>
            <button
              type="button"
              onClick={handleCopyId}
              title={entity.entity_id}
              className="inline-flex min-w-0 cursor-pointer items-center gap-1 rounded-md px-1 py-0.5 font-mono text-[11px] text-foreground hover:bg-foreground/8"
            >
              <span className="truncate">{entity.entity_id}</span>
              <MdiIcon
                path={copied ? mdiCheck : mdiContentCopy}
                size={13}
                className={copied ? 'shrink-0 text-[#43a047]' : 'shrink-0 text-muted-foreground'}
              />
            </button>
          </div>

          {entity.last_changed && (
            <div className="flex items-start justify-between gap-3">
              <span className="shrink-0 text-muted-foreground">
                {formatters.localize('ui.dialogs.more_info_control.last_changed') || 'Last changed'}
              </span>
              <span className="text-right text-foreground">
                {formatAbsoluteTime(entity.last_changed, formatters.language, neverLabel)}
              </span>
            </div>
          )}

          {attributes.length > 0 ? (
            <div className="mt-1 grid gap-1.5 border-t border-border/50 pt-1.5">
              {attributes.map((attr) => (
                <div key={attr.name} className="flex items-start justify-between gap-3">
                  <span className="shrink-0 text-muted-foreground">{attr.label}</span>
                  <span className="min-w-0 break-words text-right text-foreground">
                    {renderAttributeValue(entity, attr.name, formatters)}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="m-0 pt-1 text-center text-muted-foreground">
              {formatters.localize('ui.common.none') || 'None'}
            </p>
          )}
        </div>
      )}
    </div>
  )
}

function Spark({ data, color }: { data: number[]; color: string }) {
  if (data.length < 2) return null
  const lo = Math.min(...data)
  const hi = Math.max(...data)
  const pad = (hi - lo) * 0.15 || 0.15
  const pts = data.map(
    (v, i) => [(i / (data.length - 1)) * 260, 56 - ((v - lo + pad) / (hi - lo + pad * 2)) * 50] as const,
  )
  const line = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join('')
  return (
    <svg
      className="h-16 w-full"
      viewBox="0 0 260 60"
      preserveAspectRatio="none"
      role="img"
      aria-label="Reading over the last minute"
    >
      <path d={`${line}L260 60L0 60Z`} fill={color} opacity="0.16" />
      <path d={line} fill="none" stroke={color} strokeWidth="2" vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

export type MoreInfoDefaultProps = {
  entity: HassEntity
  formatters: EntityFormatters
  history?: number[]
  layer?: FieldKind | null
  onLayer?: (k: FieldKind | null) => void
  children?: ReactNode
}

export function MoreInfoDefault({
  entity,
  formatters,
  history = [],
  layer = null,
  onLayer,
  children,
}: MoreInfoDefaultProps) {
  const domain = domainOf(entity.entity_id)
  const fieldKind = domain === 'sensor' ? fieldOf(entity) : null
  const numericVal = fieldKind ? Number(entity.state) : Number.NaN
  const hasFieldChart = Boolean(fieldKind && !Number.isNaN(numericVal))

  const eventType =
    domain === 'event' && typeof entity.attributes.event_type === 'string'
      ? formatters.formatEntityAttributeValue(entity, 'event_type')
      : undefined
  const eventChangedOverride =
    domain === 'event' && entity.state !== 'unknown' && entity.state !== 'unavailable'
      ? entity.state
      : undefined

  const first = hasFieldChart ? (history[0] ?? numericVal) : 0
  const delta = hasFieldChart ? numericVal - first : 0

  return (
    <div className="flex flex-col gap-3">
      <StateHeader
        entity={entity}
        formatters={formatters}
        stateOverride={eventType}
        changedOverride={eventChangedOverride}
      />

      {hasFieldChart && fieldKind && (
        <>
          {history.length >= 2 && (
            <div className="grid gap-1">
              <Spark data={history} color={fieldColor(fieldKind, numericVal)} />
              <span className="text-right text-xs text-muted-foreground">
                {Math.abs(delta) < 10 ** -FIELDS[fieldKind].digits
                  ? 'Steady'
                  : `${delta > 0 ? '+' : '−'}${Math.abs(delta).toFixed(FIELDS[fieldKind].digits)} in 1 min`}
              </span>
            </div>
          )}
          {onLayer && (
            <button
              type="button"
              onClick={() => onLayer(layer === fieldKind ? null : fieldKind)}
              aria-pressed={layer === fieldKind}
              className={`cursor-pointer rounded-full border px-3 py-1.5 text-sm transition-colors ${
                layer === fieldKind
                  ? 'border-transparent bg-foreground text-background'
                  : 'border-border hover:bg-foreground/5'
              }`}
            >
              {layer === fieldKind
                ? `Showing ${FIELDS[fieldKind].label.toLowerCase()} on the floor`
                : `Show ${FIELDS[fieldKind].label.toLowerCase()} on the floor`}
            </button>
          )}
        </>
      )}

      {children}
    </div>
  )
}
