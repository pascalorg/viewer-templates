import { buildGlbInteractiveItems } from '@pascal-app/viewer'

type Graph = Parameters<typeof buildGlbInteractiveItems>[0]

/**
 * What a click pins a callout on: doors and windows (they open), and the items the viewer
 * re-lights or re-animates (lamps, fans, scripted and procedural items with moving parts).
 * Anything else a click lands on is part of a room, and a room click pins nothing.
 */
export function interactiveIds(graph: Graph): ReadonlySet<string> {
  const ids = new Set<string>(buildGlbInteractiveItems(graph).map((item) => item.pascalId))
  for (const node of Object.values(graph?.nodes ?? {}) as { id: string; type: string }[]) {
    if (node.type === 'door' || node.type === 'window') ids.add(node.id)
  }
  return ids
}
