import { getNode, type SceneGraph } from '../pascal'

/**
 * Pascal's own viewer rules for what the pointer lands on and what it is called, as the hosted
 * viewer applies them. They are copies of `resolveViewerHover` and `nodeDisplayLabel` from
 * `@pascal-app/viewer/ui` (1.1.6), not imports: that entry point brings Pascal's whole runtime
 * (about 2 MB of script), which a baked drawing never loads otherwise. Keep them in step when the
 * SDK changes its rules.
 */

/** `VIEWER_PASS_THROUGH_KINDS`: kinds a viewer click never lands on; the pointer goes through them. */
const PASS_THROUGH_KINDS = new Set(['site', 'building', 'level', 'zone', 'ceiling', 'scan', 'guide', 'spawn'])

/**
 * The node Pascal's viewer hovers for a hit on `nodeId` (`resolveViewerHover` with nothing selected
 * and no point, so a wall or a floor answers as itself rather than as its room): null for a kind
 * the pointer passes through, the whole roof for one of its parts, else the node or the node it
 * hands its selection to (`metadata.nodeSelectionProxyId`, core's `resolveSelectionProxyId`).
 */
export function pascalHover(graph: SceneGraph, nodeId: string): string | null {
  const node = getNode(graph, nodeId)
  if (!node || PASS_THROUGH_KINDS.has(node.type)) return null
  const parent = node.parentId ? getNode(graph, node.parentId) : undefined
  const owner = parent?.type === 'roof' ? parent : node
  const metadata = (owner as { metadata?: unknown }).metadata
  const proxy =
    metadata && typeof metadata === 'object' && !Array.isArray(metadata)
      ? (metadata as { nodeSelectionProxyId?: unknown }).nodeSelectionProxyId
      : undefined
  return typeof proxy === 'string' && getNode(graph, proxy) ? proxy : owner.id
}

const KIND_WORDS: Record<string, string> = {
  wall: 'Wall',
  door: 'Door',
  window: 'Window',
  cabinet: 'Cabinet',
  'cabinet-module': 'Cabinet',
  slab: 'Slab',
  ceiling: 'Ceiling',
  roof: 'Roof',
  fence: 'Fence',
  column: 'Column',
  stair: 'Stairs',
}

/**
 * What Pascal's viewer calls a node (`nodeDisplayLabel`): its name, an item's catalogue name, or a
 * word for its kind.
 */
export function pascalLabel(graph: SceneGraph, nodeId: string): string | null {
  const node = getNode(graph, nodeId)
  if (!node) return null
  if (typeof node.name === 'string' && node.name) return node.name
  if (node.type === 'item') {
    const asset = (node as { asset?: { name?: unknown } }).asset
    return typeof asset?.name === 'string' && asset.name ? asset.name : 'Item'
  }
  return KIND_WORDS[node.type] ?? node.type
}
