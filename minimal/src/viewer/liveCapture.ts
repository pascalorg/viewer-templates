import { type AnyNode, emitter, nodeRegistry, sceneRegistry, useScene } from '@pascal-app/core'
import { poseDoorMovingParts, poseWindowMovingParts } from '@pascal-app/viewer'
import {
  type AnimationClip,
  AnimationClip as Clip,
  type BufferGeometry,
  Group,
  InstancedMesh,
  Line,
  LineBasicMaterial,
  LineLoop,
  LineSegments,
  type Material,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  QuaternionKeyframeTrack,
  type Texture,
  VectorKeyframeTrack,
} from 'three'
import type { SceneGraph } from '../pascal'

/** Pascal's scene layer: what its own exports keep (overlays, zones and batches sit elsewhere). */
const SCENE_LAYER = 0

/** A copy of the runtime's scene, shaped like a bake, with the open clips a bake would carry. */
export type LiveScene = { scene: Group; animations: AnimationClip[] }

/** `userData` keys the drawing owns: a runtime part's own values for these are not copied. */
const OWN_KEYS = new Set(['pascalId', 'kind', 'label', 'openable', 'clips', 'polygon', 'color', 'drawn', 'drawing', 'patches', 'patchKeys', 'cutAbove'])
/** Where an open clip is sampled, from closed (0) to open (1). */
const SAMPLES = [0, 0.25, 0.5, 0.75, 1]
/** Seconds an open clip lasts. */
const OPEN_SECONDS = 0.6

/**
 * A copy of what Pascal's runtime built, shaped like a bake: every Pascal node is an object
 * named by its id with `pascalId`, `kind` and `label` in `userData`, and nothing else rides
 * along (overlays, zone fills, lights, helpers, hidden parts). The drawing then treats an
 * unbaked project exactly like a baked one.
 *
 * It follows Pascal's own capture protocol: `thumbnail:before-capture` hands every batched
 * node its own meshes back and draws walls whole, parts marked `pascalExport: 'strip'` are
 * left out, and `thumbnail:after-capture` puts the runtime back. Geometry is copied, so the
 * runtime can unmount afterwards. Materials are reduced to what the drawing reads from a file's
 * (colour, texture, alpha test, transparency, side); it replaces them anyway.
 *
 * What opens gets the clip Pascal's bake would give it, posed by Pascal's own code on the copy:
 * `poseDoorMovingParts` and the swing leaf's `pascalSwingLeaf` marker for doors,
 * `poseWindowMovingParts` for windows, and each kind's `exportAnimation` hook (cabinets, drawers,
 * gates, procedural furniture). Each is named `<id>: open` and left closed, as in a file.
 */
export function captureLiveScene(graph: SceneGraph): LiveScene {
  const ids = new Map<Object3D, string>()
  for (const [id, object] of sceneRegistry.nodes) ids.set(object, id)
  const copy = new Copier(graph, ids)
  const root = new Group()
  root.name = 'live-capture'
  emitter.emit('thumbnail:before-capture', { wholeWalls: true })
  try {
    for (const id of graph.rootNodeIds) {
      const object = sceneRegistry.nodes.get(id)
      if (!object) continue
      object.updateWorldMatrix(true, true)
      const top = copy.object(object)
      if (!top) continue
      // The roots sit somewhere in the runtime's scene: carry their world placement over.
      object.matrixWorld.decompose(top.position, top.quaternion, top.scale)
      root.add(top)
    }
  } finally {
    emitter.emit('thumbnail:after-capture', undefined)
  }
  const animations: AnimationClip[] = []
  // Core's migrated nodes: the pose code reads fields the published graph may leave out.
  const nodes = useScene.getState().nodes as Record<string, AnyNode | undefined>
  for (const [id, object] of copy.identities) {
    const node = nodes[id]
    if (!node) continue
    const clips = openClips(node, object)
    if (clips.length === 0) continue
    Object.assign(object.userData, { openable: true, clips: clips.map((clip) => clip.name) })
    animations.push(...clips)
  }
  root.updateMatrixWorld(true)
  return { scene: root, animations }
}

/** The clips that open a node, posed by Pascal's code; looping (ambient) motion is left out. */
function openClips(node: AnyNode, object: Object3D): AnimationClip[] {
  const name = `${node.id}: open`
  if (node.type === 'door') {
    // A scripted door brings its own clips, which the copy does not carry.
    if ((node as { source?: unknown }).source) return []
    const leaves: { leaf: Object3D; open: number }[] = []
    object.traverse((part) => {
      const marker = (part.userData as { pascalSwingLeaf?: { axis: 'y'; openRotationY: number } }).pascalSwingLeaf
      if (marker) leaves.push({ leaf: part, open: marker.openRotationY })
    })
    const clip = leaves.length
      ? sample(name, object, (t) => {
          for (const { leaf, open } of leaves) leaf.rotation.y = open * t
        })
      : sample(name, object, (t) => poseDoorMovingParts(node as never, object, t))
    return clip ? [clip] : []
  }
  if (node.type === 'window') {
    const clip = sample(name, object, (t) => poseWindowMovingParts(node as never, object, t))
    return clip ? [clip] : []
  }
  const hook = nodeRegistry.get(node.type)?.exportAnimation
  if (!hook) return []
  try {
    const made = [hook({ node: node as never, object })].flat()
    return made.filter((clip): clip is AnimationClip => !!clip && (clip.userData as { loop?: boolean } | undefined)?.loop !== true)
  } catch {
    return []
  }
}

/**
 * Records what `pose` moves between closed and open as a clip, the way Pascal's exporter samples
 * a clone; leaves the parts closed. Null when nothing moves.
 */
function sample(name: string, object: Object3D, pose: (t: number) => unknown): AnimationClip | null {
  const parts: Object3D[] = []
  object.traverse((part) => parts.push(part))
  const frames = SAMPLES.map((t) => {
    pose(t)
    return parts.map((part) => ({ position: part.position.clone(), quaternion: part.quaternion.clone(), scale: part.scale.clone() }))
  })
  pose(0)
  const times = SAMPLES.map((t) => t * OPEN_SECONDS)
  const tracks = []
  for (const [i, part] of parts.entries()) {
    const poses = frames.map((frame) => frame[i]!)
    const closed = poses[0]!
    const uuid = part.uuid
    if (poses.some((each) => each.position.distanceToSquared(closed.position) > 1e-10)) {
      tracks.push(new VectorKeyframeTrack(`${uuid}.position`, times, poses.flatMap((each) => each.position.toArray())))
    }
    if (poses.some((each) => each.quaternion.angleTo(closed.quaternion) > 1e-5)) {
      tracks.push(new QuaternionKeyframeTrack(`${uuid}.quaternion`, times, poses.flatMap((each) => each.quaternion.toArray())))
    }
    if (poses.some((each) => each.scale.distanceToSquared(closed.scale) > 1e-10)) {
      tracks.push(new VectorKeyframeTrack(`${uuid}.scale`, times, poses.flatMap((each) => each.scale.toArray())))
    }
  }
  return tracks.length ? new Clip(name, OPEN_SECONDS, tracks) : null
}

class Copier {
  /** Every Pascal node copied, by id: what open clips are made for. */
  readonly identities = new Map<string, Object3D>()
  private geometries = new Map<BufferGeometry, BufferGeometry>()
  private materials = new Map<Material, Material>()

  constructor(
    private graph: SceneGraph,
    private ids: Map<Object3D, string>,
  ) {}

  object(source: Object3D): Object3D | null {
    if (!source.visible) return null
    if ((source.userData as { pascalExport?: string }).pascalExport === 'strip') return null
    if (isNotDrawn(source)) return null
    const target = this.shell(source)
    target.name = source.name
    target.position.copy(source.position)
    target.quaternion.copy(source.quaternion)
    target.scale.copy(source.scale)
    // The markers Pascal's pose code reads (a swing leaf, a cabinet door's hinge, a window's side).
    target.userData = plainUserData(source.userData)
    const id = this.ids.get(source)
    const node = id ? this.graph.nodes[id] : undefined
    if (id && node) {
      target.name = id
      Object.assign(target.userData, { pascalId: id, kind: node.type, label: typeof node.name === 'string' ? node.name : undefined })
      if (!this.identities.has(id)) this.identities.set(id, target)
    }
    for (const child of source.children) {
      const copy = this.object(child)
      if (copy) target.add(copy)
    }
    // An empty branch that names nothing is noise.
    if (!(target instanceof Mesh || target instanceof Line) && !id && target.children.length === 0) return null
    return target
  }

  /** The drawable part of an object, or a bare node when it draws nothing the drawing keeps. */
  private shell(source: Object3D): Object3D {
    // Door and window roots are hit boxes, drawn with an invisible material.
    if (source instanceof Mesh && [source.material].flat().every((material: Material) => !material.visible)) {
      return new Object3D()
    }
    if (source instanceof InstancedMesh && source.layers.isEnabled(SCENE_LAYER)) {
      const copy = new InstancedMesh(this.geometry(source.geometry), this.material(source.material), source.count)
      copy.instanceMatrix.copy(source.instanceMatrix)
      return copy
    }
    if (source instanceof Mesh && source.layers.isEnabled(SCENE_LAYER)) {
      return new Mesh(this.geometry(source.geometry), this.material(source.material))
    }
    if (source instanceof Line && source.layers.isEnabled(SCENE_LAYER)) {
      const material = new LineBasicMaterial()
      const kind =
        source instanceof LineSegments ? LineSegments : source instanceof LineLoop ? LineLoop : Line
      return new kind(this.geometry(source.geometry), material)
    }
    return new Object3D()
  }

  private geometry(source: BufferGeometry): BufferGeometry {
    let copy = this.geometries.get(source)
    if (!copy) {
      copy = source.clone()
      this.geometries.set(source, copy)
    }
    return copy
  }

  private material(source: Material | Material[]): Material | Material[] {
    if (Array.isArray(source)) return source.map((each) => this.single(each))
    return this.single(source)
  }

  private single(source: Material): Material {
    let copy = this.materials.get(source)
    if (!copy) {
      const fields = source as Material & { color?: { getHex(): number }; map?: Texture | null }
      const material = new MeshStandardMaterial({
        alphaTest: source.alphaTest,
        opacity: source.opacity,
        side: source.side,
        transparent: source.transparent,
      })
      if (fields.color) material.color.setHex(fields.color.getHex())
      if (fields.map?.isTexture) material.map = fields.map
      material.name = source.name
      copy = material
      this.materials.set(source, copy)
    }
    return copy
  }
}

/** A part's own `userData` that survives a copy (plain values only), minus the drawing's keys. */
function plainUserData(data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(data)) {
    if (OWN_KEYS.has(key)) continue
    try {
      const text = JSON.stringify(value)
      if (text !== undefined) out[key] = JSON.parse(text)
    } catch {
      // Not plain data (an object graph, a cycle): the pose code never reads those.
    }
  }
  return out
}

/** Lights, cameras, sprites and batches: never part of a file. */
function isNotDrawn(object: Object3D): boolean {
  const flags = object as Object3D & { isLight?: boolean; isCamera?: boolean; isSprite?: boolean; isBatchedMesh?: boolean; isPoints?: boolean }
  return !!(flags.isLight || flags.isCamera || flags.isSprite || flags.isBatchedMesh || flags.isPoints)
}
