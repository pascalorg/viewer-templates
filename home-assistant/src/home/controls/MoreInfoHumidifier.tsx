/* Ported from home-assistant/frontend (Apache-2.0):
   - src/dialogs/more-info/controls/more-info-humidifier.ts
   - src/state-control/humidifier/ha-state-control-humidifier-humidity.ts
   - src/data/humidifier.ts */

import { mdiMinus, mdiPower, mdiPlus, mdiTuneVariant } from '@mdi/js'
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

export const HumidifierEntityFeature = {
  MODES: 1,
} as const

const HUMIDIFIER_ACTION_STATE: Readonly<Record<string, string>> = {
  drying: 'on',
  humidifying: 'on',
  idle: 'off',
  off: 'off',
}

const clamp = (v: number, min: number, max: number) => Math.min(Math.max(v, min), max)

function readTargetHumidity(entity: HassEntity): number | undefined {
  return typeof entity.attributes.humidity === 'number' ? entity.attributes.humidity : undefined
}

function HumidifierDial({
  entity,
  call,
  formatters,
}: {
  entity: HassEntity
  call: ServiceCallFn
  formatters: EntityFormatters
}) {
  const [targetHumidity, setTargetHumidity] = useState<number | undefined>(() =>
    readTargetHumidity(entity),
  )
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
    const next = readTargetHumidity(entityRef.current)
    targetRef.current = next
    setTargetHumidity(next)
  }, [])

  const sendService = useCallback(() => {
    const humidity = targetRef.current
    if (humidity == null) return
    void pendingSyncRef.current!.run(
      () =>
        callRef.current('humidifier', 'set_humidity', {
          entity_id: entityRef.current.entity_id,
          humidity,
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
  const min = typeof a.min_humidity === 'number' ? a.min_humidity : 0
  const max = typeof a.max_humidity === 'number' ? a.max_humidity : 100
  const step = typeof a.target_humidity_step === 'number' ? a.target_humidity_step : 1
  const currentHumidity = typeof a.current_humidity === 'number' ? a.current_humidity : undefined
  const active = stateActive(entity)
  const unavailable = entity.state === UNAVAILABLE
  const stateColor = stateColorCss(entity)
  const action = typeof a.action === 'string' ? a.action : undefined
  const actionColor =
    action && action !== 'idle' && action !== 'off' && active
      ? stateColorCss(entity, HUMIDIFIER_ACTION_STATE[action] ?? 'on')
      : undefined
  const inverted = a.device_class === 'dehumidifier'

  const formatTarget = (v: number) => formatters.formatEntityAttributeValue(entity, 'humidity', v)

  const handleStep = (delta: number) => {
    const next = clamp((targetRef.current ?? min) + delta, min, max)
    targetRef.current = next
    setTargetHumidity(next)
    pendingSyncRef.current?.schedule()
    debouncedSend()
  }

  const labelText = unavailable
    ? formatters.formatEntityState(entity, UNAVAILABLE)
    : action && action !== 'off'
      ? formatters.formatEntityAttributeValue(entity, 'action')
      : targetHumidity != null
        ? formatters.formatEntityState(entity)
        : ''

  const interactive = targetHumidity != null && !unavailable

  return (
    <div className="relative mx-auto w-full max-w-[272px]">
      {actionColor && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-4 rounded-full opacity-20 blur-xl"
          style={{ background: `radial-gradient(circle, ${actionColor} 0%, transparent 70%)` }}
        />
      )}

      <CircularSlider
        disabled={!interactive}
        inactive={!active}
        mode={inverted ? 'end' : 'start'}
        value={interactive ? targetHumidity : undefined}
        current={currentHumidity}
        min={min}
        max={max}
        step={step}
        color={stateColor}
        label={formatters.formatEntityAttributeName(entity, 'humidity')}
        formatValue={formatTarget}
        onValueChanging={(v) => {
          targetRef.current = v
          setTargetHumidity(v)
        }}
        onValueChanged={(v) => {
          targetRef.current = v
          setTargetHumidity(v)
          debouncedSend.cancel()
          sendService()
        }}
      />

      {/* Centered readout matching state-control-circular-slider-style */}
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center px-10 text-center">
        <p
          className={`m-0 text-sm leading-tight font-medium ${
            unavailable ? 'text-muted-foreground opacity-60' : 'text-muted-foreground'
          }`}
        >
          {labelText || '\u00A0'}
        </p>

        {targetHumidity != null ? (
          <div className="my-1">
            <BigNumber
              value={targetHumidity}
              unit="%"
              unitPosition="bottom"
              language={formatters.language}
              formatOptions={{ maximumFractionDigits: 0 }}
            />
          </div>
        ) : (
          !unavailable && (
            <p className="my-2 text-2xl font-normal text-foreground">
              {formatters.formatEntityState(entity)}
            </p>
          )
        )}
      </div>

      {interactive && (
        <div className="absolute right-0 bottom-1 left-0 flex justify-center gap-6">
          <button
            type="button"
            disabled={targetHumidity <= min}
            aria-label={
              formatters.localize('ui.components.climate-control.humidity_down') ||
              'Decrease humidity'
            }
            onClick={() => handleStep(-step)}
            className="grid size-11 place-items-center rounded-full border border-border bg-background/90 text-foreground shadow-sm transition-colors hover:bg-foreground/10 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <MdiIcon path={mdiMinus} size={20} />
          </button>
          <button
            type="button"
            disabled={targetHumidity >= max}
            aria-label={
              formatters.localize('ui.components.climate-control.humidity_up') ||
              'Increase humidity'
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

export type MoreInfoHumidifierProps = {
  entity: HassEntity
  call: ServiceCallFn
  formatters: EntityFormatters
}

export function MoreInfoHumidifier({ entity, call, formatters }: MoreInfoHumidifierProps) {
  const a = entity.attributes
  const unavailable = entity.state === UNAVAILABLE
  const supportModes = supportsFeature(entity, HumidifierEntityFeature.MODES)
  const availableModes = Array.isArray(a.available_modes) ? (a.available_modes as string[]) : []
  const currentMode = typeof a.mode === 'string' ? a.mode : undefined

  return (
    <div className="flex flex-col items-center gap-4">
      {a.current_humidity != null && (
        <div className="flex w-full justify-center text-center">
          <div className="flex flex-col items-center">
            <p className="m-0 mb-0.5 text-xs tracking-[0.4px] text-muted-foreground">
              {formatters.formatEntityAttributeName(entity, 'current_humidity')}
            </p>
            <p className="m-0 text-xl font-medium text-foreground" dir="ltr">
              {formatters.formatEntityAttributeValue(entity, 'current_humidity')}
            </p>
          </div>
        </div>
      )}

      <HumidifierDial entity={entity} call={call} formatters={formatters} />

      <SelectContainer>
        <SelectMenu
          label={formatters.localize('ui.card.humidifier.state') || 'State'}
          value={entity.state}
          disabled={unavailable}
          defaultIconPath={mdiPower}
          options={['off', 'on'].map((st) => ({
            value: st,
            label: formatters.formatEntityState(entity, st),
          }))}
          onSelect={(next) => {
            if (!next || next === entity.state) return
            void call('humidifier', next === 'on' ? 'turn_on' : 'turn_off', {
              entity_id: entity.entity_id,
            })
          }}
        />

        {supportModes && availableModes.length > 0 && (
          <SelectMenu
            label={formatters.localize('ui.card.humidifier.mode') || 'Mode'}
            value={currentMode}
            disabled={unavailable}
            defaultIconPath={mdiTuneVariant}
            options={availableModes.map((mode) => ({
              value: mode,
              label: formatters.formatEntityAttributeValue(entity, 'mode', mode),
              iconPath: resolveAttributeIcon(entity, 'mode', mode, formatters, mdiTuneVariant),
            }))}
            onSelect={(mode) => {
              if (!mode || mode === currentMode) return
              void call('humidifier', 'set_mode', { entity_id: entity.entity_id, mode })
            }}
          />
        )}
      </SelectContainer>
    </div>
  )
}
