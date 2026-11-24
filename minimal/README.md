# Pascal drawing viewer

A published [Pascal](https://editor.pascal.app) project as a line drawing: flat near-white
surfaces, black ink on every edge, no materials or textures, and one accent colour for what the
pointer is on and the room that is open. The camera is orthographic, like an architect's axonometric, so parallel lines stay
parallel.

It is a template: a standalone Vite, React and three.js project, meant to be forked and restyled.
It is built from [`listing`](../listing) and keeps everything listing does (floors, room names and
areas, doors and windows that open, Open from Pascal and Sign in with Pascal); it changes how the
project looks and how you move around it.

```bash
npm install
npm run dev
# open http://localhost:5173/?project=<project id>
```

The project must be published; direct anonymous links require it to be public.

## Moving around

The drawing always faces you from a corner, the way an axonometric is drawn, instead of orbiting
freely. The overlay floats over it: the title and **Spaces** top left, the details of what you
picked on the right, and one bar of controls at the bottom.

| Do | To |
| --- | --- |
| Drag, or ← → | Turn the building. Letting go settles on the nearest of the four corners. |
| **Axo** / **Plan**, or P | Switch between the axonometric (35° above the horizon) and a plan straight down. |
| Scroll or pinch | Zoom to the pointer. |
| Right-drag or two fingers | Pan along the ground. |
| Double-click | Zoom in on the point. |
| Frame button, or F | Frame the whole building again. |
| **Spaces**, or S (/ to search) | Every floor with its rooms and their areas, top floor first. Pick a floor to show it alone; pick a room to open it. Pointing at a room opens it in the drawing. |
| **Section**, or X; or 1, 2, 3… | Cut above a floor: it shows alone, without its ceilings and roof, so its rooms read from above. 1 is every floor, then each floor from the top. |
| Every floor shown | The drawing answers in levels: pointing at a wall washes its floor pale blue and names it with its area, pointing at the roof does the same for the roof level; click to show that level alone. Esc goes back to every floor. |
| A floor shown alone | Every room on it carries a tag with its name and area, pinned 90 cm above the middle of its floor. Tags never overlap: the open room's and the larger rooms' place first, nudged a tag up or down if they must; a room under 3 m² shows a dot until you zoom in, as does a room with no clear spot, or nothing where even that would crowd, and its tag opens out when you point at the dot or the room. Tags carry no mark at rest and keep off the panels; with a room open, the others dim. Click a tag to open the room; point at it to see into it. With a room open, its tag turns blue and the other rooms keep theirs, so you can move to one. |
| Hover a room | See into it: its floor takes the pale blue tint, edged in a thin cobalt line, and the walls between it and you are cut 30 cm above its floor, with a grey section fill. Its tag gets a cobalt border and mark, and its row in Spaces takes the same tint. Until a room is open, the drawing answers in rooms alone. |
| Click a room | Open it: the view frames it beside its details, its floor shows alone, everything else loses its shading and keeps light lines (walls and slabs it shares with other rooms fade past its outline) and whatever stands in front of it (a tree, a cabinet) is hidden. Its details list its area, size (extents for an L-shaped room), ceiling height, what Pascal records about it, and its contents, eight at first; pointing at a row lights the item. |
| Inside an open room | Hovering anything in it lights it in the accent with its name, by the rules Pascal's own viewer uses: an item, a piece of furniture (a kitchen module, a cabinet run, a shelf), a door, a window, a column or a stair; the room's walls and floor answer as the room. Click one (or a row of the contents list) for its size and category; click a door, a window or a cabinet to open or close it. |
| **Measure**, or M | Click two points on the drawing for the distance between them; points snap to the nearest corner. |
| Esc | Step back one level: the tool, the item, the room, the spaces panel, the floor. |
| ? | The shortcut sheet. |

On a phone, the panels become sheets above the bar.

## How it draws

Baked projects (the GLB) are drawn by this template: every material is replaced by a flat tone for
its role (wall, floor, roof, joinery, furniture, glazing), lit by a soft light that turns with the
camera, and a screen-space ink pass draws a line wherever the surface turns sharply or the depth
steps, in three weights: silhouettes and cuts heaviest, furniture, doors and windows lighter,
creases inside a surface lightest (and lighter still zoomed out). Trees and shrubs draw their
silhouette only. The lines render at twice the screen's resolution on 1x monitors and are
smoothed by FXAA, so sloping lines (roof hips, diagonals) draw clean on any screen. The site recedes: its
edge and Pascal's property line are a light hairline. Leaves keep their texture's alpha, so each leaf keeps its outline; where lines crowd, as in
foliage, the ink fades to a grey hatch. An unbaked project is built by Pascal's runtime on a
hidden canvas, the way Pascal's own bake page does, then copied and drawn exactly like a baked
one. Doors, windows and cabinets open there too: Pascal's own pose code makes the same open
animations a bake carries.

While a project loads, the page shows Pascal's mark, three stepped bars, drawn in the same ink.

The overlay's tokens (paper, ink, accent, radii, motion) are at the top of
[`src/styles.css`](src/styles.css); its components are in [`src/ui/`](src/ui).

The whole look is in [`src/viewer/style.ts`](src/viewer/style.ts): the paper, the ink, the accent,
the tone of each surface role and the two lights. Change those to restyle.

| Variable | Meaning |
| --- | --- |
| `VITE_PASCAL_BASE_URL` | Pascal instance, default `https://editor.pascal.app`. |
| `VITE_PASCAL_SOURCE` | `auto` (default): ready bake or live rebuild; `baked`: require a bake; `live`: always rebuild. |
| `VITE_PASCAL_PROJECT_ID` | Project shown when the address has no `?project=`. |
| `VITE_PASCAL_TOKEN_URL` | Your own token endpoint for private projects; see [listing](../listing/AGENTS.md#private-projects-with-your-own-login). |

| Script | Does |
| --- | --- |
| `npm run dev` | Development server. |
| `npm run build` | Static site in `dist/`, ready for Vercel, Cloudflare Pages, Pascal or any static host. |
| `npm run typecheck` | `tsc --noEmit`. |
| `npm run test:e2e` | Builds, then runs the Playwright tests against a mocked API. |

## Deploy, private projects and Sign in with Pascal

They work exactly as in `listing`: see [Deploy to Pascal](../listing/README.md#deploy-to-pascal),
[Sign in with Pascal](../listing/README.md#sign-in-with-pascal) and
[listing's AGENTS.md](../listing/AGENTS.md) for the API contract, Open from Pascal and the rules.

[`AGENTS.md`](AGENTS.md) explains this template's files and how to change the look and the
navigation.

MIT licensed, like the rest of this repository.
