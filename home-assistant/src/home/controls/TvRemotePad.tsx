/* A TV remote pad (power, input, volume, arrows, OK, back, home…) that sends key presses through a
   `remote` entity with `remote.send_command`. Shown on a remote's panel and on a TV media player's
   panel when the same device has a remote, so the TV can be driven even when Home Assistant's
   media player has no buttons for it (menus, inputs, apps). */

import {
  mdiArrowLeft,
  mdiChevronDown,
  mdiChevronLeft,
  mdiChevronRight,
  mdiChevronUp,
  mdiCog,
  mdiHome,
  mdiImport,
  mdiMenu,
  mdiPlayPause,
  mdiPower,
  mdiVolumeMinus,
  mdiVolumeOff,
  mdiVolumePlus,
} from '@mdi/js'
import { useState } from 'react'
import { domainOf, type HassEntities, type HassEntity } from '../entities'
import { useHass } from '../hass/connection'
import { MdiIcon } from './MdiIcon'
import { type ServiceCallFn, UNAVAILABLE } from './stateColors'

/** Android key names (KEYCODE_<name>), the common language of TV remotes in Home Assistant. */
type Key =
  | 'POWER'
  | 'TV_INPUT'
  | 'VOLUME_MUTE'
  | 'VOLUME_DOWN'
  | 'VOLUME_UP'
  | 'DPAD_UP'
  | 'DPAD_DOWN'
  | 'DPAD_LEFT'
  | 'DPAD_RIGHT'
  | 'DPAD_CENTER'
  | 'BACK'
  | 'HOME'
  | 'SETTINGS'
  | 'MEDIA_PLAY_PAUSE'
  | 'MENU'

/** How each integration wants a key press spelled in `remote.send_command`. */
function commandFor(platform: string | undefined, key: Key): string {
  switch (platform) {
    // Android Debug Bridge: any shell command; key presses go through `input keyevent`.
    case 'androidtv':
      return `input keyevent KEYCODE_${key}`
    // Android TV Remote and most other integrations take the bare key name.
    default:
      return key
  }
}

/** The remote that drives this entity: itself, a remote on the same device, or remote.<same name>. */
export function useRemoteFor(entity: HassEntity, entities: HassEntities | undefined): HassEntity | undefined {
  const registryOf = useHass((s) => s.registryOf)
  if (domainOf(entity.entity_id) === 'remote') return entity
  if (!entities) return undefined
  const deviceId = registryOf[entity.entity_id]?.device_id
  if (deviceId) {
    const sibling = Object.entries(registryOf).find(
      ([id, info]) => info.device_id === deviceId && domainOf(id) === 'remote' && entities[id],
    )
    if (sibling) return entities[sibling[0]]
  }
  return entities[`remote.${entity.entity_id.split('.')[1]}`]
}

type Pad = { key: Key; label: string; icon: string; big?: boolean }

const ROWS: Pad[][] = [
  [
    { key: 'POWER', label: 'Power', icon: mdiPower },
    { key: 'TV_INPUT', label: 'Input', icon: mdiImport },
    { key: 'VOLUME_MUTE', label: 'Mute', icon: mdiVolumeOff },
  ],
  [
    { key: 'VOLUME_DOWN', label: 'Volume down', icon: mdiVolumeMinus },
    { key: 'DPAD_UP', label: 'Up', icon: mdiChevronUp },
    { key: 'VOLUME_UP', label: 'Volume up', icon: mdiVolumePlus },
  ],
  [
    { key: 'DPAD_LEFT', label: 'Left', icon: mdiChevronLeft },
    { key: 'DPAD_CENTER', label: 'OK', icon: '', big: true },
    { key: 'DPAD_RIGHT', label: 'Right', icon: mdiChevronRight },
  ],
  [
    { key: 'BACK', label: 'Back', icon: mdiArrowLeft },
    { key: 'DPAD_DOWN', label: 'Down', icon: mdiChevronDown },
    { key: 'HOME', label: 'Home', icon: mdiHome },
  ],
  [
    { key: 'SETTINGS', label: 'Settings', icon: mdiCog },
    { key: 'MEDIA_PLAY_PAUSE', label: 'Play / pause', icon: mdiPlayPause },
    { key: 'MENU', label: 'Menu', icon: mdiMenu },
  ],
]

export function TvRemotePad({ remote, call }: { remote: HassEntity; call: ServiceCallFn }) {
  const platform = useHass((s) => s.registryOf[remote.entity_id]?.platform)
  const [last, setLast] = useState<string | null>(null)
  const disabled = remote.state === UNAVAILABLE

  const press = (p: Pad) => {
    setLast(p.label)
    void call('remote', 'send_command', {
      entity_id: remote.entity_id,
      command: commandFor(platform, p.key),
    })
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between px-1">
        <span className="font-medium text-sm">Remote</span>
        <span className="text-muted-foreground text-xs" aria-live="polite">
          {disabled ? 'Unavailable' : last ? `Sent ${last}` : ''}
        </span>
      </div>
      <div className="grid grid-cols-3 gap-2" dir="ltr">
        {ROWS.flat().map((p) => (
          <button
            key={p.key}
            type="button"
            aria-label={p.label}
            title={p.label}
            disabled={disabled}
            onClick={() => press(p)}
            className={`grid h-12 cursor-pointer place-items-center rounded-xl transition-colors focus-visible:outline-2 focus-visible:outline-ring active:scale-95 disabled:cursor-not-allowed disabled:opacity-40 ${
              p.big
                ? 'bg-[#009ac7] font-semibold text-sm text-white hover:opacity-90'
                : p.key === 'POWER'
                  ? 'bg-foreground/8 text-[#ff6b6b] hover:bg-foreground/15'
                  : 'bg-foreground/8 text-foreground hover:bg-foreground/15'
            }`}
          >
            {p.big ? 'OK' : <MdiIcon path={p.icon} size={22} />}
          </button>
        ))}
      </div>
    </div>
  )
}
