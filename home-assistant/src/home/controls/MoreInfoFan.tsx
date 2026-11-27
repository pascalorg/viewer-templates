/* Ported from home-assistant/frontend (Apache-2.0):
   - src/dialogs/more-info/controls/more-info-fan.ts
   - src/state-control/fan/ha-state-control-fan-speed.ts
   - src/data/fan.ts */

import {
  mdiArrowOscillating,
  mdiArrowOscillatingOff,
  mdiFan,
  mdiFanOff,
  mdiFanSpeed1,
  mdiFanSpeed2,
  mdiFanSpeed3,
  mdiPower,
  mdiRotateLeft,
  mdiRotateRight,
  mdiTuneVariant,
} from '@mdi/js'
import type { HassEntity } from '../entities'
import type { EntityFormatters } from '../hass/names'
import { ControlSelect, type ControlSelectOption } from './ControlSelect'
import { ControlSlider } from './ControlSlider'
import { StateControlToggle } from './ControlSwitch'
import { resolveAttributeIcon } from './icons'
import { MdiIcon } from './MdiIcon'
import { SelectContainer, SelectMenu } from './SelectMenu'
import { StateHeader } from './StateHeader'
import { type ServiceCallFn, stateActive, stateColorCss, supportsFeature, UNAVAILABLE } from './stateColors'

export const FanEntityFeature = {
  SET_SPEED: 1,
  OSCILLATE: 2,
  DIRECTION: 4,
  PRESET_MODE: 8,
  TURN_OFF: 16,
  TURN_ON: 32,
} as const

type FanSpeed = 'off' | 'low' | 'medium' | 'high' | 'on' | `${number}`

const FAN_SPEEDS_NAMED: Readonly<Partial<Record<number, FanSpeed[]>>> = {
  2: ['off', 'on'],
  3: ['off', 'low', 'high'],
  4: ['off', 'low', 'medium', 'high'],
}

export const FAN_SPEED_COUNT_MAX_FOR_BUTTONS = 6
const FAN_SPEED_COUNT_MAX_FOR_DISCRETE_SPEEDS = 11

export function computeFanSpeedCount(entity: HassEntity): number {
  const step = Number(entity.attributes.percentage_step ?? 1)
  return Math.round(100 / (step > 0 ? step : 1)) + 1
}

function computeFanSpeeds(entity: HassEntity): FanSpeed[] | undefined {
  const speedCount = computeFanSpeedCount(entity)
  if (speedCount > FAN_SPEED_COUNT_MAX_FOR_DISCRETE_SPEEDS) return undefined
  return (
    FAN_SPEEDS_NAMED[speedCount] ?? [
      'off',
      ...Array.from({ length: speedCount - 1 }, (_, i) => `${i + 1}` as FanSpeed),
    ]
  )
}

const isNumberedFanSpeed = (speed: FanSpeed): speed is `${number}` => !Number.isNaN(Number(speed))

function fanPercentageToSpeed(entity: HassEntity, value: number): FanSpeed {
  const step = Number(entity.attributes.percentage_step ?? 1)
  const idx = Math.round(value / (step > 0 ? step : 1))
  const speeds = computeFanSpeeds(entity)
  return speeds?.[idx] ?? 'off'
}

function fanSpeedToPercentage(entity: HassEntity, speed: FanSpeed): number {
  const step = Number(entity.attributes.percentage_step ?? 1)
  const speeds = computeFanSpeeds(entity)
  if (!speeds) return 0
  const idx = speeds.indexOf(speed)
  if (idx === -1) return 0
  return Math.floor(idx * step)
}

function computeFanSpeedIcon(entity: HassEntity, speed: FanSpeed): string | undefined {
  if (speed === 'on') return mdiFan
  if (speed === 'off') return mdiFanOff
  if (isNumberedFanSpeed(speed)) return undefined
  const idx = computeFanSpeeds(entity)?.indexOf(speed) ?? 1
  return [mdiFanSpeed1, mdiFanSpeed2, mdiFanSpeed3][idx - 1]
}

function computeFanSpeedStateDisplay(entity: HassEntity, formatters: EntityFormatters): string {
  const percentage = stateActive(entity) ? Number(entity.attributes.percentage ?? 0) : 0
  return percentage
    ? formatters.formatEntityAttributeValue(entity, 'percentage', Math.round(percentage))
    : ''
}

function FanSpeedControl({
  entity,
  call,
  formatters,
}: {
  entity: HassEntity
  call: ServiceCallFn
  formatters: EntityFormatters
}) {
  const color = stateColorCss(entity)
  const unavailable = entity.state === UNAVAILABLE
  const percentage = stateActive(entity) ? Number(entity.attributes.percentage ?? 0) : 0
  const sliderValue = Math.max(Math.round(percentage), 0)
  const speedValue = fanPercentageToSpeed(entity, percentage)
  const speedLabel = formatters.formatEntityAttributeName(entity, 'percentage')

  const localizeSpeed = (speed: FanSpeed): string => {
    if (speed === 'on' || speed === 'off') {
      return formatters.formatEntityState(entity, speed)
    }
    if (isNumberedFanSpeed(speed)) {
      return (
        formatters.localize('ui.card.fan.speed.numbered', {
          speed: formatters.formatNumber(speed),
        }) || `Speed ${speed}`
      )
    }
    return formatters.localize(`ui.card.fan.speed.${speed}`) || speed
  }

  const useButtons = computeFanSpeedCount(entity) <= FAN_SPEED_COUNT_MAX_FOR_BUTTONS
  const speeds = useButtons ? computeFanSpeeds(entity) : undefined

  if (speeds) {
    const options: ControlSelectOption[] = speeds
      .map<ControlSelectOption>((speed) =>
        isNumberedFanSpeed(speed)
          ? {
              value: speed,
              label: formatters.formatNumber(speed),
              ariaLabel: localizeSpeed(speed),
            }
          : {
              value: speed,
              label: localizeSpeed(speed),
              path: computeFanSpeedIcon(entity, speed),
            },
      )
      .reverse()

    return (
      <ControlSelect
        vertical
        options={options}
        value={speedValue}
        disabled={unavailable}
        label={speedLabel}
        color={color}
        background={color}
        backgroundOpacity={0.2}
        borderRadius={36}
        className="h-[240px] w-[130px]"
        onValueChanged={(next) => {
          const pct = fanSpeedToPercentage(entity, next as FanSpeed)
          void call('fan', 'set_percentage', { entity_id: entity.entity_id, percentage: pct })
        }}
      />
    )
  }

  return (
    <ControlSlider
      vertical
      min={0}
      max={100}
      value={sliderValue}
      step={Number(entity.attributes.percentage_step ?? 1)}
      roundValue
      disabled={unavailable}
      label={speedLabel}
      unit="%"
      formatters={formatters}
      color={color}
      background={color}
      backgroundOpacity={0.2}
      thickness={130}
      borderRadius={36}
      className="h-[240px]"
      onValueChanged={(val) => {
        void call('fan', 'set_percentage', { entity_id: entity.entity_id, percentage: val })
      }}
    />
  )
}

export type MoreInfoFanProps = {
  entity: HassEntity
  call: ServiceCallFn
  formatters: EntityFormatters
}

export function MoreInfoFan({ entity, call, formatters }: MoreInfoFanProps) {
  const unavailable = entity.state === UNAVAILABLE
  const supportsOnOff =
    supportsFeature(entity, FanEntityFeature.TURN_ON) ||
    supportsFeature(entity, FanEntityFeature.TURN_OFF)
  const supportsSpeed = supportsFeature(entity, FanEntityFeature.SET_SPEED)
  const supportsDirection = supportsFeature(entity, FanEntityFeature.DIRECTION)
  const supportsOscillate = supportsFeature(entity, FanEntityFeature.OSCILLATE)
  const supportsPresetMode = supportsFeature(entity, FanEntityFeature.PRESET_MODE)
  const supportSpeedPercentage =
    supportsSpeed && computeFanSpeedCount(entity) > FAN_SPEED_COUNT_MAX_FOR_BUTTONS

  const speedDisplay = computeFanSpeedStateDisplay(entity, formatters)
  const stateOverride =
    speedDisplay && stateActive(entity) ? speedDisplay : formatters.formatEntityState(entity)

  const presetModes = Array.isArray(entity.attributes.preset_modes)
    ? (entity.attributes.preset_modes as string[])
    : null
  const currentPreset =
    typeof entity.attributes.preset_mode === 'string' ? entity.attributes.preset_mode : undefined
  const currentDirection =
    typeof entity.attributes.direction === 'string' ? entity.attributes.direction : undefined
  const currentOscillating = entity.attributes.oscillating ? 'true' : 'false'

  const handleToggle = () => {
    const service = entity.state === 'on' ? 'turn_off' : 'turn_on'
    void call('fan', service, { entity_id: entity.entity_id })
  }

  return (
    <div className="flex flex-col items-center gap-5">
      <StateHeader entity={entity} formatters={formatters} stateOverride={stateOverride} />

      <div className="flex w-full flex-col items-center justify-center gap-5">
        {supportsSpeed ? (
          <FanSpeedControl entity={entity} call={call} formatters={formatters} />
        ) : (
          <StateControlToggle
            entity={entity}
            call={call}
            formatters={formatters}
            iconPathOn={mdiFan}
            iconPathOff={mdiFanOff}
          />
        )}

        {supportSpeedPercentage && supportsOnOff && (
          <button
            type="button"
            disabled={unavailable}
            aria-label={
              formatters.localize(
                entity.state === 'on' ? 'ui.card.common.turn_off' : 'ui.card.common.turn_on',
              ) || (entity.state === 'on' ? 'Turn off' : 'Turn on')
            }
            title={
              formatters.localize(
                entity.state === 'on' ? 'ui.card.common.turn_off' : 'ui.card.common.turn_on',
              ) || (entity.state === 'on' ? 'Turn off' : 'Turn on')
            }
            onClick={handleToggle}
            className="grid size-12 place-items-center rounded-full border border-border text-foreground transition-colors hover:bg-foreground/10 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <MdiIcon path={mdiPower} size={22} />
          </button>
        )}
      </div>

      <SelectContainer>
        {supportsPresetMode && presetModes && presetModes.length > 0 && (
          <SelectMenu
            label={formatters.formatEntityAttributeName(entity, 'preset_mode')}
            value={currentPreset}
            disabled={unavailable}
            defaultIconPath={mdiTuneVariant}
            options={presetModes.map((mode) => ({
              value: mode,
              label: formatters.formatEntityAttributeValue(entity, 'preset_mode', mode),
              iconPath: resolveAttributeIcon(entity, 'preset_mode', mode, formatters, mdiTuneVariant),
            }))}
            onSelect={(preset_mode) => {
              if (!preset_mode || preset_mode === currentPreset) return
              void call('fan', 'set_preset_mode', { entity_id: entity.entity_id, preset_mode })
            }}
          />
        )}

        {supportsDirection && (
          <SelectMenu
            label={formatters.formatEntityAttributeName(entity, 'direction')}
            value={currentDirection}
            disabled={unavailable}
            defaultIconPath={currentDirection === 'reverse' ? mdiRotateLeft : mdiRotateRight}
            options={['forward', 'reverse'].map((direction) => ({
              value: direction,
              label: formatters.formatEntityAttributeValue(entity, 'direction', direction),
              iconPath: resolveAttributeIcon(
                entity,
                'direction',
                direction,
                formatters,
                direction === 'reverse' ? mdiRotateLeft : mdiRotateRight,
              ),
            }))}
            onSelect={(direction) => {
              if (!direction || direction === currentDirection) return
              void call('fan', 'set_direction', { entity_id: entity.entity_id, direction })
            }}
          />
        )}

        {supportsOscillate && (
          <SelectMenu
            label={formatters.formatEntityAttributeName(entity, 'oscillating')}
            value={currentOscillating}
            disabled={unavailable}
            defaultIconPath={mdiArrowOscillatingOff}
            options={['true', 'false'].map((val) => ({
              value: val,
              label: formatters.formatEntityAttributeValue(entity, 'oscillating', val === 'true'),
              iconPath: val === 'true' ? mdiArrowOscillating : mdiArrowOscillatingOff,
            }))}
            onSelect={(val) => {
              const next = val === 'true'
              if (next === Boolean(entity.attributes.oscillating)) return
              void call('fan', 'oscillate', { entity_id: entity.entity_id, oscillating: next })
            }}
          />
        )}
      </SelectContainer>
    </div>
  )
}
