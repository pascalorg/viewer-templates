import { type AnyNodeId, initSpatialGridSync, operateItem, sceneRegistry, toggleDoorOpenState, toggleWindowOpenState, useInteractive, useScene } from '@pascal-app/core'
import { InteractiveSystem, SceneEnvironment, useViewer, Viewer } from '@pascal-app/viewer'
import { frameViewerNode, SceneLoader, selectViewerLevel, useViewerFloorDisplay, type ViewerSource } from '@pascal-app/viewer/ui'
import { useThree } from '@react-three/fiber'
import { Tag, X } from 'lucide-react'
import { type CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import type { SceneResponse } from '../pascal'
import { pluginInstallStateOf, publishedSceneSetup } from '../runtime/plugins'
import { CameraRig, type CameraView } from './CameraRig'
import type { Area, FieldKind } from './entities'
import { livePosition } from './effects/common'
import { type HomeLayer, HomeOverlay, HomeScene, useHomeLayer } from './HomeLayer'
import { ExplorePanel, useSceneLevels } from './explore/ExplorePanel'
import { RoomLabels } from './explore/RoomLabels'
import { useIsCompact } from './explore/useIsCompact'
import { insideOutline, roomOf } from './sketch/roomInk'
import { readStore, updateStore } from './storage'
import { playPick, useUiSounds } from './sound'
import { HelpGuide } from './sketch/HelpGuide'
import { SettingsMenu } from './sketch/SettingsMenu'

/* A Pascal project as the effects lab shows its home (src/lab/Lab.tsx), with the visitor's own
   Home Assistant in place of the lab's simulated one: the guided tour's wireframe in light or dark,
   walls up at midday, the devices panel, pins and effects on the items Home Assistant drives, and
   the camera flying to a device. Before the visitor connects, the plan shows as the wireframe with
   the connect card where the devices panel will be. The graph is always rebuilt live, as in the lab. */

type SetSceneArgs = Parameters<ReturnType<typeof useScene.getState>['setScene']>
type Graph = Parameters<typeof publishedSceneSetup>[0]

/** Looking down on the whole plan from the south-east, as the lab's opening view does. */
function viewOf(areas: Area[]): CameraView {
  if (!areas.length) return { position: new THREE.Vector3(13, 15, 19), target: new THREE.Vector3(0, 0.4, 0) }
  const x0 = Math.min(...areas.map((a) => a.bounds[0]))
  const z0 = Math.min(...areas.map((a) => a.bounds[1]))
  const x1 = Math.max(...areas.map((a) => a.bounds[2]))
  const z1 = Math.max(...areas.map((a) => a.bounds[3]))
  const size = Math.max(x1 - x0, z1 - z0, 6)
  const target = new THREE.Vector3((x0 + x1) / 2, 0.4, (z0 + z1) / 2)
  return { position: target.clone().add(new THREE.Vector3(size * 0.55, size * 0.75, size * 0.95)), target }
}

export function HomeProjectViewer({ scene, runtimeRevision }: { scene: SceneResponse; runtimeRevision: number }) {
  const { project } = scene
  const graph = useMemo(() => ({ ...scene.graph, installedPlugins: pluginInstallStateOf(scene.graph).installedPlugins }) as unknown as Graph, [scene.graph])
  const [mounted, setMounted] = useState(false)
  const [sceneReady, setSceneReady] = useState(false)

  // the lab's settings: walls up and midday light; light or dark only swaps the ink
  useEffect(() => {
    document.title = project.name || 'Home'
    const g = graph as unknown as { nodes: SetSceneArgs[0]; rootNodeIds: SetSceneArgs[1] }
    useScene.getState().setScene(g.nodes, g.rootNodeIds, publishedSceneSetup(graph))
    const stopGrid = initSpatialGridSync()
    const viewer = useViewer.getState()
    viewer.setProjectId(project.id)
    viewer.resetSelection()
    viewer.setWalkthroughMode(false)
    viewer.setCameraMode('perspective')
    viewer.setLevelMode('stacked')
    viewer.setWallMode('up')
    viewer.setShowGrid(false)
    viewer.setShowMeasurements(false)
    viewer.setTimeOfDay('midday')
    setMounted(true)
    return () => {
      stopGrid()
      useViewer.getState().setProjectId(null)
    }
  }, [graph, project.id, project.name, runtimeRevision])
  useEffect(() => () => useScene.getState().unloadScene(), [])

  return (
    <main className="relative h-full overflow-hidden" data-state={sceneReady ? 'ready' : 'loading'}>
      {mounted && <HomeStage ownerName={project.owner?.displayName ?? null} projectId={project.id} title={project.name || 'Home'} sceneReady={sceneReady} onSceneReady={setSceneReady} sceneKey={`${project.id}:${runtimeRevision}`} />}
      {!sceneReady && <SceneLoader className="bg-background" fullScreen />}
    </main>
  )
}

function HomeStage({ projectId, ownerName, title, sceneReady, onSceneReady, sceneKey }: {
  projectId: string
  ownerName: string | null
  title: string
  sceneReady: boolean
  onSceneReady: (ready: boolean) => void
  sceneKey: string
}) {
  const nodes = useScene((s) => s.nodes)
  const source = useMemo<ViewerSource>(() => ({ nodes, objectFor: (id) => sceneRegistry.nodes.get(id) }), [nodes])
  const home = useHomeLayer({ projectId, source, ready: sceneReady })
  // the interface's sounds: the visitor's own clicks in this browser, never Home Assistant's changes
  useUiSounds()
  const pins = useRef<Record<string, HTMLElement | null>>({})
  const [selected, setSelected] = useState<string | null>(null)
  // the floor shows nothing until the visitor picks a reading (or opens a sensor's card)
  const [layer, setLayer] = useState<FieldKind | null>(null)
  const view = useMemo(() => viewOf(home.areas), [home.areas])
  // a floor picked from the list reads as on the default viewer: the floors above step aside
  useViewerFloorDisplay()
  // open on the lowest floor that has rooms, as the lab shows its home: the roof out of the way
  const opened = useRef(false)
  useEffect(() => {
    if (!sceneReady || opened.current) return
    opened.current = true
    const levels = Object.values(nodes).filter((n): n is Extract<typeof n, { type: 'level' }> => n?.type === 'level').sort((a, b) => a.level - b.level)
    const roomed = levels.find((l) => Object.values(nodes).some((n) => n?.type === 'zone' && n.parentId === l.id))
    if (levels.length > 1 && roomed) selectViewerLevel(roomed.id, source)
  }, [sceneReady, nodes, source])
  // the tour viewer's explore panel on the right: links to Pascal, the project, its floors, plan and rooms
  const levels = useSceneLevels(source)
  const compact = useIsCompact()
  // folded until Home Assistant is connected: a visitor who hasn't connected sees the plan, the
  // connect card and Pascal's links only; it opens once connected and folds again on disconnect
  const [exploreOpen, setExploreOpen] = useState(false)
  useEffect(() => setExploreOpen(home.connected), [home.connected])
  const [mobileExploreOpen, setMobileExploreOpen] = useState(false)
  useEffect(() => {
    // E opens or folds it, as in the tour viewer
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== 'e' || e.metaKey || e.ctrlKey || e.altKey) return
      const t = e.target as HTMLElement | null
      if (t?.closest('input, textarea, select, [contenteditable="true"]')) return
      if (compact) setMobileExploreOpen((v) => !v)
      else setExploreOpen((v) => !v)
    }
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  }, [compact])
  // the device controls and the link cards open beside the panel, never under it
  const cardPlace = {
    '--card-top': compact ? '4.25rem' : exploreOpen ? '1rem' : '4.75rem',
    '--card-right': compact || !exploreOpen ? '1rem' : '20rem',
  } as CSSProperties
  // an item clicked on the plan opens its links where a device's controls would: one card at a time
  const [itemId, setItemId] = useState<string | null>(null)
  // a room picked in the explore panel develops into colour, and its furniture can then be linked
  const [roomId, setRoomId] = useState<string | null>(null)
  const pickRoom = useCallback((id: string | null) => {
    setRoomId(id)
    setItemId(null)
    setSelected(null)
  }, [])
  // the rooms' labels in 3D, on or off; the choice is kept with the visitor's links (`storage.ts`)
  const [labels, setLabels] = useState(() => readStore().preferences.roomLabels)
  const toggleLabels = useCallback(() => {
    const on = !readStore().preferences.roomLabels
    updateStore((store) => {
      store.preferences.roomLabels = on
    })
    setLabels(on)
  }, [])
  const roomName = roomId ? ((nodes[roomId as keyof typeof nodes] as { name?: string } | undefined)?.name || 'room') : null
  // a room's label in 3D picks it as the panel's list does: framed, then picked
  const pickRoomLabel = useCallback((id: string) => {
    frameViewerNode(id, source)
    pickRoom(id)
  }, [source, pickRoom])
  // Escape lets the room go; so does showing another floor
  useEffect(() => {
    if (!roomId) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      const t = e.target as HTMLElement | null
      if (t?.closest('input, textarea, select, [contenteditable="true"]')) return
      playPick(false)
      pickRoom(null)
    }
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  }, [roomId, pickRoom])
  const shownLevel = useViewer((s) => s.selection.levelId)
  useEffect(() => {
    const zone = roomId ? (nodes[roomId as keyof typeof nodes] as { parentId?: string | null } | undefined) : undefined
    if (roomId && (!zone || (shownLevel && zone.parentId !== shownLevel))) pickRoom(null)
  }, [roomId, shownLevel, nodes, pickRoom])
  const kept = useRef(home.kept)
  kept.current = home.kept
  const pickItem = useCallback((id: string | null) => {
    setItemId(id)
    if (!id) return
    // a click on the plan: the select tick, here only (never for what Home Assistant changes)
    playPick(true)
    setSelected(null)
    // and it works as on Pascal's own viewer: a door swings, a window opens, a fridge or a fan runs.
    // Not what Home Assistant drives: that follows its device (its pin switches it)
    if (!kept.current.has(id)) operateModel(id)
  }, [])

  const press = useCallback((id: string) => setSelected((s) => (s === id ? s : id)), [])
  const select = useCallback((id: string | null) => {
    setSelected(id)
    const e = id ? home.entities[id] : undefined
    const k = e?.attributes.device_class as FieldKind | undefined
    if (e?.entity_id.startsWith('sensor.') && k) setLayer(k)
  }, [home.entities])
  const device = home.devices.find((d) => d.entityId === selected) ?? null
  // a clicked pin group: where its devices are, for the camera to close in on (a new array each click)
  const [group, setGroup] = useState<THREE.Vector3[] | null>(null)
  const zoomTo = useCallback((ids: string[]) => {
    setGroup(ids.map((id) => livePosition.get(id)?.clone() ?? new THREE.Vector3(...(home.devices.find((d) => d.entityId === id)?.anchor.position ?? [0, 0, 0]))))
  }, [home.devices])
  // a device that went away (disconnected, re-linked) is no longer selected
  useEffect(() => {
    if (selected && !home.devices.some((d) => d.entityId === selected)) setSelected(null)
  }, [selected, home.devices])

  return (
    <>
      {/* as the guided tour: no daylight sky, so its Noir or paper theme and light rig show */}
      <Viewer daylight={false} defaultRender={{ shading: 'rendered' }} onSceneReadyChange={onSceneReady} renderContext="viewer" sceneReadyKey={sceneKey} selectionManager="custom" useBvh={false}>
        <SceneEnvironment />
        <CameraRig device={device} group={group} home={view} />
        {import.meta.env.DEV && <DevHandle />}
        <InteractiveSystem />
        {/* in the picked room, a click on a piece of furniture opens its links */}
        <ItemPicker home={home} nodes={nodes} onPick={pickItem} roomId={roomId} source={source} />
        {/* each room of the floor shown, named on the plan: a label picks its room */}
        {labels && <RoomLabels onPick={pickRoomLabel} roomId={roomId} source={source} />}
        {/* the guided tour's wireframe over everything but what Home Assistant drives and the picked room, and their effects */}
        <HomeScene home={home} layer={layer} onPress={press} pins={pins} room={roomId} selected={selected} />
      </Viewer>

      <div className="contents" style={cardPlace}>
      <HomeOverlay home={home} itemId={itemId} layer={layer} onCloseItem={() => setItemId(null)} onGroup={zoomTo} onLayer={setLayer} onSelect={select} pins={pins}
        owner={ownerName} roomId={roomId} selected={selected} title={title} />

      </div>

      {/* the tour viewer's explore panel: Pascal's links, the project, its floors, live plan and rooms */}
      <ExplorePanel compact={compact} embed={false} levels={levels} mobileOpen={mobileExploreOpen} onMobileOpenChange={setMobileExploreOpen}
        onOpenChange={setExploreOpen} onRoomSelect={pickRoom} open={exploreOpen} ownerName={ownerName} projectName={title} selectedRoomId={roomId} source={source} />

      {/* bottom right (over the Home Assistant pill on a phone): let the picked room go (not everyone knows Escape, and a tablet has none),
          the rooms' labels on or off, the guide to linking devices, and the settings (light or dark, solid or glass) */}
      <div className="pointer-events-none absolute right-4 bottom-[4.75rem] z-30 flex flex-wrap items-center justify-end gap-2 sm:right-6 sm:bottom-6">
        {roomName && (
          <button aria-label={`Deselect ${roomName}`} className={TOOL} onClick={() => pickRoom(null)} type="button">
            <X aria-hidden="true" className="h-3.5 w-3.5" />
            <span className="max-w-40 truncate">Deselect {roomName}</span>
          </button>
        )}
        <button aria-pressed={!labels} className={TOOL} onClick={toggleLabels} type="button">
          <Tag aria-hidden="true" className="h-3.5 w-3.5" />
          {labels ? 'Hide labels' : 'Show labels'}
        </button>
        <HelpGuide />
        <SettingsMenu />
      </div>
    </>
  )
}

/** A button of the bottom-right toolbar, in the theme switch's look. */
const TOOL = 'corner-smooth pointer-events-auto flex h-10 items-center gap-2 rounded-full border border-border/60 bg-background/95 px-4 font-medium text-foreground text-xs shadow-elevation-4 backdrop-blur-xl transition-colors hover:bg-background focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2'

/**
 * Operates a model by Pascal's own rules, as a click on its viewer does. Not persisted: the scene
 * is read-only here, and a persisted animation would snap back when its write is refused.
 */
function operateModel(id: string) {
  const node = useScene.getState().nodes[id as AnyNodeId] as { type?: string; asset?: { interactive?: unknown } } | undefined
  if (node?.type === 'door') return toggleDoorOpenState(id as AnyNodeId, { persist: false })
  if (node?.type === 'window') return toggleWindowOpenState(id as AnyNodeId, { persist: false })
  const interactive = node?.asset?.interactive as Parameters<typeof operateItem>[1] | undefined
  if (node?.type !== 'item' || !interactive?.controls?.length) return
  const store = useInteractive.getState()
  if (!store.items[id as AnyNodeId]) store.initItem(id as AnyNodeId, interactive, true)
  operateItem(id as AnyNodeId, interactive)
}

/** What a click can pick: things a device can be. */
const PICKABLE = new Set(['item', 'door', 'window'])

/**
 * In the room picked in the explore panel, a click (not a drag) picks the piece of furniture under
 * it: the first item along the ray, seen through the ghosted walls, floors and roofs in front of it,
 * when it stands in that room. What can be picked is outlined under the pointer. With no room picked, or on
 * furniture of another room, a click picks nothing.
 */
function ItemPicker({ nodes, onPick, roomId, home, source }: {
  nodes: Record<string, { type?: string } | undefined>
  onPick: (id: string | null) => void
  roomId: string | null
  home: HomeLayer
  source: ViewerSource
}) {
  const { gl, camera, scene } = useThree()
  const showHover = useHoverOutline()
  const live = useRef({ nodes, onPick, roomId, home, source })
  live.current = { nodes, onPick, roomId, home, source }
  useEffect(() => {
    const el = gl.domElement
    const ray = new THREE.Raycaster()
    const at = new THREE.Vector2()
    const box = new THREE.Box3()
    const centre = new THREE.Vector3()
    let down: { x: number; y: number } | null = null
    let lastMove = 0
    /** Whether an item stands in the picked room: by the linking's rooms, else by where it is drawn. */
    const inRoom = (id: string) => {
      const { roomId: room, home: h, source: s } = live.current
      if (!room) return false
      const thing = h.things.find((t) => t.id === id)
      if (thing?.rooms.some((r) => r.id === room)) return true
      const outline = roomOf(s, room)?.outline
      const object = s.objectFor(id)
      if (!outline || !object) return false
      box.setFromObject(object)
      if (box.isEmpty()) return false
      box.getCenter(centre)
      return insideOutline(outline, centre.x, centre.z)
    }
    /** The item of the picked room under the pointer, if any. */
    const itemAt = (e: PointerEvent): string | null => {
      if (!live.current.roomId) return null
      const r = el.getBoundingClientRect()
      at.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1)
      ray.setFromCamera(at, camera)
      const owner = new Map<THREE.Object3D, string>()
      for (const [id, obj] of sceneRegistry.nodes) owner.set(obj, id)
      for (const hit of ray.intersectObjects(scene.children, true)) {
        if (!hit.object.visible) continue
        for (let o: THREE.Object3D | null = hit.object; o; o = o.parent) {
          const id = owner.get(o)
          if (id && PICKABLE.has(live.current.nodes[id]?.type ?? '')) {
            if (inRoom(id)) return id
            break
          }
        }
      }
      return null
    }
    const onDown = (e: PointerEvent) => {
      down = e.button === 0 ? { x: e.clientX, y: e.clientY } : null
    }
    const onUp = (e: PointerEvent) => {
      if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5) return
      down = null
      if (!live.current.roomId) return
      live.current.onPick(itemAt(e))
    }
    const onMove = (e: PointerEvent) => {
      if (!live.current.roomId) {
        showHover(null)
        return
      }
      if (e.buttons || e.timeStamp - lastMove < 50) return
      lastMove = e.timeStamp
      showHover(itemAt(e))
    }
    const onLeave = () => showHover(null)
    el.addEventListener('pointerdown', onDown)
    el.addEventListener('pointerup', onUp)
    el.addEventListener('pointermove', onMove)
    el.addEventListener('pointerleave', onLeave)
    return () => {
      el.removeEventListener('pointerdown', onDown)
      el.removeEventListener('pointerup', onUp)
      el.removeEventListener('pointermove', onMove)
      el.removeEventListener('pointerleave', onLeave)
      showHover(null)
    }
  }, [gl, camera, scene, showHover])
  // a room let go takes its outline with it
  useEffect(() => {
    if (!roomId) showHover(null)
  }, [roomId, showHover])
  return null
}

/**
 * Outlines the piece of furniture under the pointer that can be linked, with Pascal's own hover
 * outline (its outliner, as its selection manager fills it: this viewer runs a custom one), and
 * shows the pointer over it.
 */
function useHoverOutline() {
  const gl = useThree((s) => s.gl)
  const hovered = useRef<string | null>(null)
  return useCallback((id: string | null) => {
    if (hovered.current === id) return
    hovered.current = id
    gl.domElement.style.cursor = id ? 'pointer' : ''
    const { outliner } = useViewer.getState()
    outliner.hoveredObjects.length = 0
    const object = id ? sceneRegistry.nodes.get(id as AnyNodeId) : undefined
    if (object) outliner.hoveredObjects.push(object)
  }, [gl])
}

/** Development builds only: the three.js state on `window.__lab`, as in the lab. */
function DevHandle() {
  const state = useThree()
  useEffect(() => {
    ;(window as unknown as { __lab: unknown }).__lab = state
    ;(window as unknown as { __sceneRegistry: unknown }).__sceneRegistry = sceneRegistry
  }, [state])
  return null
}
