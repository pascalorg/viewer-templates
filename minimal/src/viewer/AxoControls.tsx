import { OrbitControls } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import { type ComponentRef, useEffect, useRef } from 'react'
import {
  type Box3,
  type Camera,
  type Intersection,
  Mesh,
  type Object3D,
  type OrthographicCamera,
  Vector2,
  Vector3,
} from 'three'
import { type DrawingView, navigation, type Projection } from './navigation'

/** Camera elevation of the axonometric view: 35° above the horizon, close to isometric. */
const AXONOMETRIC_POLAR = (55 * Math.PI) / 180
/** Straight down, nudged off the pole so the controls keep a defined azimuth. */
const PLAN_POLAR = 1e-4
const QUARTER = Math.PI / 2
/** Share of the screen the model fills when framed; the rest is room for the overlay. */
export const FIT_MARGIN = 0.72
/** How fast the camera eases to its goal (per second). */
const EASE = 9

const polarOf = (projection: Projection) =>
  projection === 'plan' ? PLAN_POLAR : AXONOMETRIC_POLAR

/**
 * The azimuth the view settles on: a corner (45°) in axonometric, a side (0°) in plan, so
 * walls run square to the screen there.
 */
function snapAzimuth(azimuth: number, projection: Projection) {
  const offset = projection === 'plan' ? 0 : Math.PI / 4
  return offset + Math.round((azimuth - offset) / QUARTER) * QUARTER
}

/** Quarter turns from the first corner (or side, in plan) to the one an azimuth settles on. */
function turnsOf(azimuth: number, projection: Projection): DrawingView['turns'] {
  const offset = projection === 'plan' ? 0 : Math.PI / 4
  return ((((Math.round((azimuth - offset) / QUARTER)) % 4) + 4) % 4) as DrawingView['turns']
}

const azimuthOf = (turns: number, projection: Projection) => (projection === 'plan' ? 0 : Math.PI / 4) + turns * QUARTER

/** Where the camera sits relative to its target, as OrbitControls measures it. */
function direction(azimuth: number, polar: number, out = new Vector3()) {
  return out.set(
    Math.sin(polar) * Math.sin(azimuth),
    Math.cos(polar),
    Math.sin(polar) * Math.cos(azimuth),
  )
}

/** The signed difference between two angles, in (-π, π]. */
function angleDelta(from: number, to: number) {
  const delta = (to - from) % (Math.PI * 2)
  return delta > Math.PI ? delta - Math.PI * 2 : delta <= -Math.PI ? delta + Math.PI * 2 : delta
}

/** The screen's right and up directions in the world, for a view. */
function screenAxes(azimuth: number, polar: number) {
  const view = direction(azimuth, polar)
  const right = new Vector3(Math.cos(azimuth), 0, -Math.sin(azimuth))
  const up = new Vector3().crossVectors(view, right).normalize()
  return { right, up }
}

/**
 * The target and orthographic zoom that frame a box from a given view, in the part of the
 * screen the overlay's panels leave clear (`navigation.insets`), filling `margin` of it.
 */
function frame(camera: OrthographicCamera, box: Box3, azimuth: number, polar: number, margin = FIT_MARGIN) {
  const { right, up } = screenAxes(azimuth, polar)
  const center = box.getCenter(new Vector3())
  let halfWidth = 0
  let halfHeight = 0
  const corner = new Vector3()
  for (let i = 0; i < 8; i++) {
    corner
      .set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z)
      .sub(center)
    halfWidth = Math.max(halfWidth, Math.abs(corner.dot(right)))
    halfHeight = Math.max(halfHeight, Math.abs(corner.dot(up)))
  }
  // R3F's orthographic camera spans the canvas in CSS pixels at zoom 1.
  const width = camera.right - camera.left
  const height = camera.top - camera.bottom
  const { top, right: covered, bottom, left } = navigation.insets
  const clearWidth = Math.max(width - left - covered, width * 0.35)
  const clearHeight = Math.max(height - top - bottom, height * 0.35)
  const zoom =
    Math.min(clearWidth / (2 * Math.max(halfWidth, 0.25)), clearHeight / (2 * Math.max(halfHeight, 0.25))) * margin
  // Move the target so the box's centre lands in the middle of the clear part.
  const shiftRight = (Math.min(left, width - clearWidth) - Math.min(covered, width - clearWidth)) / 2
  const shiftUp = (Math.min(bottom, height - clearHeight) - Math.min(top, height - clearHeight)) / 2
  const target = center.addScaledVector(right, -shiftRight / zoom).addScaledVector(up, -shiftUp / zoom)
  return { target, zoom }
}

type Goal = { azimuth: number; polar: number; target: Vector3; zoom: number }

export type AxoControlsProps = {
  /** What "fit" frames: the buildings. Null until the scene is ready. */
  bounds: Box3 | null
}

/**
 * Navigation for a drawing: an orthographic camera that orbits only around the vertical axis
 * and settles on one of four corners, a plan view straight down, zoom to the pointer, pan
 * along the ground and double-click to zoom in. Overlay buttons and room selection talk to it
 * through `navigation`.
 */
export function AxoControls({ bounds }: AxoControlsProps) {
  const controls = useRef<ComponentRef<typeof OrbitControls>>(null)
  const camera = useThree((state) => state.camera) as OrthographicCamera
  const gl = useThree((state) => state.gl)
  const scene = useThree((state) => state.scene)
  const raycaster = useThree((state) => state.raycaster)
  const invalidate = useThree((state) => state.invalidate)
  const goal = useRef<Goal | null>(null)
  const framed = useRef(false)
  /** The first fit's zoom: an opening view's zoom is measured against it. */
  const fitZoom = useRef(1)

  const distance = bounds ? Math.max(bounds.getSize(new Vector3()).length(), 4) * 3 : 60

  /** Reads where the camera is now. */
  const current = (): Goal | null => {
    const orbit = controls.current
    if (!orbit) return null
    return {
      azimuth: orbit.getAzimuthalAngle(),
      polar: orbit.getPolarAngle(),
      target: orbit.target.clone(),
      zoom: camera.zoom,
    }
  }

  const place = ({ azimuth, polar, target, zoom }: Goal) => {
    const orbit = controls.current
    if (!orbit) return
    camera.position.copy(target).addScaledVector(direction(azimuth, polar), distance)
    camera.near = 0.01
    camera.far = distance * 3
    camera.zoom = zoom
    camera.updateProjectionMatrix()
    orbit.target.copy(target)
    orbit.update()
  }

  const lockPolar = (polar: number | null) => {
    const orbit = controls.current
    if (!orbit) return
    orbit.minPolarAngle = polar ?? 0
    orbit.maxPolarAngle = polar ?? Math.PI / 2
  }

  const animateTo = (next: Partial<Goal>) => {
    const from = goal.current ?? current()
    if (!from) return
    goal.current = { ...from, ...next, target: (next.target ?? from.target).clone() }
    lockPolar(null)
    invalidate()
  }

  const fitGoal = (azimuth: number, polar: number): Partial<Goal> | null => {
    if (!bounds) return null
    return { azimuth, polar, ...frame(camera, bounds, azimuth, polar) }
  }

  // Frame the model the first time its bounds arrive, from the default corner.
  useEffect(() => {
    if (!bounds || framed.current || !controls.current) return
    framed.current = true
    const polar = polarOf(navigation.projection)
    const opening = navigation.opening
    const azimuth = opening ? azimuthOf(opening.turns, navigation.projection) : snapAzimuth(Math.PI / 4, navigation.projection)
    const fit = fitGoal(azimuth, polar) as Goal
    fitZoom.current = fit.zoom
    // A saved opening view (viewer settings): its corner, its zoom against this screen's fit, its centre.
    const start = opening
      ? { ...fit, zoom: Math.min(16, Math.max(0.3, opening.zoom)) * fit.zoom, target: opening.target ? new Vector3(...opening.target) : fit.target }
      : fit
    place(start)
    lockPolar(polar)
    const orbit = controls.current
    orbit.minZoom = fit.zoom * 0.3
    orbit.maxZoom = fit.zoom * 16
    // Panels opening and closing leave a saved view where it is.
    if (opening) navigation.release()
    invalidate()
    // place, lockPolar and fitGoal only read refs and the camera.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bounds, camera, invalidate])

  // The settings bar reads the view the drawing is settling on.
  useEffect(() => {
    navigation.registerViewReader(() => {
      const view = goal.current ?? current()
      if (!view || !framed.current) return null
      const projection = navigation.projection
      const round = (n: number) => Math.round(n * 1000) / 1000
      return {
        projection,
        turns: turnsOf(view.azimuth, projection),
        zoom: round(view.zoom / fitZoom.current),
        target: [round(view.target.x), round(view.target.y), round(view.target.z)],
      }
    })
    return () => navigation.registerViewReader(null)
    // current reads refs and the camera.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [camera])

  // Overlay buttons and keys.
  useEffect(
    () =>
      navigation.onCommand((command) => {
        const from = goal.current ?? current()
        if (!from) return
        const projection = navigation.projection
        if (command.type === 'rotate') {
          animateTo({ azimuth: snapAzimuth(from.azimuth, projection) + command.turns * QUARTER })
        } else if (command.type === 'projection') {
          animateTo({ azimuth: snapAzimuth(from.azimuth, projection), polar: polarOf(projection) })
        } else if (command.type === 'focus') {
          // From the corner the view is settling on, so a focus during a turn frames it right.
          const azimuth = snapAzimuth(from.azimuth, projection)
          animateTo({ azimuth, ...frame(camera, command.box, azimuth, from.polar, command.margin ?? 0.55) })
        } else {
          const azimuth = snapAzimuth(from.azimuth, projection)
          const fit = fitGoal(azimuth, polarOf(projection))
          if (fit) animateTo(fit)
        }
      }),
    // animateTo and fitGoal read refs, the camera and bounds.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [bounds, camera],
  )

  // Double-click zooms in on the point.
  useEffect(() => {
    const element = gl.domElement
    const pointer = new Vector2()
    const handle = (event: MouseEvent) => {
      const rect = element.getBoundingClientRect()
      pointer.set(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1,
      )
      raycaster.setFromCamera(pointer, camera as Camera)
      const hit = raycaster
        .intersectObject(scene, true)
        .find(
          (candidate) =>
            candidate.object instanceof Mesh && isShown(candidate.object) && !isCutAway(candidate),
        )
      if (!hit) return
      const from = goal.current ?? current()
      if (!from) return
      navigation.release()
      animateTo({ target: hit.point.clone(), zoom: from.zoom * 2 })
    }
    element.addEventListener('dblclick', handle)
    return () => element.removeEventListener('dblclick', handle)
    // animateTo reads refs and the camera.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [camera, gl, raycaster, scene])

  useFrame((_, delta) => {
    const next = goal.current
    if (!next) return
    const now = current()
    if (!now) return
    // The canvas renders on demand, so the first frame after a pause (letting go after holding
    // still) sees a long delta; one frame's step at most, or the ease starts with a jump.
    const k = 1 - Math.exp(-Math.min(delta, 1 / 30) * EASE)
    const azimuth = now.azimuth + angleDelta(now.azimuth, next.azimuth) * k
    const polar = now.polar + (next.polar - now.polar) * k
    const target = now.target.lerp(next.target, k)
    const zoom = Math.exp(Math.log(now.zoom) + (Math.log(next.zoom) - Math.log(now.zoom)) * k)
    const settled =
      Math.abs(angleDelta(azimuth, next.azimuth)) < 1e-3 &&
      Math.abs(polar - next.polar) < 1e-3 &&
      target.distanceTo(next.target) < 1e-3 * distance &&
      Math.abs(zoom / next.zoom - 1) < 1e-3
    if (settled) {
      place(next)
      goal.current = null
      lockPolar(next.polar)
    } else {
      place({ azimuth, polar, target, zoom })
    }
    invalidate()
  })

  return (
    <OrbitControls
      enableDamping={false}
      makeDefault
      mouseButtons={{ LEFT: 0, MIDDLE: 1, RIGHT: 2 }}
      onEnd={() => {
        // Settle on the nearest corner once the pointer lets go.
        const now = current()
        if (!now) return
        animateTo({ azimuth: snapAzimuth(now.azimuth, navigation.projection) })
      }}
      onStart={() => {
        goal.current = null
        navigation.release()
        lockPolar(polarOf(navigation.projection))
      }}
      ref={controls}
      screenSpacePanning={false}
      zoomToCursor
    />
  )
}

/** A hit on the part of a wall the room cutaway took away (raycasts ignore clipping). */
function isCutAway(hit: Intersection): boolean {
  const above = (hit.object.userData as { cutAbove?: number }).cutAbove
  return above !== undefined && hit.point.y > above
}

function isShown(object: Object3D): boolean {
  for (let current: Object3D | null = object; current; current = current.parent) {
    if (!current.visible) return false
  }
  return true
}
