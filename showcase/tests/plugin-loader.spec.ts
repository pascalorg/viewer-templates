import { expect, test } from '@playwright/test'
import type { Plugin } from '@pascal-app/core'
import { createPluginLoader, loadScenePluginsBounded, PluginLoadError } from '../src/runtime/plugin-loader'

const plugin: Plugin = { id: 'test:plugin', apiVersion: 1 }

test('concurrent package loads register once and failed imports can retry', async () => {
  let loads = 0
  let registrations = 0
  const loader = createPluginLoader([{ packageName: 'fixture', load: async () => {
    if (++loads === 1) throw new Error('offline')
    return [plugin]
  } }], async () => { registrations++ })
  await expect(loader.loadPackages(['fixture'])).rejects.toBeInstanceOf(PluginLoadError)
  await Promise.all([loader.loadPackages(['fixture']), loader.loadPackages(['fixture'])])
  await loader.loadPackages(['fixture'])
  expect({ loads, registrations }).toEqual({ loads: 2, registrations: 1 })
})

test('deadline returns before a stalled import and late registration requests a remount', async () => {
  let finish!: () => void
  const stalled = new Promise<void>((resolve) => { finish = resolve })
  let late = 0
  const onTime = await loadScenePluginsBounded(['fixture'], async () => stalled, 5, () => { late++ })
  expect(onTime).toBe(false)
  expect(late).toBe(0)
  finish()
  await expect.poll(() => late).toBe(1)
})

test('a failed source cannot hide a healthy source that registers after the deadline', async () => {
  let finish!: () => void
  const stalled = new Promise<void>((resolve) => { finish = resolve })
  const registrations: string[] = []
  let late = 0
  const loader = createPluginLoader([
    { packageName: 'broken', load: async () => { throw new Error('offline') } },
    { packageName: 'healthy', load: async () => { await stalled; return [plugin] } },
  ], async (plugin) => { registrations.push(plugin.id) })
  expect(await loadScenePluginsBounded(['broken', 'healthy'], loader.loadPackages, 5, () => { late++ })).toBe(false)
  finish()
  await expect.poll(() => late).toBe(1)
  expect(registrations).toEqual(['test:plugin'])
})
