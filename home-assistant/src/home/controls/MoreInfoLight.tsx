/* Ported from home-assistant/frontend (Apache-2.0):
   - src/dialogs/more-info/controls/more-info-light.ts
   - src/components/ha-icon-button-group.ts
   - src/data/light.ts */

import {
  mdiBrightness6,
  mdiCreation,
  mdiFileWordBox,
  mdiLightbulbOff,
  mdiLightbulbOn,
  mdiPower,
} from '@mdi/js'
import { useEffect, useState } from 'react'
import type { HassEntity } from '../entities'
import { useHass } from '../hass/connection'
import type { EntityFormatters } from '../hass/names'
import { StateControlToggle } from './ControlSwitch'
import { resolveAttributeIcon } from './icons'
import {
  LightBrightness,
  type LightColor,
  LightColorMode,
  LightColorRgbPicker,
  LightColorTempPicker,
  LightEntityFeature,
  LightFavoriteColors,
  lightSupportsBrightness,
  lightSupportsColor,
  lightSupportsColorMode,
  lightSupportsFavoriteColors,
} from './LightPickers'
import { MdiIcon } from './MdiIcon'
import { SelectContainer, SelectMenu } from './SelectMenu'
import { StateHeader } from './StateHeader'
import { type ServiceCallFn, supportsFeature, UNAVAILABLE } from './stateColors'

type MainControl = 'brightness' | 'color_temp' | 'color'

export type MoreInfoLightProps = {
  entity: HassEntity
  call: ServiceCallFn
  formatters: EntityFormatters
}

export function MoreInfoLight({ entity, call, formatters }: MoreInfoLightProps) {
  const [mainControl, setMainControl] = useState<MainControl>('brightness')
  const registryEntry = useHass((s) => s.registryOf[entity.entity_id])

  const supportsColorTemp = lightSupportsColorMode(entity, LightColorMode.COLOR_TEMP)
  const supportsColor = lightSupportsColor(entity)
  const supportsBrightness = lightSupportsBrightness(entity)
  const supportsWhite = lightSupportsColorMode(entity, LightColorMode.WHITE)
  const supportsEffects = supportsFeature(entity, LightEntityFeature.EFFECT)
  const unavailable = entity.state === UNAVAILABLE

  useEffect(() => {
    if (mainControl === 'color' && !supportsColor) setMainControl('brightness')
    if (mainControl === 'color_temp' && !supportsColorTemp) setMainControl('brightness')
  }, [entity.entity_id, mainControl, supportsColor, supportsColorTemp])

  const stateOverride = entity.attributes.brightness
    ? formatters.formatEntityAttributeValue(entity, 'brightness')
    : undefined

  const registryFavorites = registryEntry?.options?.light?.favorite_colors as
    | LightColor[]
    | undefined
  const showFavorites =
    lightSupportsFavoriteColors(entity) &&
    (registryFavorites === undefined || registryFavorites.length > 0)

  const effectList = Array.isArray(entity.attributes.effect_list)
    ? (entity.attributes.effect_list as string[])
    : null
  const currentEffect =
    typeof entity.attributes.effect === 'string' ? entity.attributes.effect : undefined

  const handleToggle = () => {
    const service = entity.state === 'on' ? 'turn_off' : 'turn_on'
    void call('light', service, { entity_id: entity.entity_id })
  }

  const handleSetWhite = () => {
    void call('light', 'turn_on', { entity_id: entity.entity_id, white: true })
  }

  return (
    <div className="flex flex-col items-center gap-5">
      <StateHeader entity={entity} formatters={formatters} stateOverride={stateOverride} />

      <div className="flex w-full flex-col items-center justify-center gap-5">
        {!supportsBrightness && (
          <StateControlToggle
            entity={entity}
            call={call}
            formatters={formatters}
            iconPathOn={mdiLightbulbOn}
            iconPathOff={mdiLightbulbOff}
          />
        )}

        {(supportsColorTemp || supportsColor || supportsBrightness) && (
          <>
            {supportsBrightness && mainControl === 'brightness' && (
              <LightBrightness entity={entity} call={call} formatters={formatters} />
            )}
            {supportsColor && mainControl === 'color' && (
              <LightColorRgbPicker entity={entity} call={call} formatters={formatters} />
            )}
            {supportsColorTemp && mainControl === 'color_temp' && (
              <LightColorTempPicker entity={entity} call={call} formatters={formatters} />
            )}

            {/* Icon button group bar matching ha-icon-button-group */}
            <div className="flex h-12 items-center rounded-full bg-foreground/[0.08] px-1">
              {supportsBrightness && (
                <button
                  type="button"
                  disabled={unavailable}
                  aria-label={
                    formatters.localize('ui.dialogs.more_info_control.light.toggle') || 'Toggle'
                  }
                  title={
                    formatters.localize('ui.dialogs.more_info_control.light.toggle') || 'Toggle'
                  }
                  onClick={handleToggle}
                  className="grid size-10 place-items-center rounded-full text-foreground transition-colors hover:bg-foreground/10 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <MdiIcon path={mdiPower} size={20} />
                </button>
              )}

              {(supportsColor || supportsColorTemp) && (
                <>
                  <div className="mx-0.5 h-8 w-px bg-foreground/15" aria-hidden="true" />
                  <button
                    type="button"
                    disabled={unavailable}
                    aria-pressed={mainControl === 'brightness'}
                    aria-label={formatters.formatEntityAttributeName(entity, 'brightness')}
                    title={formatters.formatEntityAttributeName(entity, 'brightness')}
                    onClick={() => setMainControl('brightness')}
                    className={`grid size-10 place-items-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                      mainControl === 'brightness'
                        ? 'bg-foreground text-background'
                        : 'text-foreground hover:bg-foreground/10'
                    }`}
                  >
                    <MdiIcon path={mdiBrightness6} size={20} />
                  </button>
                </>
              )}

              {supportsColor && (
                <button
                  type="button"
                  disabled={unavailable}
                  aria-pressed={mainControl === 'color'}
                  aria-label={
                    formatters.localize('ui.dialogs.more_info_control.light.color') || 'Color'
                  }
                  title={
                    formatters.localize('ui.dialogs.more_info_control.light.color') || 'Color'
                  }
                  onClick={() => setMainControl('color')}
                  className={`grid size-10 place-items-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                    mainControl === 'color'
                      ? 'ring-2 ring-inset ring-foreground'
                      : 'hover:bg-foreground/10'
                  }`}
                >
                  <span
                    aria-hidden="true"
                    className={`size-7 rounded-full ${unavailable ? 'opacity-50 grayscale' : ''}`}
                    style={{
                      backgroundImage:
                        'radial-gradient(circle, rgba(255,255,255,0.8) 0%, transparent 68%), conic-gradient(from 90deg, #ff0000, #ffff00, #00ff00, #00ffff, #0000ff, #ff00ff, #ff0000)',
                    }}
                  />
                </button>
              )}

              {supportsColorTemp && (
                <button
                  type="button"
                  disabled={unavailable}
                  aria-pressed={mainControl === 'color_temp'}
                  aria-label={
                    formatters.localize('ui.dialogs.more_info_control.light.color_temp') ||
                    'Color temperature'
                  }
                  title={
                    formatters.localize('ui.dialogs.more_info_control.light.color_temp') ||
                    'Color temperature'
                  }
                  onClick={() => setMainControl('color_temp')}
                  className={`grid size-10 place-items-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                    mainControl === 'color_temp'
                      ? 'ring-2 ring-inset ring-foreground'
                      : 'hover:bg-foreground/10'
                  }`}
                >
                  <span
                    aria-hidden="true"
                    className={`size-7 rounded-full ${unavailable ? 'opacity-50 grayscale' : ''}`}
                    style={{
                      background:
                        'linear-gradient(0deg, rgb(166, 209, 255) 0%, #ffffff 50%, rgb(255, 160, 0) 100%)',
                    }}
                  />
                </button>
              )}

              {supportsWhite && (
                <>
                  <div className="mx-0.5 h-8 w-px bg-foreground/15" aria-hidden="true" />
                  <button
                    type="button"
                    disabled={unavailable}
                    aria-label={
                      formatters.localize('ui.dialogs.more_info_control.light.set_white') ||
                      'Set white'
                    }
                    title={
                      formatters.localize('ui.dialogs.more_info_control.light.set_white') ||
                      'Set white'
                    }
                    onClick={handleSetWhite}
                    className="grid size-10 place-items-center rounded-full text-foreground transition-colors hover:bg-foreground/10 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <MdiIcon path={mdiFileWordBox} size={20} />
                  </button>
                </>
              )}
            </div>

            {showFavorites && (
              <LightFavoriteColors
                entity={entity}
                registryFavorites={registryFavorites}
                call={call}
                formatters={formatters}
              />
            )}
          </>
        )}
      </div>

      {supportsEffects && effectList && effectList.length > 0 && (
        <SelectContainer>
          <SelectMenu
            label={formatters.formatEntityAttributeName(entity, 'effect')}
            value={currentEffect}
            disabled={unavailable}
            defaultIconPath={mdiCreation}
            options={effectList.map((effect) => ({
              value: effect,
              label: formatters.formatEntityAttributeValue(entity, 'effect', effect),
              iconPath: resolveAttributeIcon(entity, 'effect', effect, formatters, mdiCreation),
            }))}
            onSelect={(effect) => {
              if (!effect || effect === currentEffect) return
              void call('light', 'turn_on', { entity_id: entity.entity_id, effect })
            }}
          />
        </SelectContainer>
      )}
    </div>
  )
}
