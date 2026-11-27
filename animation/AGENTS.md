# Pascal animation viewer template

The `pascal` template plus build animations (`src/animation/`). See [Build animations](#build-animations).

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
| `src/main.tsx` | Captures and scrubs an Open from Pascal callback before React renders; starts the interface theme (`src/hud/theme.ts`). |
| `src/config.ts` | Build-time `VITE_*` settings, the project id (query, callback, then `VITE_PASCAL_PROJECT_ID`) and the URL flags. |
| `src/App.tsx` | Maps the loading state to a screen or to `ProjectViewer`. |
| `src/useProjectScene.ts` | Loading flow: access, scene read, bake download into a blob URL, runtime preparation, credential renewal, optional bake polling. |
| `src/viewer/ProjectViewer.tsx` | The assembly. Keep it shaped like the hosted viewer's tree; it adds `BuildAnimator` in the canvas and mounts `HudShell` and `AnimationCaption` over it. It mounts no selection manager, `ViewerRooms` or `ViewerHoverLabel` (the bake gets no `onPick`): nothing in the 3D scene highlights or selects under the pointer. |
| `src/hud/` | Custom Light & Airy HUD over Pascal's stores and selection helpers: `HudShell.tsx` composes `NavigatorRail.tsx` (left collapsible project + building-section floor navigator), `ModeDock.tsx` (bottom-centre: the `ViewMenu.tsx` 3D/2D/Split menu, shown in every stage mode, then the Orbit/Animate switch, 3D only (no walk, drone or camera menu: this is an animation viewer, and the other viewers have those)), `Inspector.tsx` (right Scene/Look/Light settings drawer; Scene has no Levels or Walls modes, the house always shows stacked with Pascal's default walls) and `AnimationStudio.tsx` (the build animations, a panel of their own docked on the right, opened by the dock's Animate; Settings and Animations share the right edge, one at a time). `theme.ts` holds the interface theme (System, Light or Dark, saved in `localStorage`, set from Settings › Look); it sets `dark` and `data-hud-theme` on `<html>` and never touches the 3D scene. |
| `src/animation/` | Build animations: `elements.ts` measures the pieces, `templates.ts` plans the eight timelines, `poses.ts` poses a piece at a moment, `effects.ts` draws dust, blueprint lines, ground waves and room floors, `BuildAnimator.tsx` plays a run, `AnimationsTab.tsx` provides `AnimationsPanel` (mounted in `src/hud/AnimationStudio.tsx`) and `useAnimationLifecycle`, `AnimationCaption.tsx` the title cards, `store.ts` joins them. |
| `src/viewer/screens.tsx`, `ErrorBoundary.tsx` | Status and Sign in with Pascal screens, the crash fallback. |
| `src/runtime/bootstrap.ts` | `prepareSceneRuntime`: built-in nodes, viewer config (assets, sounds, icons, local decoders), read-only lease, library materials, artifact store, plugins. |
| `src/runtime/plugins.ts` | The plugin allowlist, install-state rules and the unknown-kind warning. |
| `src/runtime/plugin-loader.ts` | Loads plugins once each, with a deadline and a late-arrival callback. |
| `src/runtime/materials.ts`, `artifacts.ts` | Library material registration; the read-only artifact store (private reads prefetch into blob URLs, waiting out a `429` for the `Retry-After` Pascal gives). |
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
publishes the state that mounts `ProjectViewer`. A session credential rejected before its expiry
gets one fresh round trip to Pascal per tab (a reader's session only once a tokenless read says the
project is definitively not public; an indeterminate read is a retryable error); when it can't be
restored, a public project shows its public view on its anonymous address, and anything else (and
every share credential, and every invalid callback) leads to a
"Reopen from Pascal" or "Reopen your share link" screen. The rules are in
[listing's AGENTS.md](../listing/AGENTS.md#open-from-pascal).

`prepareSceneRuntime` waits up to 20 seconds for the plugins the scene needs. A plugin that
arrives later bumps `runtimeRevision`: the live graph is set again and the bake's replacement
nodes are rebuilt. Kinds no registered plugin draws are counted and warned once per kind.

## Viewer settings

`src/pascal/` carries viewer settings like every template (Customize mode, `scope=configure`, the
`configure=available` hint that gets a manager the pass on arrival, `enterCustomize`, `saveSettings`; see [listing's AGENTS.md](../listing/AGENTS.md#viewer-settings)), but this template
uses none yet: it ignores the read's `settings` and has no `src/pascal-react/`. To add the opening
view, copy `src/pascal-react/` from `listing` (and its `diff -r` line in CI) and follow
[`showcase`](../showcase/AGENTS.md#viewer-settings), whose assembly this one shares.

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

## Build animations

- **Every template builds in hierarchy order**: floor by floor from the bottom, and on each floor
  slab, frame, walls, stairs, doors and windows, furniture, then ceilings, outside fittings and
  roof (`BUILD_ORDER` in `templates.ts`). Nothing that covers a piece (a ceiling, a roof, even a roof
  on its own "Roof" level) may land before it. Use `floorByFloor` for grouped schedules, or sort by
  `byRank` for one-list schedules.
- **A template is a pure plan.** `build(set)` returns a `Timeline`: per node a `Track` (start,
  duration, `Motion`, optional dust and `showBefore`), plus optional blueprint lines and ground
  waves. Poses are a function of time, so seeking and replays cost nothing. Add a template by
  adding one to `TEMPLATES`; add a motion in `poses.ts`.
- **Motions are in world space about a world pivot** and reach the object as
  `parentRest⁻¹ · M · restWorld`, decomposed into its position, quaternion and scale, so a door
  still follows its wall. At rest the object's own transform is restored exactly.
- **Batches step aside during a run.** Pascal merges a floor's walls (`wall-batch`) and repeated
  furniture (`item-batch`) once the scene settles; the animator hides those meshes and puts each
  piece's own meshes back on the scene layer every frame, then on stop emits the
  `thumbnail:before-capture`/`after-capture` pair so the batching systems re-sew cleanly.
- **The animator's `useFrame` runs at priority 0**, before Pascal's render at priority 1, on a
  wall clock (a slow GPU slows the picture, not the timeline).
- **A timeline can also drive** title cards (`captions`) and cinematic camera framings
  (`cameraKeys`).
- **Prefer transforms to extra draws.** Every template but Blueprint only moves, turns and scales
  the pieces (Pop-up book's `tilt` and `page` hinge them on a bottom edge), which costs nothing on
  the GPU. Sand drew a masked copy of every mesh and was too slow on real projects, so it was
  replaced.
- **A slab that spreads builds room by room**: `RoomFloors` lays a tile per room on it (the room's
  outline, slab-thick, in the slab's material), each growing from its own room's centre; the real
  slab takes over once the last tile is down.
- **Framing never uses `fitToBox`**: camera-controls snaps it to the box's nearest face, so a tilt
  either side of 45 degrees flipped the view. `frameBox` keeps the azimuth, looks at the box's
  bounding sphere and stands back to hold it; the panel's Zoom divides that distance and its Tilt
  (or each template's own) sets the polar angle.
- **The camera is the animation's while a cinematic build plays**: camera-controls' input is off
  (`enabled = false`; scripted moves still run), a vertical drag sets Tilt and the wheel sets Zoom,
  and the click that ends a drag is swallowed so it selects nothing. Finished or stopped, input is
  back on.
- **Zoom and Tilt follow the camera**: when the person orbits or zooms it themselves, the panel's
  sliders read it back (`followCamera` in the store: tilt is the polar angle, zoom the fit distance
  of the last framing over the camera's distance) without framing again. Every camera `update`
  counts except a framing's own glide (`framing`, from `frameBox` until `rest` or the person's
  next pointer or wheel) and the locked cinematic camera's. Don't key this on camera-controls'
  `controlstart`: the wheel sends none.
- **The sliders reach as far as the camera does**: the camera keeps Pascal's own limits
  (`ViewerCameraControls`: 5 to 100 m, polar 0 to about 84°), and `publishRanges` turns them into
  the store's `zoomRange` (against the current framing's fit distance) and `tiltRange`, which size the
  Zoom and Tilt sliders and clamp the cinematic drag and wheel. Don't cap the camera to the sliders.
- **Blueprint plays in the Noir look** (`look: 'noir'`): `NoirLook.tsx` is the Home Assistant
  viewer's `HomeNoir` wireframe (frosted walls, edges with coplanar seams merged, grey-glow ground),
  and the viewer turns Pascal's daylight off while it is on (`useNoirActive`). Each floor gets a
  `PaperSheet` (`paper.tsx`) printed with that floor's plan from Pascal's own `def.floorplan`
  geometry and named as the navigator names it (the ground floor's is kept 2 cm over the site's
  ground under it, terrain included, by `groundTopUnder`; the paper is pulled forward in depth and
  Noir's ground pushed back, as Pascal's own is); it unfolds, the floor extrudes out of it, and
  `ink.ts` develops the floor into colour. The look switches in and out behind `LookCurtain.tsx` (the
  Noir background over the stage, as CSS: a circle growing from the middle on the way in, a fade
  over the finished building on the way out, held shut until Pascal's daylight has redrawn
  smoothly (`whenSettled`) and then faded off; `appliedLook` in the store follows what the build
  wants once covered), and a finished build holds a beat, then switches back and is put back.
- **Heavy animations are prepared ahead** (`Precompiler.tsx`, mounted by `BuildAnimator`): a moment
  after the project appears, in slices of a few milliseconds a frame, it draws Blueprint's floor
  plans into textures and works out the wireframe's edges. Noir's shaders depend on its lights, so
  `NoirLook` compiles them as it mounts, while the first paper drops, by drawing stand-ins that every
  animation material discards (`warmup.ts`: put `notWarmup()` in the mask of any new animation
  material); three builds a pipeline for Pascal's own scene pass and lights, which `compileAsync`
  would not match. These materials and textures are kept for the page, never disposed between runs.
- **Render to video steps the frames itself**: the dock's Render opens `src/hud/RenderDialog.tsx`
  (animation, 30 or 60 fps, resolution), and `FrameRecorder.tsx` (mounted by `BuildAnimator`)
  renders it to an MP4 with WebCodecs through `mediabunny`, all in the browser. While it works,
  Pascal's frame loop is paused (`renderPaused` on `Viewer`), the canvas is resized to the video's
  size, and the recorder calls R3F's `advance` with a fixed `1 / fps` step (`renderClock` in
  `render.ts`; the animator's `useFrame` uses it in place of the wall clock), so no frame is dropped.
  Each frame is copied out of the canvas in the task that drew it, and the title card is drawn over
  it. The video starts in the template's look (no curtain); `LookCurtain` stands down meanwhile.
  Anything new that animates must take its time from the frame's delta or `renderClock`, never
  `performance.now()`, or it will not show in a render.
- **Overlays use single-sided node materials** and never raycast: a double-sided node material in
  Pascal's MRT scene pass breaks the WebGPU render context.
