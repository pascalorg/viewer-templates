import * as THREE from 'three'
import { LineBasicNodeMaterial, MeshBasicNodeMaterial, MeshStandardNodeMaterial } from 'three/webgpu'
import type { BuildElement, BuildRoom } from './elements'
import type { LinePlan, WavePlan } from './templates'

/**
 * The overlays the templates draw around the build: dust puffs, blueprint lines and ground waves.
 * All are plain meshes on the scene layer with single-sided node materials (a double-sided node
 * material inside Pascal's MRT scene pass breaks the WebGPU render context), never raycast, and
 * added to the scene root so the build's own motion never moves them.
 */

const NO_RAYCAST = () => {}

// ---------------------------------------------------------------------------------------------
// Dust

type Grain = {
  born: number
  life: number
  position: THREE.Vector3
  velocity: THREE.Vector3
  size: number
}

export class DustPool {
  readonly mesh: THREE.InstancedMesh
  private readonly grains: Array<Grain | null>
  private next = 0
  private readonly matrix = new THREE.Matrix4()
  private readonly quaternion = new THREE.Quaternion()
  private readonly scale = new THREE.Vector3()
  private readonly geometry: THREE.BufferGeometry
  private readonly material: THREE.Material

  constructor(capacity = 700, color = '#d9d3ca') {
    this.geometry = new THREE.IcosahedronGeometry(1, 1)
    this.material = new MeshStandardNodeMaterial({ color, roughness: 1, metalness: 0 })
    this.mesh = new THREE.InstancedMesh(this.geometry, this.material, capacity)
    this.mesh.name = 'animation-dust'
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    this.mesh.frustumCulled = false
    this.mesh.castShadow = false
    this.mesh.receiveShadow = false
    this.mesh.raycast = NO_RAYCAST
    this.grains = new Array(capacity).fill(null)
    this.clear()
  }

  /** A ring of grains kicked out from the base of `box`. */
  puff(box: THREE.Box3, strength: number, now: number) {
    const cx = (box.min.x + box.max.x) / 2
    const cz = (box.min.z + box.max.z) / 2
    const hx = (box.max.x - box.min.x) / 2
    const hz = (box.max.z - box.min.z) / 2
    const count = Math.round(10 + strength * 22)
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2
      const dx = Math.cos(angle)
      const dz = Math.sin(angle)
      // On the footprint's edge, so long walls puff along their whole length.
      const t = Math.random() * 2 - 1
      const along = hx >= hz
      const x = cx + (along ? t * hx : dx * hx)
      const z = cz + (along ? dz * hz : t * hz)
      const speed = (0.6 + Math.random() * 1.6) * (0.6 + strength * 0.6)
      this.grains[this.next] = {
        born: now,
        life: 0.7 + Math.random() * 0.8,
        position: new THREE.Vector3(x, box.min.y + 0.05, z),
        velocity: new THREE.Vector3(dx * speed, 0.4 + Math.random() * 1.1 * strength, dz * speed),
        size: (0.03 + Math.random() * 0.07) * (0.6 + strength * 0.7),
      }
      this.next = (this.next + 1) % this.grains.length
    }
  }

  update(now: number, dt: number) {
    let live = 0
    for (let i = 0; i < this.grains.length; i++) {
      const grain = this.grains[i]
      if (grain) {
        const age = (now - grain.born) / grain.life
        if (age >= 1 || age < 0) {
          this.grains[i] = null
        } else {
          grain.velocity.multiplyScalar(Math.max(0, 1 - dt * 2.6))
          grain.velocity.y -= dt * 0.6
          grain.position.addScaledVector(grain.velocity, dt)
          // Grows as it spreads, then thins away.
          const s = grain.size * (0.6 + age * 1.4) * (1 - age) ** 0.7
          this.scale.setScalar(Math.max(1e-4, s))
          this.matrix.compose(grain.position, this.quaternion, this.scale)
          this.mesh.setMatrixAt(i, this.matrix)
          live++
          continue
        }
      }
      this.scale.setScalar(0)
      this.matrix.compose(_origin, this.quaternion, this.scale)
      this.mesh.setMatrixAt(i, this.matrix)
    }
    this.mesh.visible = live > 0
    this.mesh.instanceMatrix.needsUpdate = true
  }

  clear() {
    this.grains.fill(null)
    this.update(0, 0)
  }

  dispose() {
    this.mesh.removeFromParent()
    this.geometry.dispose()
    this.material.dispose()
    this.mesh.dispose()
  }
}

const _origin = new THREE.Vector3()

// ---------------------------------------------------------------------------------------------
// Blueprint lines

const EDGE_ANGLE = 28
const MAX_EDGE_TRIANGLES = 20000

/** Box outline: furniture reads cleaner as a crate than as its every crease. */
function boxLines(box: THREE.Box3): number[] {
  const { min: a, max: b } = box
  const c = [
    [a.x, a.y, a.z], [b.x, a.y, a.z], [b.x, a.y, b.z], [a.x, a.y, b.z],
    [a.x, b.y, a.z], [b.x, b.y, a.z], [b.x, b.y, b.z], [a.x, b.y, b.z],
  ]
  const pairs = [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]]
  const out: number[] = []
  for (const [i, j] of pairs) out.push(...c[i!]!, ...c[j!]!)
  return out
}

function elementLines(element: BuildElement): Float32Array {
  if (element.phase === 'items' || element.phase === 'exterior') return new Float32Array(boxLines(element.box))
  const out: number[] = []
  const point = new THREE.Vector3()
  element.object.updateWorldMatrix(true, true)
  element.object.traverse((child) => {
    const mesh = child as THREE.Mesh
    if (!mesh.isMesh || !mesh.geometry?.getAttribute('position')) return
    const material = mesh.material as THREE.Material | THREE.Material[]
    const list = Array.isArray(material) ? material : [material]
    if (list.length > 0 && list.every((m) => m && m.visible === false)) return
    if (/collision|collider|cutout|hitbox/i.test(mesh.name)) return
    const position = mesh.geometry.getAttribute('position')
    const triangles = (mesh.geometry.index ? mesh.geometry.index.count : position.count) / 3
    if (triangles > MAX_EDGE_TRIANGLES) return
    const edges = new THREE.EdgesGeometry(mesh.geometry, EDGE_ANGLE)
    const attr = edges.getAttribute('position')
    for (let i = 0; i < attr.count; i++) {
      point.fromBufferAttribute(attr, i).applyMatrix4(mesh.matrixWorld)
      out.push(point.x, point.y, point.z)
    }
    edges.dispose()
  })
  return out.length > 0 ? new Float32Array(out) : new Float32Array(boxLines(element.box))
}

export class BlueprintLines {
  readonly group = new THREE.Group()
  private readonly material: LineBasicNodeMaterial
  private readonly glow: LineBasicNodeMaterial
  private readonly lines: Array<{ line: THREE.LineSegments; halo: THREE.LineSegments; count: number; start: number; duration: number }> = []
  private readonly fadeStart: number
  private readonly fadeEnd: number

  constructor(elements: readonly BuildElement[], plan: LinePlan, color: string) {
    this.group.name = 'animation-blueprint'
    this.material = new LineBasicNodeMaterial({ color, transparent: true, opacity: 0.95, depthWrite: false })
    // A second, wider-looking pass: the same lines lifted a hair and fainter, read as a glow.
    this.glow = new LineBasicNodeMaterial({ color: '#bfe6ff', transparent: true, opacity: 0.35, depthWrite: false, depthTest: false })
    this.fadeStart = plan.fadeStart
    this.fadeEnd = plan.fadeEnd
    for (const element of elements) {
      const draw = plan.draw.get(element.id)
      if (!draw) continue
      const positions = elementLines(element)
      const geometry = new THREE.BufferGeometry()
      geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
      const line = new THREE.LineSegments(geometry, this.material)
      const halo = new THREE.LineSegments(geometry, this.glow)
      for (const l of [line, halo]) {
        l.raycast = NO_RAYCAST
        l.frustumCulled = false
        l.renderOrder = 2
        this.group.add(l)
      }
      this.lines.push({ line, halo, count: positions.length / 3, start: draw.start, duration: draw.duration })
    }
  }

  update(time: number) {
    const fade = time <= this.fadeStart ? 1 : time >= this.fadeEnd ? 0 : 1 - (time - this.fadeStart) / (this.fadeEnd - this.fadeStart)
    this.group.visible = fade > 0.001
    this.material.opacity = 0.95 * fade
    this.glow.opacity = 0.3 * fade
    for (const entry of this.lines) {
      const u = THREE.MathUtils.clamp((time - entry.start) / entry.duration, 0, 1)
      // Whole segments only: a drawn line is a pair of vertices.
      const shown = Math.floor((entry.count * easeOut(u)) / 2) * 2
      entry.line.geometry.setDrawRange(0, shown)
      entry.line.visible = shown > 0
      // The glow only follows the pen: it lights a line while it is being drawn.
      entry.halo.visible = shown > 0 && u < 1
    }
  }

  dispose() {
    this.group.removeFromParent()
    for (const entry of this.lines) entry.line.geometry.dispose()
    this.material.dispose()
    this.glow.dispose()
  }
}

const easeOut = (t: number) => 1 - (1 - t) ** 3

// ---------------------------------------------------------------------------------------------
// Ground waves

export class GroundWaves {
  readonly group = new THREE.Group()
  private readonly rings: Array<{ mesh: THREE.Mesh; material: MeshBasicNodeMaterial; start: number; speed: number; reach: number; width: number }> = []
  private readonly geometries: THREE.BufferGeometry[] = []

  constructor(plan: WavePlan) {
    this.group.name = 'animation-waves'
    this.group.position.copy(plan.origin)
    this.group.position.y += 0.03
    for (const wave of plan.waves) {
      // A bright crest and a soft wake behind it.
      for (const [inner, opacity, width] of [[0.94, 0.9, 1], [0.7, 0.28, 1.6]] as const) {
        const geometry = new THREE.RingGeometry(inner, 1, 160, 1)
        // RingGeometry faces +z; lay it on the ground facing up.
        geometry.rotateX(-Math.PI / 2)
        this.geometries.push(geometry)
        const material = new MeshBasicNodeMaterial({ color: wave.color, transparent: true, opacity, depthWrite: false })
        material.userData.baseOpacity = opacity
        const mesh = new THREE.Mesh(geometry, material)
        mesh.raycast = NO_RAYCAST
        mesh.renderOrder = 3
        mesh.frustumCulled = false
        this.group.add(mesh)
        this.rings.push({ mesh, material, start: wave.start, speed: wave.speed, reach: wave.reach, width })
      }
    }
  }

  update(time: number) {
    let any = false
    for (const ring of this.rings) {
      const radius = (time - ring.start) * ring.speed
      const on = radius > 0.05 && radius < ring.reach
      ring.mesh.visible = on
      if (!on) continue
      any = true
      const life = radius / ring.reach
      ring.mesh.scale.setScalar(radius)
      ring.material.opacity = (ring.material.userData.baseOpacity as number) * (1 - life) ** 1.4
    }
    this.group.visible = any
  }

  dispose() {
    this.group.removeFromParent()
    for (const geometry of this.geometries) geometry.dispose()
    for (const ring of this.rings) ring.material.dispose()
  }
}

// ---------------------------------------------------------------------------------------------
// Room floors

type FloorTile = { mesh: THREE.Mesh; geometry: THREE.BufferGeometry; start: number; duration: number }

/**
 * A slab that spreads in builds room by room: one tile per room on it (the room's outline, as
 * thick as the slab, in the slab's own material), each growing out from its own room's centre in
 * turn. The real slab takes over once the last tile is down, so the margins outside the rooms
 * (under the outer walls) arrive with it.
 */
export class RoomFloors {
  readonly group = new THREE.Group()
  private readonly tiles: FloorTile[] = []
  readonly end: number

  constructor(slab: BuildElement, rooms: readonly BuildRoom[], start: number, duration: number) {
    this.group.name = 'animation-room-floors'
    let material: THREE.Material | null = null
    slab.object.traverse((child) => {
      const mesh = child as THREE.Mesh
      if (!material && mesh.isMesh) material = Array.isArray(mesh.material) ? mesh.material[0] ?? null : mesh.material
    })
    const thickness = Math.max(0.02, Math.min(slab.size.y, 0.4))
    const center = slab.center
    const ordered = [...rooms].sort((a, b) =>
      roomCenter(a).distanceTo(new THREE.Vector2(center.x, center.z)) - roomCenter(b).distanceTo(new THREE.Vector2(center.x, center.z)))
    const each = Math.min(duration, Math.max(0.45, duration * 0.55))
    const step = ordered.length > 1 ? (duration - each) / (ordered.length - 1) : 0
    ordered.forEach((room, index) => {
      const c = roomCenter(room)
      // Shape in (x, -z) so that, laid flat, it lands on the room's own (x, z).
      const shape = new THREE.Shape(room.outline.map((p) => new THREE.Vector2(p.x - c.x, -(p.y - c.y))))
      const geometry = new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false })
      geometry.rotateX(-Math.PI / 2)
      const mesh = new THREE.Mesh(geometry, material ?? undefined)
      mesh.position.set(c.x, slab.box.max.y - thickness, c.y)
      mesh.castShadow = true
      mesh.receiveShadow = true
      mesh.raycast = NO_RAYCAST
      mesh.visible = false
      this.group.add(mesh)
      this.tiles.push({ mesh, geometry, start: start + step * index, duration: each })
    })
    this.end = start + duration
  }

  get count() {
    return this.tiles.length
  }

  update(time: number) {
    const done = time >= this.end
    for (const tile of this.tiles) {
      const u = (time - tile.start) / tile.duration
      tile.mesh.visible = !done && u > 0
      if (!tile.mesh.visible) continue
      const k = Math.min(1, u)
      // Out from the room's centre with a little overshoot, then settled.
      const s = Math.max(1e-3, 1 + 2.2 * (k - 1) ** 3 + 1.2 * (k - 1) ** 2)
      tile.mesh.scale.set(s, 1, s)
    }
    this.group.visible = !done
  }

  dispose() {
    this.group.removeFromParent()
    for (const tile of this.tiles) tile.geometry.dispose()
  }
}

function roomCenter(room: BuildRoom): THREE.Vector2 {
  // The outline's centroid (by area), which sits inside L-shaped rooms better than the box centre.
  let a = 0
  let cx = 0
  let cz = 0
  for (let i = 0; i < room.outline.length; i++) {
    const p = room.outline[i]!
    const q = room.outline[(i + 1) % room.outline.length]!
    const cross = p.x * q.y - q.x * p.y
    a += cross
    cx += (p.x + q.x) * cross
    cz += (p.y + q.y) * cross
  }
  if (Math.abs(a) < 1e-6) {
    const box = room.box.getCenter(new THREE.Vector3())
    return new THREE.Vector2(box.x, box.z)
  }
  return new THREE.Vector2(cx / (3 * a), cz / (3 * a))
}
