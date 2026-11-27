/* Ported from home-assistant/frontend (Apache-2.0):
   - src/dialogs/more-info/controls/more-info-alarm_control_panel.ts
   - src/state-control/alarm_control_panel/ha-state-control-alarm_control_panel-modes.ts
   - src/data/alarm_control_panel.ts */

import {
  mdiAirplane,
  mdiHome,
  mdiLock,
  mdiMoonWaningCrescent,
  mdiShield,
  mdiShieldOff,
} from '@mdi/js'
import { useEffect, useState } from 'react'
import type { HassEntity } from '../entities'
import type { EntityFormatters } from '../hass/names'
import { CodeEntry } from './CodeEntry'
import { ControlButton } from './ControlButton'
import { ControlSelect, type ControlSelectOption } from './ControlSelect'
import { resolveEntityIcon } from './icons'
import { MdiIcon } from './MdiIcon'
import { StateHeader } from './StateHeader'
import { type ServiceCallFn, stateColorCss, supportsFeature, UNAVAILABLE } from './stateColors'

export const AlarmControlPanelEntityFeature = {
  ARM_HOME: 1,
  ARM_AWAY: 2,
  ARM_NIGHT: 4,
  TRIGGER: 8,
  ARM_CUSTOM_BYPASS: 16,
  ARM_VACATION: 32,
} as const

type AlarmMode =
  | 'armed_home'
  | 'armed_away'
  | 'armed_night'
  | 'armed_vacation'
  | 'armed_custom_bypass'
  | 'disarmed'

type AlarmModeConfig = {
  service: string
  feature?: number
  path: string
}

const ALARM_MODES: Record<AlarmMode, AlarmModeConfig> = {
  armed_home: {
    feature: AlarmControlPanelEntityFeature.ARM_HOME,
    service: 'alarm_arm_home',
    path: mdiHome,
  },
  armed_away: {
    feature: AlarmControlPanelEntityFeature.ARM_AWAY,
    service: 'alarm_arm_away',
    path: mdiLock,
  },
  armed_night: {
    feature: AlarmControlPanelEntityFeature.ARM_NIGHT,
    service: 'alarm_arm_night',
    path: mdiMoonWaningCrescent,
  },
  armed_vacation: {
    feature: AlarmControlPanelEntityFeature.ARM_VACATION,
    service: 'alarm_arm_vacation',
    path: mdiAirplane,
  },
  armed_custom_bypass: {
    feature: AlarmControlPanelEntityFeature.ARM_CUSTOM_BYPASS,
    service: 'alarm_arm_custom_bypass',
    path: mdiShield,
  },
  disarmed: {
    service: 'alarm_disarm',
    path: mdiShieldOff,
  },
}

const ALARM_MODE_ORDER = Object.keys(ALARM_MODES) as AlarmMode[]

const TRANSITIONAL_STATES = new Set(['triggered', 'arming', 'pending'])

function requiresCode(entity: HassEntity, mode: AlarmMode): boolean {
  const format = entity.attributes.code_format
  if (!format) return false
  if (mode === 'disarmed') return true
  return Boolean(entity.attributes.code_arm_required)
}

export type MoreInfoAlarmControlPanelProps = {
  entity: HassEntity
  call: ServiceCallFn
  formatters: EntityFormatters
}

export function MoreInfoAlarmControlPanel({
  entity,
  call,
  formatters,
}: MoreInfoAlarmControlPanelProps) {
  const [pendingMode, setPendingMode] = useState<AlarmMode | null>(null)

  useEffect(() => {
    setPendingMode(null)
  }, [entity.entity_id])

  const color = stateColorCss(entity)
  const unavailable = entity.state === UNAVAILABLE
  const inTransitionalState = TRANSITIONAL_STATES.has(entity.state)

  const supportedModes = ALARM_MODE_ORDER.filter((mode) => {
    const feature = ALARM_MODES[mode].feature
    return !feature || supportsFeature(entity, feature)
  })

  const currentMode = supportedModes.find((m) => m === entity.state)

  const sendMode = (mode: AlarmMode, code?: string) => {
    void call('alarm_control_panel', ALARM_MODES[mode].service, {
      entity_id: entity.entity_id,
      ...(code !== undefined ? { code } : {}),
    })
  }

  const requestMode = (mode: AlarmMode) => {
    if (mode === entity.state) return
    if (requiresCode(entity, mode)) {
      setPendingMode(mode)
      return
    }
    sendMode(mode)
  }

  const options: ControlSelectOption[] = supportedModes.map((mode) => ({
    value: mode,
    label: formatters.localize(`ui.card.alarm_control_panel.modes.${mode}`) || mode,
    path: ALARM_MODES[mode].path,
  }))

  const codeFormat = entity.attributes.code_format === 'number' ? 'number' : 'text'

  return (
    <div className="flex flex-col items-center gap-5">
      <StateHeader entity={entity} formatters={formatters} />

      <div className="flex w-full flex-col items-center justify-center gap-5">
        {inTransitionalState ? (
          <>
            <div className="flex h-[200px] flex-col items-center justify-center">
              <div
                className="relative flex size-36 animate-pulse items-center justify-center rounded-full"
                style={{ color }}
              >
                <span
                  aria-hidden="true"
                  className="absolute inset-0 rounded-full opacity-20"
                  style={{ backgroundColor: color }}
                />
                <MdiIcon path={resolveEntityIcon(entity, formatters, mdiShield)} size={72} />
              </div>
            </div>

            {!pendingMode && (
              <ControlButton
                label={formatters.localize('ui.card.alarm_control_panel.disarm') || 'Disarm'}
                disabled={unavailable}
                borderRadius="28px"
                className="h-[56px] w-[160px] text-sm font-medium"
                onClick={() => requestMode('disarmed')}
              >
                {formatters.localize('ui.card.alarm_control_panel.disarm') || 'Disarm'}
              </ControlButton>
            )}
          </>
        ) : (
          <ControlSelect
            vertical
            options={options}
            value={currentMode}
            disabled={unavailable}
            label={formatters.localize('ui.card.alarm_control_panel.modes_label') || 'Alarm modes'}
            color={color}
            background={color}
            backgroundOpacity={0.2}
            borderRadius={36}
            className="w-[136px]"
            style={{ minHeight: Math.max(200, supportedModes.length * 64) }}
            onValueChanged={(next) => requestMode(next as AlarmMode)}
          />
        )}

        {pendingMode && (
          <CodeEntry
            codeFormat={codeFormat}
            title={
              formatters.localize(
                pendingMode === 'disarmed'
                  ? 'ui.card.alarm_control_panel.disarm'
                  : 'ui.card.alarm_control_panel.arm',
              ) || (pendingMode === 'disarmed' ? 'Disarm' : 'Arm')
            }
            submitText={
              formatters.localize(
                pendingMode === 'disarmed'
                  ? 'ui.card.alarm_control_panel.disarm'
                  : 'ui.card.alarm_control_panel.arm',
              ) || (pendingMode === 'disarmed' ? 'Disarm' : 'Arm')
            }
            cancelText={formatters.localize('ui.common.cancel') || 'Cancel'}
            codeLabel={formatters.localize('ui.dialogs.enter_code.code') || 'Code'}
            clearLabel={formatters.localize('ui.dialogs.enter_code.clear') || 'Clear'}
            invalidCodeText={
              formatters.localize('ui.dialogs.enter_code.invalid_code') || 'Invalid code'
            }
            onCancel={() => setPendingMode(null)}
            onSubmit={(code) => {
              const mode = pendingMode
              setPendingMode(null)
              sendMode(mode, code)
            }}
          />
        )}
      </div>
    </div>
  )
}
