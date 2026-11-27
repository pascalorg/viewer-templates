/* Words, as the linking reads them: names from a Pascal catalog or a Home Assistant install, in
   English or French, lower-cased and without accents, split into words. */

/** "Lampe de chevet (2)" → "lampe de chevet 2"; "ceilingFan_01" → "ceiling fan 01". */
export function normalize(text: string | undefined | null): string {
  return (text ?? '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

export const words = (text: string | undefined | null) => normalize(text).split(' ').filter(Boolean)

/** Words that say nothing about which one of several it is. */
const FILLER = new Set(['the', 'a', 'an', 'of', 'de', 'du', 'des', 'la', 'le', 'les', 'and', 'et', 'with', 'my', 'smart', 'main'])

/** The words of a name that can tell two things apart, without filler. */
export const telling = (text: string | undefined | null) => words(text).filter((w) => !FILLER.has(w) && w.length > 1)

/* ---------------- rooms ---------------- */

/** Room names that mean the same room, each list under its canonical name. */
const ROOMS: Record<string, string[]> = {
  living: ['living room', 'living', 'lounge', 'salon', 'sejour', 'family room', 'sitting room', 'den'],
  bedroom: ['bedroom', 'chambre', 'master bedroom', 'guest room', 'chambre d amis', 'suite'],
  kids: ['kids room', 'children room', 'nursery', 'chambre enfant', 'chambre d enfant', 'playroom'],
  kitchen: ['kitchen', 'cuisine', 'kitchenette'],
  dining: ['dining room', 'dining', 'salle a manger'],
  bathroom: ['bathroom', 'bath', 'salle de bain', 'salle de bains', 'salle d eau', 'shower room', 'ensuite', 'en suite'],
  toilet: ['toilet', 'toilets', 'wc', 'toilettes', 'restroom', 'powder room'],
  office: ['office', 'study', 'bureau', 'home office', 'workroom', 'studio'],
  hall: ['hall', 'hallway', 'entry', 'entrance', 'entree', 'corridor', 'couloir', 'foyer', 'landing', 'palier'],
  laundry: ['laundry', 'laundry room', 'utility', 'utility room', 'buanderie', 'cellier'],
  garage: ['garage'],
  garden: ['garden', 'jardin', 'yard', 'backyard', 'back yard', 'front yard', 'lawn', 'outside', 'outdoor', 'exterieur'],
  terrace: ['terrace', 'terrasse', 'patio', 'deck', 'balcony', 'balcon', 'porch'],
  basement: ['basement', 'cellar', 'cave', 'sous sol'],
  attic: ['attic', 'loft', 'grenier', 'combles'],
  storage: ['storage', 'closet', 'placard', 'dressing', 'walk in closet', 'rangement', 'pantry'],
}
const ROOM_OF = new Map(Object.entries(ROOMS).flatMap(([canon, names]) => names.map((n) => [n, canon] as const)))

/** Words every kind of room can carry. */
const GENERIC_ROOM = new Set(['room', 'rooms', 'piece', 'area', 'zone', 'space', 'espace'])

/** "Chambre 2" → { canon: "bedroom", number: "2" }; a name it does not know keeps its own words. */
export function roomKey(name: string) {
  const all = words(name)
  const number = all.filter((w) => /^\d+$/.test(w)).join(' ')
  const rest = all.filter((w) => !/^\d+$/.test(w)).join(' ')
  return { canon: ROOM_OF.get(rest) ?? rest, number }
}

/** How sure two room names are the same room: 1 written alike, 0.9 the same room in other words,
    down to 0 for unrelated. A number on one and another on the other ("Bedroom 1", "Bedroom 2")
    makes them different rooms. */
export function roomLikeness(a: string, b: string): number {
  if (normalize(a) === normalize(b)) return 1
  const ka = roomKey(a)
  const kb = roomKey(b)
  if (ka.number && kb.number && ka.number !== kb.number) return 0
  if (ka.canon && ka.canon === kb.canon) return ka.number === kb.number ? 0.9 : 0.6
  // "room" says nothing about which room: "Room" is not the "Living Room"
  const wa = new Set(telling(a).filter((w) => !GENERIC_ROOM.has(w)))
  const wb = new Set(telling(b).filter((w) => !GENERIC_ROOM.has(w)))
  const shared = [...wa].filter((w) => wb.has(w)).length
  // one name inside the other: "Kitchen" is the room drawn as "Kitchen / Office"
  if (shared && shared === Math.min(wa.size, wb.size)) return 0.75
  return shared ? (0.7 * shared) / Math.max(wa.size, wb.size) : 0
}
