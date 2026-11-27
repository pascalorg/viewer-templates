/* Ported from home-assistant/frontend (Apache-2.0):
   - src/dialogs/more-info/controls/more-info-lock.ts
   - src/state-control/lock/ha-state-control-lock-toggle.ts
   - src/data/lock.ts */

import { mdiCheck, mdiLock, mdiLockAlert, mdiLockClock, mdiLockOpen } from '@mdi/js'
import { useEffect, useRef, useState } from 'react'
import type { HassEntity } from '../entities'
import type { EntityFormatters } from '../hass/names'
import { CodeEntry } from './CodeEntry'
import { ControlButton, ControlButtonGroup } from './ControlButton'
import { ControlSwitch } from './ControlSwitch'
import { resolveEntityIcon } from './icons'
import { MdiIcon } from './MdiIcon'
import { StateHeader } from './StateHeader'
import { HA_COLORS, type ServiceCallFn, stateColorCss, supportsFeature, UNAVAILABLE, UNKNOWN } from './stateColors'

export const LockEntityFeature = {
  OPEN: 1,
} as const

type ProtectedLockService = 'lock' | 'unlock' | 'open'
type OpenButtonState = 'normal' | 'confirm' | 'done'

const CONFIRM_TIMEOUT_MS = 5000
const DONE_TIMEOUT_MS = 2000

const isWaiting = (stateObj: HassEntity) =>
  ['opening', 'unlocking', 'locking'].includes(stateObj.state)

function canOpenLock(stateObj: HassEntity): boolean {
  if (stateObj.state === UNAVAILABLE) return false
  return stateObj.attributes.assumed_state === true || (stateObj.state !== 'open' && !isWaiting(stateObj))
}

export type MoreInfoLockProps = {
  entity: HassEntity
  call: ServiceCallFn
  formatters: EntityFormatters
}

export function MoreInfoLock({ entity, call, formatters }: MoreInfoLockProps) {
  const [openState, setOpenState] = useState<OpenButtonState>('normal')
  const [pendingService, setPendingService] = useState<ProtectedLockService | null>(null)
  const openTimerRef = useRef<number | undefined>(undefined)

  const setButtonState = (next: OpenButtonState, timeoutMs?: number) => {
    if (openTimerRef.current !== undefined) {
      window.clearTimeout(openTimerRef.current)
      openTimerRef.current = undefined
    }
    setOpenState(next)
    if (timeoutMs) {
      openTimerRef.current = window.setTimeout(() => {
        openTimerRef.current = undefined
        setOpenState('normal')
      }, timeoutMs)
    }
  }

  useEffect(
    () => () => {
      if (openTimerRef.current !== undefined) window.clearTimeout(openTimerRef.current)
    },
    [],
  )

  useEffect(() => {
    setPendingService(null)
    setButtonState('normal')
  }, [entity.entity_id])

  const codePattern =
    typeof entity.attributes.code_format === 'string' && entity.attributes.code_format.length > 0
      ? entity.attributes.code_format
      : undefined

  const executeService = (service: ProtectedLockService, code?: string) => {
    void call('lock', service, {
      entity_id: entity.entity_id,
      ...(code !== undefined ? { code } : {}),
    })
    if (service === 'open') {
      setButtonState('done', DONE_TIMEOUT_MS)
    } else {
      setButtonState('normal')
    }
  }

  const requestService = (service: ProtectedLockService) => {
    if (codePattern) {
      setPendingService(service)
      return
    }
    executeService(service)
  }

  const handleOpenClick = () => {
    if (openState !== 'confirm') {
      setButtonState('confirm', CONFIRM_TIMEOUT_MS)
      return
    }
    requestService('open')
  }

  const color = stateColorCss(entity)
  const unavailable = entity.state === UNAVAILABLE
  const jammed = entity.state === 'jammed'
  const locking = entity.state === 'locking'
  const unlocking = entity.state === 'unlocking'
  const isLockedOrLocking = entity.state === 'locked' || locking
  const supportsOpen = supportsFeature(entity, LockEntityFeature.OPEN)

  const onIconPath = resolveEntityIcon(
    entity,
    formatters,
    locking ? mdiLockClock : mdiLock,
    locking ? 'locking' : 'locked',
  )
  const offIconPath = resolveEntityIcon(
    entity,
    formatters,
    unlocking ? mdiLockClock : mdiLockOpen,
    unlocking ? 'unlocking' : 'unlocked',
  )

  return (
    <div className="flex flex-col items-center gap-5">
      <StateHeader entity={entity} formatters={formatters} />

      <div className="flex w-full flex-col items-center justify-center gap-5">
        {jammed ? (
          <div className="flex h-[220px] flex-col items-center justify-center">
            <div
              className="relative flex size-36 animate-pulse items-center justify-center rounded-full"
              style={{ color }}
            >
              <span
                aria-hidden="true"
                className="absolute inset-0 rounded-full opacity-20"
                style={{ backgroundColor: color }}
              />
              <MdiIcon
                path={resolveEntityIcon(entity, formatters, mdiLockAlert, 'jammed')}
                size={72}
              />
            </div>
          </div>
        ) : entity.state === UNKNOWN ? (
          <div className="flex flex-col items-center gap-3">
            <ControlButton
              label={formatters.localize('ui.card.lock.lock') || 'Lock'}
              disabled={unavailable}
              backgroundColor={color}
              backgroundOpacity={0.2}
              iconColor={color}
              borderRadius="28px"
              className="h-[110px] w-[130px]"
              onClick={() => requestService('lock')}
            >
              <MdiIcon path={onIconPath} size={24} />
            </ControlButton>
            <ControlButton
              label={formatters.localize('ui.card.lock.unlock') || 'Unlock'}
              disabled={unavailable}
              backgroundColor={color}
              backgroundOpacity={0.2}
              iconColor={color}
              borderRadius="28px"
              className="h-[110px] w-[130px]"
              onClick={() => requestService('unlock')}
            >
              <MdiIcon path={offIconPath} size={24} />
            </ControlButton>
          </div>
        ) : (
          <ControlSwitch
            vertical
            reversed
            checked={isLockedOrLocking}
            disabled={unavailable}
            iconOn={
              <MdiIcon path={onIconPath} size={24} className={locking ? 'animate-pulse' : undefined} />
            }
            iconOff={
              <MdiIcon path={offIconPath} size={24} className={unlocking ? 'animate-pulse' : undefined} />
            }
            onColor={color}
            offColor={color}
            borderRadius={36}
            padding={8}
            className="h-[240px] w-[130px]"
            label={
              isLockedOrLocking
                ? formatters.localize('ui.card.lock.unlock') || 'Unlock'
                : formatters.localize('ui.card.lock.lock') || 'Lock'
            }
            onChange={(checked) => requestService(checked ? 'lock' : 'unlock')}
          />
        )}

        {supportsOpen && (
          <div className="flex items-center justify-center">
            {openState === 'done' ? (
              <p
                className="m-0 flex h-[56px] items-center gap-2 text-sm font-medium"
                style={{ color: HA_COLORS.success }}
              >
                <MdiIcon path={mdiCheck} size={20} />
                <span>{formatters.localize('ui.card.lock.open_door_done') || 'Opened'}</span>
              </p>
            ) : (
              <ControlButton
                label={
                  openState === 'confirm'
                    ? formatters.localize('ui.card.lock.open_door_confirm') || 'Confirm?'
                    : formatters.localize('ui.card.lock.open_door') || 'Open door'
                }
                disabled={!canOpenLock(entity)}
                backgroundColor={openState === 'confirm' ? HA_COLORS.warning : color}
                backgroundOpacity={0.2}
                iconColor="var(--foreground)"
                borderRadius="28px"
                className="h-[56px] w-[130px] text-sm font-medium"
                onClick={handleOpenClick}
              >
                {openState === 'confirm'
                  ? formatters.localize('ui.card.lock.open_door_confirm') || 'Confirm?'
                  : formatters.localize('ui.card.lock.open_door') || 'Open door'}
              </ControlButton>
            )}
          </div>
        )}

        {pendingService && (
          <CodeEntry
            codeFormat="text"
            codePattern={codePattern}
            title={formatters.localize(`ui.card.lock.${pendingService}`) || pendingService}
            submitText={formatters.localize(`ui.card.lock.${pendingService}`) || pendingService}
            cancelText={formatters.localize('ui.common.cancel') || 'Cancel'}
            codeLabel={formatters.localize('ui.dialogs.enter_code.code') || 'Code'}
            clearLabel={formatters.localize('ui.dialogs.enter_code.clear') || 'Clear'}
            invalidCodeText={
              formatters.localize('ui.dialogs.enter_code.invalid_code') || 'Invalid code'
            }
            onCancel={() => setPendingService(null)}
            onSubmit={(code) => {
              const svc = pendingService
              setPendingService(null)
              executeService(svc, code)
            }}
          />
        )}
      </div>

      {jammed && (
        <ControlButtonGroup className="w-full">
          <ControlButton
            label={formatters.localize('ui.card.lock.unlock') || 'Unlock'}
            borderRadius="24px"
            className="h-[56px] flex-1 text-sm font-medium"
            onClick={() => requestService('unlock')}
          >
            {formatters.localize('ui.card.lock.unlock') || 'Unlock'}
          </ControlButton>
          <ControlButton
            label={formatters.localize('ui.card.lock.lock') || 'Lock'}
            borderRadius="24px"
            className="h-[56px] flex-1 text-sm font-medium"
            onClick={() => requestService('lock')}
          >
            {formatters.localize('ui.card.lock.lock') || 'Lock'}
          </ControlButton>
        </ControlButtonGroup>
      )}
    </div>
  )
}
