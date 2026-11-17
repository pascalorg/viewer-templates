import { type AnyNode, emitter, type NodeEvent } from '@pascal-app/core'
import {
  filterSectionHits, filterXrayHits, type GlbPickEvent, isSectionObject, SectionGroup, type SelectionCalloutProps, useViewer,
} from '@pascal-app/viewer'
import type { ViewerSource } from '@pascal-app/viewer/ui'
import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import { Box3, Group, Matrix3, Matrix4, type MeshBasicMaterial, type Object3D, Vector3 } from 'three'
import { cue } from '../sounds'
import { buildMembership, type Membership, polygonCentre, type Probe, resolveRoom, type Room, type XZ } from './membership'
import { placeLabel, type Rect } from './placement'
import { calloutDom, labelDom, lastItemClick, type Revealed, useDiscovery } from './state'
import { disposeWash, easeOutCubic, floorWash, followWash, memberWash, WASH_IN_MS, WASH_OPACITY, WASH_OUT_MS, washGain, washMaterial, type WashMesh } from './wash'

/**
 * The showcase's discovery, /next's behaviour on Pascal's viewer (a deliberate hybrid, as the
 * /next houses differ): one house's room and item precedence and tap rules, another's world-
 * anchored label and member-mesh wash for outdoor areas.
 *
 * - Hover (mouse and pen) reveals the room or outdoor area under the pointer on the next frame,
 *   while it moves too (as /next does: measured one frame, rooms named as the pointer
 *   sweeps across them); a hit no room owns reveals nothing, and an item reveals its room. Nothing
 *   shows while the camera visibly moves (rediscovered as soon as it slows to rest) or a drag runs.
 * - A tap on an interactive item pins its callout where it was tapped (the package builds the
 *   actions; the tap itself never operates the item). A tap on a room pins nothing and moves
 *   nothing. Escape, a tap elsewhere or × dismisses.
 * - Touch has no hover: a tap tries an item, else reveals the room; lifting the finger keeps it,
 *   an orbit hides it.
 * - It runs in Exterior, Exploded, Cut view and X-ray, never during the intro or a walkthrough.
 *
 * Both paths feed the same machine: the live scene through the node event bus, the bake through
 * `GlbScene`'s `onPick` (`reportBakedPick`). Geometry comes from `ViewerSource`.
 */

const CAMERA_QUIET_MS = 40
/**
 * Per-frame camera motion below these reads as at rest: the controls' damping eases the last
 * fraction of a move for most of a second, imperceptibly, and discovery need not wait it out.
 */
const REST_TRANSLATION_M = 0.002
const REST_ROTATION = 0.0004
const PROBE_M = 0.35
const LABEL_LIFT = 0.05
/** Fewer parts than this anchor an area's label on their bounds' top; more, on the hit. */
const AREA_BOUNDS_LIMIT = 80

/** A hit under the pointer: the node, where, and which way its face looks (world space). */
type Hit = { nodeId: string; point: Vector3; normal: Vector3 | null; object: Object3D | null }

type BakedHandler = (event: GlbPickEvent) => void
let bakedHandler: BakedHandler | null = null
/** The bake's picks (`GlbScene onPick`) enter discovery here. */
export function reportBakedPick(event: GlbPickEvent) {
  bakedHandler?.(event)
}

/** The callout hook for `InteractiveSystem` and `GlbScene`: the template draws the callout. */
export function renderCallout(props: SelectionCalloutProps) {
  return <CalloutBridge {...props} />
}

function CalloutBridge(props: SelectionCalloutProps) {
  const { object, title, subtitle, actions, onDismiss, anchor } = props
  useEffect(() => {
    const point = lastItemClick.object === object || lastItemClick.id === object.userData?.pascalId ? lastItemClick.point : null
    useDiscovery.getState().setCallout({ object, title, subtitle, actions, onDismiss, anchor, point })
  }, [object, title, subtitle, actions, onDismiss, anchor])
  useEffect(() => () => {
    if (useDiscovery.getState().callout?.object === object) useDiscovery.getState().setCallout(null)
  }, [object])
  return null
}

const FRAME_KINDS = new Set(['site', 'building', 'level'])

const DISCOVERABLE = (state: ReturnType<typeof useViewer.getState>) => !state.walkthroughMode

/** The rects the label keeps clear of: the dial, sound and full screen, the phone bar, the cut controls. */
const OBSTACLE_SELECTOR = '.sc-dial, .sc-top-actions, .sc-mobile-controls, .sc-section, .sc-help-panel, .sc-intro'

export function DiscoveryScene({ source, baked, interactiveIds }: {
  source: ViewerSource
  /** The bake answers through `reportBakedPick`; the live scene through the node event bus. */
  baked: boolean
  /** Doors, windows and items with controls: a click on one pins its callout. */
  interactiveIds: ReadonlySet<string>
}) {
  const camera = useThree((state) => state.camera)
  const gl = useThree((state) => state.gl)
  const events = useThree((state) => state.events)
  const membership = useMemo(() => buildMembership(source.nodes as Record<string, AnyNode>), [source.nodes])
  const root = useMemo(() => new Group(), [])
  const live = useRef({ source, membership, interactiveIds })
  live.current = { source, membership, interactiveIds }
  const bakedPath = useRef(baked)
  bakedPath.current = baked

  // The machine's state lives in a ref: it changes every frame and renders nothing.
  const machine = useRef({
    raw: null as Hit | null,
    rawVersion: 0,
    committedVersion: -1,
    hover: null as Revealed | null,
    tapped: null as Revealed | null,
    pointerInside: false,
    pointerType: 'mouse',
    lastCameraMove: -Infinity,
    cameraMoving: false,
    press: null as { x: number; y: number; t: number; travel: number; id: number } | null,
    nodeClickAt: -Infinity,
    cameraMatrix: new Matrix4(),
    lastCuedRoom: null as string | null,
    obstacles: [] as Rect[],
    obstaclesAt: -Infinity,
  })

  // ── Inputs ────────────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    const m = machine.current
    const canvas = gl.domElement
    const onCanvas = (event: Event) => event.target === canvas
    const down = (event: PointerEvent) => {
      if (!onCanvas(event)) return
      m.pointerType = event.pointerType
      m.press = { x: event.clientX, y: event.clientY, t: performance.now(), travel: 0, id: event.pointerId }
    }
    const move = (event: PointerEvent) => {
      if (m.press && event.pointerId === m.press.id) m.press.travel = Math.max(m.press.travel, Math.hypot(event.clientX - m.press.x, event.clientY - m.press.y))
      if (!onCanvas(event)) return
      m.pointerType = event.pointerType
      if (event.pointerType === 'touch') return
      m.pointerInside = true
      // A move re-samples: the live bus answers within this dispatch with what is under it.
      if (!bakedPath.current) { m.raw = null; m.rawVersion++ }
    }
    const leave = (event: PointerEvent) => {
      if (event.pointerType === 'touch') return
      m.pointerInside = false
      m.raw = null
      m.rawVersion++
    }
    const up = (event: PointerEvent) => {
      if (m.press && event.pointerId === m.press.id) {
        const press = m.press
        // A tap on nothing the bus or the bake reports: dismiss (the click's handlers run first).
        const tap = press.travel < 7 && performance.now() - press.t <= 350 && event.button === 0
        if (tap && onCanvas(event)) {
          const at = performance.now()
          requestAnimationFrame(() => { if (m.nodeClickAt < at - 1) clickedNothing(event.pointerType) })
        }
      }
      m.press = null
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      if (useViewer.getState().selection.selectedIds.length || m.tapped) {
        dismissItem()
        m.tapped = null
      }
    }
    addEventListener('pointerdown', down, true)
    addEventListener('pointermove', move, true)
    addEventListener('pointerup', up, true)
    canvas.addEventListener('pointerleave', leave)
    addEventListener('keydown', escape)
    return () => {
      removeEventListener('pointerdown', down, true)
      removeEventListener('pointermove', move, true)
      removeEventListener('pointerup', up, true)
      canvas.removeEventListener('pointerleave', leave)
      removeEventListener('keydown', escape)
    }
  }, [gl])

  const clickedNothing = (pointerType: string) => {
    const m = machine.current
    dismissItem()
    if (pointerType === 'touch') m.tapped = null
  }

  /** A tap on a hit: an interactive item pins its callout, else touch reveals the room. */
  const tapped = (hit: Hit | null, pointerType: string) => {
    const m = machine.current
    m.nodeClickAt = performance.now()
    if (!discoverable()) return
    if (hit && live.current.interactiveIds.has(hit.nodeId)) {
      lastItemClick.id = hit.nodeId
      lastItemClick.point = hit.point.toArray() as [number, number, number]
      lastItemClick.object = live.current.source.objectFor(hit.nodeId) ?? null
      useViewer.getState().setSelection({ selectedIds: [hit.nodeId] })
      m.tapped = null
      cue('select')
      return
    }
    // A room pins nothing and moves nothing; a tap elsewhere dismisses the callout.
    dismissItem()
    if (pointerType === 'touch') {
      m.tapped = hit ? reveal(hit) : null
      if (m.tapped) cue('select')
    }
  }

  const reveal = (hit: Hit): Revealed | null => {
    const { membership, source } = live.current
    const roomId = resolveRoom(membership, source.nodes as Record<string, AnyNode>, hit.nodeId, probe(membership, source, hit))
    return roomId ? { roomId, hit: hit.point.toArray() as [number, number, number] } : null
  }

  // The live scene: the node event bus, nearest hit first, section and X-ray respected.
  useEffect(() => {
    const m = machine.current
    const accept = (event: NodeEvent): Hit | null => {
      const state = useViewer.getState()
      if (state.walkthroughMode) return null
      // The site, a building or a floor answers for every mesh under it (R3F bubbles), and for
      // collective batch draws: pass, so the element the pointer is on answers.
      if (FRAME_KINDS.has(event.node.type)) return null
      const point = new Vector3(...event.position)
      const candidate = { point, object: event.object }
      if (!filterSectionHits([candidate], state, (hit) => isSectionObject(hit.object)).length) return null
      if (!filterXrayHits([candidate], state).length) return null
      let normal: Vector3 | null = null
      if (event.normal) normal = new Vector3(...event.normal).applyMatrix3(new Matrix3().getNormalMatrix(event.object.matrixWorld)).normalize()
      return { nodeId: event.node.id, point, normal, object: event.object }
    }
    const onMove = (event: NodeEvent) => {
      if (bakedPath.current) return
      const hit = accept(event)
      if (!hit) return
      event.stopPropagation()
      if (m.raw?.nodeId !== hit.nodeId || !m.raw.point.equals(hit.point)) {
        m.raw = hit
        m.rawVersion++
      }
    }
    const onClick = (event: NodeEvent) => {
      if (bakedPath.current) return
      const hit = accept(event)
      if (!hit) return
      event.stopPropagation()
      tapped(hit, event.nativeEvent.nativeEvent?.pointerType ?? m.pointerType)
    }
    emitter.on('node:move', onMove)
    emitter.on('node:enter', onMove)
    emitter.on('node:click', onClick)
    // The bake: `GlbScene` resolved the node, filtered section and X-ray, and sent the hit.
    bakedHandler = (event) => {
      const hit: Hit | null = event.pick && event.worldPosition
        ? {
          nodeId: event.pick.nodeId,
          point: new Vector3(...event.worldPosition),
          normal: event.normal ? new Vector3(...event.normal) : null,
          object: event.hitObject ?? null,
        }
        : null
      if (event.type === 'hover') {
        m.raw = hit
        m.rawVersion++
      } else if (hit) tapped(hit, event.pointerType ?? m.pointerType)
    }
    return () => {
      emitter.off('node:move', onMove)
      emitter.off('node:enter', onMove)
      emitter.off('node:click', onClick)
      bakedHandler = null
    }
  }, [])

  // ── Washes ────────────────────────────────────────────────────────────────────────────────
  type Wash = { key: string; meshes: WashMesh[]; material: MeshBasicMaterial; parts: MeshBasicMaterial; from: number; to: number; start: number; duration: number }
  const washes = useRef<Wash[]>([])
  const washFor = (room: Room): Wash | null => {
    const { source } = live.current
    const level = source.objectFor(room.levelId)
    if (!level) return null
    // A floor outline and an area's own parts take the light differently: one veil each.
    const material = washMaterial()
    const parts = washMaterial()
    const meshes: WashMesh[] = []
    const xray = useViewer.getState().xrayFamily
    // A room's floor shows when floors do (X-ray of another family hides it).
    if (room.washFloor && (xray === null || xray === 'floors')) meshes.push(floorWash(room, level, material))
    if (room.kind === 'area') {
      const roots = room.members.map((id) => source.objectFor(id)).filter((object): object is Object3D => !!object)
      const owners = new Set(roots)
      meshes.push(...memberWash(roots, parts, (object) => owners.has(object) || isOtherNode(object)))
    }
    if (!meshes.length) { material.dispose(); parts.dispose(); return null }
    for (const { mesh } of meshes) root.add(mesh)
    return { key: room.id, meshes, material, parts, from: 0, to: WASH_OPACITY, start: performance.now(), duration: WASH_IN_MS }
  }
  useEffect(() => () => {
    for (const wash of washes.current) { disposeWash(wash.meshes); wash.material.dispose(); wash.parts.dispose() }
    washes.current = []
  }, [])

  // Development and the test build only: lets the checks read the scene (never in a release build).
  if (import.meta.env.DEV || import.meta.env.MODE === 'runtime-test') (window as unknown as Record<string, unknown>).__discovery = { root, washes, machine, camera, source, viewer: useViewer, membership }

  // ── The frame: decide, wash, place ───────────────────────────────────────────────────────
  const shownKey = useRef<string | null>(null)
  const labelText = useRef('')
  const v = useMemo(() => ({ a: new Vector3(), b: new Vector3(), box: new Box3() }), [])
  useFrame(() => {
    const m = machine.current
    const now = performance.now()
    const state = useViewer.getState()
    const allowed = discoverable()

    // Camera motion hides what is unpinned; once quiet, re-sample what is under the pointer.
    camera.updateMatrixWorld()
    const still = atRest(m.cameraMatrix, camera.matrixWorld)
    m.cameraMatrix.copy(camera.matrixWorld)
    if (!still) {
      m.lastCameraMove = now
      if (!m.cameraMoving) {
        m.cameraMoving = true
        m.hover = null
        m.tapped = null
      }
    } else if (m.cameraMoving && now - m.lastCameraMove > CAMERA_QUIET_MS) {
      m.cameraMoving = false
      if (m.pointerInside && m.pointerType !== 'touch') {
        if (!bakedPath.current) { m.raw = null; m.rawVersion++ }
        events.update?.()
        m.committedVersion = -1
      }
    }
    const dragging = !!m.press && m.press.travel >= 7

    if (!allowed) {
      m.hover = null
      m.tapped = null
    } else if (m.pointerType !== 'touch' && m.pointerInside && !m.cameraMoving && !dragging &&
      m.committedVersion !== m.rawVersion) {
      // Every pointer move raycasts already (R3F); committing its hit each frame costs a lookup.
      m.committedVersion = m.rawVersion
      const previous = m.hover?.roomId ?? null
      m.hover = m.raw ? reveal(m.raw) : null
      // A tick when the pointer reaches another room, as /next (never twice for the same room).
      if (m.hover && m.hover.roomId !== previous && m.hover.roomId !== m.lastCuedRoom) {
        m.lastCuedRoom = m.hover.roomId
        cue('hover')
      }
      if (!m.hover) m.lastCuedRoom = null
    }
    if (!m.pointerInside && m.pointerType !== 'touch') m.hover = null
    // A pinned callout replaces the room it was clicked in.
    const pinned = useDiscovery.getState().callout
    const revealed = allowed && !m.cameraMoving && !dragging && !pinned ? (m.pointerType === 'touch' ? m.tapped : m.hover) : null
    const room = revealed ? live.current.membership.rooms.get(revealed.roomId) ?? null : null
    const key = room ? `${room.id}:${state.xrayFamily ?? ''}` : null

    if (key !== shownKey.current) {
      shownKey.current = key
      const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches
      for (const wash of washes.current) {
        if (wash.to === 0) continue
        wash.from = currentOpacity(wash, now)
        wash.to = 0
        wash.start = now
        wash.duration = reduced ? 0 : WASH_OUT_MS
      }
      if (room) {
        const wash = washFor(room)
        if (wash) {
          if (reduced) wash.duration = 0
          washes.current.push(wash)
        }
      }
    }
    // Fade, follow, retire. The veil's brightness follows the exposure (see `washGain`), so it
    // reads as /next's at every time of day.
    const exposure = (gl as unknown as { toneMappingExposure?: number }).toneMappingExposure ?? 1
    const floorGain = washGain(exposure, 'floor')
    const partsGain = washGain(exposure, 'parts')
    washes.current = washes.current.filter((wash) => {
      const opacity = currentOpacity(wash, now)
      wash.material.opacity = opacity
      wash.parts.opacity = opacity
      wash.material.color.setScalar(floorGain)
      wash.parts.color.setScalar(partsGain)
      if (wash.to === 0 && opacity <= 0) {
        disposeWash(wash.meshes)
        wash.material.dispose()
        wash.parts.dispose()
        return false
      }
      followWash(wash.meshes)
      return true
    })

    // The label: the room's name and area, anchored in the model, projected every frame.
    if (now - m.obstaclesAt > 250) {
      m.obstaclesAt = now
      const canvasRect = gl.domElement.getBoundingClientRect()
      m.obstacles = [...document.querySelectorAll(OBSTACLE_SELECTOR)].map((element) => {
        const rect = element.getBoundingClientRect()
        return { left: rect.left - canvasRect.left, top: rect.top - canvasRect.top, right: rect.right - canvasRect.left, bottom: rect.bottom - canvasRect.top }
      }).filter((rect) => rect.right > rect.left && rect.bottom > rect.top)
    }
    const width = gl.domElement.clientWidth
    const height = gl.domElement.clientHeight
    const label = labelDom.root
    if (label) {
      const anchor = room && revealed ? labelAnchor(room, revealed, v.a) : null
      if (room && anchor) {
        const text = `${room.name}\n${subtitleOf(room, state.unit)}`
        if (text !== labelText.current) {
          labelText.current = text
          if (labelDom.title) labelDom.title.textContent = room.name
          if (labelDom.subtitle) labelDom.subtitle.textContent = subtitleOf(room, state.unit)
        }
        place(label, labelDom.title?.parentElement ?? null, anchor, width, height, m.obstacles)
      } else hide(label)
    }
    const calloutRoot = calloutDom.root
    if (calloutRoot) {
      const anchor = pinned && allowed ? calloutAnchor(pinned, v.a, v.box) : null
      if (anchor) place(calloutRoot, calloutDom.copy, anchor, width, height, m.obstacles)
      else hide(calloutRoot)
    }
  })

  const place = (element: HTMLElement, copy: HTMLElement | null, world: Vector3, width: number, height: number, obstacles: Rect[]) => {
    v.b.copy(world).project(camera)
    const x = (v.b.x * 0.5 + 0.5) * width
    const y = (-v.b.y * 0.5 + 0.5) * height
    const placement = placeLabel({
      x, y, inFront: v.b.z > -1 && v.b.z < 1, copyWidth: copy?.offsetWidth ?? 0, copyHeight: copy?.offsetHeight ?? 0,
      viewWidth: width, viewHeight: height, obstacles,
    })
    if (!placement.visible) return hide(element)
    element.style.transform = `translate3d(${Math.round(x)}px, ${Math.round(y)}px, 0)`
    element.style.setProperty('--stem', `${Math.round(placement.stem)}px`)
    setData(element, 'left', placement.left)
    setData(element, 'below', placement.below)
    setData(element, 'visible', true)
  }

  const labelAnchor = (room: Room, revealed: Revealed, out: Vector3): Vector3 | null => {
    const { source } = live.current
    const level = source.objectFor(room.levelId)
    if (!level) return null
    if (room.kind === 'area' && room.members.length) {
      const roots = room.members.map((id) => source.objectFor(id)).filter((object): object is Object3D => !!object)
      if (roots.length && roots.length < AREA_BOUNDS_LIMIT) {
        v.box.makeEmpty()
        for (const object of roots) v.box.expandByObject(object)
        if (!v.box.isEmpty()) {
          // A cut from the top lowers the anchor to the cut, onto what is still drawn.
          const state = useViewer.getState()
          const top = state.sectionEnabled && state.sectionAxis === 'y' && !state.sectionFlipped ? Math.min(v.box.max.y, state.sectionPosition) : v.box.max.y
          return out.set((v.box.min.x + v.box.max.x) / 2, top, (v.box.min.z + v.box.max.z) / 2)
        }
      }
      if (revealed.hit) return out.set(...revealed.hit)
    }
    const [x, z] = polygonCentre(room.polygon)
    return level.localToWorld(out.set(x, room.floorY + LABEL_LIFT, z))
  }

  return <SectionGroup name="showcase-discovery"><primitive object={root} /></SectionGroup>
}

function discoverable() {
  const state = useViewer.getState()
  return DISCOVERABLE(state) && !useDiscovery.getState().blocked
}

/** Another node's object inside an area part (a hosted item): it is not washed with the part. */
function isOtherNode(object: Object3D) {
  return typeof object.userData?.pascalId === 'string' || typeof object.userData?.nodeId === 'string'
}

/** Whether the camera barely moved since the last frame (see `REST_TRANSLATION_M`). */
function atRest(previous: Matrix4, next: Matrix4) {
  const a = previous.elements; const b = next.elements
  if (Math.hypot(a[12]! - b[12]!, a[13]! - b[13]!, a[14]! - b[14]!) > REST_TRANSLATION_M) return false
  for (const i of [0, 1, 2, 4, 5, 6, 8, 9, 10]) if (Math.abs(a[i]! - b[i]!) > REST_ROTATION) return false
  return true
}

function currentOpacity(wash: { from: number; to: number; start: number; duration: number }, now: number) {
  if (wash.duration <= 0) return wash.to
  return wash.from + (wash.to - wash.from) * easeOutCubic((now - wash.start) / wash.duration)
}

function setData(element: HTMLElement, key: string, value: boolean) {
  const next = String(value)
  if (element.dataset[key] !== next) element.dataset[key] = next
}

function hide(element: HTMLElement) {
  setData(element, 'visible', false)
}

function dismissItem() {
  const viewer = useViewer.getState()
  if (viewer.selection.selectedIds.length) viewer.setSelection({ selectedIds: [] })
  lastItemClick.id = null
  lastItemClick.point = null
  lastItemClick.object = null
}

const OUTDOOR_WORD = { porch: 'Porch', deck: 'Deck', patio: 'Patio' } as const

/** The area in the viewer's unit, rounded as /next shows it; an outdoor area says what it is first. */
export function subtitleOf(room: Room, unit: 'metric' | 'imperial') {
  const value = unit === 'imperial' ? room.area * 10.7639 : room.area
  const area = value >= 0.5 ? `${Math.round(value).toLocaleString('en-US')} ${unit === 'imperial' ? 'sq ft' : 'm²'}` : ''
  return room.outdoorType ? [OUTDOOR_WORD[room.outdoorType], area].filter(Boolean).join(' · ') : area
}

/** The hit, in its level's XZ, with points .35 m in front of and behind its face. */
function probe(membership: Membership, source: ViewerSource, hit: Hit): Probe | null {
  const levelId = membership.levelOf(hit.nodeId)
  const level = levelId ? source.objectFor(levelId) : undefined
  if (!level) return null
  level.updateWorldMatrix(true, false)
  const local = level.worldToLocal(hit.point.clone())
  const point: XZ = [local.x, local.z]
  if (!hit.normal) return { point }
  const inverse = new Matrix4().copy(level.matrixWorld).invert()
  const normal = hit.normal.clone().transformDirection(inverse)
  const flat = Math.hypot(normal.x, normal.z)
  if (flat < 0.3) return { point }
  const dx = (normal.x / flat) * PROBE_M
  const dz = (normal.z / flat) * PROBE_M
  return { point, aside: [[local.x + dx, local.z + dz], [local.x - dx, local.z - dz]] }
}

function calloutAnchor(callout: NonNullable<ReturnType<typeof useDiscovery.getState>['callout']>, out: Vector3, box: Box3): Vector3 | null {
  if (callout.point) return out.set(...callout.point)
  const { object, anchor } = callout
  if (anchor) return object.localToWorld(out.copy(anchor))
  box.setFromObject(object)
  return box.isEmpty() ? null : box.getCenter(out)
}
