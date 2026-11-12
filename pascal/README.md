# Pascal viewer

Pascal's hosted viewer (`editor.pascal.app/viewer/<id>`) rebuilt on
`@pascal-app/{core,viewer,nodes}@1.1.4`. Open `/?project=<id>` (or set
`VITE_PASCAL_PROJECT_ID`). Access, handoff, bake download/renewal, allowlisted plugins,
library materials and read-only artifacts are prepared before the scene mounts.
`src/viewer/ProjectViewer.tsx` is the assembly, shaped like the hosted one: with a ready bake
the GLB draws the building while interactive items, scans/guides and `bake: 'replace'` plugin
kinds are rebuilt live; without one the whole graph is rebuilt live. Camera controls, the
opening camera, header, controls bar, floor plan and split view, rooms, walkthrough, drone,
callouts and sounds all come from `@pascal-app/viewer/ui` and `@pascal-app/viewer/sfx`.

```bash
npm ci
npm run dev
```

Right-drag to orbit, middle-drag or space + drag to pan, scroll to zoom, as on editor.pascal.app.
The offline test fixture is a reduced copy of the public editor's
`fixtures/viewer-live/scene.json`: site, building, level, four walls and one zone, with no remote
assets.

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
project, source mode, trees flag and optional bake polling. URL flags match the hosted viewer:
`embed=1` (header without the owner line, controls bar and stage switcher, no guest prompt;
posts `{ type: 'pascal:viewer-ready', projectId }` to the parent frame once the scene shows),
`hideHeader=1`, `hideBottomBar=1` and `camera=px,py,pz,tx,ty,tz[,fov]` or `camera=saved`.
`main[data-scene-ready]` turns true when the loader lifts. System light/dark mode is active. Never put a key or token into `VITE_*` variables. On Pascal hosting keep the API
origin `https://editor.pascal.app`; its header CSP blocks arbitrary asset/API origins regardless
of this page's meta policy. A meta policy cannot set `frame-ancestors`.

`src/pascal/` is byte-identical to listing's standalone API/access/handoff client and root CI
checks that equality. Callback capture and query scrubbing run before React renders; project
access resolution runs through `useProjectScene` and `projectSceneRuntime`. See [listing's contract and handoff rules](../listing/AGENTS.md).

The 13 viewer sound files and seven control icons are byte-for-byte copies from the public
editor's `apps/editor/public/`, served from this page's origin.

The template deliberately omits community likes/duplicate, collections, view counts, analytics
and SEO text. The owner's name is plain text (the public read returns no profile address), and
"Get started" links to editor.pascal.app. Kinds from Pascal's private plugins are skipped with
one console warning per kind and no on-screen notice.

To validate a static build with Pascal's CLI (no key or upload):

```bash
npx @pascal-app/cli@1.1.4 viewer deploy dist --viewer viewer_Abc123DEF456ghi7 --dry-run
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
arrival, `warnUnknownKinds(graph)` refreshes the unknown-kind counts.

Only literal `/render` imports in `plugins.ts` may execute. No discovery hook or scene-provided
package/URL is imported. A plugin requires its kind prefix and an installed id; a missing or
malformed installed list enables legacy plugins, while `[]` disables them. Trees is excluded
unless `VITE_PASCAL_PLUGIN_TREES=1`. Environment loading also registers its viewer presentation.
Unknown kinds are counted and warned once per kind per page; the remaining graph renders.
If a chunk is still pending at the deadline,
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
deadlines, access/handoff, bake renewal, hook cancellation and the viewer chrome (icons, a door
sound from the callout, embed and hide flags, the opening camera, walkthrough). API responses and external
assets are mocked in the offline rendering smokes. The pool fixture extends the common live
graph; runtime tests render through the test-only `tests/fixtures/FixtureViewer.tsx`.

The normal `npm run build` includes no test modules or harness entries, enforced by `check`.
Use `PASCAL_TEST_PORT=4182 npm run test:e2e` to isolate another worktree. Rebuild normally before
`check` and deployment; `check` rejects a runtime-test build.
