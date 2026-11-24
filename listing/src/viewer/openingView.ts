import type { OpeningCamera } from '../settings'

/**
 * The bridge between the settings bar (plain React, outside the canvas) and the camera inside it:
 * the mounted viewer registers how to read its pose. One viewer per page.
 */
let read: (() => OpeningCamera | null) | null = null

export function registerViewReader(reader: (() => OpeningCamera | null) | null) {
  read = reader
}

/** The camera's pose now, or null while no viewer is mounted. */
export function currentView(): OpeningCamera | null {
  return read?.() ?? null
}
