/* Ported from home-assistant/frontend (Apache-2.0):
   - src/panels/lovelace/entity-rows/hui-input-number-entity-row.ts (number / input_number)
   - src/panels/lovelace/entity-rows/hui-input-select-entity-row.ts (select / input_select)
   - src/panels/lovelace/entity-rows/hui-input-text-entity-row.ts (text / input_text)
   - src/panels/lovelace/entity-rows/hui-button-entity-row.ts (button / input_button)
   - src/panels/lovelace/entity-rows/hui-scene-entity-row.ts (scene) */

import { mdiEye, mdiEyeOff } from '@mdi/js'
import { useEffect, useState } from 'react'
import { domainOf, type HassEntity } from '../entities'
import type { EntityFormatters } from '../hass/names'
import { ControlSlider } from './ControlSlider'
import { MdiIcon } from './MdiIcon'
import { SelectMenu } from './SelectMenu'
import { HA_COLORS, type ServiceCallFn, UNAVAILABLE, UNKNOWN } from './stateColors'
import { StateHeader } from './StateHeader'

type InputProps = {
  entity: HassEntity
  call: ServiceCallFn
  formatters: EntityFormatters
}

export function MoreInfoNumber({ entity, call, formatters }: InputProps) {
  const domain = domainOf(entity.entity_id)
  const a = entity.attributes
  const unavailable = entity.state === UNAVAILABLE
  const min = typeof a.min === 'number' ? a.min : 0
  const max = typeof a.max === 'number' ? a.max : 100
  const step = typeof a.step === 'number' && a.step > 0 ? a.step : 1
  const unit = typeof a.unit_of_measurement === 'string' ? a.unit_of_measurement : undefined
  const numericState = Number(entity.state)
  const validNum = !Number.isNaN(numericState)
  const mode = a.mode === 'box' ? 'box' : 'slider'

  const [draft, setDraft] = useState(validNum ? String(numericState) : '')
  const [sliderValue, setSliderValue] = useState<number | undefined>(undefined)

  useEffect(() => {
    setDraft(validNum ? String(numericState) : '')
  }, [entity.state, validNum, numericState])

  const commit = (val: number) => {
    const clamped = Math.min(Math.max(val, min), max)
    void call(domain, 'set_value', { entity_id: entity.entity_id, value: clamped })
  }

  const displayOverride =
    sliderValue !== undefined
      ? formatters.formatEntityState(entity, String(sliderValue))
      : undefined

  return (
    <div className="flex flex-col gap-3">
      <StateHeader entity={entity} formatters={formatters} stateOverride={displayOverride} />

      {mode === 'box' ? (
        <form
          className="flex items-center gap-2"
          onSubmit={(ev) => {
            ev.preventDefault()
            const parsed = Number(draft)
            if (!Number.isNaN(parsed)) commit(parsed)
          }}
        >
          <input
            type="number"
            min={min}
            max={max}
            step={step}
            disabled={unavailable}
            value={draft}
            onChange={(ev) => setDraft(ev.target.value)}
            onBlur={() => {
              const parsed = Number(draft)
              if (!Number.isNaN(parsed) && parsed !== numericState) commit(parsed)
            }}
            className="min-w-0 flex-1 rounded-full border border-border bg-transparent px-3 py-1.5 font-mono text-sm outline-none focus:border-foreground/40 disabled:opacity-40"
          />
          {unit && <span className="text-xs text-muted-foreground">{unit}</span>}
          <button
            type="submit"
            disabled={unavailable || draft === ''}
            className="cursor-pointer rounded-full bg-foreground px-3.5 py-1.5 text-sm font-medium text-background disabled:cursor-not-allowed disabled:opacity-40"
          >
            {formatters.localize('ui.common.set') || 'Set'}
          </button>
        </form>
      ) : (
        <div className="px-1" dir="ltr">
          <ControlSlider
            value={validNum ? numericState : min}
            min={min}
            max={max}
            step={step}
            disabled={unavailable}
            thickness={14}
            borderRadius={9999}
            showHandle
            unit={unit}
            formatters={formatters}
            color={HA_COLORS.primary}
            label={String(a.friendly_name ?? entity.entity_id)}
            onSliderMoved={(v) => setSliderValue(v)}
            onValueChanged={(v) => {
              setSliderValue(undefined)
              commit(v)
            }}
          />
          <div className="mt-1.5 flex justify-between font-mono text-[11px] text-muted-foreground">
            <span>
              {min}
              {unit ? ` ${unit}` : ''}
            </span>
            <span>
              {max}
              {unit ? ` ${unit}` : ''}
            </span>
          </div>
        </div>
      )}
    </div>
  )
}

export function MoreInfoSelect({ entity, call, formatters }: InputProps) {
  const domain = domainOf(entity.entity_id)
  const unavailable = entity.state === UNAVAILABLE
  const options = Array.isArray(entity.attributes.options)
    ? (entity.attributes.options as string[])
    : []

  return (
    <div className="flex flex-col gap-3">
      <StateHeader entity={entity} formatters={formatters} />
      <SelectMenu
        label={formatters.localize('ui.card.select.option') || 'Option'}
        value={entity.state !== UNKNOWN && entity.state !== UNAVAILABLE ? entity.state : undefined}
        disabled={unavailable || options.length === 0}
        fullWidth
        options={options.map((opt) => ({
          value: opt,
          label: formatters.formatEntityState(entity, opt),
        }))}
        onSelect={(option) => {
          if (!option || option === entity.state) return
          void call(domain, 'select_option', { entity_id: entity.entity_id, option })
        }}
      />
    </div>
  )
}

export function MoreInfoText({ entity, call, formatters }: InputProps) {
  const domain = domainOf(entity.entity_id)
  const a = entity.attributes
  const unavailable = entity.state === UNAVAILABLE
  const isPassword = a.mode === 'password'
  const minLen = typeof a.min === 'number' ? a.min : undefined
  const maxLen = typeof a.max === 'number' ? a.max : undefined
  const pattern = typeof a.pattern === 'string' && a.pattern ? a.pattern : undefined
  const initial = entity.state === UNKNOWN || entity.state === UNAVAILABLE ? '' : entity.state

  const [value, setValue] = useState(initial)
  const [reveal, setReveal] = useState(false)

  useEffect(() => {
    setValue(initial)
  }, [initial])

  const submit = () => {
    if (unavailable) return
    if (minLen !== undefined && value.length < minLen) return
    if (maxLen !== undefined && value.length > maxLen) return
    void call(domain, 'set_value', { entity_id: entity.entity_id, value })
  }

  return (
    <div className="flex flex-col gap-3">
      <form
        className="flex items-center gap-1.5"
        onSubmit={(ev) => {
          ev.preventDefault()
          submit()
        }}
      >
        <div className="relative flex min-w-0 flex-1 items-center">
          <input
            type={isPassword && !reveal ? 'password' : 'text'}
            value={value}
            minLength={minLen}
            maxLength={maxLen}
            pattern={pattern}
            disabled={unavailable}
            aria-label={String(a.friendly_name ?? entity.entity_id)}
            onChange={(ev) => setValue(ev.target.value)}
            className="w-full rounded-full border border-border bg-transparent px-3 py-1.5 pr-9 text-sm outline-none focus:border-foreground/40 disabled:opacity-40"
          />
          {isPassword && (
            <button
              type="button"
              aria-label={reveal ? 'Hide' : 'Show'}
              onClick={() => setReveal((v) => !v)}
              className="absolute right-1.5 grid size-7 cursor-pointer place-items-center rounded-full text-muted-foreground hover:bg-foreground/8 hover:text-foreground"
            >
              <MdiIcon path={reveal ? mdiEyeOff : mdiEye} size={16} />
            </button>
          )}
        </div>
        <button
          type="submit"
          disabled={unavailable || value === initial}
          className="cursor-pointer rounded-full bg-foreground px-3.5 py-1.5 text-sm font-medium text-background disabled:cursor-not-allowed disabled:opacity-40"
        >
          {formatters.localize('ui.common.set') || 'Set'}
        </button>
      </form>
    </div>
  )
}

export function MoreInfoButton({ entity, call, formatters }: InputProps) {
  const domain = domainOf(entity.entity_id)
  const unavailable = entity.state === UNAVAILABLE
  return (
    <div className="flex flex-col items-center gap-3">
      <StateHeader entity={entity} formatters={formatters} />
      <button
        type="button"
        disabled={unavailable}
        onClick={() => void call(domain, 'press', { entity_id: entity.entity_id })}
        className="w-full cursor-pointer rounded-full bg-[#009ac7] px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {formatters.localize('ui.card.button.press') || 'Press'}
      </button>
    </div>
  )
}

export function MoreInfoScene({
  entity,
  call,
  formatters,
  isLab = false,
}: InputProps & { isLab?: boolean }) {
  const unavailable = entity.state === UNAVAILABLE
  const labSets =
    isLab && entity.attributes._entities && typeof entity.attributes._entities === 'object'
      ? Object.entries(entity.attributes._entities as Record<string, [string, Record<string, unknown>]>)
      : []

  return (
    <div className="flex flex-col gap-3">
      <StateHeader entity={entity} formatters={formatters} />
      <button
        type="button"
        disabled={unavailable}
        onClick={() => void call('scene', 'turn_on', { entity_id: entity.entity_id })}
        className="w-full cursor-pointer rounded-full bg-[#009ac7] px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {formatters.localize('ui.card.scene.turn_on') || 'Activate'}
      </button>
      {labSets.length > 0 && (
        <ul className="m-0 grid list-none gap-1 p-0 text-xs">
          {labSets.map(([target, [svc]]) => (
            <li key={target} className="flex justify-between gap-2">
              <span className="truncate text-foreground/85">{target}</span>
              <span className="shrink-0 text-muted-foreground">{svc.replaceAll('_', ' ')}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
