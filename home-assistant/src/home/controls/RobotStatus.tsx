/* Ported from home-assistant/frontend (Apache-2.0):
   - src/state-control/vacuum/ha-state-control-vacuum-status.ts
   - src/state-control/lawn_mower/ha-state-control-lawn_mower-status.ts
   - src/components/entity/ha-battery-icon.ts
   - src/common/entity/battery_icon.ts
   - src/data/entity/entity_registry.ts (findBatteryEntity / findBatteryChargingEntity) */

import {
  mdiBattery,
  mdiBattery10,
  mdiBattery20,
  mdiBattery30,
  mdiBattery40,
  mdiBattery50,
  mdiBattery60,
  mdiBattery70,
  mdiBattery80,
  mdiBattery90,
  mdiBatteryAlert,
  mdiBatteryAlertVariantOutline,
  mdiBatteryCharging,
  mdiBatteryCharging10,
  mdiBatteryCharging20,
  mdiBatteryCharging30,
  mdiBatteryCharging40,
  mdiBatteryCharging50,
  mdiBatteryCharging60,
  mdiBatteryCharging70,
  mdiBatteryCharging80,
  mdiBatteryCharging90,
  mdiBatteryChargingOutline,
  mdiBatteryUnknown,
} from '@mdi/js'
import { type CSSProperties, useId } from 'react'
import { domainOf, type HassEntities, type HassEntity } from '../entities'
import { useHass } from '../hass/connection'
import { blankBeforeUnit, type EntityFormatters } from '../hass/names'
import { MdiIcon } from './MdiIcon'
import { HA_COLORS, stateColorCss, UNAVAILABLE } from './stateColors'

const BATTERY_PATHS: Record<number, string> = {
  10: mdiBattery10,
  20: mdiBattery20,
  30: mdiBattery30,
  40: mdiBattery40,
  50: mdiBattery50,
  60: mdiBattery60,
  70: mdiBattery70,
  80: mdiBattery80,
  90: mdiBattery90,
  100: mdiBattery,
}

const BATTERY_CHARGING_PATHS: Record<number, string> = {
  10: mdiBatteryCharging10,
  20: mdiBatteryCharging20,
  30: mdiBatteryCharging30,
  40: mdiBatteryCharging40,
  50: mdiBatteryCharging50,
  60: mdiBatteryCharging60,
  70: mdiBatteryCharging70,
  80: mdiBatteryCharging80,
  90: mdiBatteryCharging90,
  100: mdiBatteryCharging,
}

export function batteryLevelIconPath(
  batteryLevel: number | string,
  isBatteryCharging?: boolean,
): string {
  const value = Number(batteryLevel)
  if (Number.isNaN(value)) {
    if (batteryLevel === 'off') return mdiBattery
    if (batteryLevel === 'on') return mdiBatteryAlert
    return mdiBatteryUnknown
  }
  const clamped = Math.max(0, Math.min(100, value))
  const rounded = Math.round(clamped / 10) * 10
  if (isBatteryCharging && clamped >= 10) {
    return BATTERY_CHARGING_PATHS[rounded] ?? mdiBatteryCharging
  }
  if (isBatteryCharging) {
    return mdiBatteryChargingOutline
  }
  if (clamped <= 5) {
    return mdiBatteryAlertVariantOutline
  }
  return BATTERY_PATHS[rounded] ?? mdiBattery
}

export function DeviceBatteryBadge({
  entity,
  entities,
  formatters,
}: {
  entity: HassEntity
  entities?: HassEntities
  formatters: EntityFormatters
}) {
  const registryOf = useHass((s) => s.registryOf)
  const deviceId = registryOf[entity.entity_id]?.device_id

  if (deviceId && entities) {
    const siblingIds = Object.entries(registryOf)
      .filter(([, info]) => info.device_id === deviceId)
      .map(([id]) => id)

    let battery: HassEntity | undefined
    for (const id of siblingIds) {
      const candidate = entities[id]
      if (!candidate || candidate.attributes.device_class !== 'battery') continue
      const dom = domainOf(id)
      if (dom === 'sensor') {
        battery = candidate
        break
      }
      if (dom === 'binary_sensor' && !battery) {
        battery = candidate
      }
    }

    if (battery) {
      const batteryDomain = domainOf(battery.entity_id)
      const numeric = !Number.isNaN(Number(battery.state))
      if (batteryDomain === 'binary_sensor' || numeric) {
        const charging = siblingIds
          .map((id) => entities[id])
          .find(
            (c) =>
              c &&
              domainOf(c.entity_id) === 'binary_sensor' &&
              c.attributes.device_class === 'battery_charging',
          )
        const iconPath = batteryLevelIconPath(battery.state, charging?.state === 'on')
        return (
          <span className="inline-flex items-center gap-1 text-sm text-muted-foreground">
            {batteryDomain !== 'binary_sensor' && (
              <span>
                {Number(battery.state).toFixed()}
                {blankBeforeUnit('%', formatters.language)}%
              </span>
            )}
            <MdiIcon path={iconPath} size={18} />
          </span>
        )
      }
    }
  }

  // Fallback for legacy integrations & lab entities that report battery_level on the entity itself
  const attrLevel = entity.attributes.battery_level
  if (typeof attrLevel === 'number' && !Number.isNaN(attrLevel)) {
    const isCharging = entity.state === 'docked'
    const iconPath = batteryLevelIconPath(attrLevel, isCharging)
    return (
      <span className="inline-flex items-center gap-1 text-sm text-muted-foreground">
        <span>
          {Math.round(attrLevel)}
          {blankBeforeUnit('%', formatters.language)}%
        </span>
        <MdiIcon path={iconPath} size={18} />
      </span>
    )
  }

  return null
}

type VacuumVisualState = 'cleaning' | 'docked' | 'returning' | 'paused' | 'error' | 'idle'

function computeVacuumVisualState(entity: HassEntity): VacuumVisualState {
  if (entity.state === UNAVAILABLE) return 'idle'
  if (entity.state === 'error') return 'error'
  if (entity.state === 'cleaning' || entity.state === 'on') return 'cleaning'
  if (entity.state === 'returning') return 'returning'
  if (entity.state === 'paused') return 'paused'
  if (entity.state === 'docked') return 'docked'
  return 'idle'
}

export function VacuumStatus({ entity }: { entity: HassEntity }) {
  const visualState = computeVacuumVisualState(entity)
  const color = stateColorCss(entity) || HA_COLORS.inactive

  return (
    <div
      className={`robot-vacuum ${visualState} relative mx-auto size-[180px]`}
      style={{ '--vacuum-color': color } as CSSProperties}
      aria-hidden="true"
    >
      <svg viewBox="0 0 240 240" xmlns="http://www.w3.org/2000/svg" className="size-full">
        {/* Soft background glow */}
        <circle cx="120" cy="120" r="110" className="glow" fill="var(--vacuum-color)" opacity="0.06" />

        {/* Robot body group */}
        <g className="vacuum-body-rotate">
          <g className="vacuum-body">
            {/* Side brush */}
            <g className="brush brush-right">
              <g className="brush-spokes">
                <line x1="174" y1="76" x2="174" y2="64" stroke="var(--vacuum-color)" strokeWidth="1.2" strokeLinecap="round" opacity="0.5" />
                <line x1="174" y1="76" x2="174" y2="88" stroke="var(--vacuum-color)" strokeWidth="1.2" strokeLinecap="round" opacity="0.5" />
                <line x1="174" y1="76" x2="162" y2="76" stroke="var(--vacuum-color)" strokeWidth="1.2" strokeLinecap="round" opacity="0.5" />
                <line x1="174" y1="76" x2="186" y2="76" stroke="var(--vacuum-color)" strokeWidth="1.2" strokeLinecap="round" opacity="0.5" />
              </g>
              <circle cx="174" cy="76" r="2" fill="var(--vacuum-color)" opacity="0.5" />
            </g>

            {/* Outer body shell */}
            <circle cx="120" cy="120" r="72" fill="var(--background)" stroke="var(--vacuum-color)" strokeWidth="2" />

            {/* Inner body ring */}
            <circle cx="120" cy="120" r="66" fill="none" stroke="var(--vacuum-color)" strokeWidth="0.8" opacity="0.2" />

            {/* Bumper arc */}
            <path d="M 60 94 A 68 68 0 0 1 180 94" fill="none" stroke="var(--vacuum-color)" strokeWidth="3" strokeLinecap="round" className="bumper" />

            {/* Direction indicator lines */}
            <g className="nav-lines" opacity="0.15">
              <line x1="120" y1="56" x2="120" y2="74" stroke="var(--vacuum-color)" strokeWidth="1.5" />
              <line x1="88" y1="63" x2="96" y2="78" stroke="var(--vacuum-color)" strokeWidth="1.5" />
              <line x1="152" y1="63" x2="144" y2="78" stroke="var(--vacuum-color)" strokeWidth="1.5" />
            </g>

            {/* LIDAR turret */}
            <circle cx="120" cy="108" r="14" fill="var(--background)" stroke="var(--vacuum-color)" strokeWidth="2" className="lidar-housing" />
            <circle cx="120" cy="108" r="9" fill="none" stroke="var(--vacuum-color)" strokeWidth="0.8" opacity="0.25" />

            {/* Power button area */}
            <circle cx="120" cy="140" r="8" fill="var(--vacuum-color)" opacity="0.08" className="power-ring" />
            <circle cx="120" cy="140" r="4" fill="var(--vacuum-color)" opacity="0.25" className="power-dot" />
          </g>
        </g>

        {/* Dust particles (cleaning state) */}
        <g className="particles">
          <circle className="particle p1" cx="120" cy="120" r="2" fill="var(--vacuum-color)" />
          <circle className="particle p2" cx="120" cy="120" r="1.5" fill="var(--vacuum-color)" />
          <circle className="particle p3" cx="120" cy="120" r="1.5" fill="var(--vacuum-color)" />
          <circle className="particle p4" cx="120" cy="120" r="2" fill="var(--vacuum-color)" />
          <circle className="particle p5" cx="120" cy="120" r="1.5" fill="var(--vacuum-color)" />
          <circle className="particle p6" cx="120" cy="120" r="1.5" fill="var(--vacuum-color)" />
          <circle className="particle p7" cx="120" cy="120" r="1" fill="var(--vacuum-color)" />
          <circle className="particle p8" cx="120" cy="120" r="1" fill="var(--vacuum-color)" />
        </g>

        {/* Dock station */}
        <g className="dock-indicator">
          <rect x="76" y="188" width="88" height="28" rx="8" fill="var(--background)" stroke="var(--vacuum-color)" strokeWidth="2" />
        </g>

        {/* Return arrow */}
        <g className="return-path">
          <polygon points="120,220 110,206 130,206" fill="var(--vacuum-color)" stroke="var(--vacuum-color)" strokeWidth="2" strokeLinejoin="round" opacity="0.55" />
        </g>
      </svg>
    </div>
  )
}

type MowerVisualState = 'mowing' | 'docked' | 'returning' | 'paused' | 'error' | 'idle'

function computeMowerVisualState(entity: HassEntity): MowerVisualState {
  if (entity.state === UNAVAILABLE) return 'idle'
  if (entity.state === 'error') return 'error'
  if (entity.state === 'mowing') return 'mowing'
  if (entity.state === 'returning') return 'returning'
  if (entity.state === 'paused') return 'paused'
  if (entity.state === 'docked') return 'docked'
  return 'idle'
}

export function LawnMowerStatus({ entity }: { entity: HassEntity }) {
  const maskId = useId()
  const visualState = computeMowerVisualState(entity)
  const color = stateColorCss(entity) || HA_COLORS.inactive

  return (
    <div
      className={`robot-mower ${visualState} relative mx-auto size-[180px]`}
      style={{ '--mower-color': color } as CSSProperties}
      aria-hidden="true"
    >
      <svg viewBox="0 0 240 240" xmlns="http://www.w3.org/2000/svg" className="size-full">
        {/* Soft background glow */}
        <circle cx="120" cy="120" r="110" className="glow" fill="var(--mower-color)" opacity="0.06" />

        {/* Dock station */}
        <g className="dock-indicator">
          <rect x="80" y="188" width="80" height="24" rx="7" fill="var(--background)" stroke="var(--mower-color)" strokeWidth="2" />
        </g>

        {/* Return arrow */}
        <g className="return-path">
          <polygon points="120,220 110,208 130,208" fill="var(--mower-color)" stroke="var(--mower-color)" strokeWidth="2" strokeLinejoin="round" opacity="0.55" />
        </g>

        {/* Robot body group */}
        <g className="mower-body-rotate">
          <g className="mower-body">
            {/* Blade disc */}
            <g className="blade-disc">
              <circle cx="120" cy="130" r="46" fill="none" stroke="var(--mower-color)" strokeWidth="1.5" strokeDasharray="8 6" />
              <circle cx="120" cy="130" r="6" fill="var(--mower-color)" />
              <line x1="120" y1="130" x2="120" y2="88" stroke="var(--mower-color)" strokeWidth="2" strokeLinecap="round" />
              <line x1="120" y1="130" x2="156" y2="151" stroke="var(--mower-color)" strokeWidth="2" strokeLinecap="round" />
              <line x1="120" y1="130" x2="84" y2="151" stroke="var(--mower-color)" strokeWidth="2" strokeLinecap="round" />
            </g>

            {/* Rear wheels */}
            <g className="wheel wheel-left">
              <rect x="50" y="144" width="12" height="40" rx="5" fill="var(--background)" stroke="var(--mower-color)" strokeWidth="1.5" opacity="0.7" />
              <line className="tread" x1="56" y1="148" x2="56" y2="180" stroke="var(--mower-color)" strokeWidth="6" strokeDasharray="3 3" strokeLinecap="butt" opacity="0.12" />
            </g>
            <g className="wheel wheel-right">
              <rect x="178" y="144" width="12" height="40" rx="5" fill="var(--background)" stroke="var(--mower-color)" strokeWidth="1.5" opacity="0.7" />
              <line className="tread" x1="184" y1="148" x2="184" y2="180" stroke="var(--mower-color)" strokeWidth="6" strokeDasharray="3 3" strokeLinecap="butt" opacity="0.12" />
            </g>

            {/* D-shaped body shell */}
            <path
              d="M 64,98 C 64,50 176,50 176,98 L 176,168 C 176,180 168,186 158,186 L 82,186 C 72,186 64,180 64,168 Z"
              fill="var(--background)"
              stroke="var(--mower-color)"
              strokeWidth="2"
              className="body-shell"
            />

            {/* Inner body ring */}
            <path
              d="M 74,102 C 74,60 166,60 166,102 L 166,162 C 166,172 160,176 152,176 L 88,176 C 80,176 74,172 74,162 Z"
              fill="none"
              stroke="var(--mower-color)"
              strokeWidth="0.8"
              opacity="0.2"
            />

            {/* Front bumper band */}
            <path d="M 64,102 C 64,52 176,52 176,102" fill="none" stroke="var(--mower-color)" strokeWidth="4" strokeLinecap="round" className="bumper" />

            {/* Bumper highlight & sensor dots */}
            <path d="M 72,100 C 72,58 168,58 168,100" fill="none" stroke="var(--mower-color)" strokeWidth="1" strokeLinecap="round" opacity="0.15" />
            <circle cx="92" cy="68" r="1.5" fill="var(--mower-color)" opacity="0.15" />
            <circle cx="120" cy="60" r="1.5" fill="var(--mower-color)" opacity="0.15" />
            <circle cx="148" cy="68" r="1.5" fill="var(--mower-color)" opacity="0.15" />

            {/* LED power indicator */}
            <circle cx="120" cy="78" r="4" fill="var(--mower-color)" opacity="0.08" className="led-ring" />
            <circle cx="120" cy="78" r="2.5" fill="var(--mower-color)" opacity="0.5" className="led-dot" />

            {/* Control panel area */}
            <circle cx="120" cy="148" r="8" fill="var(--mower-color)" opacity="0.06" className="power-ring" />
            <circle cx="120" cy="148" r="4" fill="var(--mower-color)" opacity="0.2" className="power-dot" />

            {/* Grass clippings masked outside body */}
            <mask id={maskId}>
              <rect width="240" height="240" fill="white" />
              <path d="M 60,98 C 60,46 180,46 180,98 L 180,170 C 180,182 172,190 160,190 L 80,190 C 68,190 60,182 60,170 Z" fill="black" />
            </mask>
            <g className="particles" mask={`url(#${maskId})`}>
              <path className="grass g1" d="M64,110 q-3,4 -1,8" fill="none" stroke="var(--mower-color)" strokeWidth="1.4" strokeLinecap="round" />
              <path className="grass g2" d="M63,126 q-4,3 -2,8" fill="none" stroke="var(--mower-color)" strokeWidth="1.2" strokeLinecap="round" />
              <path className="grass g3" d="M64,140 q-4,3 -2,8" fill="none" stroke="var(--mower-color)" strokeWidth="1.5" strokeLinecap="round" />
              <path className="grass g4" d="M64,154 q-3,4 -1,8" fill="none" stroke="var(--mower-color)" strokeWidth="1.1" strokeLinecap="round" />
              <path className="grass g5" d="M66,168 q-3,3 -1,8" fill="none" stroke="var(--mower-color)" strokeWidth="1.3" strokeLinecap="round" />
              <path className="grass g6" d="M176,110 q3,4 1,8" fill="none" stroke="var(--mower-color)" strokeWidth="1.4" strokeLinecap="round" />
              <path className="grass g7" d="M177,126 q4,3 2,8" fill="none" stroke="var(--mower-color)" strokeWidth="1.2" strokeLinecap="round" />
              <path className="grass g8" d="M176,140 q4,3 2,8" fill="none" stroke="var(--mower-color)" strokeWidth="1.5" strokeLinecap="round" />
              <path className="grass g9" d="M176,154 q3,4 1,8" fill="none" stroke="var(--mower-color)" strokeWidth="1.1" strokeLinecap="round" />
              <path className="grass g10" d="M174,168 q3,3 1,8" fill="none" stroke="var(--mower-color)" strokeWidth="1.3" strokeLinecap="round" />
              <path className="grass g11" d="M90,68 q-3,-4 -1,-8" fill="none" stroke="var(--mower-color)" strokeWidth="1.3" strokeLinecap="round" />
              <path className="grass g12" d="M120,54 q1,-4 -1,-8" fill="none" stroke="var(--mower-color)" strokeWidth="1.2" strokeLinecap="round" />
              <path className="grass g13" d="M150,68 q3,-4 1,-8" fill="none" stroke="var(--mower-color)" strokeWidth="1.3" strokeLinecap="round" />
              <path className="grass g14" d="M92,186 q-3,4 -1,8" fill="none" stroke="var(--mower-color)" strokeWidth="1.3" strokeLinecap="round" />
              <path className="grass g15" d="M120,186 q2,4 0,9" fill="none" stroke="var(--mower-color)" strokeWidth="1.1" strokeLinecap="round" />
              <path className="grass g16" d="M148,186 q3,4 1,8" fill="none" stroke="var(--mower-color)" strokeWidth="1.3" strokeLinecap="round" />
            </g>
          </g>
        </g>
      </svg>
    </div>
  )
}
