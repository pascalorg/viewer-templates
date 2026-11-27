/* Ported from home-assistant/frontend (Apache-2.0):
   - src/dialogs/more-info/controls/more-info-cover.ts
   - src/dialogs/more-info/components/covers/ha-more-info-cover-buttons.ts
   - src/dialogs/more-info/components/covers/ha-more-info-cover-favorite-positions.ts */

import {
  mdiAngleAcute,
  mdiArrowBottomLeft,
  mdiArrowTopRight,
  mdiArrowUpDown,
  mdiStop,
} from '@mdi/js'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { HassEntity } from '../entities'
import { useHass } from '../hass/connection'
import type { EntityFormatters } from '../hass/names'
import { ControlButton } from './ControlButton'
import {
  canClose,
  canCloseTilt,
  canOpen,
  canOpenTilt,
  canStop,
  canStopTilt,
  computeCoverCloseIcon,
  computeCoverOpenIcon,
  type CoverAction,
  type CoverCommand,
  type CoverControlMode,
  type CoverDrag,
  CoverEntityFeature,
  type CoverRequest,
  CoverRequestTracker,
  coverCommandData,
  coverCommandService,
  coverCurrentValue,
  coverHasPositionControls,
  coverHasTiltControls,
  coverModeAttribute,
  coverSupportsPosition,
  coverSupportsSetValue,
  DEFAULT_COVER_FAVORITE_POSITIONS,
  defaultCoverMode,
  normalizeFavoritePositions,
} from './cover'
import { CoverGraphic } from './CoverGraphic'
import { MdiIcon } from './MdiIcon'
import { StateHeader } from './StateHeader'
import { HA_COLORS, type ServiceCallFn, supportsFeature, UNAVAILABLE } from './stateColors'

type CoverButtonDef = {
  action: CoverAction
  feature: number
  icon: (entity: HassEntity) => string
  labelKey: string
  enabled: (entity: HassEntity) => boolean
}

const COVER_BUTTONS: Record<CoverControlMode, CoverButtonDef[]> = {
  position: [
    {
      action: 'open',
      feature: CoverEntityFeature.OPEN,
      icon: computeCoverOpenIcon,
      labelKey: 'ui.card.cover.open_cover',
      enabled: canOpen,
    },
    {
      action: 'stop',
      feature: CoverEntityFeature.STOP,
      icon: () => mdiStop,
      labelKey: 'ui.card.cover.stop_cover',
      enabled: canStop,
    },
    {
      action: 'close',
      feature: CoverEntityFeature.CLOSE,
      icon: computeCoverCloseIcon,
      labelKey: 'ui.card.cover.close_cover',
      enabled: canClose,
    },
  ],
  tilt: [
    {
      action: 'open',
      feature: CoverEntityFeature.OPEN_TILT,
      icon: () => mdiArrowTopRight,
      labelKey: 'ui.card.cover.open_tilt_cover',
      enabled: canOpenTilt,
    },
    {
      action: 'stop',
      feature: CoverEntityFeature.STOP_TILT,
      icon: () => mdiStop,
      labelKey: 'ui.card.cover.stop_cover',
      enabled: canStopTilt,
    },
    {
      action: 'close',
      feature: CoverEntityFeature.CLOSE_TILT,
      icon: () => mdiArrowBottomLeft,
      labelKey: 'ui.card.cover.close_tilt_cover',
      enabled: canCloseTilt,
    },
  ],
}

export type MoreInfoCoverProps = {
  entity: HassEntity
  call: ServiceCallFn
  formatters: EntityFormatters
}

export function MoreInfoCover({ entity, call, formatters }: MoreInfoCoverProps) {
  const [mode, setMode] = useState<CoverControlMode>(() => defaultCoverMode(entity))
  const [drag, setDrag] = useState<CoverDrag | undefined>(undefined)
  const [request, setRequest] = useState<CoverRequest | undefined>(undefined)
  const trackerRef = useRef<CoverRequestTracker | null>(null)
  trackerRef.current ??= new CoverRequestTracker()
  const lastEntityIdRef = useRef(entity.entity_id)

  const registryEntry = useHass((s) => s.registryOf[entity.entity_id])

  useEffect(() => {
    if (lastEntityIdRef.current !== entity.entity_id) {
      lastEntityIdRef.current = entity.entity_id
      setMode(defaultCoverMode(entity))
      trackerRef.current?.clear()
      setRequest(undefined)
      setDrag(undefined)
      return
    }
    if (trackerRef.current?.stateChanged(entity)) {
      setRequest(trackerRef.current.request)
    }
  }, [entity])

  const handleCommand = (command: CoverCommand) => {
    const res = call('cover', coverCommandService(command), coverCommandData(entity, command))
    if (res && typeof (res as Promise<boolean>).then === 'function') {
      void (res as Promise<boolean>).then((ok) => {
        if (ok === false && trackerRef.current?.clear()) {
          setRequest(undefined)
        }
      })
    }
    if (trackerRef.current?.commandSent(command, entity)) {
      setRequest(trackerRef.current.request)
    }
  }

  const formatVal = (m: CoverControlMode, value: number) =>
    formatters.formatEntityAttributeValue(entity, coverModeAttribute(m), Math.round(value))

  const dragText = (() => {
    if (!drag) return undefined
    if (!drag.swipe) return formatVal(mode, drag.value)
    if (!drag.swipe.passedHalfway) return undefined
    return (
      formatters.localize(
        drag.swipe.action === 'close'
          ? 'ui.dialogs.more_info_control.cover.closes_on_release'
          : 'ui.dialogs.more_info_control.cover.opens_on_release',
      ) || (drag.swipe.action === 'close' ? 'Closes on release' : 'Opens on release')
    )
  })()

  const stateText = (() => {
    const stateDisplay = formatters.formatEntityState(entity)
    const raw = entity.attributes[coverModeAttribute(mode)]
    const value = typeof raw === 'number' ? Math.round(raw) : 0
    if (value === 0) return stateDisplay
    return `${stateDisplay} · ${formatVal(mode, value)}`
  })()

  const dragHint = (() => {
    if (!drag || drag.swipe) return undefined
    const current = coverCurrentValue(entity, mode)
    if (current === undefined) {
      return (
        formatters.localize('ui.dialogs.more_info_control.cover.currently_unknown') ||
        'Currently unknown'
      )
    }
    const formatted = formatVal(mode, current)
    return (
      formatters.localize('ui.dialogs.more_info_control.cover.currently', { value: formatted }) ||
      `Currently ${formatted}`
    )
  })()

  const requestHint = (() => {
    if (!request || drag) return undefined
    if (request.mode === 'position' && !coverSupportsPosition(entity)) {
      return request.value
        ? formatters.localize('ui.dialogs.more_info_control.cover.requested_open') ||
            'Requested open'
        : formatters.localize('ui.dialogs.more_info_control.cover.requested_closed') ||
            'Requested closed'
    }
    const formatted = formatVal(request.mode, request.value)
    return (
      formatters.localize('ui.dialogs.more_info_control.cover.requested', { value: formatted }) ||
      `Requested ${formatted}`
    )
  })()

  const bothModes = coverHasPositionControls(entity) && coverHasTiltControls(entity)
  const buttons = COVER_BUTTONS[mode].filter((b) => supportsFeature(entity, b.feature))
  const showFavorites = coverSupportsSetValue(entity, mode)

  const favorites = useMemo(() => {
    const raw =
      mode === 'tilt'
        ? registryEntry?.options?.cover?.favorite_tilt_positions
        : registryEntry?.options?.cover?.favorite_positions
    if (raw !== undefined) return normalizeFavoritePositions(raw)
    return DEFAULT_COVER_FAVORITE_POSITIONS
  }, [mode, registryEntry])

  const unavailable = entity.state === UNAVAILABLE
  const currentValue = coverCurrentValue(entity, mode)

  return (
    <div className="flex flex-col items-center gap-5">
      <StateHeader
        entity={entity}
        formatters={formatters}
        stateOverride={dragText ?? stateText}
        changedTextOverride={dragHint ?? requestHint}
        stateAccent={dragText !== undefined}
      />

      <div className="flex w-full flex-col items-center gap-4">
        <CoverGraphic
          entity={entity}
          mode={mode}
          request={request}
          formatters={formatters}
          onCommand={handleCommand}
          onDragChanged={setDrag}
        />

        {bothModes && (
          <div className="flex h-12 items-center rounded-full bg-foreground/[0.08] p-1">
            <button
              type="button"
              aria-pressed={mode === 'position'}
              aria-label={formatters.localize('ui.card.cover.position') || 'Position'}
              title={formatters.localize('ui.card.cover.position') || 'Position'}
              onClick={() => setMode('position')}
              className={`grid size-10 place-items-center rounded-full transition-colors ${
                mode === 'position'
                  ? 'bg-foreground text-background'
                  : 'text-foreground hover:bg-foreground/10'
              }`}
            >
              <MdiIcon path={mdiArrowUpDown} size={20} />
            </button>
            <button
              type="button"
              aria-pressed={mode === 'tilt'}
              aria-label={formatters.localize('ui.card.cover.tilt_position') || 'Tilt position'}
              title={formatters.localize('ui.card.cover.tilt_position') || 'Tilt position'}
              onClick={() => setMode('tilt')}
              className={`grid size-10 place-items-center rounded-full transition-colors ${
                mode === 'tilt'
                  ? 'bg-foreground text-background'
                  : 'text-foreground hover:bg-foreground/10'
              }`}
            >
              <MdiIcon path={mdiAngleAcute} size={20} />
            </button>
          </div>
        )}
      </div>

      {buttons.length > 0 && (
        <div className="flex w-full justify-center gap-2.5">
          {buttons.map((btn) => {
            const ariaLabel = formatters.localize(btn.labelKey) || btn.action
            const shortLabel =
              formatters.localize(`ui.dialogs.more_info_control.cover.${btn.action}`) ||
              btn.action.charAt(0).toUpperCase() + btn.action.slice(1)
            return (
              <ControlButton
                key={btn.action}
                label={ariaLabel}
                disabled={!btn.enabled(entity)}
                borderRadius="16px"
                className="h-16 max-w-[96px] flex-1"
                onClick={() => handleCommand({ mode, action: btn.action })}
              >
                <div className="flex flex-col items-center gap-1 text-xs font-medium">
                  <MdiIcon path={btn.icon(entity)} size={22} />
                  <span>{shortLabel}</span>
                </div>
              </ControlButton>
            )
          })}
        </div>
      )}

      {showFavorites && favorites.length > 0 && (
        <div className="flex w-full flex-wrap justify-center gap-2">
          {favorites.map((fav) => {
            const active = currentValue !== undefined && Math.round(currentValue) === fav
            const labelKey =
              mode === 'position'
                ? 'ui.dialogs.more_info_control.cover.favorite_position.set'
                : 'ui.dialogs.more_info_control.cover.favorite_tilt_position.set'
            const label =
              formatters.localize(labelKey, { value: `${fav}%` }) || `Set to ${fav}%`
            return (
              <ControlButton
                key={fav}
                label={label}
                disabled={unavailable}
                backgroundColor={active ? HA_COLORS.blue : 'var(--foreground)'}
                backgroundOpacity={active ? 1 : 0.1}
                iconColor={active ? '#ffffff' : 'var(--foreground)'}
                borderRadius="9999px"
                className="h-9 w-[64px] text-xs font-medium"
                onClick={() => handleCommand({ mode, action: 'set', value: fav })}
              >
                {fav}%
              </ControlButton>
            )
          })}
        </div>
      )}
    </div>
  )
}
