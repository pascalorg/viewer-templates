import type { AnyNode } from '@pascal-app/core'
import { expect, test } from '@playwright/test'
import { buildMembership, resolveRoom } from '../../src/showcase/discovery/membership'

type Node = Record<string, unknown> & { id: string; type: string }
const rect = (x0: number, z0: number, x1: number, z1: number) => [[x0, z0], [x1, z0], [x1, z1], [x0, z1]]

/** Two rooms side by side sharing a wall, a porch in front with its posts and beam. */
function scene(extra: Node[] = []) {
  const list: Node[] = [
    { id: 'site', type: 'site', parentId: null },
    { id: 'building', type: 'building', parentId: 'site' },
    { id: 'level', type: 'level', parentId: 'building' },
    { id: 'kitchen', type: 'zone', parentId: 'level', name: 'Kitchen', polygon: rect(0, 0, 4, 4), boundaryWallIds: ['w-shared', 'w-north'] },
    { id: 'living', type: 'zone', parentId: 'level', name: 'Living', polygon: rect(4, 0, 9, 4), boundaryWallIds: ['w-shared'] },
    { id: 'porch', type: 'zone', parentId: 'level', name: 'Front entrance', roomType: 'porch', polygon: rect(0, 4, 9, 6) },
    { id: 'w-shared', type: 'wall', parentId: 'level' },
    { id: 'w-north', type: 'wall', parentId: 'level' },
    { id: 'w-loose', type: 'wall', parentId: 'level' },
    { id: 'door', type: 'door', parentId: 'w-shared' },
    { id: 'base', type: 'slab', parentId: 'level', zoneIds: ['kitchen', 'living', 'porch'], elevation: 0.05, plateRole: 'base', polygon: rect(0, 0, 9, 6) },
    { id: 'porch-slab', type: 'slab', parentId: 'level', zoneIds: ['porch'], elevation: 0.01, plateRole: 'sunken', polygon: rect(0, 4, 9, 6) },
    { id: 'ceiling', type: 'ceiling', parentId: 'level', zoneId: 'kitchen' },
    { id: 'lamp', type: 'item', parentId: 'ceiling' },
    { id: 'sofa', type: 'item', parentId: 'level' },
    { id: 'post', type: 'column', parentId: 'level', metadata: { porchOf: 'porch', porchPart: 'post' } },
    { id: 'beam', type: 'beam', parentId: 'level', metadata: { porchOf: 'porch', porchPart: 'beam' } },
    { id: 'column', type: 'column', parentId: 'level' },
    { id: 'roof', type: 'roof', parentId: 'level' },
    ...extra,
  ]
  return Object.fromEntries(list.map((node) => [node.id, node])) as unknown as Record<string, AnyNode>
}

test('rooms and areas come from the graph', () => {
  const membership = buildMembership(scene())
  expect([...membership.rooms.keys()].sort()).toEqual(['kitchen', 'living', 'porch'])
  const porch = membership.rooms.get('porch')!
  expect(porch.kind).toBe('area')
  expect(porch.outdoorType).toBe('porch')
  expect(porch.members.sort()).toEqual(['beam', 'porch-slab', 'post'])
  expect(porch.washFloor).toBe(false)
  expect(porch.floorY).toBe(0.01)
  expect(membership.rooms.get('kitchen')!.area).toBe(16)
  expect(membership.rooms.get('kitchen')!.floorY).toBe(0.05)
})

test('semantic links decide first', () => {
  const nodes = scene()
  const membership = buildMembership(nodes)
  expect(resolveRoom(membership, nodes, 'w-north', null)).toBe('kitchen')
  expect(resolveRoom(membership, nodes, 'ceiling', null)).toBe('kitchen')
  // A lamp hangs from the kitchen's ceiling, wherever it is drawn.
  expect(resolveRoom(membership, nodes, 'lamp', { point: [6, 2] })).toBe('kitchen')
  expect(resolveRoom(membership, nodes, 'post', { point: [20, 20] })).toBe('porch')
  expect(resolveRoom(membership, nodes, 'beam', null)).toBe('porch')
  expect(resolveRoom(membership, nodes, 'porch-slab', null)).toBe('porch')
  expect(resolveRoom(membership, nodes, 'kitchen', null)).toBe('kitchen')
})

test('a shared wall or plate is decided by the side of the hit', () => {
  const nodes = scene()
  const membership = buildMembership(nodes)
  // Seen from the living room: the face's normal points into it.
  expect(resolveRoom(membership, nodes, 'w-shared', { point: [4, 2], aside: [[4.35, 2], [3.65, 2]] })).toBe('living')
  expect(resolveRoom(membership, nodes, 'w-shared', { point: [4, 2], aside: [[3.65, 2], [4.35, 2]] })).toBe('kitchen')
  // A door takes its wall's rooms.
  expect(resolveRoom(membership, nodes, 'door', { point: [4, 2], aside: [[4.35, 2], [3.65, 2]] })).toBe('living')
  expect(resolveRoom(membership, nodes, 'base', { point: [1, 1] })).toBe('kitchen')
  expect(resolveRoom(membership, nodes, 'base', { point: [5, 5] })).toBe('porch')
})

test('geometry places only what nothing links, and roofs reveal nothing', () => {
  const nodes = scene()
  const membership = buildMembership(nodes)
  expect(resolveRoom(membership, nodes, 'sofa', { point: [6, 1] })).toBe('living')
  expect(resolveRoom(membership, nodes, 'sofa', { point: [30, 1] })).toBeNull()
  expect(resolveRoom(membership, nodes, 'sofa', null)).toBeNull()
  // A column that is no porch's part stands in the room it is in.
  expect(resolveRoom(membership, nodes, 'column', { point: [1, 1] })).toBe('kitchen')
  expect(resolveRoom(membership, nodes, 'w-loose', { point: [1, 3.9], aside: [[1, 3.55]] })).toBe('kitchen')
  expect(resolveRoom(membership, nodes, 'roof', { point: [1, 1] })).toBeNull()
  expect(resolveRoom(membership, nodes, 'missing', { point: [1, 1] })).toBeNull()
})

test('an area without its own plate washes its outline', () => {
  const nodes = scene()
  delete (nodes as Record<string, unknown>)['porch-slab']
  const porch = buildMembership(nodes).rooms.get('porch')!
  expect(porch.washFloor).toBe(true)
  expect(porch.members.sort()).toEqual(['beam', 'post'])
})
