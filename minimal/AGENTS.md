# Drawing viewer template

A standalone web page that shows one published Pascal project as a monochrome line drawing, under
an orthographic camera that turns in quarter steps between four axonometric corners and a plan.
It is [`listing`](../listing) with a different look and navigation: the loading flow, the API
client, access (Open from Pascal, Sign in with Pascal, your own token endpoint), floors, rooms and
openable doors and windows are the same code.

The read API contract, what the baked GLB contains, access, deployment and the shared rules are in
[listing's AGENTS.md](../listing/AGENTS.md); read it before changing how projects are read.

## Layout

| Path | Owns |
| --- | --- |
| `src/pascal/` | The API client and access helpers, byte-identical to `listing/src/pascal/`. No React, no three.js. |
| `src/pascal-react/` | `useViewerSettings`, `SettingsPanel` and its field blocks, byte-identical to `listing/src/pascal-react/`. |
| `src/settings.ts` | This template's viewer settings: the opening view's schema and defaults. |
| `src/useListing.ts` | Loading flow: choose a ready bake or the live graph; poll while baking. |
| `src/App.tsx` | Screens, and the scene's state: floor, room, item, panels, tool; the keyboard map; the panels' insets for framing. |
| `src/spaces.ts` | Floors, rooms (area, size, ceiling, Pascal's room details) and their contents (items and furniture), read from the graph alone, so both renderers list the same. |
| `src/ui/` | The overlay: `SpacesPanel` (title, Spaces button, floors and rooms with search), `Inspector` (a room's or an item's details), `Dock` (the bar, the measure and section strips), `Marks` (pointer tag, room tags, measure marks, toast, shortcut sheet), `tagLayout` (placing room tags without overlap), `icons`, `format`. |
| `src/styles.css` | The overlay's tokens (top of the file) and components, the loader, the status screens. |
| `src/viewer/style.ts` | The look: paper, ink, accent, a tone per surface role, the two lights, and the shared materials. |
| `src/viewer/InkPass.tsx` | Takes over rendering in the baked canvas: a normal and depth pass (meshes in `inkMaterials` with their own material), the scene, then the ink on top. |
| `src/viewer/AxoControls.tsx` | Navigation, for both renderers: orthographic orbit around the vertical, corner snapping, plan, zoom to pointer, ground pan, double-click zoom, framing a selected room. |
| `src/viewer/navigation.ts` | The store the overlay buttons and keys use to drive `AxoControls`, the panels' insets framing avoids, and the opening view (`setOpening`, `currentView`). |
| `src/viewer/roomTags.ts`, `RoomTagProjector.tsx` | The pinned room tags: which rooms the overlay tags, and the canvas side that projects each one's floor point to the screen, for both renderers. |
| `src/viewer/measure.ts`, `MeasureTool.tsx` | The measure tool: its store (points, preview, their screen positions), and the canvas side that picks and snaps points, for both renderers. |
| `src/viewer/Viewer.tsx` | The baked canvas: orthographic camera, camera-relative light, `Model`, `AxoControls`, `InkPass`. |
| `src/viewer/Model.tsx` | Parses the GLB, swaps every material for its role's tone (leaves keep their cutout), floor visibility, hover highlight, the room cutaway, door and window clips. |
| `src/viewer/LiveViewer.tsx`, `liveCapture.ts` | An unbaked project: Pascal's runtime (lazy) builds it on a hidden canvas, `captureLiveScene` copies it shaped like a bake, with the open clips Pascal's pose code makes, and the baked `Viewer` draws the copy. |
| `src/viewer/pascalRules.ts` | Pascal's viewer rules for what hover lands on and what a node is called: copies of `resolveViewerHover` and `nodeDisplayLabel` from `@pascal-app/viewer/ui`. |
| `src/viewer/semantics.ts` | Maps GLB nodes to Pascal identities: floors, rooms and their bounds, walls and what is set in them, which walls hide a room, openables, what hover lights up. |
| `src/viewer/loaders.ts` | GLTFLoader with the meshopt decoder and KTX2 transcoder Pascal's files need. |
| `vite.config.ts` | Build, and the Content-Security-Policy written into `index.html`. |
| `tests/` | Playwright tests against a mocked API (fixtures shared with listing). |

## The look

- **Surfaces.** `drawAsLines` in `Model.tsx` disposes the file's materials and textures and gives
  each mesh the shared `MeshLambertMaterial` for its role (`roleOfKind` in `style.ts`, from the
  nearest Pascal `kind`). See-through materials become glazing and move to `GLAZING_LAYER`, so the
  ink ignores glass and draws what is behind it.
- **Light.** An ambient fill and one directional key that follows the camera (`Lights` in
  `Viewer.tsx`): floors and tops lightest in every view, the two visible wall faces in two tones.
  No shadows, no environment map, no tone mapping.
- **Ink.** `InkPass` renders normals and depth of the opaque scene into a target, renders the
  scene, then composites a full-screen shader. A crease is where neighbouring normals turn by more
  than ~30° (`normalThreshold`); a silhouette is where linear depth has a step (second derivative
  above `depthThreshold`, at least 3 cm or 4 pixels). It needs the orthographic camera: depth is
  linear there, so sloped planes never ink. Lines come in three weights, read from the tag the
  normal pass writes in alpha (`style.ts`): silhouettes and cuts of structure draw on both
  sides of the step (heaviest); objects (`OBJECT_LAYER`, kinds item, door, window and the
  furniture kinds: the normal
  pass draws them with `OBJECT_TAG`) draw their outline on their own side at `STYLE.objectInk`;
  creases draw at `STYLE.creaseInk`, two pixels wide on structure and one, on one side, on objects, fading towards `STYLE.creaseFar` as
  the drawing zooms out (`creaseFadeZoom`), so fine repeating lines don't shimmer. Single-sided
  lines keep thin frames from drawing as two or three parallel strokes. The pass renders at
  least at `STYLE.inkResolution` (2) pixels to the CSS pixel: on a 1x monitor at twice its
  resolution, scaled down by the smoothing pass, or its lines would be one coarse pixel. On a
  software renderer (no GPU: SwiftShader, llvmpipe, as in the tests and CI) it stays at the
  screen's own resolution, since four times the pixels would slow every frame.
  The edge test is per pixel, so it renders into `inkTarget` and a second shader
  smooths it onto the drawing with FXAA (the compact variant) along each line's direction;
  without it, roof hips and other diagonals come out stepped. The surfaces keep the canvas's
  own multisampling. `inkTarget`'s second channel carries the share of each line on the edge of
  the floor pointed at, which the smoothing pass draws in `STYLE.accent`.
  Where lines crowd (foliage, fine clutter), a ring of samples two CSS pixels out finds that most
  neighbouring surfaces turn away, and the ink fades by `STYLE.busyFade` to a grey hatch; creases,
  corners and thin rails against the background keep full weight.
- **Leaves.** A textured surface that is alpha-tested, transparent or double-sided is a cutout:
  `cutoutMaterial` keeps the texture for its alpha only, and `cutoutNormalMaterial` gives the ink
  the same outline. Bakes export leaves opaque but double-sided, hence that last test. Cutouts
  live on `OWN_INK_LAYER` with their normal-pass material in `inkMaterials`, tagged `LEAF_TAG`:
  the ink draws vegetation's silhouette only (`STYLE.leafInk`), never a step from one leaf to
  the next, so shrubs don't turn to black noise.
- **Selection.** Clicking a room (in the drawing or in Spaces) calls `onSelectRoom(id)`; `App`
  keeps it, shows its floor alone and its details, and passes `selectedRoomId` back (with the
  rest of `FocusProps`, shared by both renderers). `Model` then keeps the room's cutaway open whatever
  the pointer does, asks `navigation.focus` to frame `roomBounds`, and fades everything on the
  level that `roomMembers` does not claim (the walls around the room with their doors and
  windows, and every thing whose middle is inside it), except `NEUTRAL_KINDS` (site, level).
  Walls and floors (`Drawn.structure`: slab and zone kinds) run on into the next rooms, so the
  member walls and every floor on the level fade by the room mask instead (see "Room masks").
  The same rays, run against the faded meshes, find whole things in front of the room (trees,
  tall furniture); those are hidden (`Drawn.hidden`: no layers, so neither drawn nor hit).
  Faded meshes lose their shading, not their lines: `ghostMaterial` is the paper, unlit, and
  they write `GHOST_TAG` in the normal pass's alpha, so the ink draws them at `STYLE.ghostInk`
  (about 40%) and the rest of the house stays legible around the room. A floor change or the close button (or Esc) deselects; close frames the
  floor shown (or the building) again. Changing floor eases the camera onto `levelBounds`: the
  floor's walls, slabs and roofs, not the garden around them. A door or window touching the room's outline is one
  of its members, so it can be opened from inside.
- **Site.** The ground (kind `site`) draws on `OWN_INK_LAYER` with `inkNormalMaterial({ soft })`,
  which writes `SOFT_TAG` in alpha: the ink draws its lines at `STYLE.siteInk`, and its edge
  against the paper on the ground's side only, a hairline. Lines the file draws itself (Pascal's
  amber property line is a `Line`) get `hairlineMaterial()`, move to `GLAZING_LAYER` so the
  normal pass doesn't ink them again, and cannot be picked.
- **Floors first.** With every floor shown, the drawing answers in levels: `floorAt` is the
  level of the hit mesh itself (`MeshInfo.levelId`), so a wall names its floor and the roof its
  roof level. That level's meshes (`meshesByLevel`) wash with `tintMaterial` (`STYLE.levelTint`
  of `STYLE.hover`, `Drawn.tint`), the pointer tag names it from Spaces (`PointerHover` kind
  `level`; no area for a level without rooms), and a click calls `onSelectLevel`, showing it
  alone. Esc steps back out. What the site holds (garden, trees) names none.
- **Rooms first.** Once a floor shows alone, until a room is selected, the drawing answers in rooms alone: hover opens a
  room, tints its floor and tags it, and no item lights up or turns the pointer into a hand. Inside the selected
  room (`thingAt` in `Model.tsx`: a hit that is not faded), hover lights the thing and tags it;
  a click picks it (`onSelectThing`) or, if it is openable (a door, a window, a cabinet), opens
  it. What a hit lands on is Pascal's own viewer rule (`highlightAt` with `pascalHover`): the
  nearest Pascal node above the hit, of any kind but the ones a click passes through (site,
  building, level, zone, ceiling, scans, guides) and the room's walls and floor, which answer as
  the room; a roof's part answers as the roof, and a node with a selection proxy as that node.
  So a kitchen names each module (a dishwasher, a sink base, the wall cabinet above it), its
  countertop the run, a microwave on a shelf itself, and a kind Pascal adds later hovers without
  a change here. `pascalRules.ts` holds copies of the SDK's `resolveViewerHover` and
  `nodeDisplayLabel`, not imports: `@pascal-app/viewer/ui` brings Pascal's whole runtime (about
  2 MB of script), which the baked page never loads. Keep them in step with the SDK.
- **Accent.** `syncAccent` in `Model.tsx` paints with `accentMaterial()` what is hovered inside the
  selected room, the items a contents row points at (`pointedThingIds`) and the picked item
  (`selectedThingId`), and takes it off the rest (`highlightAt` in `semantics.ts` decides what
  a hit lands on). It is the only colour in the drawing; keep `--highlight` in `styles.css` in step.
- **Room cutaway.** Hovering a room opens it (`openRoom` in `Model.tsx`). `obstructions` in
  `semantics.ts` casts rays from points spread over the room's floor (at 5 cm and 1 m) towards the
  camera; every wall they cross on the room's level is cut, with the doors and windows set in
  it, at `CUT_PLANE`: the room's floor plus `STYLE.cutHeight`. The floor is `ZoneEntry.floor`,
  measured once by `measureFloors` (the most common top of the slab and zone meshes under the
  room): Pascal places a zone at its level's base, which can sit well below the slab's top
  (half a metre on Cedar & Stone), and cutting there drew the section fill fighting the floor. The room's far walls are never
  crossed, so they stay as a backdrop. A cut mesh draws with `clippedMaterial` (both sides, back
  faces in `STYLE.section`, one mid grey for every cut, so the cut reads as a filled section
  without becoming the darkest thing on screen) and moves to `OWN_INK_LAYER`
  with its clipped normal material. Raycasts ignore clipping, so hits above the cut
  are skipped (`isCutAway`). The room stays open `CLOSE_DELAY_MS` after the pointer leaves it,
  follows the camera once a turn settles (rays are not cast mid-animation), and closes in plan
  and when the floor changes. A Spaces row the pointer is on opens its room the same way
  (`previewRoomId`). A hidden thing has no layers, so the rays test thing meshes directly
  (`mesh.raycast`), or it would come back on the next cast. A mesh's look is one state (`Drawn`: tone, faded, accent, cut,
  hidden) applied by `refresh`; change it there, never by assigning `mesh.material` elsewhere. Normal-pass materials come from `inkNormalMaterial`.
- **Room masks.** `ROOM_MASK` in `style.ts` holds two world outlines as shader uniforms:
  `focus`, the selected room, and `hover`, the room the pointer, a tag or a Spaces row points
  at (never the selected one). `maskedMaterial(surface, 'wall' | 'floor')` patches a surface
  with both: beyond the focus outline it fades like `ghostMaterial` (a floor's top right at the
  outline, anything else `STYLE.focusReach` past it, so walls on the outline keep their outer
  half), and a floor's up-facing parts inside the hover outline take `STYLE.hover` (`inHover`).
  Floors always draw masked and always bring their own normal material, which writes
  `HOVER_TAG` inside the hover outline: the ink colours a line in `STYLE.accent` where that tag
  lies on one side and structure on the other, so the floor pointed at is edged in cobalt where
  it meets walls and cuts; furniture just sits on the fill, and plank joints stay ink. Walls are masked only while
  shared with the selected room (`Drawn.shared`), when `inkNormalMaterial({ masked })` tags
  their faded part for the ink too. Shader patches stack
  through `patched`, so a masked wall can also be cut.
- **Pinned room tags.** With a floor shown alone, `App` tags every room on it through
  `roomTags.setSpots`, each at `labelPoint` (the outline's centroid, or the nearest point inside
  for an L or U), `TAG_HEIGHT` above its floor; the open room's tag is filled in the accent
  (`is-current`). `RoomTagProjector`, inside each canvas with a `locate` for that renderer (the
  GLB's zone and its measured floor), projects them every frame it draws and
  `RoomTags` in `ui/Marks.tsx` renders them as buttons: click opens the room, pointing previews
  it (`previewRoomId`). Hovering a tagged room in the drawing lights its tag instead of adding a
  pointer tag. No tags with every floor shown (the rooms are under the roof) or while measuring.
  Tags never overlap: `placeTags` (`ui/tagLayout.ts`) places them greedily, the open room's
  first, then by area, each on its anchor or one tag up or down; one with no clear spot becomes
  a pin (`is-collapsed`), or nothing (`is-hidden`) where the pin too would overlap. A pin or
  hidden tag opens out on its anchor, over the others, while it or its room is pointed at
  (`is-hot`), without moving the rest. Sizes are measured from the DOM when a tag is open and
  at rest. Rooms under 3 m² are dots until zoomed in far enough that they span 140 CSS pixels
  (`RoomTagProjector` writes the pixels per metre). With a room open, the other tags dim
  (`is-dim`); the open room's always shows (`keep`). Placement is decided on the view as it last
  stood still for 150 ms (`useSettledScreen`): while the camera moves, tags ride their anchors as
  placed instead of flipping every frame, and a tag moving to a new spot slides there (the
  nudge is a CSS transition). Tags have no mark at rest (a row of hollow squares reads as checkboxes); pointed at,
  a tag stays white with an accent border and filled mark, so it doesn't melt into the tinted
  floor under it.
- **Tags.** `PointerTag` in `ui/Marks.tsx`: a white chip above and right of the pointer (left
  near the right edge) with a square mark. Over a room it gives the room and its area (not for
  the room already open); inside the open room, the thing (`thingName`: what Pascal's viewer
  calls it, `pascalLabel`; else its label in the file, or its kind) with a filled accent mark. With every floor shown, it names the
  floor under the pointer with its area. Things and floors show a hand cursor; rooms keep the
  default.
- **Loader.** `Loader` in `App.tsx`: Pascal's three bars outlined in ink, filling in turn, over a
  hairline that follows the download. It replaces the cover image.
- **Live.** An unbaked project draws exactly like a baked one, because it becomes one in the
  browser. `LiveViewer` mounts Pascal's runtime under the loader (`.live-build`, invisible) the
  way Pascal's bake page does: `daylight={false}`, `disablePostFx`, no scene or library
  materials, levels stacked, walls up. Once it reports the scene ready and
  `pendingSceneBuildCount()` has stayed at zero for a few frames, `captureLiveScene`
  (`liveCapture.ts`) copies what it built following Pascal's capture protocol:
  `thumbnail:before-capture` (`wholeWalls`) hands batched nodes their own meshes back, parts
  marked `pascalExport: 'strip'`, off the scene layer (zone fills, overlays), hidden or drawn with
  an invisible material (door and window hit boxes) are left out, lights and batches too, and
  `thumbnail:after-capture` puts the runtime back. Each Pascal node becomes an object named by its
  id with `pascalId`, `kind` and `label` in `userData`, as in a GLB; geometry is copied and
  materials reduced to what `drawAsLines` reads; each part's plain `userData` comes along, since
  Pascal's pose code reads its markers there (`pascalSwingLeaf`, `cabinetPose`,
  `windowExteriorSign`). What opens then gets the clip a bake would carry, `<id>: open`, made by
  Pascal's own code on the copy: a swing door's leaf turns to its marker's `openRotationY`, other
  doors through `poseDoorMovingParts`, windows through `poseWindowMovingParts` (sampled from closed
  to open, as Pascal's exporter samples a clone), and any other kind through its definition's
  `exportAnimation` hook in `nodeRegistry` (cabinets, gates, procedural furniture; looping clips
  are left out). The tracks name parts by uuid, as the SDK's do; `Model` points them at its own
  clone. The runtime then unmounts and the copy goes to `Viewer` as `source` (`Model` takes a
  GLB's bytes or a scene with its clips), where a click plays the clip as on a bake. A scripted
  door (one with a `source`) brings its own clips, which the copy does not carry. Scripted items (`artifact://<sha256>` sources, such as a light
  fitting) load through `configureArtifactStore`, from the project's
  `/api/projects/<id>/artifacts/<sha256>` (a redirect to signed storage, already in the CSP);
  without it they draw as placeholder boxes. That route is Pascal's app's, not the documented
  read API, and its requests carry no viewer token: a private project's scripted items may stay
  placeholders.

## The overlay

Floating chrome after Pascal's viewer design: the title and the **Spaces** button top left,
the details panel top right, one pill bar of controls bottom centre with the active tool's strip
above it, tooltips on the bar's icons, and a shortcut sheet (`?`). On screens under 768 px the
panels become sheets above the bar.

- **Room tags** pin on the rooms of the floor shown; see "Pinned room tags" above.
- **Spaces** (`SpacesPanel`) lists `readSpaces(graph)`: every floor, top first, with its area,
  and its rooms with theirs; a search filters rooms by name. A floor row shows it alone; a room
  row selects it; pointing at a room row opens it in the drawing. The link runs both ways:
  `hotId` (the room or floor pointed at on the drawing, a tag or a row) gives its row the tint.
- **Details** (`Inspector`) shows the selected room (area, the bounding size of its outline as
  "Size", or "Extents" when an L or U shape fills less of it, its ceiling height, Pascal's room
  details when filled in, its contents) or the thing picked in it (an item's catalogue width,
  depth and height times its scale, category and catalogue name; furniture's own width, depth
  and height, none for a run, whose modules make its length). Identical things share a contents row with
  a count; the list shows eight rows, then "Show all"; a row's arrow shows while pointed at, and
  pointing at a row lights its items in the drawing. The floor is named once, in the crumbs,
  which with the close button step back.
- **Contents** are `roomContents`: items and furniture on the room's level whose position lies
  in its outline. A thing in or on another (a plate on a table, a microwave on a shelf, a module
  in a run) is placed through its parent's position and turn (`levelPoint`). Items hung on walls
  have no such position and are not listed.
- **Measure** (`measure.ts`, `MeasureTool.tsx`): while it is on, the tool owns the pointer (the
  model's hover and clicks stand down). A click raycasts the shown scene and snaps to the hit
  face's nearest corner within 12 px; the overlay draws rings, the line and the distance from the
  projected points the canvas writes back every frame.
- **Section** is the floor control: "No cut" or a floor, shown alone without ceilings and roof.
- **Framing beside the panels.** `App` tells `navigation.setInsets` how much of each side the
  panels cover; `frame` in `AxoControls.tsx` fits a box into the rest and moves the target so
  it lands in its middle. Insets are set in a layout effect, before the viewers' effects frame.
  When they change (a panel opens or closes), the last framing runs again in the new space,
  unless the user has moved the camera since (`navigation.release`). Room tags keep off the
  panels too (`panelAreas` in `ui/Marks.tsx`).
- **Keys** live in one listener in `App`: arrows, P, F, S, /, 1–9, M, X, ?, Esc (steps back: tool,
  item, room, panel). They stand down while typing in a field or while the sheet is open.

## The navigation

`AxoControls` wraps drei's `OrbitControls` (with an orthographic camera) and owns the camera pose:

- The polar angle is locked: 55° from vertical in axonometric, almost 0 in plan. Dragging only
  changes the azimuth; letting go eases to the nearest corner (45° + k·90°), or to the nearest side
  in plan so walls run square to the screen.
- Every programmatic move (turn, projection, fit, focus, double-click) sets a goal that `useFrame` eases
  towards; touching the controls cancels it. Each frame's step is capped at a 30 fps frame's: the
  canvas renders on demand, so the first frame after a pause (letting go after holding still)
  sees a long delta, and an uncapped ease would start with a jump. The canvas renders on demand, so the loop
  invalidates only while moving.
- `frame` projects the bounds' corners on the view's axes, fits them in the part of the screen
  the panels leave clear (`navigation.insets`) at `FIT_MARGIN`, and centres them there. Zoom is
  limited to 0.3–16 times the first fit.
- Pan stays on the ground plane (`screenSpacePanning={false}`). Zoom follows the pointer.
- `navigation.focus(box)` frames a box from the current view (a selected room). Double-click
  zooms in twice on the point under the pointer.

To add a view (an elevation, say), add a `Projection` in `navigation.ts`, its polar angle in
`polarOf` and its snapping offset in `snapAzimuth`, then a button in `Dock` (`ui/Dock.tsx`), and
let `OpeningSchema` in `src/settings.ts` accept it.

## Viewer settings

The model, how a manager enters Customize mode (from Pascal or from the viewer's own Customize
tab), the hook, the panel and its field blocks, and how to add a setting are
in [listing's AGENTS.md](../listing/AGENTS.md#viewer-settings). This template's one setting is the
opening view, as navigation knows it, not a free camera:

```json
{ "v": 1, "opening": { "projection": "axonometric", "turns": 1, "zoom": 1.6, "target": [x, y, z] } }
```

`projection` is `axonometric` or `plan`; `turns` (0–3) is the corner (or, in plan, the side) in
quarter turns from the first one; `zoom` is against the fit (1 frames the building, 0.3–16 like
the controls' limits), so it reads the same on any screen; `target` is the point at the centre of
the screen (optional: without it the fit's centre). `App` passes the saved view (a manager's draft)
to `navigation.setOpening` before the drawing first frames; `AxoControls` then opens there instead
of the first fit and releases the framing, so panels opening don't move it. The Customize panel's
**Opening view** section (`src/ui/OpeningSettings.tsx`) shows **Projection** (Axonometric, Plan),
**Turn** (0°, 90°, 180°, 270°) and **Zoom** ("Fits the building" or a factor, with **Fit**), each
saying "Default (…)" until something is set; choosing one also turns the drawing there. **Use
current view** stores `navigation.currentView()` (the view the controls are easing to, with its
centre); **Clear** drops `opening`. An invalid view opens on the first corner, as before. The
Customize pill sits top right (below the title on screens under 1,024 px), and pill and panel sit
under the room inspector, which wins.

## Rules

Everything in [listing's rules](../listing/AGENTS.md#rules) applies, plus:

- **`src/pascal/` stays byte-identical to `listing/src/pascal/`.** CI runs `diff -r` on them.
- **Keep the camera orthographic.** The ink's depth test and `frame` assume it.
- **Do not call `stopPropagation` in the model's pointer handlers.** All meshes share one event
  object, and R3F's `stopPropagation` then drops the hover record when the pointer crosses from
  one mesh to another, so leaving the model never fires `pointerout`. The handlers handle each
  native event once instead.
- **One colour, three roles.** The drawing is monochrome (the site's own amber line included).
  Solid accent marks what is selected: the open room's tag and Spaces row, the picked item, what
  the pointer is on inside the open room, and the measure. The pale tint (`STYLE.hover`,
  `--highlight-soft`) marks only what is pointed at: a room's floor (edged in accent), a level's
  wash, a Spaces row. The floor shown is neutral (`--tint-strong`, bold, an ink mark). Controls
  that are on are ink. Copy in sentence case.
- **Overlay facts come from the graph.** Show only what Pascal stores (names, areas, outlines,
  catalogue sizes, room details); never invent sample values.

## Before you finish

```bash
npm run typecheck
npm run build
npx playwright install chromium   # once
npm run test:e2e
```

The tests mock the scene read and the GLB download, so they need no network and no Pascal account.
They render with software WebGL.
