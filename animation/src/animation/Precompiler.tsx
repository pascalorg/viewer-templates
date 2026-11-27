import { useLocale, usePascalI18n } from '@pascal-app/core'
import { localizedLevelName, type ViewerSource } from '@pascal-app/viewer/ui'
import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import type * as THREE from 'three'
import { type BuildElement, collectBuild } from './elements'
import { prepareEdges } from './NoirLook'
import { preparePaper } from './paper'
import { useAnimationStore } from './store'
import { templateById } from './templates'

/**
 * Gets the heavy animations ready while the project sits on screen, so pressing play doesn't
 * freeze: Blueprint's floor plans (drawn from SVG into textures) and the wireframe's edge lines
 * (worked out per geometry). The work is cut into small slices, a few milliseconds a frame,
 * starting a moment after the project appears. Blueprint's own shaders depend on its lights, so `NoirLook` warms
 * those itself while the first paper drops in.
 */

/** Milliseconds of preparation a frame may take. */
const BUDGET_MS = 4
/** How long after the project appears before starting (its own first frames come first). */
const DELAY_MS = 1200

/** The meshes a piece draws itself, not those of pieces hosted under it. */
function ownMeshes(element: BuildElement, others: ReadonlySet<THREE.Object3D>): THREE.Mesh[] {
  const out: THREE.Mesh[] = []
  const visit = (object: THREE.Object3D) => {
    if (object !== element.object && others.has(object)) return
    if ((object as THREE.Mesh).isMesh) out.push(object as THREE.Mesh)
    for (const child of object.children) visit(child)
  }
  visit(element.object)
  return out
}

export function Precompiler({ source, ready }: { source: ViewerSource; ready: boolean }) {
  const invalidate = useThree((state) => state.invalidate)
  const i18n = usePascalI18n()
  const locale = useLocale()
  const sourceRef = useRef(source)
  sourceRef.current = source
  const nameRef = useRef<(levelId: string) => string | null>(() => null)
  nameRef.current = (levelId) => {
    const level = (sourceRef.current.nodes as unknown as Record<string, { level?: number; name?: string } | undefined>)[levelId]
    return level ? localizedLevelName(level, i18n, locale) : null
  }
  const job = useRef<Generator<void, void, void> | null>(null)

  useEffect(() => {
    if (!ready) return
    let cancelled = false
    const timer = window.setTimeout(() => {
      if (cancelled) return
      // Measured at rest: wait for a build that is playing to end first.
      const start = () => {
        if (cancelled) return
        if (useAnimationStore.getState().status !== 'idle') {
          window.setTimeout(start, 1000)
          return
        }
        job.current = steps()
        invalidate()
      }
      start()
    }, DELAY_MS)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
      job.current = null
    }
    // biome-ignore lint/correctness/useExhaustiveDependencies: once per scene shown
  }, [ready])

  function* steps(): Generator<void, void, void> {
    const source = sourceRef.current
    const set = collectBuild(source)
    yield
    if (!set) return
    const nodes = source.nodes as unknown as Record<string, unknown>

    // Blueprint: each floor's paper, named as the navigator names it.
    const plan = templateById('blueprint').build(set)
    yield
    for (const paper of plan.noir?.papers ?? []) {
      const named = nameRef.current(paper.levelId)
      if (named) paper.title = named
      preparePaper(paper, nodes)
      yield
    }

    // Blueprint: the wireframe's edges on the walls and furniture (floors draw none).
    const others = new Set(set.elements.map((e) => e.object))
    for (const element of set.elements) {
      if (element.phase === 'ground') continue
      for (const mesh of ownMeshes(element, others)) {
        if (mesh.geometry?.getAttribute('position')) prepareEdges(mesh.geometry)
      }
      yield
    }
  }

  useFrame(() => {
    const current = job.current
    if (!current) return
    const until = performance.now() + BUDGET_MS
    while (performance.now() < until) {
      if (current.next().done) {
        job.current = null
        return
      }
    }
    invalidate()
  })

  return null
}
