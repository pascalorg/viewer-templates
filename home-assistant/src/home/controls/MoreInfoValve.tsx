/* Ported from home-assistant/frontend (Apache-2.0):
   - src/dialogs/more-info/controls/more-info-valve.ts
   - src/state-control/valve/ha-state-control-valve-position.ts
   - src/state-control/valve/ha-state-control-valve-toggle.ts
   - src/state-control/valve/ha-state-control-valve-buttons.ts
   - src/dialogs/more-info/components/valves/ha-more-info-valve-favorite-positions.ts */

import { mdiMenu, mdiStop, mdiSwapVertical, mdiValveClosed, mdiValveOpen } from '@mdi/js'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { HassEntity } from '../entities'
import { useHass } from '../hass/connection'
import type { EntityFormatters } from '../hass/names'
import { ControlButton, ControlButtonGroup } from './ControlButton'
import { ControlSlider } from './ControlSlider'
import { ControlSwitch } from './ControlSwitch'
import { normalizeFavoritePositions } from './cover'
import { MdiIcon } from './MdiIcon'
import { StateHeader } from './StateHeader'
import { HA_COLORS, type ServiceCallFn, stateColorCss, supportsFeature, UNAVAILABLE, UNKNOWN } from './stateColors'
import {
  canCloseValve,
  canOpenValve,
  canStopValve,
  computeValvePositionStateDisplay,
  DEFAULT_VALVE_FAVORITE_POSITIONS,
  ValveEntityFeature,
  valveSupportsPosition,
} from './valve'

type ValveMode = 'position' | 'button'

function ValvePositionSlider({
  entity,
  call,
  formatters,
}: {
  entity: HassEntity
  call: ServiceCallFn
  formatters: EntityFormatters
}) {
  const color = stateColorCss(entity)
  const rawPos = entity.attributes.current_position
  const value = typeof rawPos === 'number' ? Math.round(rawPos) : undefined

  return (
    <ControlSlider
      vertical
      showHandle
      min={0}
      max={100}
      value={value}
      disabled={entity.state === UNAVAILABLE}
      label={formatters.formatEntityAttributeName(entity, 'current_position')}
      unit="%"
      formatters={formatters}
      color={color}
      background={color}
      backgroundOpacity={0.2}
      thickness={130}
      borderRadius={36}
      className="h-[240px]"
      onValueChanged={(pos) => {
        void call('valve', 'set_valve_position', {
          entity_id: entity.entity_id,
          position: pos,
        })
      }}
    />
  )
}

function ValveToggleControl({
  entity,
  call,
  formatters,
}: {
  entity: HassEntity
  call: ServiceCallFn
  formatters: EntityFormatters
}) {
  const onColor = stateColorCss(entity, 'open')
  const offColor = stateColorCss(entity, 'closed')
  const isOpen =
    entity.state === 'open' || entity.state === 'opening' || entity.state === 'closing'
  const isClosed = entity.state === 'closed'
  const unavailable = entity.state === UNAVAILABLE

  const send = (open: boolean) => {
    void call('valve', open ? 'open_valve' : 'close_valve', { entity_id: entity.entity_id })
  }

  if (entity.attributes.assumed_state || entity.state === UNKNOWN) {
    return (
      <div className="flex flex-col items-center gap-3">
        <ControlButton
          label={formatters.localize('ui.card.valve.open_valve') || 'Open valve'}
          disabled={unavailable}
          backgroundColor={onColor}
          backgroundOpacity={isOpen ? 1 : 0.2}
          iconColor={isOpen ? '#ffffff' : onColor}
          borderRadius="28px"
          className="h-[110px] w-[130px]"
          onClick={() => send(true)}
        >
          <MdiIcon path={mdiValveOpen} size={24} />
        </ControlButton>
        <ControlButton
          label={formatters.localize('ui.card.valve.close_valve') || 'Close valve'}
          disabled={unavailable}
          backgroundColor={offColor}
          backgroundOpacity={isClosed ? 1 : 0.2}
          iconColor={isClosed ? '#ffffff' : offColor}
          borderRadius="28px"
          className="h-[110px] w-[130px]"
          onClick={() => send(false)}
        >
          <MdiIcon path={mdiValveClosed} size={24} />
        </ControlButton>
      </div>
    )
  }

  return (
    <ControlSwitch
      vertical
      reversed
      checked={isOpen}
      disabled={unavailable}
      pathOn={mdiValveOpen}
      pathOff={mdiValveClosed}
      iconSize={24}
      onColor={onColor}
      offColor={offColor}
      borderRadius={36}
      padding={8}
      className="h-[240px] w-[130px]"
      label={
        isOpen
          ? formatters.localize('ui.card.valve.close_valve') || 'Close valve'
          : formatters.localize('ui.card.valve.open_valve') || 'Open valve'
      }
      onChange={send}
    />
  )
}

function ValveButtonsControl({
  entity,
  call,
  formatters,
}: {
  entity: HassEntity
  call: ServiceCallFn
  formatters: EntityFormatters
}) {
  const buttons: ('open' | 'stop' | 'close')[] = []
  if (supportsFeature(entity, ValveEntityFeature.OPEN)) buttons.push('open')
  if (supportsFeature(entity, ValveEntityFeature.STOP)) buttons.push('stop')
  if (supportsFeature(entity, ValveEntityFeature.CLOSE)) buttons.push('close')

  return (
    <ControlButtonGroup vertical className="h-[240px] w-[100px] gap-2.5">
      {buttons.map((btn) => {
        if (btn === 'open') {
          return (
            <ControlButton
              key="open"
              label={formatters.localize('ui.card.valve.open_valve') || 'Open valve'}
              disabled={!canOpenValve(entity)}
              borderRadius="32px"
              className="w-full flex-1"
              onClick={() => void call('valve', 'open_valve', { entity_id: entity.entity_id })}
            >
              <MdiIcon path={mdiValveOpen} size={24} />
            </ControlButton>
          )
        }
        if (btn === 'stop') {
          return (
            <ControlButton
              key="stop"
              label={formatters.localize('ui.card.valve.stop_valve') || 'Stop valve'}
              disabled={!canStopValve(entity)}
              borderRadius="32px"
              className="w-full flex-1"
              onClick={() => void call('valve', 'stop_valve', { entity_id: entity.entity_id })}
            >
              <MdiIcon path={mdiStop} size={24} />
            </ControlButton>
          )
        }
        return (
          <ControlButton
            key="close"
            label={formatters.localize('ui.card.valve.close_valve') || 'Close valve'}
            disabled={!canCloseValve(entity)}
            borderRadius="32px"
            className="w-full flex-1"
            onClick={() => void call('valve', 'close_valve', { entity_id: entity.entity_id })}
          >
            <MdiIcon path={mdiValveClosed} size={24} />
          </ControlButton>
        )
      })}
    </ControlButtonGroup>
  )
}

export type MoreInfoValveProps = {
  entity: HassEntity
  call: ServiceCallFn
  formatters: EntityFormatters
}

export function MoreInfoValve({ entity, call, formatters }: MoreInfoValveProps) {
  const supportsPosition = valveSupportsPosition(entity)
  const [mode, setMode] = useState<ValveMode>(() => (supportsPosition ? 'position' : 'button'))
  const lastEntityIdRef = useRef(entity.entity_id)
  const registryEntry = useHass((s) => s.registryOf[entity.entity_id])

  useEffect(() => {
    if (lastEntityIdRef.current !== entity.entity_id) {
      lastEntityIdRef.current = entity.entity_id
      setMode(valveSupportsPosition(entity) ? 'position' : 'button')
    }
  }, [entity])

  const supportsOpenClose =
    supportsFeature(entity, ValveEntityFeature.OPEN) ||
    supportsFeature(entity, ValveEntityFeature.CLOSE) ||
    supportsFeature(entity, ValveEntityFeature.STOP)

  const supportsOpenCloseOnly =
    supportsFeature(entity, ValveEntityFeature.OPEN) &&
    supportsFeature(entity, ValveEntityFeature.CLOSE) &&
    !supportsFeature(entity, ValveEntityFeature.STOP) &&
    !supportsPosition

  const stateDisplay = formatters.formatEntityState(entity)
  const positionDisplay = computeValvePositionStateDisplay(entity, formatters)
  const stateOverride = positionDisplay ? `${stateDisplay} · ${positionDisplay}` : stateDisplay

  const favorites = useMemo(() => {
    const raw = registryEntry?.options?.valve?.favorite_positions
    if (raw !== undefined) return normalizeFavoritePositions(raw)
    return DEFAULT_VALVE_FAVORITE_POSITIONS
  }, [registryEntry])

  const unavailable = entity.state === UNAVAILABLE
  const currentPos =
    typeof entity.attributes.current_position === 'number'
      ? Math.round(entity.attributes.current_position)
      : undefined

  return (
    <div className="flex flex-col items-center gap-5">
      <StateHeader entity={entity} formatters={formatters} stateOverride={stateOverride} />

      <div className="flex w-full flex-col items-center gap-5">
        <div className="flex items-center justify-center">
          {mode === 'position' && supportsPosition && (
            <ValvePositionSlider entity={entity} call={call} formatters={formatters} />
          )}
          {mode === 'button' &&
            (supportsOpenCloseOnly ? (
              <ValveToggleControl entity={entity} call={call} formatters={formatters} />
            ) : supportsOpenClose ? (
              <ValveButtonsControl entity={entity} call={call} formatters={formatters} />
            ) : null)}
        </div>

        {supportsPosition && supportsOpenClose && (
          <div className="flex h-12 items-center rounded-full bg-foreground/[0.08] p-1">
            <button
              type="button"
              aria-pressed={mode === 'position'}
              aria-label={
                formatters.localize('ui.dialogs.more_info_control.valve.switch_mode.position') ||
                'Position'
              }
              title={
                formatters.localize('ui.dialogs.more_info_control.valve.switch_mode.position') ||
                'Position'
              }
              onClick={() => setMode('position')}
              className={`grid size-10 place-items-center rounded-full transition-colors ${
                mode === 'position'
                  ? 'bg-foreground text-background'
                  : 'text-foreground hover:bg-foreground/10'
              }`}
            >
              <MdiIcon path={mdiMenu} size={20} />
            </button>
            <button
              type="button"
              aria-pressed={mode === 'button'}
              aria-label={
                formatters.localize('ui.dialogs.more_info_control.valve.switch_mode.button') ||
                'Buttons'
              }
              title={
                formatters.localize('ui.dialogs.more_info_control.valve.switch_mode.button') ||
                'Buttons'
              }
              onClick={() => setMode('button')}
              className={`grid size-10 place-items-center rounded-full transition-colors ${
                mode === 'button'
                  ? 'bg-foreground text-background'
                  : 'text-foreground hover:bg-foreground/10'
              }`}
            >
              <MdiIcon path={mdiSwapVertical} size={20} />
            </button>
          </div>
        )}

        {supportsPosition && favorites.length > 0 && (
          <div className="flex w-full flex-wrap justify-center gap-2">
            {favorites.map((fav) => {
              const active = currentPos === fav
              const label =
                formatters.localize('ui.dialogs.more_info_control.valve.favorite_position.set', {
                  value: `${fav}%`,
                }) || `Set to ${fav}%`
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
                  onClick={() =>
                    void call('valve', 'set_valve_position', {
                      entity_id: entity.entity_id,
                      position: fav,
                    })
                  }
                >
                  {fav}%
                </ControlButton>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
