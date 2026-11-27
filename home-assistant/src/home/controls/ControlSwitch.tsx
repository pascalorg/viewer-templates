/* Ported from home-assistant/frontend (Apache-2.0):
   - src/components/ha-control-switch.ts
   - src/state-control/ha-state-control-toggle.ts */

import { mdiFlash, mdiFlashOff } from '@mdi/js'
import {
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  useRef,
} from 'react'
import { domainOf, type HassEntity } from '../entities'
import type { EntityFormatters } from '../hass/names'
import { ControlButton } from './ControlButton'
import { MdiIcon } from './MdiIcon'
import { HA_COLORS, type ServiceCallFn, stateColorCss, UNAVAILABLE, UNKNOWN } from './stateColors'

const SWIPE_THRESHOLD_PX = 16

export type ControlSwitchProps = {
  checked: boolean
  disabled?: boolean
  vertical?: boolean
  reversed?: boolean
  pathOn?: string
  pathOff?: string
  iconOn?: ReactNode
  iconOff?: ReactNode
  iconSize?: number
  label?: string
  onColor?: string
  offColor?: string
  borderRadius?: number
  padding?: number
  className?: string
  style?: CSSProperties
  onChange: (checked: boolean) => void
}

export function ControlSwitch({
  checked,
  disabled = false,
  vertical = false,
  reversed = false,
  pathOn,
  pathOff,
  iconOn,
  iconOff,
  iconSize = 20,
  label,
  onColor = HA_COLORS.primary,
  offColor = HA_COLORS.inactive,
  borderRadius = 16,
  padding = 4,
  className = '',
  style,
  onChange,
}: ControlSwitchProps) {
  const dragStartRef = useRef<{ x: number; y: number; pointerId: number } | null>(null)

  const handleToggle = () => {
    if (disabled) return
    onChange(!checked)
  }

  const handlePointerDown = (ev: PointerEvent<HTMLDivElement>) => {
    if (disabled || (ev.pointerType === 'mouse' && ev.button !== 0)) return
    ev.currentTarget.setPointerCapture(ev.pointerId)
    dragStartRef.current = { x: ev.clientX, y: ev.clientY, pointerId: ev.pointerId }
  }

  const handlePointerUp = (ev: PointerEvent<HTMLDivElement>) => {
    const start = dragStartRef.current
    if (!start || start.pointerId !== ev.pointerId) return
    dragStartRef.current = null
    if (ev.currentTarget.hasPointerCapture(ev.pointerId)) {
      ev.currentTarget.releasePointerCapture(ev.pointerId)
    }
    if (disabled) return

    const dx = ev.clientX - start.x
    const dy = ev.clientY - start.y
    const dist = Math.hypot(dx, dy)

    if (dist < SWIPE_THRESHOLD_PX) {
      handleToggle()
      return
    }

    if (vertical && Math.abs(dy) >= Math.abs(dx)) {
      // Swipe up -> dy < 0; swipe down -> dy > 0
      const next = dy < 0 ? reversed : !reversed
      if (next !== checked) onChange(next)
      return
    }

    if (!vertical && Math.abs(dx) >= Math.abs(dy)) {
      const isRtl = typeof document !== 'undefined' && document.dir === 'rtl'
      const swipeRight = dx > 0
      const next = swipeRight
        ? (!reversed && !isRtl) || (reversed && isRtl)
        : (reversed && !isRtl) || (!reversed && isRtl)
      if (next !== checked) onChange(next)
    }
  }

  const handlePointerCancel = (ev: PointerEvent<HTMLDivElement>) => {
    if (dragStartRef.current?.pointerId === ev.pointerId) {
      dragStartRef.current = null
    }
  }

  const handleKeyDown = (ev: KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return
    if (ev.key === 'Enter' || ev.key === ' ') {
      ev.preventDefault()
      handleToggle()
      return
    }

    const isRtl = !vertical && typeof document !== 'undefined' && document.dir === 'rtl'
    const flip = reversed !== isRtl
    const [forward, backward] = vertical ? ['ArrowDown', 'ArrowUp'] : ['ArrowRight', 'ArrowLeft']
    const onKey = flip ? backward : forward
    const offKey = flip ? forward : backward

    if (ev.key !== onKey && ev.key !== offKey) return
    ev.preventDefault()

    const wantOn = ev.key === onKey
    if (wantOn !== checked) onChange(wantOn)
  }

  const activeColor = checked ? onColor : offColor
  const flexDirection = vertical
    ? reversed
      ? 'column-reverse'
      : 'column'
    : reversed
      ? 'row-reverse'
      : 'row'

  const thumbTransform = checked
    ? vertical
      ? reversed
        ? 'translateY(-100%)'
        : 'translateY(100%)'
      : reversed
        ? 'translateX(-100%)'
        : 'translateX(100%)'
    : 'translate(0, 0)'

  const thumbRadius = Math.max(4, borderRadius - padding)

  return (
    <div
      role="switch"
      aria-checked={checked}
      aria-label={label}
      aria-disabled={disabled || undefined}
      tabIndex={disabled ? undefined : 0}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      onKeyDown={handleKeyDown}
      className={`group relative box-border flex touch-none select-none outline-none transition-shadow duration-180 ease-in-out focus-visible:ring-2 ${
        disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'
      } ${vertical ? 'h-[240px] w-[130px]' : 'h-10 w-full'} ${className}`}
      style={{
        borderRadius,
        padding,
        flexDirection,
        ...(disabled ? {} : { ['--tw-ring-color' as string]: activeColor }),
        ...style,
      }}
    >
      <div
        aria-hidden="true"
        className={`pointer-events-none absolute inset-0 rounded-[inherit] opacity-20 transition-[background-color,opacity] duration-180 ease-in-out ${
          disabled ? '' : 'group-hover:opacity-35 group-focus-visible:opacity-35'
        }`}
        style={{ backgroundColor: activeColor }}
      />
      <div
        aria-hidden="true"
        className="relative flex items-center justify-center text-white transition-[transform,background-color] duration-180 ease-in-out"
        style={{
          width: vertical ? '100%' : '50%',
          height: vertical ? '50%' : '100%',
          borderRadius: thumbRadius,
          backgroundColor: activeColor,
          transform: thumbTransform,
        }}
      >
        {checked
          ? pathOn
            ? <MdiIcon path={pathOn} size={iconSize} />
            : iconOn
          : pathOff
            ? <MdiIcon path={pathOff} size={iconSize} />
            : iconOff}
      </div>
    </div>
  )
}

export type StateControlToggleProps = {
  entity: HassEntity
  call: ServiceCallFn
  formatters: EntityFormatters
  iconPathOn?: string
  iconPathOff?: string
}

export function StateControlToggle({
  entity,
  call,
  formatters,
  iconPathOn,
  iconPathOff,
}: StateControlToggleProps) {
  const onColor = stateColorCss(entity, 'on')
  const offColor = stateColorCss(entity, 'off')
  const isOn = entity.state === 'on'
  const isOff = entity.state === 'off'
  const unavailable = entity.state === UNAVAILABLE

  const callToggle = (turnOn: boolean) => {
    const stateDomain = domainOf(entity.entity_id)
    const serviceDomain = stateDomain === 'group' ? 'homeassistant' : stateDomain
    void call(serviceDomain, turnOn ? 'turn_on' : 'turn_off', { entity_id: entity.entity_id })
  }

  if (entity.attributes.assumed_state || entity.state === UNKNOWN) {
    return (
      <div className="flex flex-col items-center gap-3">
        <ControlButton
          label={formatters.localize('ui.card.common.turn_on') || 'Turn on'}
          disabled={unavailable}
          backgroundColor={onColor}
          backgroundOpacity={isOn ? 1 : 0.2}
          iconColor={isOn ? '#ffffff' : onColor}
          borderRadius="28px"
          className="h-[110px] w-[130px]"
          onClick={() => callToggle(true)}
        >
          <MdiIcon path={iconPathOn || mdiFlash} size={24} />
        </ControlButton>
        <ControlButton
          label={formatters.localize('ui.card.common.turn_off') || 'Turn off'}
          disabled={unavailable}
          backgroundColor={offColor}
          backgroundOpacity={isOff ? 1 : 0.2}
          iconColor={isOff ? '#ffffff' : offColor}
          borderRadius="28px"
          className="h-[110px] w-[130px]"
          onClick={() => callToggle(false)}
        >
          <MdiIcon path={iconPathOff || mdiFlashOff} size={24} />
        </ControlButton>
      </div>
    )
  }

  return (
    <ControlSwitch
      vertical
      reversed
      checked={isOn}
      disabled={unavailable}
      pathOn={iconPathOn || mdiFlash}
      pathOff={iconPathOff || mdiFlashOff}
      iconSize={24}
      onColor={onColor}
      offColor={offColor}
      borderRadius={36}
      padding={8}
      className="h-[240px] w-[130px]"
      label={formatters.localize('ui.card.common.toggle') || 'Toggle'}
      onChange={callToggle}
    />
  )
}
