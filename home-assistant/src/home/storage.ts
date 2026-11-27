/*
 * Everything the viewer keeps for the visitor, in one JSON document under one localStorage key,
 * shaped to be sent to a backend as it is later on: per project, per Home Assistant (its address),
 * which devices the visitor linked to which item or room, and which room each Home Assistant area is.
 *
 *   {
 *     "version": 1,
 *     "preferences": { "roomLabels": true },
 *     "projects": {
 *       "<project id>": {
 *         "homes": {
 *           "<Home Assistant address>": {
 *             "links": {
 *               "light.bedroom_ceiling": { "to": "item", "itemId": "item_…", "updatedAt": "…" },
 *               "sensor.bedroom_humidity": { "to": "room", "roomId": "zone_…", "updatedAt": "…" },
 *               "fan.old_fan": { "to": "none", "updatedAt": "…" }
 *             },
 *             "areas": { "Bedroom": { "roomId": "zone_…", "updatedAt": "…" } },
 *             "updatedAt": "…"
 *           }
 *         }
 *       }
 *     }
 *   }
 *
 * A link "to": "none" is one the visitor took off the plan, so the matching doesn't put it back. An
 * area with "roomId": null is in none of the plan's rooms. Entity ids and area names are Home
 * Assistant's; item and room ids are the Pascal scene's nodes.
 */

export const STORAGE_KEY = 'pascal-ha'

export type LinkRecord =
  | { to: 'item'; itemId: string; updatedAt: string }
  | { to: 'room'; roomId: string; updatedAt: string }
  | { to: 'none'; updatedAt: string }

export type AreaRecord = { roomId: string | null; updatedAt: string }

export type HomeRecord = {
  links: Record<string, LinkRecord>
  areas: Record<string, AreaRecord>
  updatedAt: string
}

export type ViewerStore = {
  version: 1
  preferences: { roomLabels: boolean }
  projects: Record<string, { homes: Record<string, HomeRecord> }>
}

const empty = (): ViewerStore => ({ version: 1, preferences: { roomLabels: true }, projects: {} })

/** The whole document, with what earlier versions kept under keys of their own moved into it. */
export function readStore(): ViewerStore {
  let store: ViewerStore
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as Partial<ViewerStore> | null
    store = parsed?.version === 1 ? { ...empty(), ...parsed, preferences: { ...empty().preferences, ...parsed.preferences } } as ViewerStore : empty()
  } catch {
    store = empty()
  }
  return migrate(store)
}

function writeStore(store: ViewerStore) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(store))
}

/** Changes the document in one read and one write, so two callers never undo each other. */
export function updateStore(change: (store: ViewerStore) => void) {
  const store = readStore()
  change(store)
  writeStore(store)
}

export function homeOf(store: ViewerStore, projectId: string, hassUrl: string): HomeRecord {
  const project = (store.projects[projectId] ??= { homes: {} })
  return (project.homes[hassUrl] ??= { links: {}, areas: {}, updatedAt: new Date().toISOString() })
}

/* ---- the viewer's own shapes: a link is an item id, `room:` and a room id, or null ---- */

/** How the viewer holds a link to a room itself, beside links to items: `room:` and the room's id. */
export const ROOM_PICK = 'room:'

export function pickOf(link: LinkRecord): string | null {
  if (link.to === 'item') return link.itemId
  if (link.to === 'room') return `${ROOM_PICK}${link.roomId}`
  return null
}

export function linkOf(pick: string | null, updatedAt = new Date().toISOString()): LinkRecord {
  if (pick === null) return { to: 'none', updatedAt }
  if (pick.startsWith(ROOM_PICK)) return { to: 'room', roomId: pick.slice(ROOM_PICK.length), updatedAt }
  return { to: 'item', itemId: pick, updatedAt }
}

/* ---- earlier versions: `pascal-ha-links:<project>:<address>`, `pascal-ha-areas:…`, `pascal-ha-room-labels` ---- */

const OLD = /^pascal-ha-(links|areas):([^:]+):(.+)$/

function migrate(store: ViewerStore): ViewerStore {
  const old = Object.keys(localStorage).filter((key) => OLD.test(key) || key === 'pascal-ha-room-labels')
  if (!old.length) return store
  const now = new Date().toISOString()
  for (const key of old) {
    const raw = localStorage.getItem(key)
    if (key === 'pascal-ha-room-labels') {
      store.preferences.roomLabels = raw !== 'off'
      continue
    }
    const [, kind, projectId, hassUrl] = key.match(OLD)!
    let values: Record<string, string | null> = {}
    try {
      values = JSON.parse(raw ?? '{}') as Record<string, string | null>
    } catch {
      // unreadable: nothing to keep
    }
    const home = homeOf(store, projectId!, hassUrl!)
    for (const [name, value] of Object.entries(values)) {
      // what the new document already has is newer
      if (kind === 'links') home.links[name] ??= linkOf(value, now)
      else home.areas[name] ??= { roomId: value, updatedAt: now }
    }
  }
  writeStore(store)
  for (const key of old) localStorage.removeItem(key)
  return store
}
