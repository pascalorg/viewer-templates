import type { SelectionCalloutProps } from '@pascal-app/viewer'
import type { Object3D } from 'three'
import { create } from 'zustand'

/** What the visitor is discovering: a room or outdoor area, revealed by hover or a tap. */
export type Revealed = {
  roomId: string
  /** The world point of the hit that revealed it (an area with many parts anchors there). */
  hit: [number, number, number] | null
}

/** An item's callout, pinned where it was clicked, with the package-built actions. */
export type PinnedCallout = SelectionCalloutProps & {
  /** The clicked world point, when the click that pinned it is known. */
  point: [number, number, number] | null
}

type DiscoveryState = {
  /** The intro or anything else that owns the screen: no discovery at all. */
  blocked: boolean
  setBlocked: (blocked: boolean) => void
  callout: PinnedCallout | null
  setCallout: (callout: PinnedCallout | null) => void
}

export const useDiscovery = create<DiscoveryState>((set) => ({
  blocked: true,
  setBlocked: (blocked) => set({ blocked }),
  callout: null,
  setCallout: (callout) => set({ callout }),
}))

/**
 * The DOM the scene's frame loop writes into each frame (positions, visibility): the label and the
 * pinned callout are template DOM over the canvas, positioned without a React render per frame.
 */
export const labelDom: { root: HTMLElement | null; title: HTMLElement | null; subtitle: HTMLElement | null } = {
  root: null, title: null, subtitle: null,
}
export const calloutDom: { root: HTMLElement | null; copy: HTMLElement | null } = { root: null, copy: null }

/** The last item click's world point, so the callout pins where the item was clicked. */
export const lastItemClick: { id: string | null; point: [number, number, number] | null; object: Object3D | null } = {
  id: null, point: null, object: null,
}
