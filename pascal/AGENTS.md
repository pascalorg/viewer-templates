# Pascal template — the hosted viewer on public packages

This folder is independently installable with public npm packages and six pinned public git
plugins. The page resolves projects and prepares plugins, materials and artifacts before rendering
the hosted viewer's assembly: a ready bake with the parts the hosted viewer keeps live, or a
full live rebuild. Community likes, duplicate, collections, view counts, analytics, SEO text
and private plugins are outside the template.

| Path | Responsibility |
| --- | --- |
| `src/App.tsx` | Project states and runtime adapter; resolved scenes render `viewer/ProjectViewer.tsx`. |
| `src/viewer/` | `ProjectViewer.tsx` (keep shaped like the hosted `viewer-client.tsx`), `ViewerOverlay.tsx`, `GuestPrompt.tsx`, `ErrorBoundary.tsx`, status screens. |
| `src/main.tsx` | Capture/scrub handoff callback before render; system theme listener. |
| `src/config.ts` | Public environment configuration and reserved URL parsing. |
| `src/styles.css` | Tailwind, viewer/ui theme, package sources and Barlow. |
| `src/pascal/` | Standalone contract, client and access/handoff helpers. Keep byte-identical to `listing/src/pascal/`; root CI enforces it. |
| `src/runtime/` | Render bootstrap, literal lazy plugin allowlist, hosted bounded loader, material mapping and read-only project artifacts. `prepareSceneRuntime` owns the read-only lease and cleanup; see README for assembly signatures. |
| `vite.config.ts` | Editor/Next boundary, singleton dedupe, local decoders and production CSP. |
| `scripts/check-build.mjs` | Bundle/install/lock boundary report, hosting paths/extensions and stricter size budgets. |
| `public/` | The viewer's 13 MP3 sounds and seven WebP control icons from the public editor. |
| `tests/` | Minimal public live graph and offline SwiftShader smoke test, preview port 4180. |

Read [listing's contract/access documentation](../listing/AGENTS.md) before wiring project
reads. The public graph omits collections, strip-only kinds and hidden/private data. Public
bakes must be disclosure-compatible version 3 or later. Never rely on the full hosted graph.
Never put an API key, account session or viewer token in the bundle. Credentials remain
tab-scoped; signed storage fetches omit credentials and never receive Pascal bearer tokens.

Load plugins before mounting a graph; hold the core read-only lease for the scene's lifetime.
Registries are singletons: use one scene per page. Camera controls and the opening camera come
from `@pascal-app/viewer/ui`; keep the hosted viewer tree shape and use viewer/ui rather than
forking its components.

Optional plugins must use an explicit build-time allowlist of package pins and literal dynamic
`/render` imports, never graph-driven imports. Keep trees opt-in. The pinned trees render entry
uses a compiler-only `Plugin` declaration via `paths`: Vite image
imports are strings but the plugin's preset art assumes `{ src }`. The other five typecheck
with `vite/client`. Unused-local/parameter checks are enabled; `scripts/typecheck.mjs` filters only unused-symbol
diagnostics from raw TS in node_modules because TypeScript has no per-directory unused option.
Template diagnostics and all other dependency errors still fail. No installed plugin source patches. Remove `.npmrc` legacy peer resolution
after upstream makes editor optional and widens core/viewer ranges at the chosen pins.

Preserve the boundary against `@pascal-app/editor` and `next`, the three Pascal 1.1.3 pins and the CLI pin in `deploy:dry` (bump
together), and the singleton dedupe list. Keep content-hashed assets and self-hosted decoders.
`check` budgets are 20 MiB/file, 90 MiB total and 1,500 files. Pascal's header CSP restricts
origins even if a local meta policy is widened. Do not add remote scripts.

Use sentence case and fully rounded buttons. Override theme tokens instead of copying the UI.
URL inputs are `project`, `embed`, `hideHeader`, `hideBottomBar` and `camera`, read as the
hosted viewer reads them; an embed posts `pascal:viewer-ready` once `data-scene-ready` holds.

Run `npm ci`, `npm run typecheck`, `npm run build`, `npm run check`, `npm run test:e2e` and
`VIEWER_ID=viewer_dryrun npm run deploy:dry`. See [README.md](README.md) for setup and scope.
`test:e2e` adds runtime and hook HTML entries via `--mode runtime-test`; all tests share
the preview server. The normal build excludes every harness and test module; `check` enforces it. Use `PASCAL_TEST_PORT` to isolate concurrent worktrees. Rebuild normally before deploying.
