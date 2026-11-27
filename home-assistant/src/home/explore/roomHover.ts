import { create } from 'zustand'

/**
 * The room the pointer is on, wherever it is: a row of the explore panel's room list, a room of
 * its mini plan, or a room's label in 3D. Each of them lights up the same room. Kept apart from
 * the viewer's own `hoveredId`, which would also paint the room's floor in Pascal's blue.
 */
export const useRoomHover = create<{ id: string | null; set: (id: string | null) => void }>((set) => ({
  id: null,
  set: (id) => set({ id }),
}))
