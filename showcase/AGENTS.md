# Pascal showcase template

A static Vite and React app with the look of Pascal's `/next` demo (radial dial, top bar, phone
bottom bar), rendered by the same stack as the [`pascal`](../pascal) template on the public
`@pascal-app/core`, `@pascal-app/viewer` and `@pascal-app/nodes` packages at `1.1.6` or
later (fill in at release; until then `package.json` points at local builds with `file:`).
Loading, access, runtime and plugins are `pascal`'s, unchanged; only the chrome differs.

This file tells you (or your agent) where things are and which rules to keep. [`README.md`](README.md)
covers what is on screen, flags and scripts. The read API contract and the access rules are in
[listing's AGENTS.md](../listing/AGENTS.md); `pascal`'s [AGENTS.md](../pascal/AGENTS.md) explains
the loading flow and the runtime, which this template shares.

## Layout

| Path | Owns |
| --- | --- |
| `src/features.ts` | Capability flags: `cutView`, `xray`, `touchWalk`, `intro` (all on; the README lists what each needs from the packages). Gated controls render only when on. |
| `src/showcase/ShowcaseOverlay.tsx` | The chrome over the scene: layout (dial or phone bar), menus, sound, full screen, reset. |
| `src/showcase/Dial.tsx` | The radial dial and its hover labels; lays out any number of views. |
| `src/showcase/MobileControls.tsx`, `TopBar.tsx`, `InteractionHelp.tsx`, `Loader.tsx` | Phone bar, sound and full screen, the help dialog, the loader. |
| `src/showcase/CutSlider.tsx`, `IntroSlot.tsx`, `useIntro.ts` | The Cut view controls; the intro's Skip button and its once-per-page sequencing. |
| `src/showcase/families.ts`, `touch.ts` | X-ray family labels and the opening family; whether the visitor walks by touch (from real input). |
| `src/showcase/modes.ts`, `intro.ts`, `framing.ts`, `front.ts`, `coalesce.ts` | Pure, unit-tested: modes and moods over the store, cut slider maths, the intro's clock-driven sequence and camera orbit, the house's front and the arrival heading, the once-per-frame scrub writer. |
| `src/showcase/presentation.ts` | Holds the loader until the first view is staged and drawn; the instant camera placement the arrival and the intro use behind it, and the orbit camera's pose (`cameraPose`). |
| `src/showcase/opening.ts` | Pure, unit-tested: viewer settings (the opening view's schema, per-field fallbacks) and `resolveOpening` over the default view. |
| `src/showcase/viewer-actions.ts` | Every store call the chrome makes (`setLevelMode`, `setTimeOfDay`, walkthrough, framing). |
| `src/showcase/WalkHud.tsx` | The walkthrough HUD and its numbers (speeds, see distance) and copy, `/next`'s; the action, Shutters, Close and Jump buttons. |
| `src/showcase/sounds.ts` | `/next`'s interface sounds on the package cues: a hover tick per control entered and per room reached, a click per press and per callout pinned, a soft fall on dismiss; muted with the sound toggle, rate-limited by `playSound`, silent before the first gesture. |
| `src/showcase/time.ts` | The time-of-day glide (`transitionTimeOfDay`, 1 s, `cubic-bezier(.4,0,.2,1)`) and the dial's target while it runs; `setMoodNow` (the same targets, `durationMs: 0`) for the opening view, Reset view, the intro's end and reduced motion; `followSiteLocation`, which re-resolves a parked sun height once the site's location is known. |
| `src/showcase/ShowcaseCamera.tsx` | `ViewerCameraControls` with /next's bindings, `tap`, and limits (min 1 m, max `max(300 × max(1, 1.06/aspect), 4 × model radius)`, polar ≤ .47π); Shift/Ctrl/⌘ + left drag pans. |
| `src/showcase/discovery/` | The template's own interaction layer (replaces `ViewerRooms`, `ViewerHoverLabel`, `ViewerSelectionManager` and the outline): `membership.ts` (pure, unit tested), `DiscoveryScene.tsx` (inputs, state machine, washes, label placement each frame), `wash.ts`, `placement.ts`, `DiscoveryOverlay.tsx` (label and callout DOM), `interactive.ts`, `state.ts`. |
| `src/showcase/showcase.css`, `icons.tsx`, `gesture-icons.tsx` | Styles (prefix `sc-`) and inline SVG icons, ported from `/next`. |
| `src/viewer/ProjectViewer.tsx` | The assembly, as in `pascal`, with `ShowcaseOverlay` in place of the header and controls bar. |
| `src/viewer/screens.tsx` | Loading, access, Sign in with Pascal and error screens in the loader's look. |
| `src/main.tsx`, `config.ts`, `App.tsx`, `useProjectScene.ts`, `src/runtime/`, `src/pascal/` | As in `pascal`. |
| `src/pascal-react/` | `useViewerSettings` and `SettingsBar`, byte-identical to `listing/src/pascal-react/`. |
| `public/` | Sounds (`audios/sfx/`) and DM Sans with its licence (`fonts/`). |
| `tests/` | Playwright tests against a mocked API; `tests/unit/` runs without a browser. |

## Rules

- **No `@pascal-app/editor`, no `next`.** `vite.config.ts` fails the build on either import, and
  `npm run check` fails if either is bundled, installed or in `package-lock.json`.
- **`src/pascal/` stays byte-identical to `listing/src/pascal/`.** CI runs
  `diff -r listing/src/pascal showcase/src/pascal`. Change all copies together, and keep React and
  three.js out of it.
- **Pascal versions move in lockstep.** `@pascal-app/core`, `@pascal-app/viewer` and
  `@pascal-app/nodes` stay on the same exact version (at least `1.1.6`: the four flags in
  `src/features.ts` need it), and the `@pascal-app/cli` version in the `deploy:dry` script moves
  with them.
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
- **The chrome writes to the viewer only through `src/showcase/viewer-actions.ts`**, and reads the
  store for what is active: the dial shows the store's state, never a copy of it.
- **Gate what the viewer can't do yet** in `src/features.ts`. Don't show a mode that does nothing.
- **No title, facts or owner over the scene.** The embedding page overlays what it wants
  (`roomCounts` from `@pascal-app/core` for rooms, bedrooms and area).
- **Assets stay ours.** No recorded sounds, house models, map code or Google assets from `/next`;
  fonts are self-hosted (the CSP allows no font CDN).
- **Use `@pascal-app/viewer/ui` components** in the scene and override theme tokens rather than
  copying them. Sentence case for copy, fully rounded buttons.

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
take minutes without a GPU. Run `npm run test:e2e` on your machine before opening a pull request.
`npm run test:e2e` builds with `--mode runtime-test` and serves that build on `PASCAL_TEST_PORT`
(default 4180), with the scene read, storage and external assets mocked.

## The chrome

`ProjectViewer` sets the opening view (`applyOpeningView`: exploded at dusk, or Exterior for a
single floor, or the house whole when the intro is about to play) before the first frame, and
mounts `ShowcaseOverlay` under the opaque loader once the scene is drawn. The loader holds until
the first view is staged and drawn (`presentation.ts`): the arrival framing, the intro's first
pose (house hidden by the section) or a `?camera=` pose is placed with an instant
`setLookAt(..., false)`, and the loader fades only two rendered frames later; the intro's clock
starts after that. `index.html` paints the page dark before any CSS loads. The first visible frame
is therefore the loader, then the site with the house unrevealed or the settled view, never the
default camera or a white page. On a bake it also gives the sun the site's north
and location (`shareDaylightSite` → `setDaylightSite`), since a bake never loads the graph into
the scene store.

- Modes: Exterior is `setLevelMode('stacked')`, walls up, walkthrough off, selection cleared;
  Exploded is `setLevelMode('exploded')`; Walkthrough stacks the floors, then
  `setWalkthroughMovement('walk')` and `setWalkthroughMode(true)`, using the walkthrough
  controllers and HUDs the assembly mounts.
- Cut view assembles the house (stacked, walls up) and sets `setSectionAxis('y')`,
  `setSectionFlipped(false)`, `setSectionPosition` 1.2 m above the lowest floor (core's
  `getLevelElevations`, clamped inside `sectionBounds`) and `setSectionEnabled(true)`. The slider
  maps 0..1 across `sectionBounds` on the axis with a 2% margin, written once per frame. Any other
  mode, and Reset view, turns the section off and puts back the presentation the cut replaced; a
  walk keeps it (the viewer lifts it while walking) so the Cut view is back after the walk. The
  removed part still casts its shadows (the viewer's default `sectionShadows: 'full'`), so the
  opened rooms keep the light they have with the roof on; `setSectionShadows('cut')` is the old
  sunlit look.
- X-ray assembles the house like the Cut view and sets `setXrayFamily` to the first of walls,
  structure or floors the project has (`sceneFamilies` of the published graph, on live and baked
  scenes alike); the fan or carousel picks another. Cut view and X-ray turn each other off; any
  other mode and Reset view call `setXrayFamily(null)` and put back the presentation. A walk ends
  X-ray. With fewer than two families the mode is hidden.
- Walkthrough sets `setWalkthroughInputMode('touch' | 'desktop')` from the last real pointer
  (`touch.ts`) before `setWalkthroughMode(true)`. Both controllers get `/next`'s speeds and see
  distance (`WALK_SPEEDS` 1.8 / 2.8 m/s with Shift, `SEE_DISTANCE` 16 m, in `WalkHud.tsx`); reach
  stays the package's (2.5 m live, 3 m baked). `WalkHud` replaces the stock HUD on both inputs: our
  centre dot (with `/next`'s ready halo when a target is in reach), the target's name beside it
  (`useFirstPersonHud` `interact`, or `seenInteract` with "Come a little closer"), the action
  (Open / Close / Turn on / Turn off, `E`) and Jump (`Space`) buttons bottom right, Return to view
  (`Esc`) top centre; keycaps hide on touch. Shutters (`F`, while `shuttersInView`: baked only)
  and Close (`T`, while `canClose`: live only) join the action button when the package offers
  them; no crouch button, as on `/next`. The package's own in-canvas shutters prompt is hidden
  (`showcase.css`) since the Shutters button carries its key. `tests/walk-hud.spec.ts` drives the
  HUD store through a harness page (`tests/fixtures/walk-hud.html`). A click on a button presses its key (the controllers
  listen for keys with a keyboard); on touch the buttons act on press through
  `createWalkthroughInput()`. The dial and top bar stay while walking with a keyboard, as on
  `/next`; by touch the chrome hides and the package's stick and look areas take the screen
  (its own buttons are hidden for `WalkHud`'s). A walk that ends puts a non-touch device back to
  desktop input.
- Framing (`framing.ts`): points on the drawn building (the corners of each part's own box, per
  floor, without the yard's items, fences and plugin parts) are placed as the default view draws
  them (Exploded lifts each floor) and fitted at 25° elevation from the arrival heading into the
  screen area the chrome leaves free (`screenSafeArea`), centred there, reaching 96% of it. The
  arrival (after the intro, or at once without it), Reset view and the intro's end use it; a
  `?camera=` link keeps its camera.
- The arrival heading (`front.ts`, `arrivalAzimuth` in `viewer-actions.ts`) is a front
  three-quarter view: the front is the saved camera's heading, else the direction from the
  footprint to the spawn point, else the main entrance (an exterior door, double or widest
  first, garage doors excluded), else the façade with the most openings, else the longest façade;
  the camera sits 35° off that normal on the side with more wall to show. With no walls it falls
  back to 45°.
- Moods (`MOOD_TARGETS`, `modes.ts`): Night and Day are the `night` and `midday` presets; Dusk is
  `{ elevation: -5.5, side: 'setting' }` and Dawn `{ elevation: 3, side: 'rising' }`, matched to
  `/next` by measurement (frame brightness against Day, lamps, sky). The viewer switches lamps on
  below −2° and fades them in fully by −5°, so Dusk has them on at full strength, far from the
  switch; Dawn has them off. A sun height rests as an explicit minute in the store (`moodOf` matches
  it through `timeTargetMinutes`); the opening view is set before the site's location is known
  (a bake shares it, a live graph mounts it), so `followSiteLocation` moves a parked height to the
  site's minute when it arrives, unless the time was changed since.
- The intro (`useIntro`) plays once per page load when the scene is on screen: a Y section rising
  through `sectionBounds` while the camera orbits 35° at 25° elevation, ending on the arrival
  heading, sent as `camera-controls:frame` poses. Pointer or wheel input on the canvas stops the orbit; it ends
  with the section off and the default view.
- Reset view applies the opening view and the settled framing (`frameSettled`).
- Sound toggles `useAudioSettings().muted`; the viewer's own sounds play, from `public/audios/sfx`.

## Viewer settings

The model, how a manager enters Customize mode, the hook and the bar, and how to add a setting are
in [listing's AGENTS.md](../listing/AGENTS.md#viewer-settings). This template's one setting is the
opening view, the state the page settles into after its intro:

```json
{ "v": 1, "opening": { "camera": { "position": [x, y, z], "target": [x, y, z] }, "time": "dusk", "mode": "exploded" } }
```

- `time` is a mood (`night`, `dawn`, `day`, `dusk`), `mode` one of `exterior`, `exploded`, `cut`,
  `xray`. Walkthrough is never saved: nobody arrives walking. Each field falls back on its own
  (`opening.ts`): no camera frames the house as before, no time is Dusk, an unknown mode or one
  this page does not offer (`availableModes`) is the default one.
- `ProjectViewer` resolves the saved view (a manager's draft) once, as the scene opens, into an
  `OpeningView` (`resolveOpening`), and hands it to `applyOpeningView` (mood and mode before the
  first frame; the Cut view and X-ray wait for the model's bounds, `settleOpeningMode`) and to the
  chrome. The intro's orbit ends on the saved camera's heading, and `finishIntro` applies the mode,
  mood and camera; without the intro the camera is placed at once behind the loader. Reset view
  returns to the opening view as it stands (a manager's draft included).
- A camera in the link (`?camera=`) still wins over the saved camera; the saved time and mode
  apply with it.
- **Set current view as opening view** stores the orbit camera (`cameraPose`), the mood the sky is
  on or gliding to, and the mode (`modeOf`); it is disabled while walking, when the orbit controls
  are unmounted. **Reset** drops `opening`. The Cut view's plane and X-ray's family are not saved:
  they open where they always do.
- The bar sits top centre, under the sound and full screen buttons on screens under 760 px, in
  the chrome's colours (`showcase.css`).

## Discovery

The viewer draws; the template decides what a pointer does. The assembly mounts no `ViewerRooms`,
`ViewerHoverLabel` or `ViewerSelectionManager`, keeps `showZones` off, passes `outlineSync={false}`
to `GlbScene` and leaves `outliner` empty, and gives both callout hooks (`InteractiveSystem` and
`GlbScene` `renderCallout`) the template's `renderCallout`.

- Inputs: the live scene through the node event bus (`node:move`, `node:enter`, `node:click`;
  site, building and level events pass so the element under the pointer answers), the bake through
  `GlbScene onPick` (`reportBakedPick`, with `worldPosition`, `normal`, `pointerType`). Section and
  X-ray filtering use the viewer's `filterSectionHits` / `filterXrayHits`. Clicks arrive only for
  taps: `ShowcaseCamera` passes `tap: { maxTravelPx: 7, maxDurationMs: 350 }`.
- Rules: runs in every mode but Walkthrough, never during the intro (`useDiscovery.blocked`). Hover
  commits on the next frame, while the pointer moves too (measured against `/next`, which
  names rooms as the pointer sweeps); visible camera motion hides what is unpinned (motion under
  2 mm and .0004 per frame counts as rest, so the controls' damping tail does not hold it back) and
  R3F's `events.update()` re-samples 40 ms after it stops. A click on an interactive item
  (doors, windows, `buildGlbInteractiveItems`) selects it, so the package builds its callout and
  actions; any other click dismisses. Touch has no hover: a tap reveals the room or pins the item.
- Membership (`membership.ts`): a zone's `boundaryWallIds` / `boundarySeparatorIds`, slabs'
  `zoneIds` / `associatedZoneIds` / `floor.sourceSlabId`, `ceiling.zoneId`, porch parts
  (`metadata.porchOf`, core's `porchPartOf`), then hosts (a door's wall, a lamp's ceiling). Several
  linked rooms are told apart by the hit pushed .35 m along its face normal (front first); nodes
  with no link are placed by the room outline they fall in (items, and walls of rooms drawn without
  boundaries). Roofs and the site reveal nothing.
- Wash (`wash.ts`): separate meshes with a white `MeshBasicMaterial` (.11, depth-tested, no depth
  write, polygon offset −3/−3, not tone-mapped, render order 30, not raycast) inside a
  `SectionGroup`, following their source's world matrix each frame; rooms get their outline 3.5 cm
  over the floor (shown with floors only in X-ray), areas their own floor plate and porch posts and
  beams (all faces, skipping X-ray-held meshes). 120 ms in, 70 ms out, `1−(1−t)³`. The veil is
  drawn with the scene, before the viewer's exposure and grade, so its white follows the exposure
  each frame (`washGain`: `√exposure` × 1.25 for floors, × .7 for an area's parts), measured to lift
  a surface as far towards white as `/next`'s does at Night, Dusk and Day.
- Label and callout: template DOM over the canvas, written each frame (no React render): dot,
  leader `max(copy + 12, clamp(.12 × height, 64, 104))`, copy 12 px beside it, flipped to stay 16 px
  inside and 8 px clear of the chrome, hidden off screen. Rooms anchor at their outline's centre
  5 cm over the floor; areas at the top centre of their parts (lowered to a top cut); a pinned item
  at the clicked point. Day uses the dark-on-light ink.
- Development and `runtime-test` builds expose `window.__discovery` for the browser checks.

To add a mode: add it to `MODES` in `modes.ts` (with a flag if it needs viewer support), give it
store calls in `applyMode`, and make `modeOf` recognise it.
