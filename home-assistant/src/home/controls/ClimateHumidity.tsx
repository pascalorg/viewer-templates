/* Ported from home-assistant/frontend (Apache-2.0):
   - src/state-control/climate/ha-state-control-climate-humidity.ts
   - src/state-control/state-control-circular-slider-style.ts */

import { mdiMinus, mdiPlus } from '@mdi/js'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { HassEntity } from '../entities'
import type { EntityFormatters } from '../hass/names'
import { BigNumber } from './BigNumber'
import { CircularSlider } from './CircularSlider'
import {
  ClimateEntityFeature,
  climateStateActive,
  humidifierStateColor,
  supportsFeature,
  UNAVAILABLE,
} from './climate'
import type { ClimateServiceCall } from './ClimateTemperature'
import { MdiIcon } from './MdiIcon'
import { createDebounce, PendingValueSync } from './pendingSync'

export type ClimateHumidityProps = {
  entity: HassEntity
  call: ClimateServiceCall
  formatters: EntityFormatters
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(Math.max(v, min), max)
}

function readHumidity(entity: HassEntity): number | undefined {
  return typeof entity.attributes.humidity === 'number' ? entity.attributes.humidity : undefined
}

export function ClimateHumidity({ entity, call, formatters }: ClimateHumidityProps) {
  const [targetHumidity, setTargetHumidity] = useState<number | undefined>(() => readHumidity(entity))

  const pendingSyncRef = useRef<PendingValueSync | null>(null)
  pendingSyncRef.current ??= new PendingValueSync()
  const targetRef = useRef(targetHumidity)
  targetRef.current = targetHumidity
  const entityRef = useRef(entity)
  entityRef.current = entity
  const callRef = useRef(call)
  callRef.current = call
  const lastEntityIdRef = useRef(entity.entity_id)

  const syncFromEntity = useCallback(() => {
    const next = readHumidity(entityRef.current)
    targetRef.current = next
    setTargetHumidity(next)
  }, [])

  const sendService = useCallback(() => {
    const humidity = targetRef.current
    if (humidity == null) return
    void pendingSyncRef.current!.run(
      () =>
        callRef.current('climate', 'set_humidity', {
          entity_id: entityRef.current.entity_id,
          humidity,
        }),
      syncFromEntity,
    )
  }, [syncFromEntity])

  const debouncedSend = useMemo(() => createDebounce(() => sendService(), 1000), [sendService])

  useEffect(() => () => debouncedSend.cancel(), [debouncedSend])

  useEffect(() => {
    if (lastEntityIdRef.current !== entity.entity_id) {
      lastEntityIdRef.current = entity.entity_id
      debouncedSend.cancel()
      pendingSyncRef.current!.reset()
      syncFromEntity()
    } else if (pendingSyncRef.current!.shouldSync()) {
      syncFromEntity()
    }
  }, [entity, debouncedSend, syncFromEntity])

  const attrs = entity.attributes
  const step =
    typeof attrs.target_humidity_step === 'number' && attrs.target_humidity_step > 0
      ? attrs.target_humidity_step
      : 1
  const min = typeof attrs.min_humidity === 'number' ? attrs.min_humidity : 0
  const max = typeof attrs.max_humidity === 'number' ? attrs.max_humidity : 100
  const currentHumidity = typeof attrs.current_humidity === 'number' ? attrs.current_humidity : undefined

  const supportsTargetHumidity = supportsFeature(entity, ClimateEntityFeature.TARGET_HUMIDITY)
  const active = climateStateActive(entity.state)
  const stateColor = humidifierStateColor(active)

  const formatTargetValue = useCallback(
    (v: number) => formatters.formatEntityAttributeValue(entity, 'humidity', v),
    [entity, formatters],
  )

  const handleChanging = (v: number | undefined) => {
    if (typeof v !== 'number' || Number.isNaN(v)) return
    targetRef.current = v
    setTargetHumidity(v)
  }

  const handleChanged = (v: number) => {
    if (typeof v !== 'number' || Number.isNaN(v)) return
    targetRef.current = v
    setTargetHumidity(v)
    debouncedSend.cancel()
    sendService()
  }

  const handleStepButton = (delta: number) => {
    const next = clamp(Number(((targetRef.current ?? min) + delta).toFixed(4)), min, max)
    targetRef.current = next
    setTargetHumidity(next)
    pendingSyncRef.current!.schedule()
    debouncedSend()
  }

  const renderLabel = () => {
    if (entity.state === UNAVAILABLE) {
      return (
        <p className="m-0 min-h-[1.5em] max-w-[65%] truncate text-center text-sm font-medium text-muted-foreground">
          {formatters.formatEntityState(entity, UNAVAILABLE)}
        </p>
      )
    }
    if (targetHumidity == null) {
      return (
        <p className="m-0 min-h-[1.5em] max-w-[65%] truncate text-center text-sm font-medium">
          {formatters.formatEntityState(entity)}
        </p>
      )
    }
    return (
      <p className="m-0 min-h-[1.5em] max-w-[65%] truncate text-center text-sm font-medium">
        {formatters.localize('ui.card.climate.humidity_target')}
      </p>
    )
  }

  const numberFormatOptions = useMemo<Intl.NumberFormatOptions>(() => ({ maximumFractionDigits: 0 }), [])

  if (supportsTargetHumidity && targetHumidity != null && entity.state !== UNAVAILABLE) {
    return (
      <div className="relative mx-auto w-full max-w-[280px]">
        <CircularSlider
          inactive={!active}
          value={targetHumidity}
          min={min}
          max={max}
          step={step}
          current={currentHumidity}
          color={stateColor}
          label={formatters.formatEntityAttributeName(entity, 'humidity')}
          formatValue={formatTargetValue}
          onValueChanging={handleChanging}
          onValueChanged={handleChanged}
        />
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-1.5">
          <div className="pointer-events-auto flex w-full flex-col items-center justify-center gap-1">
            {renderLabel()}
            <BigNumber
              value={targetHumidity}
              unit="%"
              unitPosition="bottom"
              formatOptions={numberFormatOptions}
              language={formatters.language}
            />
            <span className="min-h-[1.25em]" aria-hidden="true" />
          </div>
        </div>
        <div className="pointer-events-none absolute right-0 bottom-2 left-0 flex items-center justify-center gap-6">
          <button
            type="button"
            aria-label={formatters.localize('ui.components.climate-control.humidity_down')}
            onClick={() => handleStepButton(-step)}
            className="pointer-events-auto grid size-12 cursor-pointer place-items-center rounded-full border border-muted-foreground/50 bg-transparent text-foreground transition-colors hover:bg-foreground/[0.08] focus-visible:outline-2 focus-visible:outline-ring"
          >
            <MdiIcon path={mdiMinus} size={22} />
          </button>
          <button
            type="button"
            aria-label={formatters.localize('ui.components.climate-control.humidity_up')}
            onClick={() => handleStepButton(step)}
            className="pointer-events-auto grid size-12 cursor-pointer place-items-center rounded-full border border-muted-foreground/50 bg-transparent text-foreground transition-colors hover:bg-foreground/[0.08] focus-visible:outline-2 focus-visible:outline-ring"
          >
            <MdiIcon path={mdiPlus} size={22} />
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="relative mx-auto w-full max-w-[280px]">
      <CircularSlider
        current={currentHumidity}
        min={min}
        max={max}
        step={step}
        disabled
      />
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-1.5">
        {renderLabel()}
      </div>
    </div>
  )
}
