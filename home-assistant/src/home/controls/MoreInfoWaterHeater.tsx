/* Ported from home-assistant/frontend (Apache-2.0):
   - src/dialogs/more-info/controls/more-info-water_heater.ts
   - src/state-control/water_heater/ha-state-control-water_heater-temperature.ts
   - src/data/water_heater.ts */

import {
  mdiAccount,
  mdiAccountArrowRight,
  mdiCircleMedium,
  mdiMinus,
  mdiPlus,
  mdiWaterBoiler,
} from '@mdi/js'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { HassEntity } from '../entities'
import type { EntityFormatters } from '../hass/names'
import { BigNumber } from './BigNumber'
import { CircularSlider } from './CircularSlider'
import { resolveAttributeIcon } from './icons'
import { MdiIcon } from './MdiIcon'
import { createDebounce, PendingValueSync } from './pendingSync'
import { SelectContainer, SelectMenu } from './SelectMenu'
import { type ServiceCallFn, stateActive, stateColorCss, supportsFeature, UNAVAILABLE } from './stateColors'

export const WaterHeaterEntityFeature = {
  TARGET_TEMPERATURE: 1,
  OPERATION_MODE: 2,
  AWAY_MODE: 4,
  ON_OFF: 8,
} as const

const OPERATION_MODES = [
  'electric',
  'gas',
  'heat_pump',
  'eco',
  'performance',
  'high_demand',
  'off',
] as const

const operationModeOrdering: Record<string, number> = Object.fromEntries(
  OPERATION_MODES.map((m, i) => [m, i]),
)

function compareWaterHeaterOperationMode(a: string, b: string): number {
  return (operationModeOrdering[a] ?? OPERATION_MODES.length) - (operationModeOrdering[b] ?? OPERATION_MODES.length)
}

const clamp = (v: number, min: number, max: number) => Math.min(Math.max(v, min), max)

function readTargetTemp(entity: HassEntity): number | undefined {
  return typeof entity.attributes.temperature === 'number'
    ? entity.attributes.temperature
    : undefined
}

function WaterHeaterDial({
  entity,
  call,
  formatters,
}: {
  entity: HassEntity
  call: ServiceCallFn
  formatters: EntityFormatters
}) {
  const [targetTemp, setTargetTemp] = useState<number | undefined>(() => readTargetTemp(entity))
  const pendingSyncRef = useRef<PendingValueSync | null>(null)
  pendingSyncRef.current ??= new PendingValueSync()
  const targetRef = useRef(targetTemp)
  targetRef.current = targetTemp
  const entityRef = useRef(entity)
  entityRef.current = entity
  const callRef = useRef(call)
  callRef.current = call
  const lastEntityIdRef = useRef(entity.entity_id)

  const syncFromEntity = useCallback(() => {
    const next = readTargetTemp(entityRef.current)
    targetRef.current = next
    setTargetTemp(next)
  }, [])

  const sendService = useCallback(() => {
    const temperature = targetRef.current
    if (temperature == null) return
    void pendingSyncRef.current!.run(
      () =>
        callRef.current('water_heater', 'set_temperature', {
          entity_id: entityRef.current.entity_id,
          temperature,
        }),
      syncFromEntity,
    )
  }, [syncFromEntity])

  const debouncedSend = useMemo(() => createDebounce(sendService, 1000), [sendService])
  useEffect(() => () => debouncedSend.cancel(), [debouncedSend])

  useEffect(() => {
    if (lastEntityIdRef.current !== entity.entity_id) {
      lastEntityIdRef.current = entity.entity_id
      debouncedSend.cancel()
      pendingSyncRef.current?.reset()
      syncFromEntity()
      return
    }
    if (pendingSyncRef.current?.shouldSync()) {
      syncFromEntity()
    }
  }, [entity, debouncedSend, syncFromEntity])

  const a = entity.attributes
  const supportsTargetTemp = supportsFeature(entity, WaterHeaterEntityFeature.TARGET_TEMPERATURE)
  const step =
    typeof a.target_temp_step === 'number' && a.target_temp_step > 0
      ? a.target_temp_step
      : formatters.temperatureUnit === '°F'
        ? 1
        : 0.5
  const min = typeof a.min_temp === 'number' ? a.min_temp : 30
  const max = typeof a.max_temp === 'number' ? a.max_temp : 70
  const currentTemp = typeof a.current_temperature === 'number' ? a.current_temperature : undefined
  const active = stateActive(entity)
  const unavailable = entity.state === UNAVAILABLE
  const stateColor = stateColorCss(entity)

  const interactive = supportsTargetTemp && targetTemp != null && !unavailable

  const digits = step.toString().split('.')[1]?.length ?? 0
  const formatOptions: Intl.NumberFormatOptions = {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }

  const handleStep = (delta: number) => {
    const next = clamp(Math.round(((targetRef.current ?? min) + delta) * 100) / 100, min, max)
    targetRef.current = next
    setTargetTemp(next)
    pendingSyncRef.current?.schedule()
    debouncedSend()
  }

  const labelText = unavailable
    ? formatters.formatEntityState(entity, UNAVAILABLE)
    : !supportsTargetTemp || targetTemp == null
      ? formatters.formatEntityState(entity)
      : formatters.localize('ui.card.water_heater.target') || 'Target'

  return (
    <div className="relative mx-auto w-full max-w-[272px]">
      {interactive ? (
        <CircularSlider
          inactive={!active}
          mode="start"
          value={targetTemp}
          current={currentTemp}
          min={min}
          max={max}
          step={step}
          color={stateColor}
          label={formatters.localize('ui.card.water_heater.target_temperature') || 'Target temperature'}
          formatValue={(v) => formatters.formatEntityAttributeValue(entity, 'temperature', v)}
          onValueChanging={(v) => {
            targetRef.current = v
            setTargetTemp(v)
          }}
          onValueChanged={(v) => {
            targetRef.current = v
            setTargetTemp(v)
            debouncedSend.cancel()
            sendService()
          }}
        />
      ) : (
        <CircularSlider
          readonly
          disabled={!active}
          mode="full"
          current={currentTemp}
          min={min}
          max={max}
          step={step}
          color={stateColor}
        />
      )}

      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center px-10 text-center">
        <p
          className={`m-0 text-sm leading-tight font-medium ${
            unavailable ? 'text-muted-foreground opacity-60' : 'text-muted-foreground'
          }`}
        >
          {labelText}
        </p>

        {interactive && (
          <div className="my-1">
            <BigNumber
              value={targetTemp}
              unit={formatters.temperatureUnit}
              language={formatters.language}
              formatOptions={formatOptions}
            />
          </div>
        )}
      </div>

      {interactive && (
        <div className="absolute right-0 bottom-1 left-0 flex justify-center gap-6">
          <button
            type="button"
            disabled={targetTemp <= min}
            aria-label={
              formatters.localize('ui.components.climate-control.temperature_down') ||
              'Decrease temperature'
            }
            onClick={() => handleStep(-step)}
            className="grid size-11 place-items-center rounded-full border border-border bg-background/90 text-foreground shadow-sm transition-colors hover:bg-foreground/10 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <MdiIcon path={mdiMinus} size={20} />
          </button>
          <button
            type="button"
            disabled={targetTemp >= max}
            aria-label={
              formatters.localize('ui.components.climate-control.temperature_up') ||
              'Increase temperature'
            }
            onClick={() => handleStep(step)}
            className="grid size-11 place-items-center rounded-full border border-border bg-background/90 text-foreground shadow-sm transition-colors hover:bg-foreground/10 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <MdiIcon path={mdiPlus} size={20} />
          </button>
        </div>
      )}
    </div>
  )
}

export type MoreInfoWaterHeaterProps = {
  entity: HassEntity
  call: ServiceCallFn
  formatters: EntityFormatters
}

export function MoreInfoWaterHeater({ entity, call, formatters }: MoreInfoWaterHeaterProps) {
  const a = entity.attributes
  const unavailable = entity.state === UNAVAILABLE
  const supportOperationMode = supportsFeature(entity, WaterHeaterEntityFeature.OPERATION_MODE)
  const supportAwayMode = supportsFeature(entity, WaterHeaterEntityFeature.AWAY_MODE)
  const operationList = Array.isArray(a.operation_list)
    ? [...(a.operation_list as string[])].sort(compareWaterHeaterOperationMode)
    : []
  const awayMode = typeof a.away_mode === 'string' ? a.away_mode : undefined

  return (
    <div className="flex flex-col items-center gap-4">
      {a.current_temperature != null && (
        <div className="flex w-full justify-center text-center">
          <div className="flex flex-col items-center">
            <p className="m-0 mb-0.5 text-xs tracking-[0.4px] text-muted-foreground">
              {formatters.formatEntityAttributeName(entity, 'current_temperature')}
            </p>
            <p className="m-0 text-xl font-medium text-foreground" dir="ltr">
              {formatters.formatEntityAttributeValue(entity, 'current_temperature')}
            </p>
          </div>
        </div>
      )}

      <WaterHeaterDial entity={entity} call={call} formatters={formatters} />

      <SelectContainer>
        {supportOperationMode && operationList.length > 0 && (
          <SelectMenu
            label={formatters.localize('ui.card.water_heater.mode') || 'Operation'}
            value={entity.state}
            disabled={unavailable}
            defaultIconPath={mdiWaterBoiler}
            options={operationList.map((mode) => ({
              value: mode,
              label: formatters.formatEntityState(entity, mode),
              iconPath: resolveAttributeIcon(
                entity,
                'operation_mode',
                mode,
                formatters,
                mdiCircleMedium,
              ),
            }))}
            onSelect={(operation_mode) => {
              if (!operation_mode || operation_mode === entity.state) return
              void call('water_heater', 'set_operation_mode', {
                entity_id: entity.entity_id,
                operation_mode,
              })
            }}
          />
        )}

        {supportAwayMode && (
          <SelectMenu
            label={formatters.formatEntityAttributeName(entity, 'away_mode')}
            value={awayMode}
            disabled={unavailable}
            defaultIconPath={mdiAccount}
            options={['on', 'off'].map((mode) => ({
              value: mode,
              label: formatters.formatEntityAttributeValue(entity, 'away_mode', mode),
              iconPath: mode === 'on' ? mdiAccountArrowRight : mdiAccount,
            }))}
            onSelect={(mode) => {
              const nextBool = mode === 'on'
              const curBool = awayMode === 'on'
              if (nextBool === curBool) return
              void call('water_heater', 'set_away_mode', {
                entity_id: entity.entity_id,
                away_mode: nextBool,
              })
            }}
          />
        )}
      </SelectContainer>
    </div>
  )
}
