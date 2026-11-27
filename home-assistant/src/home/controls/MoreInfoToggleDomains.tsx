/* Ported from home-assistant/frontend (Apache-2.0):
   - src/dialogs/more-info/controls/more-info-switch.ts
   - src/dialogs/more-info/controls/more-info-input_boolean.ts
   - src/dialogs/more-info/controls/more-info-siren.ts
   - src/dialogs/more-info/components/siren/ha-more-info-siren-advanced-controls.ts
   - src/data/feature/siren_entity_feature.ts */

import { mdiPlay, mdiPower, mdiPowerOff, mdiStop, mdiVolumeHigh, mdiVolumeOff } from '@mdi/js'
import { useState } from 'react'
import type { HassEntity } from '../entities'
import type { EntityFormatters } from '../hass/names'
import { ControlButton, ControlButtonGroup } from './ControlButton'
import { StateControlToggle } from './ControlSwitch'
import { MdiIcon } from './MdiIcon'
import { SelectMenu } from './SelectMenu'
import { StateHeader } from './StateHeader'
import { type ServiceCallFn, supportsFeature } from './stateColors'

export const SirenEntityFeature = {
  TURN_ON: 1,
  TURN_OFF: 2,
  TONES: 4,
  VOLUME_SET: 8,
  DURATION: 16,
} as const

export type MoreInfoToggleProps = {
  entity: HassEntity
  call: ServiceCallFn
  formatters: EntityFormatters
}

export function MoreInfoSwitch({ entity, call, formatters }: MoreInfoToggleProps) {
  return (
    <div className="flex flex-col items-center">
      <StateHeader entity={entity} formatters={formatters} />
      <div className="flex flex-col items-center justify-center py-2">
        <StateControlToggle
          entity={entity}
          call={call}
          formatters={formatters}
          iconPathOn={mdiPower}
          iconPathOff={mdiPowerOff}
        />
      </div>
    </div>
  )
}

export function MoreInfoInputBoolean({ entity, call, formatters }: MoreInfoToggleProps) {
  return (
    <div className="flex flex-col items-center">
      <StateHeader entity={entity} formatters={formatters} />
      <div className="flex flex-col items-center justify-center py-2">
        <StateControlToggle
          entity={entity}
          call={call}
          formatters={formatters}
          iconPathOn={mdiPower}
          iconPathOff={mdiPowerOff}
        />
      </div>
    </div>
  )
}

export function MoreInfoSiren({ entity, call, formatters }: MoreInfoToggleProps) {
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [tone, setTone] = useState<string | undefined>(undefined)
  const [volumeInput, setVolumeInput] = useState<string>('')
  const [durationInput, setDurationInput] = useState<string>('')

  const availableTones = entity.attributes.available_tones
  const supportsTones =
    supportsFeature(entity, SirenEntityFeature.TONES) &&
    availableTones !== undefined &&
    availableTones !== null &&
    (Array.isArray(availableTones)
      ? availableTones.length > 0
      : typeof availableTones === 'object' && Object.keys(availableTones).length > 0)
  const supportsVolume = supportsFeature(entity, SirenEntityFeature.VOLUME_SET)
  const supportsDuration = supportsFeature(entity, SirenEntityFeature.DURATION)
  const allowAdvanced = supportsTones || supportsVolume || supportsDuration

  const toneOptions = supportsTones
    ? Object.entries(availableTones as string[] | Record<string, string>).map(([toneId, toneName]) => ({
        value: Array.isArray(availableTones) ? String(toneName) : toneId,
        label: String(toneName),
      }))
    : []

  const handleAdvancedPlay = () => {
    const payload: Record<string, unknown> & { entity_id: string } = {
      entity_id: entity.entity_id,
    }
    if (tone !== undefined) payload.tone = tone
    if (volumeInput.trim() !== '') {
      const parsed = Number.parseFloat(volumeInput) / 100
      if (!Number.isNaN(parsed)) {
        payload.volume_level = Math.min(1, Math.max(0, parsed))
      }
    }
    if (durationInput.trim() !== '') {
      const parsed = Number.parseInt(durationInput, 10)
      if (!Number.isNaN(parsed)) {
        payload.duration = parsed
      }
    }
    void call('siren', 'turn_on', payload)
  }

  const handleAdvancedStop = () => {
    void call('siren', 'turn_off', { entity_id: entity.entity_id })
  }

  return (
    <div className="flex flex-col items-center">
      <StateHeader entity={entity} formatters={formatters} />
      <div className="flex w-full flex-col items-center justify-center gap-5 py-2">
        <StateControlToggle
          entity={entity}
          call={call}
          formatters={formatters}
          iconPathOn={mdiVolumeHigh}
          iconPathOff={mdiVolumeOff}
        />

        {allowAdvanced && (
          <button
            type="button"
            aria-expanded={showAdvanced}
            onClick={() => setShowAdvanced((v) => !v)}
            className="rounded-full px-4 py-1.5 text-sm font-medium text-[#009ac7] transition-colors hover:bg-[#009ac7]/10"
          >
            {showAdvanced
              ? formatters.localize('ui.common.close') || 'Close'
              : formatters.localize('ui.components.siren.more_controls') || 'More controls'}
          </button>
        )}

        {allowAdvanced && showAdvanced && (
          <div className="grid w-full gap-3 rounded-2xl border border-border/60 bg-foreground/[0.03] p-3">
            {supportsTones && (
              <SelectMenu
                fullWidth
                showArrow
                label={formatters.localize('ui.components.siren.tone') || 'Tone'}
                value={tone}
                options={toneOptions}
                onSelect={(next) => setTone(next)}
              />
            )}

            {supportsVolume && (
              <label className="grid gap-1">
                <span className="text-xs text-muted-foreground">
                  {formatters.localize('ui.components.siren.volume') || 'Volume'}
                </span>
                <div className="flex items-center rounded-xl bg-foreground/[0.08] px-3 py-2 focus-within:ring-2 focus-within:ring-ring">
                  <input
                    type="number"
                    min={0}
                    max={100}
                    step={1}
                    value={volumeInput}
                    placeholder="0–100"
                    onChange={(ev) => setVolumeInput(ev.target.value)}
                    className="w-full min-w-0 bg-transparent text-sm text-foreground outline-none"
                  />
                  <span className="ml-2 text-xs text-muted-foreground">%</span>
                </div>
              </label>
            )}

            {supportsDuration && (
              <label className="grid gap-1">
                <span className="text-xs text-muted-foreground">
                  {formatters.localize('ui.components.siren.duration') || 'Duration'}
                </span>
                <div className="flex items-center rounded-xl bg-foreground/[0.08] px-3 py-2 focus-within:ring-2 focus-within:ring-ring">
                  <input
                    type="number"
                    min={0}
                    step={1}
                    value={durationInput}
                    placeholder="s"
                    onChange={(ev) => setDurationInput(ev.target.value)}
                    className="w-full min-w-0 bg-transparent text-sm text-foreground outline-none"
                  />
                  <span className="ml-2 text-xs text-muted-foreground">s</span>
                </div>
              </label>
            )}

            <ControlButtonGroup className="mt-1 gap-4">
              <ControlButton
                label={formatters.localize('ui.card.common.turn_on') || 'Turn on'}
                borderRadius="16px"
                className="h-16 w-16"
                onClick={handleAdvancedPlay}
              >
                <MdiIcon path={mdiPlay} size={24} />
              </ControlButton>
              <ControlButton
                label={formatters.localize('ui.card.common.turn_off') || 'Turn off'}
                borderRadius="16px"
                className="h-16 w-16"
                onClick={handleAdvancedStop}
              >
                <MdiIcon path={mdiStop} size={24} />
              </ControlButton>
            </ControlButtonGroup>
          </div>
        )}
      </div>
    </div>
  )
}
