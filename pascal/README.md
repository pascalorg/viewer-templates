# Pascal viewer scaffold

The project data flow and render runtime are integrated on
`@pascal-app/{core,viewer,nodes}@1.1.2`. Open `/?project=<id>` (or set
`VITE_PASCAL_PROJECT_ID`). Access, handoff, bake download/renewal, allowlisted plugins,
library materials and read-only artifacts are prepared before mounting the resolved graph.
Rendering still uses the scaffold's simple viewer and drei `OrbitControls`. Ready bakes are
downloaded into blob URLs, but hybrid GLB assembly awaits the next public camera-controls
release; both source modes currently display the resolved graph live.

```bash
npm ci
npm run dev
```

Drag to orbit and scroll to zoom. The offline test fixture is a reduced copy of the public editor's
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
load only when their enabled kinds occur in the resolved graph. `.npmrc` uses `legacy-peer-deps` because the plugins require
editor peers and several still declare core/viewer `<1`. Render peers are explicit dependencies.
The trees loader uses a compiler-only paths shim (`src/runtime/trees-render.d.ts`):
its preset thumbnails assume Next image objects, while Vite imports URLs. The other five render
entries typecheck directly with `vite/client`. TypeScript's unused-local/parameter checks are enabled. TypeScript 7 has no per-directory
unused option and still checks imported plugin TS despite `exclude`. `npm run typecheck` runs
the compiler and filters only unused-symbol diagnostics under `node_modules`; every template
diagnostic and all other dependency type errors remain failures.
Never patch installed plugin source or import a package
name supplied by a scene graph. Trees remains opt-in (`VITE_PASCAL_PLUGIN_TREES=0`).

The public build-time variables in `.env.example` configure the API/assets origin, default
project, source mode, trees flag and optional bake polling. URL chrome/camera flags remain
reserved for the later assembly. System light/dark mode is active. Never put a key or token into `VITE_*` variables. On Pascal hosting keep the API
origin `https://editor.pascal.app`; its header CSP blocks arbitrary asset/API origins regardless
of this page's meta policy. A meta policy cannot set `frame-ancestors`.

`src/pascal/` is byte-identical to listing's standalone API/access/handoff client and root CI
checks that equality. Callback capture and query scrubbing run before React renders; project
access resolution runs through `useProjectScene` and `projectSceneRuntime`. See [listing's contract and handoff rules](../listing/AGENTS.md).

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

`npm run test:e2e` builds with `--mode runtime-test`, adding `tests/runtime.html`,
`tests/fixtures/hook.html`, an artifact redirect target and a manifest only for tests. App,
runtime and hook tests all use the same preview server, configured with `PASCAL_TEST_PORT`
(default 4180). No separate development server is started. Tests cover pool geometry and lazy
chunk requests through App, materials, missing kinds, artifact redirects/cleanup, loader
deadlines, access/handoff, bake renewal and hook cancellation. API responses and external
assets are mocked in the offline rendering smokes. The pool fixture extends the common live
graph; App and runtime tests share the scaffold renderer and pixel helper.

The normal `npm run build` includes no test modules or harness entries, enforced by `check`.
Use `PASCAL_TEST_PORT=4182 npm run test:e2e` to isolate another worktree. Rebuild normally before
`check` and deployment; `check` rejects a runtime-test build.
