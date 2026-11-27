/* Ported from home-assistant/frontend (Apache-2.0):
   - src/state-control/climate/ha-state-control-climate-temperature.ts
   - src/state-control/state-control-circular-slider-style.ts */

import { mdiMinus, mdiPlus } from '@mdi/js'
import { type CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { HassEntity } from '../entities'
import type { EntityFormatters } from '../hass/names'
import { BigNumber } from './BigNumber'
import { CircularSlider, type CircularSliderMode } from './CircularSlider'
import {
  climateActionColor,
  ClimateEntityFeature,
  climateStateActive,
  climateStateColor,
  supportsFeature,
  UNAVAILABLE,
} from './climate'
import { MdiIcon } from './MdiIcon'
import { createDebounce, PendingValueSync } from './pendingSync'

type Target = 'value' | 'low' | 'high'

export type ClimateServiceCall = (
  domain: string,
  service: string,
  data: Record<string, unknown> & { entity_id: string },
) => Promise<boolean> | void

export type ClimateTemperatureProps = {
  entity: HassEntity
  call: ClimateServiceCall
  formatters: EntityFormatters
}

const SLIDER_MODES: Readonly<Record<string, CircularSliderMode>> = {
  auto: 'full',
  cool: 'end',
  dry: 'full',
  fan_only: 'full',
  heat: 'start',
  heat_cool: 'full',
  off: 'full',
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(Math.max(v, min), max)
}

function readTargets(entity: HassEntity): Partial<Record<Target, number>> {
  const a = entity.attributes
  return {
    value: typeof a.temperature === 'number' ? a.temperature : undefined,
    low: typeof a.target_temp_low === 'number' ? a.target_temp_low : undefined,
    high: typeof a.target_temp_high === 'number' ? a.target_temp_high : undefined,
  }
}

export function ClimateTemperature({ entity, call, formatters }: ClimateTemperatureProps) {
  const [targets, setTargets] = useState<Partial<Record<Target, number>>>(() => readTargets(entity))
  const [selectedTarget, setSelectedTarget] = useState<Target>('low')

  const pendingSyncRef = useRef<PendingValueSync | null>(null)
  pendingSyncRef.current ??= new PendingValueSync()
  const targetsRef = useRef(targets)
  targetsRef.current = targets
  const entityRef = useRef(entity)
  entityRef.current = entity
  const callRef = useRef(call)
  callRef.current = call
  const lastEntityIdRef = useRef(entity.entity_id)

  const syncFromEntity = useCallback(() => {
    const next = readTargets(entityRef.current)
    targetsRef.current = next
    setTargets(next)
  }, [])

  const sendService = useCallback(
    (type: Target) => {
      const cur = targetsRef.current
      const id = entityRef.current.entity_id
      const data =
        type === 'high' || type === 'low'
          ? {
              entity_id: id,
              target_temp_low: cur.low,
              target_temp_high: cur.high,
            }
          : {
              entity_id: id,
              temperature: cur.value,
            }
      void pendingSyncRef.current!.run(
        () => callRef.current('climate', 'set_temperature', data),
        syncFromEntity,
      )
    },
    [syncFromEntity],
  )

  const debouncedSend = useMemo(() => createDebounce((t: Target) => sendService(t), 1000), [sendService])

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
    (typeof attrs.target_temp_step === 'number' && attrs.target_temp_step > 0
      ? attrs.target_temp_step
      : undefined) ?? (formatters.temperatureUnit === '°F' ? 1 : 0.5)
  const min = typeof attrs.min_temp === 'number' ? attrs.min_temp : formatters.temperatureUnit === '°F' ? 45 : 7
  const max = typeof attrs.max_temp === 'number' ? attrs.max_temp : formatters.temperatureUnit === '°F' ? 95 : 35
  const currentTemperature = typeof attrs.current_temperature === 'number' ? attrs.current_temperature : undefined

  const supportsTargetTemperature =
    supportsFeature(entity, ClimateEntityFeature.TARGET_TEMPERATURE) && targets.value != null
  const supportsTargetTemperatureRange =
    supportsFeature(entity, ClimateEntityFeature.TARGET_TEMPERATURE_RANGE) &&
    targets.low != null &&
    targets.high != null

  const active = climateStateActive(entity.state)
  const action = typeof attrs.hvac_action === 'string' ? attrs.hvac_action : undefined
  const stateColor = climateStateColor(entity.state)
  const lowColor = climateStateColor(active ? 'heat' : 'off')
  const highColor = climateStateColor(active ? 'cool' : 'off')
  const actionColor = climateActionColor(entity.state, action)

  const digits = step.toString().split('.')[1]?.length ?? 0
  const numberFormatOptions = useMemo<Intl.NumberFormatOptions>(
    () => ({ maximumFractionDigits: digits, minimumFractionDigits: digits }),
    [digits],
  )

  const formatTargetValue = useCallback(
    (v: number) => formatters.formatEntityAttributeValue(entity, 'temperature', v),
    [entity, formatters],
  )

  const handleChanging = (target: Target) => (v: number | undefined) => {
    if (typeof v !== 'number' || Number.isNaN(v)) return
    const next = { ...targetsRef.current, [target]: v }
    targetsRef.current = next
    setTargets(next)
    setSelectedTarget(target)
  }

  const handleChanged = (target: Target) => (v: number) => {
    if (typeof v !== 'number' || Number.isNaN(v)) return
    const next = { ...targetsRef.current, [target]: v }
    targetsRef.current = next
    setTargets(next)
    setSelectedTarget(target)
    debouncedSend.cancel()
    sendService(target)
  }

  const handleStepButton = (target: Target, delta: number) => {
    const defaultValue = target === 'high' ? max : min
    let temp = (targetsRef.current[target] ?? defaultValue) + delta
    temp = clamp(Number(temp.toFixed(4)), min, max)
    if (target === 'high' && targetsRef.current.low != null) {
      temp = clamp(temp, targetsRef.current.low, max)
    }
    if (target === 'low' && targetsRef.current.high != null) {
      temp = clamp(temp, min, targetsRef.current.high)
    }
    const next = { ...targetsRef.current, [target]: temp }
    targetsRef.current = next
    setTargets(next)
    pendingSyncRef.current!.schedule()
    debouncedSend(target)
  }

  const isTemperatureDisplayed = supportsTargetTemperature || supportsTargetTemperatureRange

  const renderLabel = () => {
    if (entity.state === UNAVAILABLE) {
      return (
        <p className="m-0 min-h-[1.5em] max-w-[65%] truncate text-center text-sm font-medium text-muted-foreground">
          {formatters.formatEntityState(entity, UNAVAILABLE)}
        </p>
      )
    }
    const text =
      action && action !== 'off'
        ? formatters.formatEntityAttributeValue(entity, 'hvac_action')
        : isTemperatureDisplayed
          ? formatters.formatEntityState(entity)
          : ''
    return (
      <p
        className="m-0 min-h-[1.5em] max-w-[65%] truncate text-center text-sm font-medium"
        style={actionColor ? { color: actionColor } : undefined}
      >
        {text || '\u00A0'}
      </p>
    )
  }

  const renderPrimary = () => {
    if (supportsTargetTemperature && targets.value != null) {
      return (
        <BigNumber
          value={targets.value}
          unit={formatters.temperatureUnit}
          formatOptions={numberFormatOptions}
          language={formatters.language}
        />
      )
    }
    if (supportsTargetTemperatureRange && targets.low != null && targets.high != null) {
      return (
        <div
          className="flex flex-row items-center gap-4"
          style={{ '--ha-big-number-size': '38px' } as CSSProperties}
        >
          <button
            type="button"
            aria-pressed={selectedTarget === 'low'}
            onClick={() => setSelectedTarget('low')}
            className={`cursor-pointer border-0 bg-transparent p-0 text-inherit transition-[opacity,transform] duration-150 focus-visible:scale-110 focus-visible:outline-none ${
              selectedTarget === 'low' ? 'opacity-100' : 'opacity-65 hover:opacity-85'
            }`}
          >
            <span className="sr-only">{formatters.formatEntityAttributeName(entity, 'target_temp_low')}</span>
            <BigNumber
              value={targets.low}
              unit={formatters.temperatureUnit}
              formatOptions={numberFormatOptions}
              language={formatters.language}
            />
          </button>
          <button
            type="button"
            aria-pressed={selectedTarget === 'high'}
            onClick={() => setSelectedTarget('high')}
            className={`cursor-pointer border-0 bg-transparent p-0 text-inherit transition-[opacity,transform] duration-150 focus-visible:scale-110 focus-visible:outline-none ${
              selectedTarget === 'high' ? 'opacity-100' : 'opacity-65 hover:opacity-85'
            }`}
          >
            <span className="sr-only">{formatters.formatEntityAttributeName(entity, 'target_temp_high')}</span>
            <BigNumber
              value={targets.high}
              unit={formatters.temperatureUnit}
              formatOptions={numberFormatOptions}
              language={formatters.language}
            />
          </button>
        </div>
      )
    }
    if (entity.state !== UNAVAILABLE) {
      return <p className="m-0 text-3xl font-normal">{formatters.formatEntityState(entity)}</p>
    }
    return null
  }

  const renderButtons = (target: Target, colored = false) => {
    const borderColor =
      colored && active ? (target === 'high' ? highColor : lowColor) : undefined
    const downLabel = formatters.localize(
      target === 'low'
        ? 'ui.components.climate-control.lower_temperature_down'
        : target === 'high'
          ? 'ui.components.climate-control.upper_temperature_down'
          : 'ui.components.climate-control.temperature_down',
    )
    const upLabel = formatters.localize(
      target === 'low'
        ? 'ui.components.climate-control.lower_temperature_up'
        : target === 'high'
          ? 'ui.components.climate-control.upper_temperature_up'
          : 'ui.components.climate-control.temperature_up',
    )
    return (
      <div className="pointer-events-none absolute right-0 bottom-2 left-0 flex items-center justify-center gap-6">
        <button
          type="button"
          aria-label={downLabel}
          onClick={() => handleStepButton(target, -step)}
          style={borderColor ? { borderColor } : undefined}
          className="pointer-events-auto grid size-12 cursor-pointer place-items-center rounded-full border border-muted-foreground/50 bg-transparent text-foreground transition-colors hover:bg-foreground/[0.08] focus-visible:outline-2 focus-visible:outline-ring"
        >
          <MdiIcon path={mdiMinus} size={22} />
        </button>
        <button
          type="button"
          aria-label={upLabel}
          onClick={() => handleStepButton(target, step)}
          style={borderColor ? { borderColor } : undefined}
          className="pointer-events-auto grid size-12 cursor-pointer place-items-center rounded-full border border-muted-foreground/50 bg-transparent text-foreground transition-colors hover:bg-foreground/[0.08] focus-visible:outline-2 focus-visible:outline-ring"
        >
          <MdiIcon path={mdiPlus} size={22} />
        </button>
      </div>
    )
  }

  const renderInfo = () => (
    <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-1.5">
      <div className="pointer-events-auto flex w-full flex-col items-center justify-center gap-1">
        {renderLabel()}
        {renderPrimary()}
        <span className="min-h-[1.25em]" aria-hidden="true" />
      </div>
    </div>
  )

  const glow = actionColor && (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute -inset-[10%] rounded-full opacity-15"
      style={{
        background: `radial-gradient(50% 50% at 50% 50%, ${actionColor} 0%, transparent 100%)`,
      }}
    />
  )

  if (supportsTargetTemperature && entity.state !== UNAVAILABLE) {
    const hvacModes = Array.isArray(attrs.hvac_modes) ? (attrs.hvac_modes as string[]) : []
    const heatCoolModes = hvacModes.filter((m) => m === 'heat' || m === 'cool' || m === 'heat_cool')
    const modeKey =
      heatCoolModes.length === 1 && (entity.state === 'off' || entity.state === 'auto')
        ? heatCoolModes[0]!
        : entity.state
    const sliderMode = SLIDER_MODES[modeKey] ?? 'full'

    return (
      <div className="relative mx-auto w-full max-w-[280px]">
        {glow}
        <CircularSlider
          inactive={!active}
          mode={sliderMode}
          value={targets.value}
          min={min}
          max={max}
          step={step}
          current={currentTemperature}
          color={stateColor}
          formatValue={formatTargetValue}
          label={formatters.formatEntityAttributeName(entity, 'temperature')}
          onValueChanging={handleChanging('value')}
          onValueChanged={handleChanged('value')}
        />
        {renderInfo()}
        {renderButtons('value')}
      </div>
    )
  }

  if (supportsTargetTemperatureRange && entity.state !== UNAVAILABLE) {
    return (
      <div className="relative mx-auto w-full max-w-[280px]">
        {glow}
        <CircularSlider
          inactive={!active}
          dual
          low={targets.low}
          high={targets.high}
          min={min}
          max={max}
          step={step}
          current={currentTemperature}
          lowColor={lowColor}
          highColor={highColor}
          formatValue={formatTargetValue}
          lowLabel={formatters.formatEntityAttributeName(entity, 'target_temp_low')}
          highLabel={formatters.formatEntityAttributeName(entity, 'target_temp_high')}
          onLowChanging={handleChanging('low')}
          onLowChanged={handleChanged('low')}
          onHighChanging={handleChanging('high')}
          onHighChanged={handleChanged('high')}
        />
        {renderInfo()}
        {renderButtons(selectedTarget, true)}
      </div>
    )
  }

  return (
    <div className="relative mx-auto w-full max-w-[280px]">
      {glow}
      <CircularSlider
        mode="full"
        current={currentTemperature}
        min={min}
        max={max}
        step={step}
        color={stateColor}
        readonly
        disabled={!active}
      />
      {renderInfo()}
    </div>
  )
}
