# Pascal viewer scaffold

S1 + S2 of the Pascal template: a standalone Vite page that renders a small local scene using
`@pascal-app/{core,viewer,nodes}@1.1.2`. It currently opens the fixture for every URL. Project
reads, hybrid baked/live assembly and hosted viewer chrome belong to later slices. S2 provides
the runtime API and plugin allowlist for that assembly, exercised through a separate test entry.

```bash
npm ci
npm run dev
```

Drag to orbit and scroll to zoom. The fixture is a reduced copy of the public editor's
`fixtures/viewer-live/scene.json`: site, building, level, four walls and one zone, with no remote
assets. It uses the public drei `OrbitControls`; the hosted camera/opening-camera components
await a later viewer/ui release. The fixture disables textures, daylight and post-processing
to provide a small, offline rendering check, as the public viewer-live fixture does.

```bash
npm run typecheck
npm run build
npm run check
npx playwright install chromium
npm run test:e2e
VIEWER_ID=viewer_Abc123DEF456ghi7 npm run deploy:dry
```

The production build prepends the CSP meta to `index.html`, serves matching Three decoders from
`/decoders/`, rejects editor/Next imports and emits `build-boundary.json` containing package
names and entry-chunk plugin checks. `check` validates the installed/locked/bundled packages,
hosting extensions and budgets: 20 MiB per file, 90 MiB total, 1,500 files. Vite's default lazy
chunking is sufficient; assets keep their default content-hashed names.

The six public plugins are pinned to Community's exact commits in the runtime allowlist. They
are not loaded by the S1 fixture. `.npmrc` uses `legacy-peer-deps` because the plugins require
editor peers and several still declare core/viewer `<1`. Render peers are explicit dependencies.
The trees loader uses a compiler-only paths shim (`src/runtime/trees-render.d.ts`):
its preset thumbnails assume Next image objects, while Vite imports URLs. The other five render
entries typecheck directly with `vite/client`. TypeScript's unused-local/parameter checks are off
because the pinned third-party TS sources contain unused declarations; strict typing stays on.
Never patch installed plugin source or import a package
name supplied by a scene graph. Trees remains opt-in (`VITE_PASCAL_PLUGIN_TREES=0`).

The public build-time variables in `.env.example` reserve the project's API/assets origin,
default project, source mode, trees flag and bake-poll flag for the later runtime. `config.ts`
also parses project/URL flags; the S1 page does not apply them. Only system light/dark mode is
active now. Never put a key or token into `VITE_*` variables. On Pascal hosting keep the API
origin `https://editor.pascal.app`; its header CSP blocks arbitrary asset/API origins regardless
of this page's meta policy. A meta policy cannot set `frame-ancestors`.

`src/pascal/` is byte-identical to listing's standalone API/access/handoff client and root CI
checks that equality. Callback capture and query scrubbing run before React renders; project
access resolution will be wired in a later slice. See [listing's contract and handoff rules](../listing/AGENTS.md).

The 13 viewer sound files and seven control icons are byte-for-byte copies from the public
editor's `apps/editor/public/`. The fixture configures their same-origin paths but does not
yet mount the hosted controls bar or interaction sounds.

The eventual template deliberately omits community likes/duplicate, collections, SEO text and
private plugin geometry on live scenes. This scaffold makes no hosted-viewer parity claim.

To validate a static build with Pascal's CLI (no key or upload):

```bash
npx @pascal-app/cli@1.1.2 viewer deploy dist --viewer viewer_Abc123DEF456ghi7 --dry-run
```

For an actual deployment follow [listing's deployment guide](../listing/README.md#deploy).
Keep deployment keys in your shell, never in this folder or the browser bundle.

## Runtime API for scene assembly

Import from `src/runtime/bootstrap.ts` and call before mounting either a live graph or baked
GLB with live replacements:

```ts
prepareSceneRuntime(options: PrepareSceneRuntimeOptions): Promise<PreparedSceneRuntime>

type PrepareSceneRuntimeOptions = {
  projectId: string
  graph: SceneGraph
  libraryMaterials?: readonly unknown[]
  baseUrl?: string              // defaults to VITE_PASCAL_BASE_URL
  token?: string                // tab's short-lived pvh_ credential, never a build variable
  signal?: AbortSignal
  onLate?: () => void           // remount live graph / refresh GLB replacement nodes
  pluginTimeoutMs?: number      // defaults to 20_000
}
type PreparedSceneRuntime = {
  setup: ReturnType<typeof publishedSceneSetup>
  unknownKinds: Record<string, number>
  pluginsLoaded: boolean        // true = settled before deadline; failures are logged/skipped
  dispose: () => void
}
```

The call registers built-ins synchronously, configures assets/sounds/icons/local decoders,
acquires the scene read-only lease, registers the served material rows in catalog shape, sets
the project artifact store, and waits for only the plugins the graph needs. Then call
`useScene.getState().setScene(nodes, rootNodeIds, runtime.setup)` on the live path. The baked
path uses the same preparation before `buildGlb*` helpers. Hold the result until the scene has
unmounted; stop spatial-grid subscriptions first, then call `runtime.dispose()` to release the
lease, detach the artifact store and revoke blob URLs. Disposal is idempotent; failed/aborted
preparation cleans itself up. Registries are singletons: use one project per page and reload
to switch projects. A late chunk's callback is suppressed after disposal/abort. After a late
remount, `warnUnknownKinds(graph)` can refresh the missing-parts notice counts.

Only literal `/render` imports in `plugins.ts` may execute. No discovery hook or scene-provided
package/URL is imported. A plugin requires its kind prefix and an installed id; a missing or
malformed installed list enables legacy plugins, while `[]` disables them. Trees is excluded
unless `VITE_PASCAL_PLUGIN_TREES=1`. Environment loading also registers its viewer presentation.
Unknown kinds are counted and warned once per kind per page; the remaining graph renders.
Use `unknownKinds` for the later missing-parts notice. If a chunk is still pending at the deadline,
its missing kinds can appear in this snapshot until the late callback remounts the scene.

Lower-level exports, for assembly that needs to control individual steps:

```ts
// bootstrap.ts
bootstrapRuntime(): void
loadSceneRenderPlugins(packageNames: readonly string[]): Promise<void>
// plugins.ts
neededPlugins(graph: PluginGraph): string[]
pluginInstallStateOf(graph?: { installedPlugins?: unknown } | null): PluginInstallState
publishedSceneSetup(graph: { materials?: unknown; installedPlugins?: unknown }): {
  materials: Record<SceneMaterialId, SceneMaterial>; collections: {}
  installedPlugins: string[]; hasExplicitPluginInstallState: boolean
}
warnUnknownKinds(graph: PluginGraph): Record<string, number>
// materials.ts
registerReferencedLibraryMaterials(materials: readonly unknown[]): void
// artifacts.ts
referencedArtifactHashes(graph: unknown): string[]
createProjectArtifactStore(options: ProjectArtifactOptions): Promise<{
  store: ArtifactStore; dispose: () => void
}>
```

`PluginGraph` has `nodes: Record<string, { type: string }>` and optional `installedPlugins: unknown`.
`PluginInstallState` has `installedPlugins: string[]` and `hasExplicitPluginInstallState: boolean`.
`ProjectArtifactOptions` has `baseUrl`, `projectId`, `graph: unknown`, optional `token` and `signal`.
`plugin-loader.ts` is copied verbatim from the hosted viewer: it exports `createPluginLoader`,
`PluginLoadError`, `whenLoaded` and `loadScenePluginsBounded` with retry, deduplication, a bounded
wait and late-arrival notification.

Anonymous artifact URLs use the public project artifact route and its signed storage redirect.
With a credential, preparation walks all nested `artifact://<sha256>` fields, deduplicates hashes
and prefetches their bytes with `credentials: 'omit'`. Native fetch strips the bearer header on
the cross-origin storage redirect. Private URL lookups then return blob URLs; missing hashes
return null. `put` rejects and `text` returns null: authored script text is editor-only, while
viewers consume compiled artifacts. Artifact 401s propagate as `PascalError('unauthorized')` for
the access layer to handle; they never silently fall back to anonymous reads.

`npm run test:e2e` builds with `--mode runtime-test`, adding `tests/runtime.html` and a build
manifest only for smoke tests. This exercises pool geometry, chunk requests, missing kinds,
library materials, artifact redirects/cleanup and loader deadlines alongside the original
offline smoke. The default `npm run build` excludes both the harness and its test hooks; until
the assembly imports this API, it still builds the S1 fixture. For manual runtime inspection,
run `npm run dev` and open `/tests/runtime.html?pool=1&unknown=1` (never deployed).
Use `PASCAL_TEST_PORT=4182 npm run test:e2e` when another worktree is testing on port 4180.
The test runner binds IPv4 explicitly and starts its own server so it cannot reuse another
worktree's build. Rebuild normally before deployment.
