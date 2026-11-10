import {
  acquireSceneReadOnlyLease,
  emitter,
  loadPlugin,
  nodeMechanism,
  type NodeEvent,
  registerLibraryMaterials,
  sceneRegistry,
  toggleMechanism,
  unregisterLibraryMaterials,
  useScene,
} from '@pascal-app/core'
import { renderPlugin } from '@pascal-app/nodes/render'
import { configureViewer, useViewer, Viewer } from '@pascal-app/viewer'
import { OrbitControls } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useState } from 'react'
import { Vector3 } from 'three'
import { PASCAL_BASE_URL } from '../config'
import { findAncestorOfType, type SceneResponse, zoneArea, zoneContains, zoneInfo } from '../pascal'
import type { RoomHover } from './semantics'

type SceneInput = Parameters<ReturnType<typeof useScene.getState>['setScene']>
type LiveViewerProps = {
  scene: SceneResponse
  levelId: string | null
  onError: (error: unknown) => void
  onHover: (hover: (RoomHover & { x: number; y: number }) | null) => void
  onSceneReadyChange: (ready: boolean) => void
}

configureViewer({ assetsBaseUrl: PASCAL_BASE_URL })
const pluginReady = loadPlugin(renderPlugin)

export function LiveViewer({ scene, levelId, onError, onHover, onSceneReadyChange }: LiveViewerProps) {
  const [loaded, setLoaded] = useState<SceneResponse | null>(null)

  useEffect(() => {
    let cancelled = false
    let release: (() => void) | undefined
    // The API keeps kind-specific data loose; core migrates it when loading.
    const graph = scene.graph as unknown as {
      nodes: SceneInput[0]
      rootNodeIds: SceneInput[1]
    } & NonNullable<SceneInput[2]>
    const materials = scene.libraryMaterials as Parameters<typeof registerLibraryMaterials>[0]
    onSceneReadyChange(false)
    void pluginReady.then(() => {
      if (cancelled) return
      release = acquireSceneReadOnlyLease()
      registerLibraryMaterials(materials)
      useScene.getState().setScene(graph.nodes, graph.rootNodeIds, {
        materials: graph.materials,
        collections: graph.collections,
        installedPlugins: graph.installedPlugins,
      })
      const viewer = useViewer.getState()
      viewer.resetSelection()
      viewer.setCameraMode('perspective')
      viewer.setLevelMode('stacked')
      viewer.setWallMode('up')
      viewer.setShowGrid(false)
      viewer.setShowMeasurements(false)
      viewer.setTextures(false)
      setLoaded(scene)
    }).catch((error: unknown) => !cancelled && onError(error))
    return () => {
      cancelled = true
      if (release) {
        unregisterLibraryMaterials(materials.map((material) => material.id))
        release()
      }
    }
  }, [scene, onError, onSceneReadyChange])

  useEffect(() => {
    if (loaded !== scene) return
    const viewer = useViewer.getState()
    const building = levelId ? findAncestorOfType(scene.graph, levelId, 'building') : null
    const selection = {
      buildingId: building?.id ?? null,
      levelId,
      zoneId: null,
      selectedIds: [],
    } as Parameters<typeof viewer.setSelection>[0]
    viewer.setSelection(selection)
    viewer.setLevelMode(levelId ? 'solo' : 'stacked')
  }, [loaded, scene, levelId])

  useEffect(() => {
    if (loaded !== scene) return
    const move = (event: NodeEvent) => {
      event.stopPropagation()
      const level = findAncestorOfType(scene.graph, event.node.id, 'level')
      let room: RoomHover | null = null
      for (const node of Object.values(scene.graph.nodes)) {
        const zone = zoneInfo(node)
        if (!zone || findAncestorOfType(scene.graph, node.id, 'level')?.id !== level?.id) continue
        const object = sceneRegistry.nodes.get(node.id)
        if (!object) continue
        const point = object.worldToLocal(new Vector3(...event.position))
        if (zoneContains(zone, point.x, point.z)) {
          room = { label: zone.name ?? 'Room', area: zoneArea(zone) }
          break
        }
      }
      const { clientX: x, clientY: y } = event.nativeEvent
      onHover(room ? { ...room, x, y } : null)
    }
    const leave = () => onHover(null)
    const click = (event: NodeEvent) => {
      event.stopPropagation()
      if (event.nativeEvent.delta > 4) return
      if (event.node.type !== 'door' && event.node.type !== 'window') return
      const mechanism = nodeMechanism(event.node)
      if (mechanism) toggleMechanism(mechanism, event.node)
    }
    emitter.on('node:move', move)
    emitter.on('node:leave', leave)
    emitter.on('node:click', click)
    return () => {
      emitter.off('node:move', move)
      emitter.off('node:leave', leave)
      emitter.off('node:click', click)
      onHover(null)
    }
  }, [loaded, scene, onHover])

  if (loaded !== scene) return null
  return (
    <Viewer
      daylight={false}
      defaultRender={{ textures: false }}
      disablePostFx
      onRenderError={onError}
      onSceneReadyChange={onSceneReadyChange}
      sceneReadyKey={`${scene.project.id}:${scene.revision.version}`}
      selectionManager="custom"
    >
      <OrbitControls makeDefault target={[0, 1, 0]} />
      <ListingCutaway scene={scene} levelId={levelId} />
    </Viewer>
  )
}

function ListingCutaway({ scene, levelId }: Pick<LiveViewerProps, 'scene' | 'levelId'>) {
  const shells = useMemo(() => Object.values(scene.graph.nodes).filter((node) =>
    node.type === 'ceiling' || node.type === 'roof' || node.type === 'roof-segment'), [scene.graph])
  // Match the baked floor control's dollhouse view, including nodes that mount lazily.
  useFrame(() => {
    for (const node of shells) {
      const object = sceneRegistry.nodes.get(node.id)
      if (object) object.visible = node.visible !== false && levelId === null
    }
  })
  return null
}
