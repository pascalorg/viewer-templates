# Pascal viewer template

A static Vite and React app that rebuilds Pascal's hosted 3D viewer on the public
`@pascal-app/core`, `@pascal-app/viewer` and `@pascal-app/nodes` packages at `1.1.4`. It reads
Pascal's published scene API, anonymously or with a short-lived credential from Open from
Pascal, and renders either a ready bake with the parts the hosted viewer keeps live, or a full
live rebuild of the published graph.

It is a template: fork it, restyle it, add UI. This file tells you (or your agent) where things
are and which rules to keep. [`README.md`](README.md) covers setup, flags, plugins and deployment.
The read API contract and the access rules are in [listing's AGENTS.md](../listing/AGENTS.md);
read it before changing how projects are read.

## Layout

| Path | Owns |
| --- | --- |
| `src/main.tsx` | Captures and scrubs an Open from Pascal callback before React renders; follows the system light or dark setting. |
| `src/config.ts` | Build-time `VITE_*` settings, the project id (query, callback, then `VITE_PASCAL_PROJECT_ID`) and the URL flags. |
| `src/App.tsx` | Maps the loading state to a screen or to `ProjectViewer`. |
| `src/useProjectScene.ts` | Loading flow: access, scene read, bake download into a blob URL, runtime preparation, credential renewal, optional bake polling. |
| `src/viewer/ProjectViewer.tsx` | The assembly. Keep it shaped like the hosted viewer's tree. |
| `src/viewer/ViewerOverlay.tsx`, `GuestPrompt.tsx`, `screens.tsx`, `ErrorBoundary.tsx` | Header and controls bar, the "Get started" card, status screens, the crash fallback. |
| `src/runtime/bootstrap.ts` | `prepareSceneRuntime`: built-in nodes, viewer config (assets, sounds, icons, local decoders), read-only lease, library materials, artifact store, plugins. |
| `src/runtime/plugins.ts` | The plugin allowlist, install-state rules and the unknown-kind warning. |
| `src/runtime/plugin-loader.ts` | Loads plugins once each, with a deadline and a late-arrival callback. |
| `src/runtime/materials.ts`, `artifacts.ts` | Library material registration; the read-only artifact store (private reads prefetch into blob URLs). |
| `src/runtime/project-scene.ts` | Connects `useProjectScene` to `prepareSceneRuntime`. |
| `src/runtime/trees-render.d.ts` | Type-only stand-in for the trees render entry (mapped in `tsconfig.json` `paths`). |
| `src/pascal/` | The API client and Open from Pascal helpers, shared with `listing`. No React, no three.js. |
| `src/styles.css` | Tailwind, the viewer UI theme, Barlow and Geist Mono, and the `@source` scan of plugin sources. |
| `public/` | The viewer's sounds (`audios/sfx/`) and control icons (`icons/`), served from this origin. |
| `vite.config.ts` | The editor and Next boundary, singleton dedupe, self-hosted decoders and the production CSP. |
| `scripts/check-build.mjs` | `npm run check`: hosting limits and the package boundary. |
| `scripts/typecheck.mjs` | `npm run typecheck`: `tsc --noEmit`, ignoring only unused-symbol errors inside `node_modules`. |
| `tests/` | Playwright tests against a mocked API, with fixtures and test-only harness pages. |

## Rules

- **No `@pascal-app/editor`, no `next`.** `vite.config.ts` fails the build on either import, and
  `npm run check` fails if either is bundled, installed or in `package-lock.json`.
- **`src/pascal/` stays byte-identical to `listing/src/pascal/`.** CI runs
  `diff -r listing/src/pascal pascal/src/pascal`. Change both together, and keep React and
  three.js out of it.
- **Pascal versions move in lockstep.** `@pascal-app/core`, `@pascal-app/viewer` and
  `@pascal-app/nodes` stay on the same exact version, and the `@pascal-app/cli` version in the
  `deploy:dry` script moves with them.
- **`legacy-peer-deps` stays in `.npmrc`** until the pinned public plugins accept Pascal 1.x and
  stop requiring the editor as a peer. Declare render-time peers in `package.json` yourself.
  Never patch installed plugin source.
- **Hosting limits are enforced by `npm run check`**: 20 MiB per file, 90 MiB in total, 1,500
  files, allowlisted file extensions, no hidden files or symlinks, no plugin code in the entry
  chunk and no test output in `dist/`.
- **Plugins come only from the allowlist** in `src/runtime/plugins.ts`, with literal `/render`
  imports. Never import a package or URL named by scene data. Keep trees opt-in.
- **Load plugins before mounting a graph, and hold the read-only lease for the scene's
  lifetime.** `prepareSceneRuntime` does both; dispose its result after the scene unmounts.
  Registries are singletons, so render one project per page.
- **Never put an API key, account session or viewer token in the bundle.** `VITE_*` values and
  everything in `src/` ship to every visitor. Credentials stay in the tab's `sessionStorage`;
  signed storage downloads omit credentials.
- **Keep decoders self-hosted and the CSP in step** with what the page loads. Do not add remote
  scripts. Pascal hosting sends its own CSP header, which wins over a wider meta policy.
- **Use `@pascal-app/viewer/ui` components** and override theme tokens rather than copying
  them. Sentence case for copy, fully rounded buttons.

## Before you finish

```bash
npm run typecheck
npm run build
npm run check
npx playwright install chromium   # once
npm run test:e2e
npm run build                     # test:e2e leaves a test build in dist/; check refuses it
VIEWER_ID=viewer_dryrun npm run deploy:dry
```

Pull request CI does not run the browser tests for this template: they render full 3D scenes and
take minutes without a GPU. Run `npm run test:e2e` on your machine before opening a pull request;
a maintainer can also run them from the CI workflow's "Run workflow" button.

`npm run test:e2e` builds with `--mode runtime-test`, which adds the harness pages under
`tests/`, and serves that build with `vite preview` on `PASCAL_TEST_PORT` (default 4180). The
tests mock the scene read, storage and external assets, so they need no network and no Pascal
account. They render with software WebGL.

## The loading flow

`useProjectScene` resolves access (callback, stored tab credential, Pascal entry, then
anonymous), reads the scene and picks a source: `baked` when a bake is ready and
`VITE_PASCAL_SOURCE` is not `live`, otherwise `live`. For a bake it downloads the GLB into a blob
URL, renewing the signed URL when needed. It then awaits `prepareSceneRuntime` and only then
publishes the state that mounts `ProjectViewer`. A rejected credential leads to a "Reopen from
Pascal" or "Reopen your share link" screen; it never falls back to an anonymous read.

`prepareSceneRuntime` waits up to 20 seconds for the plugins the scene needs. A plugin that
arrives later bumps `runtimeRevision`: the live graph is set again and the bake's replacement
nodes are rebuilt. Kinds no registered plugin draws are counted and warned once per kind.
