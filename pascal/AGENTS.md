# Pascal template — S1 scaffold

This folder is independently installable with public npm packages and six pinned public git
plugins. Only the fixture scaffold is implemented. Do not infer hosted-viewer parity from it.
Later slices add project access, the plugin allowlist and hybrid scene assembly. Community
likes, duplicate, collections, SEO text and private plugins are outside the intended template.

| Path | Responsibility |
| --- | --- |
| `src/App.tsx` | Public Viewer, built-in render plugin, read-only lease and local fixture. |
| `src/main.tsx` | Capture/scrub handoff callback before render; system theme listener. |
| `src/config.ts` | Public environment configuration and reserved URL parsing. |
| `src/styles.css` | Tailwind, viewer/ui theme, package sources and Barlow. |
| `src/pascal/` | Standalone contract, client and access/handoff helpers. Keep byte-identical to `listing/src/pascal/`; root CI enforces it. |
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
Registries are singletons: use one scene per page. Do not copy hosted camera/opening-camera
components in S1; use the public controls available in 1.1.2. Later hosted assembly should keep
the hosted viewer tree shape and use viewer/ui rather than forking its components.

Optional plugins must use an explicit build-time allowlist of package pins and literal dynamic
`/render` imports, never graph-driven imports. Keep trees opt-in. The pinned trees render entry
requires a compiler-only `Plugin` declaration via `paths` when it is introduced: Vite image
imports are strings but the plugin's preset art assumes `{ src }`. The other five typecheck
with `vite/client`. No installed plugin source patches. Remove `.npmrc` legacy peer resolution
after upstream makes editor optional and widens core/viewer ranges at the chosen pins.

Preserve the boundary against `@pascal-app/editor` and `next`, the three Pascal 1.1.2 pins (bump
together), and the singleton dedupe list. Keep content-hashed assets and self-hosted decoders.
`check` budgets are 20 MiB/file, 90 MiB total and 1,500 files. Pascal's header CSP restricts
origins even if a local meta policy is widened. Do not add remote scripts.

Use sentence case and fully rounded buttons. Override theme tokens instead of copying the UI.
Reserved later URL inputs are `project`, `embed`, `hideHeader`, `hideBottomBar` and `camera`;
the eventual ready message is `pascal:viewer-ready`. They do not change S1's fixture page.

Run `npm ci`, `npm run typecheck`, `npm run build`, `npm run check`, `npm run test:e2e` and
`VIEWER_ID=viewer_dryrun npm run deploy:dry`. See [README.md](README.md) for setup and scope.
