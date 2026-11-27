/* Ported from home-assistant/frontend (Apache-2.0):
   - src/dialogs/more-info/controls/more-info-lawn_mower.ts
   - src/data/lawn_mower.ts */

import { mdiHomeImportOutline, mdiPause, mdiPlay, mdiStop } from '@mdi/js'
import type { HassEntities, HassEntity } from '../entities'
import type { EntityFormatters } from '../hass/names'
import { ControlButton, ControlButtonGroup } from './ControlButton'
import { MdiIcon } from './MdiIcon'
import { DeviceBatteryBadge, LawnMowerStatus } from './RobotStatus'
import { type ServiceCallFn, supportsFeature, UNAVAILABLE } from './stateColors'
import { StateHeader } from './StateHeader'

export const LawnMowerEntityFeature = {
  START_MOWING: 1,
  PAUSE: 2,
  DOCK: 4,
  STOP: 8,
} as const

function isMowing(entity: HassEntity): boolean {
  return entity.state === 'mowing'
}

function canStartMowing(entity: HassEntity): boolean {
  if (entity.state === UNAVAILABLE) return false
  return entity.state !== 'mowing'
}

function canStop(entity: HassEntity): boolean {
  if (entity.state === UNAVAILABLE) return false
  return entity.state !== 'docked' && entity.state !== 'idle'
}

function canDock(entity: HassEntity): boolean {
  if (entity.state === UNAVAILABLE) return false
  return entity.state !== 'docked'
}

export type MoreInfoLawnMowerProps = {
  entity: HassEntity
  entities?: HassEntities
  call: ServiceCallFn
  formatters: EntityFormatters
}

export function MoreInfoLawnMower({ entity, entities, call, formatters }: MoreInfoLawnMowerProps) {
  const unavailable = entity.state === UNAVAILABLE

  const supportsStartMowing = supportsFeature(entity, LawnMowerEntityFeature.START_MOWING)
  const supportsPause = supportsFeature(entity, LawnMowerEntityFeature.PAUSE)
  const supportsStartPause = supportsStartMowing || supportsPause
  const showPause = isMowing(entity) && supportsPause

  const supportsStop = supportsFeature(entity, LawnMowerEntityFeature.STOP)
  const supportsDock = supportsFeature(entity, LawnMowerEntityFeature.DOCK)
  const hasAnyCommand = supportsStartPause || supportsStop || supportsDock

  const startPauseIcon = showPause ? mdiPause : mdiPlay
  const startPauseLabel = showPause
    ? formatters.localize('ui.dialogs.more_info_control.lawn_mower.pause') || 'Pause'
    : formatters.localize('ui.dialogs.more_info_control.lawn_mower.start_mowing') || 'Start mowing'
  const startPauseDisabled =
    unavailable || (!showPause && (!supportsStartMowing || !canStartMowing(entity)))

  const callMower = (service: string) => {
    void call('lawn_mower', service, { entity_id: entity.entity_id })
  }

  return (
    <div className="flex flex-col items-center gap-4">
      <StateHeader
        entity={entity}
        formatters={formatters}
        afterTime={<DeviceBatteryBadge entity={entity} entities={entities} formatters={formatters} />}
      />

      <div className="flex w-full flex-col items-center gap-4">
        <LawnMowerStatus entity={entity} />

        {hasAnyCommand && (
          <ControlButtonGroup>
            {supportsStartPause && (
              <ControlButton
                label={startPauseLabel}
                disabled={startPauseDisabled}
                borderRadius="12px"
                className="h-12 w-12"
                onClick={() => callMower(showPause ? 'pause' : 'start_mowing')}
              >
                <MdiIcon path={startPauseIcon} size={22} />
              </ControlButton>
            )}

            {supportsStop && (
              <ControlButton
                label={formatters.localize('ui.dialogs.more_info_control.lawn_mower.stop') || 'Stop'}
                disabled={unavailable || !canStop(entity)}
                borderRadius="12px"
                className="h-12 w-12"
                onClick={() => callMower('stop')}
              >
                <MdiIcon path={mdiStop} size={22} />
              </ControlButton>
            )}

            {supportsDock && (
              <ControlButton
                label={
                  formatters.localize('ui.dialogs.more_info_control.lawn_mower.dock') ||
                  'Return to dock'
                }
                disabled={unavailable || !canDock(entity)}
                borderRadius="12px"
                className="h-12 w-12"
                onClick={() => callMower('dock')}
              >
                <MdiIcon path={mdiHomeImportOutline} size={22} />
              </ControlButton>
            )}
          </ControlButtonGroup>
        )}
      </div>
    </div>
  )
}
