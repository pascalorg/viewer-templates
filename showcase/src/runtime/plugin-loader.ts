import type { Plugin } from '@pascal-app/core'

export type PluginSource = { packageName: string; load: () => Promise<Plugin[]> }

export class PluginLoadError extends Error {
  readonly registeredPackages: readonly string[]

  constructor(cause: unknown, registeredPackages: readonly string[]) {
    super(cause instanceof Error ? cause.message : String(cause), { cause })
    this.registeredPackages = registeredPackages
  }
}

/**
 * Loads plugin packages one source at a time: each package registers as soon
 * as its own import resolves, a package loads once, and a failed one is not
 * cached (a later scene retries it). `loadPackages` waits only for the named
 * packages, so a stalled or broken unrelated chunk never blocks a scene.
 */
export function createPluginLoader(
  sources: readonly PluginSource[],
  register: (plugin: Plugin) => Promise<void>,
) {
  const loads = new Map<string, Promise<void>>()
  const registeredPackages = new Set<string>()
  const loadSource = (source: PluginSource): Promise<void> => {
    const existing = loads.get(source.packageName)
    if (existing) return existing
    const load = (async () => {
      for (const plugin of await source.load()) {
        await register(plugin)
        registeredPackages.add(source.packageName)
      }
    })()
    loads.set(source.packageName, load)
    load.catch(() => {
      if (loads.get(source.packageName) === load) loads.delete(source.packageName)
    })
    return load
  }
  return {
    /** Every package; a failure is logged and skipped, it never takes the others down. */
    async loadAll(): Promise<void> {
      await Promise.all(
        sources.map((source) =>
          loadSource(source).catch((error: unknown) => {
            console.error(
              `[bootstrap] plugin ${source.packageName} failed to load; skipping it`,
              error,
            )
          }),
        ),
      )
    },
    /**
     * Only the named packages; waits for all of them, then rejects when one failed. A name without a
     * source (a build flag is off) is skipped: callers check the registry.
     */
    async loadPackages(packageNames: readonly string[]): Promise<void> {
      // Wait for every package, then fail if one failed: a fast failure must not
      // hand the scene over while healthy packages are still registering.
      const results = await Promise.allSettled(
        sources.filter((source) => packageNames.includes(source.packageName)).map(loadSource),
      )
      const failed = results.find((result) => result.status === 'rejected')
      if (failed) {
        throw new PluginLoadError(
          failed.reason,
          packageNames.filter((name) => registeredPackages.has(name)),
        )
      }
    },
  }
}

/**
 * Waits for `load` at most `ms`: true when it finished in time. When it
 * finishes later, `onLate` runs then, so a page that went ahead without it can
 * mount it (a node renderer does not re-render when its kind registers late).
 */
export async function whenLoaded(
  load: Promise<unknown>,
  ms: number,
  onLate: () => void,
): Promise<boolean> {
  let timedOut = false
  const done = load.then(
    () => {
      if (timedOut) onLate()
      return true
    },
    () => true,
  )
  let timer: ReturnType<typeof setTimeout> | undefined
  const expired = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => {
      timedOut = true
      resolve(false)
    }, ms)
  })
  const onTime = await Promise.race([done, expired])
  clearTimeout(timer)
  return onTime
}

/**
 * Loads the plugin packages a scene needs with `load`, for at most `ms`: true
 * when they arrived in time, false at the deadline (`onLate` runs when they
 * arrive after it). A failed load is logged and the scene renders without it.
 */
export function loadScenePluginsBounded(
  packageNames: readonly string[],
  load: (packageNames: readonly string[]) => Promise<void>,
  ms: number,
  onLate: () => void,
): Promise<boolean> {
  const loading = load(packageNames).catch((err: unknown) => {
    console.error('[viewer] plugin load failed; rendering without it', err)
    // A failed package must not hide healthy plugins that registered after
    // the viewer's deadline; strict callers still receive PluginLoadError.
    if (err instanceof PluginLoadError && err.registeredPackages.length > 0) return
    throw err
  })
  return whenLoaded(loading, ms, onLate)
}
