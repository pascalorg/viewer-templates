/* Ported from home-assistant/frontend (Apache-2.0):
   - src/dialogs/more-info/controls/more-info-camera.ts
   - src/dialogs/more-info/controls/more-info-image.ts
   - src/data/camera.ts
   - src/data/image.ts */

import { mdiImageOffOutline, mdiVideo, mdiVideoOff } from '@mdi/js'
import { useEffect, useRef, useState } from 'react'
import type { HassEntity } from '../entities'
import { useHass } from '../hass/connection'
import type { EntityFormatters } from '../hass/names'
import { resolveHassMediaUrl } from './mediaPlayer'
import { MdiIcon } from './MdiIcon'
import { type ServiceCallFn, supportsFeature, UNAVAILABLE } from './stateColors'
import { StateHeader } from './StateHeader'

export const CameraEntityFeature = {
  ON_OFF: 1,
  STREAM: 2,
} as const

const CAMERA_REFRESH_MS = 10_000

function computeCameraProxyPath(entity: HassEntity): string | undefined {
  if (typeof entity.attributes.access_token === 'string' && entity.attributes.access_token) {
    return `/api/camera_proxy/${entity.entity_id}?token=${encodeURIComponent(entity.attributes.access_token)}`
  }
  if (typeof entity.attributes.entity_picture === 'string' && entity.attributes.entity_picture) {
    return entity.attributes.entity_picture
  }
  return undefined
}

function computeImageProxyPath(entity: HassEntity): string | undefined {
  if (typeof entity.attributes.access_token === 'string' && entity.attributes.access_token) {
    return `/api/image_proxy/${entity.entity_id}?token=${encodeURIComponent(entity.attributes.access_token)}&state=${encodeURIComponent(entity.state)}`
  }
  if (typeof entity.attributes.entity_picture === 'string' && entity.attributes.entity_picture) {
    return entity.attributes.entity_picture
  }
  return undefined
}

/** Lab-only stand-in camera still for image entities when offline. */
function LabSnapshot({ seed, caption }: { seed: number; caption: string }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const g = ref.current?.getContext('2d')
    if (!g) return
    const W = 320
    const H = 180
    const sky = g.createLinearGradient(0, 0, 0, H)
    sky.addColorStop(0, '#2b3a52')
    sky.addColorStop(1, '#5b6b7e')
    g.fillStyle = sky
    g.fillRect(0, 0, W, H)
    g.fillStyle = '#3a3530'
    g.fillRect(110, 30, 100, 150)
    g.fillStyle = '#6b4a2f'
    g.fillRect(125, 45, 70, 135)
    g.fillStyle = '#7c8a6b'
    g.fillRect(0, 150, W, 30)
    if (caption.startsWith('Someone')) {
      const x = 70 + seed * 180
      g.fillStyle = '#d9a98a'
      g.beginPath()
      g.arc(x, 78, 14, 0, Math.PI * 2)
      g.fill()
      g.fillStyle = '#c0533b'
      g.fillRect(x - 18, 94, 36, 60)
    }
    g.fillStyle = 'rgba(255,255,255,.85)'
    g.font = '11px ui-monospace, monospace'
    g.fillText(new Date().toLocaleTimeString(), 8, 16)
  }, [seed, caption])
  return <canvas ref={ref} width={320} height={180} className="w-full rounded-xl" aria-label={caption} />
}

export type MoreInfoCameraProps = {
  entity: HassEntity
  call: ServiceCallFn
  formatters: EntityFormatters
}

export function MoreInfoCamera({ entity, call, formatters }: MoreInfoCameraProps) {
  const hassUrl = useHass((s) => s.hassUrl)
  const [refreshTick, setRefreshTick] = useState(0)
  const [failedUrl, setFailedUrl] = useState<string | null>(null)

  const unavailable = entity.state === UNAVAILABLE
  const isOff = entity.state === 'off'
  const rawPath = !unavailable && !isOff ? computeCameraProxyPath(entity) : undefined
  const baseUrl = resolveHassMediaUrl(rawPath, hassUrl)

  useEffect(() => {
    if (!baseUrl) return
    const id = window.setInterval(() => setRefreshTick((t) => t + 1), CAMERA_REFRESH_MS)
    return () => window.clearInterval(id)
  }, [baseUrl])

  const imageUrl = baseUrl
    ? `${baseUrl}${baseUrl.includes('?') ? '&' : '?'}time=${refreshTick}`
    : ''
  const showImage = Boolean(imageUrl) && failedUrl !== baseUrl

  const supportsOnOff = supportsFeature(entity, CameraEntityFeature.ON_OFF)
  const hasMotionDetection = typeof entity.attributes.motion_detection === 'boolean'
  const motionOn = entity.attributes.motion_detection === true

  return (
    <div className="flex flex-col gap-3">
      {showImage ? (
        <div className="overflow-hidden rounded-xl bg-foreground/8">
          <img
            src={imageUrl}
            alt={String(entity.attributes.friendly_name ?? entity.entity_id)}
            referrerPolicy="no-referrer"
            onError={() => setFailedUrl(baseUrl)}
            className="block aspect-video w-full object-cover"
          />
        </div>
      ) : (
        <div className="flex aspect-video w-full flex-col items-center justify-center gap-2 rounded-xl bg-foreground/8 text-muted-foreground">
          <MdiIcon path={unavailable || isOff ? mdiVideoOff : mdiVideo} size={36} />
          <span className="text-sm font-medium">{formatters.formatEntityState(entity)}</span>
        </div>
      )}

      {supportsOnOff && !unavailable && (
        <button
          type="button"
          onClick={() =>
            void call('camera', isOff ? 'turn_on' : 'turn_off', { entity_id: entity.entity_id })
          }
          className="cursor-pointer rounded-full bg-foreground/8 px-3 py-1.5 text-sm font-medium text-foreground transition-colors hover:bg-foreground/15"
        >
          {isOff
            ? formatters.localize('ui.card.common.turn_on') || 'Turn on'
            : formatters.localize('ui.card.common.turn_off') || 'Turn off'}
        </button>
      )}

      {hasMotionDetection && (
        <div className="flex items-center justify-between gap-3 rounded-xl bg-foreground/5 px-3 py-2">
          <span className="text-sm text-foreground">
            {formatters.formatEntityAttributeName(entity, 'motion_detection')}
          </span>
          <button
            type="button"
            role="switch"
            aria-checked={motionOn}
            disabled={unavailable}
            onClick={() =>
              void call(
                'camera',
                motionOn ? 'disable_motion_detection' : 'enable_motion_detection',
                { entity_id: entity.entity_id },
              )
            }
            className={`relative h-6 w-10 shrink-0 cursor-pointer rounded-full transition-colors disabled:opacity-40 ${
              motionOn ? 'bg-foreground' : 'bg-foreground/20'
            }`}
          >
            <i
              className={`absolute top-0.5 left-0.5 size-5 rounded-full bg-background shadow transition-transform ${
                motionOn ? 'translate-x-4' : ''
              }`}
            />
          </button>
        </div>
      )}
    </div>
  )
}

export type MoreInfoImageProps = {
  entity: HassEntity
  formatters: EntityFormatters
  isLab?: boolean
}

export function MoreInfoImage({ entity, formatters, isLab = false }: MoreInfoImageProps) {
  const hassUrl = useHass((s) => s.hassUrl)
  const [failedUrl, setFailedUrl] = useState<string | null>(null)

  const rawPath = entity.state !== UNAVAILABLE ? computeImageProxyPath(entity) : undefined
  const imageUrl = resolveHassMediaUrl(rawPath, hassUrl)
  const showImage = Boolean(imageUrl) && failedUrl !== imageUrl

  return (
    <div className="flex flex-col gap-3">
      {showImage ? (
        <div className="overflow-hidden rounded-xl bg-foreground/8">
          <img
            src={imageUrl}
            alt={String(entity.attributes.friendly_name ?? entity.entity_id)}
            referrerPolicy="no-referrer"
            onError={() => setFailedUrl(imageUrl)}
            className="block w-full max-w-full rounded-xl object-contain"
          />
        </div>
      ) : isLab && entity.attributes._seed !== undefined ? (
        <LabSnapshot
          seed={Number(entity.attributes._seed ?? 0)}
          caption={String(entity.attributes._caption ?? '')}
        />
      ) : (
        <div className="flex aspect-video w-full flex-col items-center justify-center gap-2 rounded-xl bg-foreground/8 text-muted-foreground">
          <MdiIcon path={mdiImageOffOutline} size={36} />
          <span className="text-sm">{formatters.formatEntityState(entity)}</span>
        </div>
      )}
      <StateHeader entity={entity} formatters={formatters} />
    </div>
  )
}
