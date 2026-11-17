# Pascal showcase viewer

A project page with the look and controls of Pascal's `/next` demo: a radial dial on the left for
views and time of day, sound and full screen at the top right, and a bottom bar on phones. It renders with the same stack as
the [`pascal`](../pascal) template, on the public `@pascal-app/core`, `@pascal-app/viewer` and
`@pascal-app/nodes` packages, and loads projects exactly like it.

It needs those packages at **`1.1.6`** or later: the section cut, the
sun-height time targets, X-ray families, touch walking, `roomCounts` and the interaction hooks
(time transitions, camera bindings and taps, callout and outline hooks) arrived there.

It is a template: a standalone project, meant to be forked and restyled. It does not use Pascal's
editor package or Next.js.

```bash
npm install
npm run dev
# open http://localhost:5173/?project=<project id>
```

The project must be published; direct anonymous links require it to be public. Private projects
open from Pascal, from a share link, or with Sign in with Pascal.

## What is on screen

| Control | Does |
| --- | --- |
| Dial, outer ring | Exterior (floors stacked, walls up), Exploded (floors apart), Cut view (a section plane), X-ray (one family of parts at a time), Walkthrough (first person). |
| Cut view controls | Cut from the top, side or front, show the other side, and a slider across the model. |
| X-ray families | Fanned beside the dial (a carousel on phones): walls, floors, roofs, doors and windows, and the other families the project has. |
| Dial, inner ring | Night, Dawn, Day, Dusk, on the viewer's sun for the site's location; the sky glides there in 1 s, the short way round the clock. Night and Day are the `night` and `midday` presets; Dusk is blue hour, the sun 5.5° below the horizon with the lamps on; Dawn a low rising sun at 3° (`MOOD_TARGETS` in `src/showcase/modes.ts`). |
| Dial, centre | Reset view: the opening mode and time of day, and the building framed again. |
| Help (under the dial) | The mouse, touch and walking bindings. |
| Orbit | Left drag rotates, right drag (or Shift and drag) pans, the wheel or a pinch zooms; one finger rotates, two fingers zoom and pan. Only a click or tap (under 7 px and 350 ms) selects. |
| Discovery | Pointing at a room or an outdoor area (a porch, deck or patio) names it with its area and washes it white; a click on a door, window or switchable item pins its controls where it was clicked. Touch: a tap does both. |
| Top right | Sound on or off (the viewer's audio settings) and full screen. |
| Walkthrough | `/next`'s walk: 1.8 m/s, 2.8 m/s with Shift. A dot in the middle; what it rests on is named beside it, with the action button (Open, Close, Turn on, Turn off, or `E`) in reach, or "Come a little closer" when it is seen but too far (up to 16 m). Shutters (`F`) beside it when a baked window with shutters is in reach, Close (`T`) when a live door, window or mechanism is. Jump (`Space`) and Return to view (`Esc`). By touch the buttons act on press; there is no crouch button, as on `/next`. |
| Phone | A bottom bar with the views, a time-of-day row with Reset, and Help. Walkthrough uses on-screen thumb controls when the phone is used by touch. |
| Intro | On arrival, a 4.5 s reveal: a section plane rises through the model while the camera turns around it, ending on a front three-quarter view. "Skip intro" ends it; reduced motion and `?camera=` links skip it. The loader stays until the first view is drawn, so the intro starts on the site with the house not yet revealed. |
| Arrival view | The intro's end, the arrival without it and Reset view face the house's front from 35° to one side, at 25° elevation. The front is the saved camera, else the spawn point, else the main entrance, else the façade with the most openings, else the longest (`src/showcase/front.ts`). |

Projects open on exploded floors at dusk, like `/next`; a single-floor project opens on Exterior.
Unlike `pascal`, which mounts the viewer's room pills, hover pill, outline and selection rules, the
showcase decides what a pointer does itself (`src/showcase/discovery/`), with the viewer drawing.

### Capability flags

`src/features.ts` gates the controls that need viewer support. All four are on; turn one off to
build against an older viewer.

| Flag | Gates | Needs from the packages |
| --- | --- | --- |
| `cutView` | The Cut view mode and its controls (`src/showcase/CutSlider.tsx`). | `useViewer` section state (`sectionEnabled`, `sectionAxis`, `sectionPosition`, `sectionFlipped`), `sectionBounds` |
| `intro` | The arrival reveal (`src/showcase/useIntro.ts`, `IntroSlot.tsx`). | The same section state and `sectionBounds` |
| `xray` | The X-ray mode and its family picker; hidden on projects with fewer than two families. | `useViewer.xrayFamily`, `sceneFamilies` |
| `touchWalk` | Walkthrough by touch. Off: touch devices don't see Walkthrough. | `useViewer.walkthroughInputMode`, `WalkthroughTouchControls` |

Dawn and Dusk use sun-height targets (`transitionTimeOfDay({ elevation, side })`, `timeTargetMinutes`) and, on a bake, `setDaylightSite`. The behaviour layer is not flagged and needs: `transitionTimeOfDay`;
`ViewerCameraControls` `mouseButtons`, `touches`, `limits` and `tap`; `GlbScene` `outlineSync`,
`renderCallout` and the hit fields on `GlbPickEvent`; `InteractiveSystem` `renderCallout`;
`filterSectionHits`, `filterXrayHits`, `isSectionObject`, `heldReasons`; the walkthrough's
`speeds` and `seeDistance` on both controllers, `useFirstPersonHud` `seenInteract` and
`createWalkthroughInput`; `sectionShadows` (default `'full'`).

The dial lays itself out for three, four or five views. Wire a mode's store calls in
`src/showcase/viewer-actions.ts`.

## Settings and URL flags

The same as [`pascal`](../pascal/README.md#choosing-a-project): `VITE_PASCAL_BASE_URL`,
`VITE_PASCAL_ASSETS_URL`, `VITE_PASCAL_PROJECT_ID`, `VITE_PASCAL_SOURCE`,
`VITE_PASCAL_PLUGIN_TREES` and `VITE_PASCAL_POLL_BAKE`, all read at build time and public. See
`.env.example`.

| Flag | Does |
| --- | --- |
| `embed=1` | For iframes: posts `{ type: 'pascal:viewer-ready', projectId }` to the parent frame once the scene is on screen. |
| `hideHeader=1` | Accepted for compatibility; there is no header to hide. |
| `hideBottomBar=1` | Hides the dial (or the phone bar). |
| `camera=px,py,pz,tx,ty,tz[,fov]` | Opens on this camera; `camera=saved` uses the camera saved on the scene. |

`main[data-scene-ready="true"]` is set once the loader lifts; `.sc-chrome` carries `data-mode`,
`data-mood`, `data-level-mode` and `data-time-of-day` for tests and styling.

## Customise

- **Chrome**: `src/showcase/`. `ShowcaseOverlay.tsx` composes it; `Dial.tsx`, `MobileControls.tsx`,
  `TopBar.tsx`, `InteractionHelp.tsx` and `Loader.tsx` are the parts; `showcase.css` styles them
  (prefix `sc-`).
- **What a control does**: `src/showcase/viewer-actions.ts`, the only place the chrome writes to the
  viewer store. The mode and mood lists are data in `src/showcase/modes.ts`.
- **A title or facts over the scene**: there are none. A host that wants them overlays its own on
  the embed; `roomCounts` from `@pascal-app/core` gives the rooms, bedrooms and modelled area
  from the published graph.
- **Discovery**: `src/showcase/discovery/`. `membership.ts` says which room or area a node belongs
  to (pure, unit tested: change it to group things differently); `DiscoveryScene.tsx` holds the
  timings (the next frame, while the pointer moves too; camera rest thresholds) and the rules (what reveals what, what a click pins);
  `wash.ts` the white veil (opacity, fades, and `WASH_GAIN`, its brightness against the exposure); `DiscoveryOverlay.tsx` and the `sc-zone` rules in
  `showcase.css` the label and the item callout; `interactive.ts` which items pin a callout.
- **Orbit**: `src/showcase/ShowcaseCamera.tsx` (bindings, tap thresholds, limits).
- **Time of day**: `MOOD_TARGETS` in `src/showcase/modes.ts` (the preset or sun height per mood),
  `src/showcase/time.ts` (glide length and easing).
- **Walkthrough HUD**: `src/showcase/WalkHud.tsx` (speeds, see distance, copy) and the `sc-walk` rules.
- **Sounds**: `src/showcase/sounds.ts` (which moments tick, on the package's cues).
- **Type**: DM Sans, self-hosted in `public/fonts/` (SIL Open Font License, licence file next to
  it), set in `src/styles.css`. The page is always dark.
- **Scene and loading**: `src/viewer/ProjectViewer.tsx` and `src/viewer/screens.tsx`, as in `pascal`.
- Keep copy in sentence case and buttons fully rounded.

## Scripts

| Script | Does |
| --- | --- |
| `npm run dev` | Development server. |
| `npm run build` | Static site in `dist/`, with the Content-Security-Policy and the three.js decoders. |
| `npm run typecheck` | TypeScript check. |
| `npm run test:unit` | Unit tests of the pure modules (modes, membership, framing, the house's front, the intro sequence); no browser. |
| `npm run check` | Checks `dist/` against the hosting limits and the package boundary. |
| `npm run test:e2e` | Builds a test build, then runs the Playwright tests against a mocked API. |
| `npm run deploy:dry` | Dry run of `pascal viewer deploy` with `@pascal-app/cli@1.1.6`; needs `VIEWER_ID`. |

`npm run test:e2e` needs `npx playwright install chromium` once, and leaves a test build in
`dist/`: run `npm run build` again before `check` or a deploy. Deploying to Pascal works as in
[`pascal`](../pascal/README.md#deploy-to-pascal).

## Known gaps

- No 2D plan, floor picker or breadcrumb: the chrome is 3D only, like `/next`.
- Framing fits the building and leaves the yard (trees, fences, pools) free to run off screen.
- Discovery knows rooms and outdoor areas only: the yard, roof, solar and site parts `/next` names
  are not rooms in Pascal's graph, so pointing at them shows nothing. The label's ink is dark only
  at Day (no backdrop sampling).
- The gaps listed in [`pascal`](../pascal/README.md#known-gaps) apply too.

The `/next` interface code and its inline icons are Pascal's, published here under this
repository's MIT licence. [`AGENTS.md`](AGENTS.md) covers the rules to keep and where things live.
