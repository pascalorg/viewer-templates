import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber'
import { Fragment, useMemo, type MutableRefObject } from 'react'
import * as THREE from 'three'
import { AirflowEffect } from './effects/AirflowEffect'
import { FieldEffect, type FieldInput } from './effects/FieldEffect'
import { NoiseEffect } from './effects/NoiseEffect'
import { PascalItemSync } from './effects/PascalItemSync'
import { LightEffect } from './effects/LightEffect'
import { CameraEffect, MediaEffect, NetworkEffect, VoiceEffect } from './effects/MediaEffects'
import { RotorEffect } from './effects/RotorEffect'
import { AlarmEffect, ContactEffect, LeakEffect, LockEffect, ModelOpening, MotionEffect, OpeningEffect, SirenEffect, SmokeEffect } from './effects/SafetyEffects'
import { EnergyEffect, HeaterEffect, RobotEffect, WaterEffect } from './effects/UtilityEffects'
import { livePosition } from './effects/common'
import { AlertEffect, DoorbellEffect, MistEffect, PresenceEffect, SignalEffect, WeatherEffect } from './effects/PeopleEffects'

/** Where rain and snow fall: round the home, a few metres past its rooms. */
function weatherBounds(areas: Area[]): [number, number, number, number] {
  const pad = 5
  return [
    Math.min(...areas.map((a) => a.bounds[0])) - pad,
    Math.min(...areas.map((a) => a.bounds[1])) - pad,
    Math.max(...areas.map((a) => a.bounds[2])) + pad,
    Math.max(...areas.map((a) => a.bounds[3])) + pad,
  ]
}
import {
  climateStrength,
  domainOf,
  familyOf,
  fieldColor,
  fieldOf,
  hvacAction,
  isOn,
  type Area,
  type FieldKind,
  type HassEntities,
  type HomeDevice,
} from './entities'

/** Pins are DOM buttons that ride on the model; the canvas moves them every frame. */
export type PinRefs = MutableRefObject<Record<string, HTMLElement | null>>

/** Every device's effect, the floor field for the chosen reading, the pins and the press targets. */
export function HomeEffects({ devices, areas, indoor = areas, entities, layer, floorY, pins, selected = null, onPress }: {
  /** The device the camera is on: some effects (the router's links) only show in full for it. */
  selected?: string | null
  devices: HomeDevice[]
  areas: Area[]
  /** The rooms inside the home, which the alarm's outline wraps (defaults to every area). */
  indoor?: Area[]
  entities: HassEntities
  /** The reading the floor field shows, or null for none. */
  layer: FieldKind | null
  floorY: number
  pins: PinRefs
  onPress: (entityId: string) => void
}) {
  // noise is worked out from the noisy devices themselves (NoiseEffect); the other readings paint
  // each room from its sensor
  const noise = layer === 'sound_pressure'
  const fields = useMemo(() => areas.map((area) => ({ area, input: fieldInput(area, noise ? null : layer, devices, entities) })), [areas, layer, noise, devices, entities])
  const indoorIds = useMemo(() => new Set(indoor.map((a) => a.id)), [indoor])
  // one entity drives each model's own controls (two would fight over its switch): a fan before
  // the light on it, as the blades are what the model animates
  const drivers = useMemo(() => {
    const by = new Map<string, string>()
    for (const d of devices) {
      if (!d.nodeId) continue
      const had = by.get(d.nodeId)
      if (!had || (domainOf(had) === 'light' && domainOf(d.entityId) !== 'light')) by.set(d.nodeId, d.entityId)
    }
    return new Set(by.values())
  }, [devices])
  return (
    <>
      {devices.map((d) => {
        const e = entities[d.entityId]
        if (!e) return null
        const p = { entity: e, device: d, entities, floorY }
        return <Fragment key={d.entityId}>
          {/* the linked model's own animation and lights (a fan's blades, a lamp's bulb), as the device is */}
          {d.nodeId && drivers.has(d.entityId) && <PascalItemSync nodeId={d.nodeId} entity={e} />}
          {(() => { switch (d.effect ?? familyOf(e)) {
          case 'light': return <LightEffect entity={e} anchor={d.anchor} floorY={floorY} />
          case 'airflow': return <AirflowEffect entity={e} anchor={d.anchor} />
          case 'rotor': return <RotorEffect entity={e} anchor={d.anchor} floorY={floorY} />
          case 'opening': return <OpeningEffect {...p} />
          case 'model': return <ModelOpening {...p} />
          case 'lock': return <LockEffect {...p} />
          case 'contact': return <ContactEffect {...p} />
          case 'smoke': return <SmokeEffect {...p} />
          case 'leak': return <LeakEffect {...p} />
          case 'motion': return <MotionEffect {...p} />
          case 'siren': return <SirenEffect {...p} />
          case 'alarm': return <AlarmEffect {...p} areas={indoor} />
          case 'media': return <MediaEffect {...p} />
          case 'camera': return <CameraEffect {...p} />
          case 'voice': return <VoiceEffect {...p} />
          case 'network': return <NetworkEffect {...p} devices={devices} focused={selected === d.entityId} />
          case 'robot': return <RobotEffect {...p} />
          case 'energy': return <EnergyEffect {...p} />
          case 'heater': return <HeaterEffect {...p} />
          case 'water': return <WaterEffect {...p} />
          case 'mist': return <MistEffect {...p} />
          case 'presence': return <PresenceEffect {...p} areas={areas} devices={devices} />
          case 'alert': return <AlertEffect {...p} />
          // a status (battery, running, lock…) draws nothing on the plan: its pin says it
          case 'status': return null
          case 'signal': return <SignalEffect {...p} devices={devices} />
          case 'doorbell': return <DoorbellEffect {...p} />
          default: return null
        } })()}
        </Fragment>
      })}
      {/* the weather has no place of its own: it sets the sky and falls over the grounds */}
      {Object.values(entities).filter((e) => e.entity_id.startsWith('weather.')).slice(0, 1).map((e) => (
        <WeatherEffect key={e.entity_id} entity={e} bounds={weatherBounds(areas)} />
      ))}
      {fields.map(({ area, input }) => input && <FieldEffect key={area.id} area={area} floorY={floorY} input={input} />)}
      {indoor.map((area) => <NoiseEffect key={area.id} area={area} floorY={floorY} devices={devices} entities={entities} indoorIds={indoorIds} visible={noise} />)}
      <PinTracker devices={devices} pins={pins} selected={selected} />
      {devices.map((d) => <Hit key={d.entityId} id={d.entityId} at={d.anchor.position} r={Math.max(0.22, Math.max(...(d.anchor.size ?? [0.4, 0.4, 0.4])) * 0.55)} onPress={onPress} />)}
    </>
  )
}

/** What the floor of one room shows for the chosen reading: the sensor's value, and whatever is changing it. */
function fieldInput(area: Area, layer: FieldKind | null, devices: HomeDevice[], entities: HassEntities): FieldInput | null {
  const here = devices.filter((d) => d.anchor.area === area.id).map((d) => ({ d, e: entities[d.entityId]! })).filter(({ e }) => e)
  const sensor = layer && here.find(({ e }) => domainOf(e.entity_id) === 'sensor' && fieldOf(e) === layer)
  if (!layer || !sensor) {
    // keep the field mounted (fading out) once it has been shown, so its shader compiles once
    const any = here.find(({ e }) => domainOf(e.entity_id) === 'sensor' && fieldOf(e))
    return any ? { color: '#ffffff', visible: false } : null
  }
  const input: FieldInput = { color: fieldColor(layer, Number(sensor.e.state)), visible: true }
  for (const { d, e } of here) {
    const at: [number, number] = [d.anchor.position[0], d.anchor.position[2]]
    if (domainOf(e.entity_id) === 'climate' && e.state !== 'off') {
      const a = hvacAction(e)
      const target = Number(e.attributes.temperature ?? 21)
      const s = climateStrength(e)
      if (layer === 'temperature' && (a === 'cooling' || a === 'heating')) input.source = { at, color: fieldColor(layer, target), strength: s }
      if (layer === 'humidity' && (a === 'cooling' || a === 'drying')) input.source = { at, color: fieldColor(layer, a === 'drying' ? 36 : 44), strength: s }
      if (layer === 'pm25') input.source = { at, color: fieldColor(layer, 5), strength: s }
    }
    if (domainOf(e.entity_id) === 'fan' && isOn(e) && layer === 'carbon_dioxide') {
      input.source = { at, color: fieldColor(layer, 600), strength: Number(e.attributes.percentage ?? 50) / 100 }
    }
  }
  return input
}

/** Pins closer than this on screen (px) are drawn as one, with a count of the others. */
const PIN_GAP = 26

/**
 * Moves the DOM pins onto their devices every frame, and groups pins that would overlap: the first
 * keeps its place and shows "+n" for the ones under it, which reappear as the camera moves closer.
 * The selected device's pin always shows, and is never hidden under another.
 */
function PinTracker({ devices, pins, selected }: { devices: HomeDevice[]; pins: PinRefs; selected: string | null }) {
  const camera = useThree((s) => s.camera)
  const size = useThree((s) => s.size)
  const v = useMemo(() => new THREE.Vector3(), [])
  const order = useMemo(() => {
    // the selected pin claims its place first
    const first = devices.find((d) => d.entityId === selected)
    const rest = devices.filter((d) => d.entityId !== selected)
    return first ? [first, ...rest] : rest
  }, [devices, selected])
  useFrame(() => {
    const shown: { x: number; y: number; el: HTMLElement; n: number; names: string[]; ids: string[] }[] = []
    for (const d of order) {
      const el = pins.current[d.entityId]
      if (!el) continue
      const live = livePosition.get(d.entityId)
      if (live) v.copy(live)
      else v.set(...d.anchor.position)
      v.project(camera)
      const x = (v.x * 0.5 + 0.5) * size.width
      const y = (-v.y * 0.5 + 0.5) * size.height
      // `translate`, not `transform`: the hover's `scale` then grows the pin about its own centre.
      // (Applied after a transform, it scaled the pin's place on screen too, and the pin jumped out
      // from under the pointer.)
      el.style.translate = `calc(${x}px - 50%) calc(${y}px - 50%)`
      if (v.z > 1) {
        el.style.visibility = 'hidden'
        continue
      }
      const near = shown.find((p) => Math.hypot(p.x - x, p.y - y) < PIN_GAP)
      if (near && d.entityId !== selected) {
        el.style.visibility = 'hidden'
        near.n++
        near.names.push(el.dataset.name ?? '')
        near.ids.push(d.entityId)
        continue
      }
      el.style.visibility = 'visible'
      shown.push({ x, y, el, n: 0, names: [el.dataset.name ?? ''], ids: [d.entityId] })
    }
    for (const p of shown) {
      if (p.n) {
        // the panel reads the group back on click, to zoom the camera in on it
        p.el.dataset.more = `+${p.n}`
        p.el.dataset.group = p.ids.join(',')
        p.el.title = `${p.names.join('\n')}\n(click to zoom in)`
      } else {
        delete p.el.dataset.more
        delete p.el.dataset.group
        // a single pin shows its own hover label instead of the browser's tooltip
        p.el.removeAttribute('title')
      }
    }
  })
  return null
}

function Hit({ id, r, at, onPress }: { id: string; r: number; at: [number, number, number]; onPress: (id: string) => void }) {
  const gl = useThree((s) => s.gl)
  return (
    <mesh
      position={at}
      onClick={(e: ThreeEvent<MouseEvent>) => {
        if (e.delta > 6) return
        e.stopPropagation()
        onPress(id)
      }}
      onPointerOver={(e: ThreeEvent<PointerEvent>) => {
        e.stopPropagation()
        gl.domElement.style.cursor = 'pointer'
      }}
      onPointerOut={() => {
        gl.domElement.style.cursor = ''
      }}
    >
      <sphereGeometry args={[r, 12, 10]} />
      <meshBasicMaterial transparent opacity={0} depthWrite={false} colorWrite={false} />
    </mesh>
  )
}
