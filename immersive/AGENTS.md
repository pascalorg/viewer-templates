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
| `src/viewer/ProjectViewer.tsx` | The assembly. Keep the 3D `<Viewer>` and `ViewerStage` tree shaped like the hosted viewer. |
| `src/viewer/ViewerOverlay.tsx`, `src/viewer/chrome/*` | Custom viewer chrome built on `@pascal-app/viewer` stores, helpers, and primitives: `ExplorePanel`, `CommandBar`, `ShowPopover`, `LightPopover`, `SelectionCard`, `OnboardingHint`, `ShortcutsSheet`, `BottomSheet`, `useViewerShortcuts`. |
| `src/viewer/chrome/useAmbientOcclusion.ts` | Persisted Ambient occlusion preference (`pascal-viewer-ao`, default on) synced onto `useViewer`'s `sceneAppearance.postprocessing.ambientOcclusion`. |
| `src/viewer/screens.tsx`, `ErrorBoundary.tsx`, `GuestPrompt.tsx` | Branded loader, status and Sign in with Pascal screens, crash fallback. |
| `src/runtime/bootstrap.ts` | `prepareSceneRuntime`: built-in nodes, viewer config (assets, sounds, icons, local decoders), read-only lease, library materials, artifact store, plugins. |
| `src/runtime/plugins.ts` | The plugin allowlist, install-state rules and the unknown-kind warning. |
| `src/runtime/plugin-loader.ts` | Loads plugins once each, with a deadline and a late-arrival callback. |
| `src/runtime/materials.ts`, `artifacts.ts` | Library material registration; the read-only artifact store (private reads prefetch into blob URLs). |
| `src/runtime/project-scene.ts` | Connects `useProjectScene` to `prepareSceneRuntime`. |
| `src/runtime/trees-render.d.ts` | Type-only stand-in for the trees render entry (mapped in `tsconfig.json` `paths`). |
| `src/pascal/` | The API client and Open from Pascal helpers, shared with `listing`. No React, no three.js. |
| `src/pascal-react/` | `useViewerSettings`, `SettingsPanel` and its field blocks, byte-identical to `listing/src/pascal-react/`. |
| `src/settings/opening.ts` | Pure, unit-tested: this template's viewer settings (schema, per-field fallbacks, `withOpening`, `withTour`) and the tour route (`arrangeTour`, `tourOrder`, `moveRoom`, `toggleRoom`). |
| `src/settings/viewer-actions.ts`, `TourSettings.tsx`, `OpeningSettings.tsx` | Puts saved settings on screen, reads the orbit camera (`CameraPoseBridge`, `cameraPose`), and the Customize panel's fields. |
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
- **Viewer chrome lives in `src/viewer/chrome/`**, built as our own React components on
  `@pascal-app/viewer`'s stores, selection/solar helpers, camera emitter, and Radix primitives
  (theme tokens still come from `@pascal-app/viewer/ui/theme.css`). Keep the 3D `<Viewer>`,
  `ViewerStage`, and walkthrough HUD from the package. Sentence case for copy, fully rounded
  buttons.

## Before you finish

```bash
npm run typecheck
npm run test:unit
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

## Viewer settings

The model, how a manager enters Customize mode (from Pascal or from the viewer's own Customize
tab), the hook, the panel and its field blocks, and how to add a setting are in
[listing's AGENTS.md](../listing/AGENTS.md#viewer-settings). This template saves the guided
tour's route (which rooms, in which order, and whether it starts by itself) and how the page opens:

```json
{ "v": 1, "tour": { "order": ["zone_b", "zone_a", "zone_c"], "skip": ["zone_c"], "autostart": true }, "opening": { "camera": { "position": [x, y, z], "target": [x, y, z] }, "time": "night", "walls": "cutaway" } }
```

- The tour's route is `tourFloors` (floors lowest first, rooms in the viewer's room-list order)
  run through `arrangeTour`: rooms named in `tour.order` come first on their floor, in that order;
  rooms it doesn't name (added since) follow in the viewer's order; rooms in `tour.skip` are left
  out, and a floor with none left is too. Floors keep their order: `order` sorts rooms within a
  floor. With nothing saved (a new project, or one never customised) the route is the viewer's,
  unchanged. `ViewerOverlay` builds the route from the settings' current value, so a manager's
  draft drives the tour at once and can be previewed from the bottom bar before saving.
- The Customize panel's **Guided tour** section (`TourSettings.tsx`) lists the whole route,
  skipped rooms included (`tourOrder`): a checkbox per room to keep or skip it, buttons to move it
  up or down its floor, **Use the default order** (drops `order` and `skip`), and Start on arrival.
  The first change writes the complete order (`moveRoom`), so a saved route always names every
  room it knew. With every room skipped the tour button is disabled for visitors.

- `time` is one of the Light popover's presets (`midday`, `golden`, `blue`, `night`) and
  `walls` one of `up`, `cutaway`, `down`. Each field
  falls back on its own (`opening.ts`): no camera frames the house as before, and a missing or
  unknown time or walls keeps what the visitor had. A dragged sun, the live sky and translucent
  walls are never saved. Levels aren't a setting: the viewer always opens with its own.
- `ProjectViewer` snapshots the settings once as the scene opens (`arrival`). The saved camera
  goes through the same `ViewerOpeningCamera` path as `?camera=`, so the loader waits for it; a
  camera in the link wins over the saved one. Time and walls are applied once on arrival
  (`applyOpeningLook`); over a bake the walls are left alone, as the Show popover hides them there.
- `tour.autostart` starts the guided tour once the scene is on screen (`ViewerOverlay`'s
  `autostartTour`), never in an embed, VR or AR.
- The Customize panel's **Opening view** section (`OpeningSettings.tsx`) has **Use current
  view**, Camera with **Use current** and **Clear**, Time of day and, live only, Walls. Choosing a time or walls
  shows it on screen. The popovers change the screen, never the draft; when the screen differs
  from what Save keeps, the panel says so ("On screen now: …").
- The tab sits in the bottom-left corner beside the compass, on the side the panel docks: the
  panel docks on the left, so the Explore panel and its rooms on the right stay in
  view while customising (`styles.css` overrides the shared stylesheet's right-hand placement);
  phones keep the tab at the top left and the sheet across the bottom. Both step aside during the tour, a walkthrough, VR and AR. Colours follow the light and
  dark themes.
- `<main>` carries `data-time-of-day` and `data-wall-mode` for tests.

## The loading flow

`useProjectScene` resolves access (callback, stored tab credential, Pascal entry, then
anonymous), reads the scene and picks a source: `baked` when a bake is ready and
`VITE_PASCAL_SOURCE` is not `live`, otherwise `live`. For a bake it downloads the GLB into a blob
URL, renewing the signed URL when needed. It then awaits `prepareSceneRuntime` and only then
publishes the state that mounts `ProjectViewer`. A session credential rejected before its expiry
gets one fresh round trip to Pascal per tab, only once a tokenless read says the project is
definitively not public (Pascal refuses reader sessions on public projects); an indeterminate read
(offline, 5xx, 429) is a retryable error. The outcome is kept for the tab, so a reload never starts
another automatic trip. When the session can't be restored, a public project shows its public view
on its anonymous address, and anything else (and every share credential, and every invalid
callback) leads to a "Reopen from Pascal" or "Reopen your share link" screen; after Customize,
its sign-in button restarts Customize (`configure`). The rules are in
[listing's AGENTS.md](../listing/AGENTS.md#open-from-pascal).

`prepareSceneRuntime` waits up to 20 seconds for the plugins the scene needs. A plugin that
arrives later bumps `runtimeRevision`: the live graph is set again and the bake's replacement
nodes are rebuilt. Kinds no registered plugin draws are counted and warned once per kind.

## Sign in with Pascal

What the visitor sees, what the site and project need, and the three helpers (`canSignIn`,
`signIn`, `SignInUnavailable`) are in [README.md](README.md#sign-in-with-pascal); the protocol
rules are in [listing's AGENTS.md](../listing/AGENTS.md#sign-in-with-pascal). In this template:

- `useSignIn` in `src/viewer/screens.tsx` drives the button on the anonymous not-found and
  needs-access screens, the session reopen screen and the refused screen. Call `canSignIn` only
  there, never on a successful visit.
- Each screen has two texts: one for when the button is shown and one that doesn't mention
  signing in. Show the second until `canSignIn` resolves `true`.
- Sign in with Pascal is the primary button; "Open project in Pascal" becomes secondary next to it.
  The busy label and the `role="alert"` line must not move the layout. Show your own message
  there, never the error's text or anything from the callback.
