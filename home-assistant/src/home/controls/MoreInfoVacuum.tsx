/* Ported from home-assistant/frontend (Apache-2.0):
   - src/dialogs/more-info/controls/more-info-vacuum.ts
   - src/data/vacuum.ts */

import {
  mdiFan,
  mdiHomeImportOutline,
  mdiMapMarker,
  mdiPause,
  mdiPlay,
  mdiPlayPause,
  mdiStop,
  mdiTargetVariant,
} from '@mdi/js'
import type { HassEntities, HassEntity } from '../entities'
import type { EntityFormatters } from '../hass/names'
import { ControlButton, ControlButtonGroup } from './ControlButton'
import { MdiIcon } from './MdiIcon'
import { DeviceBatteryBadge, VacuumStatus } from './RobotStatus'
import { SelectContainer, SelectMenu } from './SelectMenu'
import { type ServiceCallFn, supportsFeature, UNAVAILABLE } from './stateColors'
import { StateHeader } from './StateHeader'

export const VacuumEntityFeature = {
  TURN_ON: 1,
  TURN_OFF: 2,
  PAUSE: 4,
  STOP: 8,
  RETURN_HOME: 16,
  FAN_SPEED: 32,
  STATUS: 128,
  SEND_COMMAND: 256,
  LOCATE: 512,
  CLEAN_SPOT: 1024,
  MAP: 2048,
  STATE: 4096,
  START: 8192,
  CLEAN_AREA: 16384,
} as const

function isCleaning(entity: HassEntity): boolean {
  return entity.state === 'cleaning' || entity.state === 'on'
}

function canStart(entity: HassEntity): boolean {
  if (entity.state === UNAVAILABLE) return false
  return !isCleaning(entity)
}

function canStop(entity: HassEntity): boolean {
  return entity.state !== 'docked' && entity.state !== 'off' && entity.state !== 'idle'
}

function canReturnHome(entity: HassEntity): boolean {
  if (entity.state === UNAVAILABLE) return false
  return entity.state !== 'returning'
}

export type MoreInfoVacuumProps = {
  entity: HassEntity
  entities?: HassEntities
  call: ServiceCallFn
  formatters: EntityFormatters
}

export function MoreInfoVacuum({ entity, entities, call, formatters }: MoreInfoVacuumProps) {
  const a = entity.attributes
  const unavailable = entity.state === UNAVAILABLE

  const stateOverride =
    supportsFeature(entity, VacuumEntityFeature.STATUS) && typeof a.status === 'string' && a.status
      ? formatters.formatEntityAttributeValue(entity, 'status')
      : undefined

  const supportsStart = supportsFeature(entity, VacuumEntityFeature.START)
  const supportsPause = supportsFeature(entity, VacuumEntityFeature.PAUSE)
  const supportsState = supportsFeature(entity, VacuumEntityFeature.STATE)
  const supportsStartPause = supportsStart || supportsPause
  const legacyStartPause = !supportsState && !supportsStart && supportsPause

  const supportsStop = supportsFeature(entity, VacuumEntityFeature.STOP)
  const supportsReturnHome = supportsFeature(entity, VacuumEntityFeature.RETURN_HOME)
  const supportsLocate = supportsFeature(entity, VacuumEntityFeature.LOCATE)
  const supportsCleanSpot = supportsFeature(entity, VacuumEntityFeature.CLEAN_SPOT)
  const supportsFanSpeed = supportsFeature(entity, VacuumEntityFeature.FAN_SPEED)

  const fanSpeedList = Array.isArray(a.fan_speed_list) ? (a.fan_speed_list as string[]) : []
  const currentFanSpeed = typeof a.fan_speed === 'string' ? a.fan_speed : undefined

  const hasAnyCommand =
    supportsStartPause ||
    supportsStop ||
    supportsReturnHome ||
    supportsLocate ||
    supportsCleanSpot

  const showPause = isCleaning(entity) && supportsPause
  const startPauseIcon = legacyStartPause ? mdiPlayPause : showPause ? mdiPause : mdiPlay

  const startPauseLabel = legacyStartPause
    ? formatters.localize('ui.dialogs.more_info_control.vacuum.start_pause') || 'Start/pause'
    : showPause
      ? formatters.localize('ui.dialogs.more_info_control.vacuum.pause') || 'Pause'
      : formatters.localize('ui.dialogs.more_info_control.vacuum.start') || 'Start'

  const startPauseDisabled =
    unavailable || (!legacyStartPause && !showPause && (!supportsStart || !canStart(entity)))

  const callVacuum = (service: string) => {
    void call('vacuum', service, { entity_id: entity.entity_id })
  }

  const handleStartPause = () => {
    if (legacyStartPause) {
      callVacuum('start_pause')
      return
    }
    callVacuum(showPause ? 'pause' : 'start')
  }

  return (
    <div className="flex flex-col items-center gap-4">
      <StateHeader
        entity={entity}
        formatters={formatters}
        stateOverride={stateOverride}
        afterTime={<DeviceBatteryBadge entity={entity} entities={entities} formatters={formatters} />}
      />

      <div className="flex w-full flex-col items-center gap-4">
        <VacuumStatus entity={entity} />

        {hasAnyCommand && (
          <ControlButtonGroup>
            {supportsStartPause && (
              <ControlButton
                label={startPauseLabel}
                disabled={startPauseDisabled}
                borderRadius="12px"
                className="h-12 w-12"
                onClick={handleStartPause}
              >
                <MdiIcon path={startPauseIcon} size={22} />
              </ControlButton>
            )}

            {supportsStop && (
              <ControlButton
                label={formatters.localize('ui.dialogs.more_info_control.vacuum.stop') || 'Stop'}
                disabled={unavailable || !canStop(entity)}
                borderRadius="12px"
                className="h-12 w-12"
                onClick={() => callVacuum('stop')}
              >
                <MdiIcon path={mdiStop} size={22} />
              </ControlButton>
            )}

            {supportsReturnHome && (
              <ControlButton
                label={
                  formatters.localize('ui.dialogs.more_info_control.vacuum.return_home') ||
                  'Return to dock'
                }
                disabled={unavailable || !canReturnHome(entity)}
                borderRadius="12px"
                className="h-12 w-12"
                onClick={() => callVacuum('return_to_base')}
              >
                <MdiIcon path={mdiHomeImportOutline} size={22} />
              </ControlButton>
            )}

            {supportsLocate && (
              <ControlButton
                label={
                  formatters.localize('ui.dialogs.more_info_control.vacuum.locate') || 'Locate'
                }
                disabled={unavailable}
                borderRadius="12px"
                className="h-12 w-12"
                onClick={() => callVacuum('locate')}
              >
                <MdiIcon path={mdiMapMarker} size={22} />
              </ControlButton>
            )}

            {supportsCleanSpot && (
              <ControlButton
                label={
                  formatters.localize('ui.dialogs.more_info_control.vacuum.clean_spot') ||
                  'Clean spot'
                }
                disabled={unavailable}
                borderRadius="12px"
                className="h-12 w-12"
                onClick={() => callVacuum('clean_spot')}
              >
                <MdiIcon path={mdiTargetVariant} size={22} />
              </ControlButton>
            )}
          </ControlButtonGroup>
        )}
      </div>

      {supportsFanSpeed && fanSpeedList.length > 0 && (
        <SelectContainer>
          <SelectMenu
            label={formatters.formatEntityAttributeName(entity, 'fan_speed')}
            value={currentFanSpeed}
            disabled={unavailable}
            defaultIconPath={mdiFan}
            options={fanSpeedList.map((mode) => ({
              value: mode,
              label: formatters.formatEntityAttributeValue(entity, 'fan_speed', mode),
            }))}
            onSelect={(fan_speed) => {
              if (!fan_speed || fan_speed === currentFanSpeed) return
              void call('vacuum', 'set_fan_speed', {
                entity_id: entity.entity_id,
                fan_speed,
              })
            }}
          />
        </SelectContainer>
      )}
    </div>
  )
}
