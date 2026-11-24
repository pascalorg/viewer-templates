import { useSyncExternalStore } from 'react'
import type { Box3 } from 'three'

/**
 * The drawing's two projections: an axonometric view from one of the four corners, and a
 * plan straight down. Both are orthographic, so parallel lines stay parallel.
 */
export type Projection = 'axonometric' | 'plan'

export type NavigationCommand =
  | { type: 'rotate'; turns: 1 | -1 }
  | { type: 'projection'; projection: Projection }
  | { type: 'fit' }
  | { type: 'focus'; box: Box3; margin?: number }

type Listener = () => void

/** How much of each side of the screen the overlay's panels cover, in CSS pixels. */
export type Insets = { top: number; right: number; bottom: number; left: number }

/**
 * A view of the drawing as navigation knows it, which is what an opening view saves: the
 * projection, the corner (quarter turns from the first one), the zoom against the fit (1 frames
 * the building) and the point at the centre of the screen.
 */
export type DrawingView = {
  projection: Projection
  turns: 0 | 1 | 2 | 3
  zoom: number
  target?: [number, number, number]
}

let projection: Projection = 'axonometric'
let insets: Insets = { top: 0, right: 0, bottom: 0, left: 0 }
/**
 * The last framing (the first view is a fit), kept until the user moves the camera: when a
 * panel opens or closes, it is framed again in the space the panels now leave.
 */
let lastFrame: Extract<NavigationCommand, { type: 'fit' | 'focus' }> | null = { type: 'fit' }
/** The view the drawing opens on (viewer settings); none frames the building from the first corner. */
let opening: DrawingView | null = null
let readView: (() => DrawingView | null) | null = null
const stateListeners = new Set<Listener>()
const commandListeners = new Set<(command: NavigationCommand) => void>()

/**
 * The bridge between the overlay buttons (plain React) and the camera controls inside the
 * canvas. One viewer per page, so a module-level store is enough.
 */
export const navigation = {
  rotate(turns: 1 | -1) {
    emit({ type: 'rotate', turns })
  },
  setProjection(next: Projection) {
    if (next !== projection) {
      projection = next
      for (const listener of stateListeners) listener()
    }
    emit({ type: 'projection', projection: next })
  },
  fit() {
    lastFrame = { type: 'fit' }
    emit(lastFrame)
  },
  /** Frames a box (a selected room, a floor) from the current view; `margin` is the share of the screen it fills. */
  focus(box: Box3, margin?: number) {
    lastFrame = { type: 'focus', box, margin }
    emit(lastFrame)
  },
  /** The user moved the camera: panels opening or closing leave the view where it is. */
  release() {
    lastFrame = null
  },
  get projection() {
    return projection
  },
  /**
   * Framing (fit, focus) centres what it frames in the screen these panels leave clear. A change
   * frames the last framing again, unless the user has moved the camera since.
   */
  setInsets(next: Insets) {
    const same = next.top === insets.top && next.right === insets.right && next.bottom === insets.bottom && next.left === insets.left
    insets = next
    if (!same && lastFrame) emit(lastFrame)
  },
  get insets() {
    return insets
  },
  /** Set before the drawing first frames: it opens on this view instead of the fit. */
  setOpening(view: DrawingView | null) {
    opening = view
    if (view && view.projection !== projection) {
      projection = view.projection
      for (const listener of stateListeners) listener()
    }
  },
  get opening() {
    return opening
  },
  /** The controls register how to read the view they show (or are easing to). */
  registerViewReader(reader: (() => DrawingView | null) | null) {
    readView = reader
  },
  /** The view on screen, as an opening view would save it; null before the drawing is framed. */
  currentView(): DrawingView | null {
    return readView?.() ?? null
  },
  onCommand(listener: (command: NavigationCommand) => void) {
    commandListeners.add(listener)
    return () => {
      commandListeners.delete(listener)
    }
  },
}

function emit(command: NavigationCommand) {
  for (const listener of commandListeners) listener(command)
}

function subscribe(listener: Listener) {
  stateListeners.add(listener)
  return () => {
    stateListeners.delete(listener)
  }
}

export function useProjection(): Projection {
  return useSyncExternalStore(subscribe, () => projection)
}
