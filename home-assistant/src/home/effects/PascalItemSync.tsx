import { useInteractive, useScene, type AnyNodeId } from '@pascal-app/core'
import { useEffect, useMemo } from 'react'
import { domainOf, isOn, type HassEntity } from '../entities'

/* A linked Pascal item's own controls, driven by its Home Assistant entity. Catalog items carry
   their own on/off toggle, sliders and temperature (`asset.interactive`): the toggle starts a
   ceiling fan's blades or lights a lamp's bulb, in the model itself. Pascal sets them from its own
   clicks and theme (lamps on at night); here they follow the device instead. */

type Control =
  | { kind: 'toggle' }
  | { kind: 'slider'; min: number; max: number; step?: number }
  | { kind: 'temperature'; min?: number; max?: number }
type Interactive = { controls?: Control[]; effects?: unknown[] }
type Value = boolean | number

/** Whether the device is running, as its model shows it: a cover open, a lock open, a player on. */
function running(e: HassEntity): boolean {
  switch (domainOf(e.entity_id)) {
    case 'cover': return e.state === 'open' || e.state === 'opening'
    case 'lock': return e.state === 'unlocked' || e.state === 'open'
    case 'media_player': return e.state !== 'off' && e.state !== 'standby' && isOn(e)
    default: return isOn(e)
  }
}

/** The device's level, 0..1, where it has one: a light's brightness, a fan's speed, a volume. */
function level(e: HassEntity): number | null {
  const a = e.attributes
  if (a.brightness != null) return Number(a.brightness) / 255
  if (a.percentage != null) return Number(a.percentage) / 100
  if (a.current_position != null) return Number(a.current_position) / 100
  if (a.volume_level != null) return Number(a.volume_level)
  return null
}

/** What each control should read for this entity; undefined leaves a control as it is. */
function valuesFor(interactive: Interactive | undefined, e: HassEntity): (Value | undefined)[] {
  const on = running(e)
  return (interactive?.controls ?? []).map((c) => {
    if (c.kind === 'toggle') return on
    if (c.kind === 'slider') {
      const l = level(e)
      if (l == null || !Number.isFinite(l)) return undefined
      const step = c.step || 1
      const v = c.min + Math.min(1, Math.max(0, l)) * (c.max - c.min)
      return Math.min(c.max, Math.max(c.min, Math.round(v / step) * step))
    }
    const t = Number(e.attributes.temperature)
    if (!Number.isFinite(t)) return undefined
    return Math.min(c.max ?? 30, Math.max(c.min ?? 16, t))
  })
}

export function PascalItemSync({ nodeId, entity }: { nodeId: string; entity: HassEntity }) {
  const interactive = useScene((s) => (s.nodes[nodeId as AnyNodeId] as { asset?: { interactive?: Interactive } } | undefined)?.asset?.interactive)
  const want = useMemo(() => valuesFor(interactive, entity), [interactive, entity])
  useEffect(() => {
    if (!interactive?.controls?.length) return
    const id = nodeId as AnyNodeId
    const apply = () => {
      const store = useInteractive.getState()
      if (!store.items[id]) store.initItem(id, interactive as never, true)
      const current = useInteractive.getState().items[id]?.controlValues ?? []
      want.forEach((v, i) => {
        if (v !== undefined && current[i] !== v) useInteractive.getState().setControlValue(id, i, v)
      })
    }
    apply()
    // Pascal sets them again on its own (the theme turns every lamp on or off): back to the device
    return useInteractive.subscribe(apply)
  }, [nodeId, interactive, want])
  return null
}
