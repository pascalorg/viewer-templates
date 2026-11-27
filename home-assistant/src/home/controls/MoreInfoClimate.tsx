/* Ported from home-assistant/frontend (Apache-2.0):
   - src/dialogs/more-info/controls/more-info-climate.ts
   - src/dialogs/more-info/components/more-info-control-style.ts */

import {
  mdiArrowOscillating,
  mdiFan,
  mdiThermometer,
  mdiTuneVariant,
  mdiWaterPercent,
} from '@mdi/js'
import { useEffect, useState } from 'react'
import type { HassEntity } from '../entities'
import type { EntityFormatters } from '../hass/names'
import { ClimateHumidity } from './ClimateHumidity'
import { type ClimateServiceCall, ClimateTemperature } from './ClimateTemperature'
import {
  ClimateEntityFeature,
  climateHvacModeIcon,
  compareClimateHvacModes,
  resolveClimateAttributeIcon,
  supportsFeature,
  UNAVAILABLE,
} from './climate'
import { IconToggleGroup } from './IconToggleGroup'
import { SelectContainer, SelectMenu } from './SelectMenu'

type MainControl = 'temperature' | 'humidity'

export type MoreInfoClimateProps = {
  entity: HassEntity
  call: ClimateServiceCall
  formatters: EntityFormatters
}

export function MoreInfoClimate({ entity, call, formatters }: MoreInfoClimateProps) {
  const [mainControl, setMainControl] = useState<MainControl>('temperature')

  const supportTargetHumidity = supportsFeature(entity, ClimateEntityFeature.TARGET_HUMIDITY)
  const supportFanMode = supportsFeature(entity, ClimateEntityFeature.FAN_MODE)
  const supportPresetMode = supportsFeature(entity, ClimateEntityFeature.PRESET_MODE)
  const supportSwingMode = supportsFeature(entity, ClimateEntityFeature.SWING_MODE)
  const supportSwingHorizontalMode = supportsFeature(
    entity,
    ClimateEntityFeature.SWING_HORIZONTAL_MODE,
  )

  useEffect(() => {
    if (mainControl === 'humidity' && !supportTargetHumidity) {
      setMainControl('temperature')
    }
  }, [entity.entity_id, mainControl, supportTargetHumidity])

  const a = entity.attributes
  const unavailable = entity.state === UNAVAILABLE
  const currentTemperature = a.current_temperature
  const currentHumidity = a.current_humidity

  const hvacModes = Array.isArray(a.hvac_modes) ? (a.hvac_modes as string[]) : []
  const presetModes = Array.isArray(a.preset_modes) ? (a.preset_modes as string[]) : null
  const fanModes = Array.isArray(a.fan_modes) ? (a.fan_modes as string[]) : null
  const swingModes = Array.isArray(a.swing_modes) ? (a.swing_modes as string[]) : null
  const swingHorizontalModes = Array.isArray(a.swing_horizontal_modes)
    ? (a.swing_horizontal_modes as string[])
    : null

  const callIfChanged = (
    oldVal: unknown,
    newVal: unknown,
    service: string,
    payload: Record<string, unknown>,
  ) => {
    if (oldVal === newVal) return
    void call('climate', service, { entity_id: entity.entity_id, ...payload })
  }

  return (
    <div className="flex flex-col gap-5 text-foreground">
      {(currentTemperature != null || currentHumidity != null) && (
        <div className="flex flex-row items-center justify-center text-center">
          {currentTemperature != null && (
            <div className="flex flex-1 flex-col items-center justify-center">
              <p className="m-0 mb-1 text-[13px] leading-[1.2] tracking-[0.2px] text-foreground/75">
                {formatters.formatEntityAttributeName(entity, 'current_temperature')}
              </p>
              <p dir="ltr" className="m-0 text-xl leading-[1.2] font-medium">
                {formatters.formatEntityAttributeValue(entity, 'current_temperature')}
              </p>
            </div>
          )}
          {currentHumidity != null && (
            <div className="flex flex-1 flex-col items-center justify-center">
              <p className="m-0 mb-1 text-[13px] leading-[1.2] tracking-[0.2px] text-foreground/75">
                {formatters.formatEntityAttributeName(entity, 'current_humidity')}
              </p>
              <p dir="ltr" className="m-0 text-xl leading-[1.2] font-medium">
                {formatters.formatEntityAttributeValue(entity, 'current_humidity')}
              </p>
            </div>
          )}
        </div>
      )}

      <div className="flex flex-col items-center justify-center gap-4">
        {mainControl === 'temperature' ? (
          <ClimateTemperature entity={entity} call={call} formatters={formatters} />
        ) : (
          <ClimateHumidity entity={entity} call={call} formatters={formatters} />
        )}

        {supportTargetHumidity && (
          <IconToggleGroup<MainControl>
            value={mainControl}
            onChange={setMainControl}
            options={[
              {
                value: 'temperature',
                label: formatters.localize('ui.dialogs.more_info_control.climate.temperature'),
                iconPath: mdiThermometer,
                disabled: unavailable,
              },
              {
                value: 'humidity',
                label: formatters.localize('ui.dialogs.more_info_control.climate.humidity'),
                iconPath: mdiWaterPercent,
                disabled: unavailable,
              },
            ]}
          />
        )}
      </div>

      <SelectContainer>
        {hvacModes.length > 0 && (
          <SelectMenu
            label={formatters.localize('ui.card.climate.mode')}
            value={entity.state}
            disabled={unavailable}
            defaultIconPath={climateHvacModeIcon(entity.state)}
            options={[...hvacModes].sort(compareClimateHvacModes).map((mode) => ({
              value: mode,
              iconPath: climateHvacModeIcon(mode),
              label: formatters.formatEntityState(entity, mode),
            }))}
            onSelect={(mode) => callIfChanged(entity.state, mode, 'set_hvac_mode', { hvac_mode: mode })}
          />
        )}

        {supportPresetMode && presetModes && (
          <SelectMenu
            label={formatters.formatEntityAttributeName(entity, 'preset_mode')}
            value={typeof a.preset_mode === 'string' ? a.preset_mode : undefined}
            disabled={unavailable}
            defaultIconPath={mdiTuneVariant}
            options={presetModes.map((mode) => ({
              value: mode,
              iconPath: resolveClimateAttributeIcon(entity, 'preset_mode', mode, formatters, mdiTuneVariant),
              label: formatters.formatEntityAttributeValue(entity, 'preset_mode', mode),
            }))}
            onSelect={(mode) => {
              if (!mode) return
              callIfChanged(a.preset_mode, mode, 'set_preset_mode', { preset_mode: mode })
            }}
          />
        )}

        {supportFanMode && fanModes && (
          <SelectMenu
            label={formatters.formatEntityAttributeName(entity, 'fan_mode')}
            value={typeof a.fan_mode === 'string' ? a.fan_mode : undefined}
            disabled={unavailable}
            defaultIconPath={mdiFan}
            options={fanModes.map((mode) => ({
              value: mode,
              iconPath: resolveClimateAttributeIcon(entity, 'fan_mode', mode, formatters, mdiFan),
              label: formatters.formatEntityAttributeValue(entity, 'fan_mode', mode),
            }))}
            onSelect={(mode) => callIfChanged(a.fan_mode, mode, 'set_fan_mode', { fan_mode: mode })}
          />
        )}

        {supportSwingMode && swingModes && (
          <SelectMenu
            label={formatters.formatEntityAttributeName(entity, 'swing_mode')}
            value={typeof a.swing_mode === 'string' ? a.swing_mode : undefined}
            disabled={unavailable}
            defaultIconPath={mdiArrowOscillating}
            options={swingModes.map((mode) => ({
              value: mode,
              iconPath: resolveClimateAttributeIcon(entity, 'swing_mode', mode, formatters, mdiArrowOscillating),
              label: formatters.formatEntityAttributeValue(entity, 'swing_mode', mode),
            }))}
            onSelect={(mode) => callIfChanged(a.swing_mode, mode, 'set_swing_mode', { swing_mode: mode })}
          />
        )}

        {supportSwingHorizontalMode && swingHorizontalModes && (
          <SelectMenu
            label={formatters.formatEntityAttributeName(entity, 'swing_horizontal_mode')}
            value={typeof a.swing_horizontal_mode === 'string' ? a.swing_horizontal_mode : undefined}
            disabled={unavailable}
            defaultIconPath={mdiArrowOscillating}
            options={swingHorizontalModes.map((mode) => ({
              value: mode,
              iconPath: resolveClimateAttributeIcon(
                entity,
                'swing_horizontal_mode',
                mode,
                formatters,
                mdiArrowOscillating,
              ),
              label: formatters.formatEntityAttributeValue(entity, 'swing_horizontal_mode', mode),
            }))}
            onSelect={(mode) =>
              callIfChanged(a.swing_horizontal_mode, mode, 'set_swing_horizontal_mode', {
                swing_horizontal_mode: mode,
              })
            }
          />
        )}
      </SelectContainer>
    </div>
  )
}
