# Listing viewer template

A standalone web page that shows one published Pascal project in 3D: a baked 3D file (GLB) under
studio light, a floors control, room names and areas on hover, and doors and windows that open on
click. Unbaked projects rebuild live from the published graph. It reads Pascal's published scene
API, anonymously or with a short-lived viewer credential. The live path uses the public
`@pascal-app/core`, `@pascal-app/viewer` and `@pascal-app/nodes` packages at `^1.1.0`.

It is a template: fork it, restyle it, add UI. This file tells you (or your agent) where things are
and which rules to keep.

## Layout

| Path | Owns |
| --- | --- |
| `src/pascal/` | The API client: the contract schema (`contract.ts`), `getScene` / `fetchGlb` with typed errors and signed-URL renewal (`client.ts`), read helpers (`graph.ts`), browser access resolution and PKCE (`access.ts`, `handoff.ts`), and `saveSettings` / `parseSettings` for viewer settings (`settings.ts`). No React and no three.js in here; keep it that way so it can move into an SDK unchanged. |
| `src/pascal-react/` | Viewer settings for React: `useViewerSettings`, the Customize panel `SettingsPanel` (with `settings-panel.css`) and its field blocks `SettingsSection`, `SettingsRow`, `SettingsOptions`. React only, no three.js, nothing template-specific. |
| `src/settings.ts` | This template's viewer settings: the opening view's schema and defaults. |
| `src/useListing.ts` | Loading flow: choose a ready bake or live graph; poll while baking. |
| `src/App.tsx`, `src/styles.css` | Screens (loading, errors, access and Sign in with Pascal, no 3D file, WebGL unavailable) and the overlay UI. |
| `src/viewer/Viewer.tsx` | The canvas: environment light, key light and shadow, camera framing (or the saved opening view), orbit controls. |
| `src/viewer/OpeningCamera.tsx`, `openingView.ts` | Puts the camera on the saved opening view, and lets the Customize panel read the pose on screen. |
| `src/viewer/LiveViewer.tsx` | Lazy live runtime: render plugin, read-only lease, graph/material hydration, readiness and listing interactions. |
| `src/viewer/Model.tsx` | Parses the GLB, applies floor visibility, hover and click, plays door and window clips. |
| `src/viewer/semantics.ts` | Maps GLB nodes to Pascal identities: floors, rooms, openables. |
| `src/viewer/loaders.ts` | GLTFLoader with the meshopt decoder and KTX2 transcoder Pascal's files need. |
| `vite.config.ts` | Build, and the Content-Security-Policy written into `index.html`. |
| `tests/` | Playwright smoke against a mocked API, with fixtures from `scripts/make-fixture.mjs`. |

## The contract

The template is built on contract version 1 of Pascal's scene read API. The sections of that
contract are **Route**, **Response** and **Projection**; `src/pascal/contract.ts` mirrors the
response.

**Route.** `GET {baseUrl}/api/projects/{id}/scene`, optional `?revision=published` (the default and,
in version 1, the only value).

- Anonymous requests read public, published projects. The answer carries
  `Access-Control-Allow-Origin: *`, so any site can call it from the browser without a proxy.
- Every answer is `Cache-Control: private, no-store`, because it contains signed URLs.
- Errors are `{ "error": code }`: 404 `not_found` (missing or not public; Pascal does not tell them
  apart), 404 `not_published`, 401 when a credential was sent and rejected, 400
  `unsupported_revision`.
- The client sends `credentials: 'omit'`, so a visitor's own Pascal session never changes what
  your page sees.

**Response.** `contractVersion: 1`, then:

- `project`: `id`, `name` (may be null), `owner` (`displayName`, `avatarUrl`) or null, `coverUrl`.
- `revision`: `kind: 'published'`, `version`, `modelId`, `disclosurePolicyVersion`.
- `graph`: the published scene graph: `nodes` (by id, each with `id`, `type`, `name`, `parentId`,
  `children` and kind-specific fields) and `rootNodeIds`.
- `libraryMaterials`: the library materials the graph references.
- `bake`: `status` (`ready`, `baking`, `failed`, `none`), `bakeVersion`, `hash`, and `lods`: one
  entry per level of detail with `level` (0 is the most detailed), `url`, `bytes`, `triangles` and
  `expiresAt`.

Each LOD `url` is a signed URL that lives about 10 minutes and `expiresAt` is its real expiry. To
get a fresh one, read the scene again. `fetchGlb` does this when a URL is within a minute of expiry,
and once more if storage rejects it (400 or 403).

**Projection.** The graph is the published scene with what the owner did not publish removed
(disclosure policy 1): hidden subtrees, annotation-only node kinds, scans and guides unless shown
publicly, per-node `metadata` and `provenance`, and the site's address and parcel data. Do not rely
on fields outside the rendering data.

### What the 3D file contains

The GLB is self-describing, so a viewer needs no Pascal runtime:

- `node.name` is the Pascal node id, and `node.extras` (three's `userData`) carries `pascalId`,
  `kind` (`site`, `building`, `level`, `zone`, `slab`, `wall`, `door`, `window`, `item`, …) and
  `label`.
- A hit resolves to a Pascal node by walking up to the nearest ancestor with `extras.pascalId`.
  From there, `parentId` in the graph leads to its level and, for some kinds, its zone (room).
- Zones carry `polygon` (and `color`) in extras: the outline in the zone's own x/z plane, in
  metres. Their fill mesh is not in the file.
- Doors and windows that really open carry `openable: true` and `clips: ["<id>: open"]`: a
  one-second clip, closed at time 0. Play it once and clamp; reverse `timeScale` to close.
  Ambient clips end in `: loop` (a fan); this template does not play them.
- Geometry uses `EXT_meshopt_compression` (required) and textures are KTX2 (`KHR_texture_basisu`).
- There are no lights and no post-processing in the file. Lighting is the viewer's job.

## Run it

```bash
npm install            # or: bun install
cp .env.example .env   # optional
npm run dev            # http://localhost:5173/?project=<project id>
```

| Variable | Meaning |
| --- | --- |
| `VITE_PASCAL_BASE_URL` | Pascal instance, default `https://editor.pascal.app`. |
| `VITE_PASCAL_SOURCE` | `auto` (default): ready bake or live rebuild; `baked`: require a ready bake; `live`: always rebuild. |
| `VITE_PASCAL_PROJECT_ID` | Project shown when the address has no `?project=`. |
| `VITE_PASCAL_ASSET_ORIGINS` | Storage hosts added to the CSP `connect-src`, default `https://*.supabase.co`. |

All of them are build-time and public: Vite inlines `VITE_*` values into the bundle.

In auto mode a baking project renders live immediately, polls every 30 seconds, then switches
to the GLB when ready. Baked mode keeps the no-file/baking screens. Live mode never downloads
the bake. Both renderers keep the listing overlays. The live runtime is dynamically imported;
baked visitors do not load viewer/nodes. Register `renderPlugin` from `@pascal-app/nodes/render`
before loading the graph, hold the core read-only lease until unmount, register `libraryMaterials`,
and use `Viewer.onSceneReadyChange` for readiness. Relative assets use `VITE_PASCAL_BASE_URL`;
storage configuration keeps the runtime default. Live uses the fixture's untextured studio setup.

Checks:

```bash
npm run typecheck
npm run build
npx playwright install chromium   # once
npm run test:e2e                  # builds, serves dist, mocks the API
```

The smoke test intercepts the scene read and the GLB download, so it needs no network and no
Pascal account. `npm run fixture` regenerates `tests/fixtures/` (needs KTX-Software's `toktx`, or
`TOKTX=/path/to/toktx`); the fixture is a small two-floor house with a KTX2 texture, a door clip and
meshopt compression, like a real bake.
`live-scene.json` and `cube.gltf` are the standalone live-viewer fixture: the smoke mocks their
asset reads and checks scene readiness, rendered pixels, and the baking-to-ready transition.

## Open from Pascal

Register this viewer in Pascal settings with its entry URL, exact origins, and the callback
`<origin>/` (for example `https://viewer.example/` or `http://localhost:5173/`). The callback is
the same root page served by Vite in development and by the static production build; no extra
route or SPA rewrite is needed. Register each development port explicitly. Production origins
must use HTTPS and be verified: request the origin challenge in Pascal settings, serve it as
plain text at `/.well-known/pascal-viewer-verification`, then verify the origin in settings.
Pascal does not fetch localhost for verification. Bind the published project to this viewer,
then open it from Pascal or create a share link pinned to this viewer.

The helper resolves `GET /api/viewers/resolve?origin=<location.origin>` once per page to discover
the viewer ID and exact callback. No viewer ID or per-project deployment configuration is needed.
Pascal supplies `project`, `viewer`, and `access=session|share|anonymous` in its entry URL. An
entry without `access` (a hand-written or truncated link) counts as `access=anonymous`.
The helper captures and immediately scrubs callback `code`, `error`, `error_description`,
`state`, and `iss` before loading the app or rendering React, validates the saved transaction
(including its ten-minute maximum age), then exchanges the code using S256 PKCE and `credentials: 'omit'`. No Pascal cookies are sent by API reads.

Access resolves in order: callback, matching unexpired tab credential, private entry authorization,
then anonymous published read. Direct links without private entry context can read public projects.
If descriptor discovery is unavailable, only public projects work. An invalid callback stops
loading and shows “Reopen from Pascal” or “Reopen your share link”. Share readers should reopen
their original Pascal share link; the helper never stores or reconstructs that durable link.

A session credential Pascal rejects before its expiry (the owner revoked it from the Share
popover, the binding changed, the parent session ended) is recorded per tab, issuer, viewer,
project and origin in `sessionStorage` (`pascal:recovery:`, with the Customize intent and whether
the round trip is spent), and settled:

- **One round trip, same mode.** A fresh top-level PKCE authorize, never reusing the rejected
  token. A configure credential asks for `scope=configure` again at once (the configure path,
  which also lets the visitor sign in; Pascal allows it on public projects). A reader's session
  only after an independent tokenless read of the published scene says the project is
  *definitively* not public (404, 401 or 403), because Pascal refuses non-configure session
  authorizes on public projects with its own refusal page.
- **Indeterminate probe.** Offline, 5xx, 429 or an answer the client doesn't understand: neither a
  round trip nor the public view, but the read's `PascalError`, shown as a retryable error. A
  retry or a reload settles again from the record.
- **No loops.** The record outlives navigation, reloads and repeated failures. While it exists, a
  reload or re-entry (a session entry, no entry, or the `configure=available` hint) never starts an
  automatic authorize: it settles again, to the public view, "Reopen from Pascal" or the
  retryable error. Explicit sign-in and Customize buttons still start a new transaction. Only a
  successful credentialed read clears the record.
- **Public fallback.** When the session can't be restored (no round trip left, the replacement
  rejected too, or Pascal refusing a validated recovery or renewal callback, or its exchange
  failing or not granting configure), a project the tokenless read shows is public and published
  opens its public view, read-only, on its anonymous address: the current address, or for a
  callback the transaction's validated return path, without `viewer`, `access`, `configure` and
  callback parameters (other parameters and the hash kept). The Customize tab says it needs
  reopening (`customizeNeedsReopen`). Invalid or tampered callbacks (wrong state, issuer, code or
  age) never fall back: they show "Reopen from Pascal" as before.
- **Private and unpublished projects** never fall back: they show "Reopen from Pascal", whose
  button restarts Customize when the visitor was customising (`ReopenRequired.configure`,
  `signIn(projectId, baseUrl, { configure: true })`).

Share credentials are not recovered and never fall back.

Credentials are isolated by Pascal issuer, viewer, project, and browser origin in `sessionStorage`.
Never store tokens in `localStorage`, query parameters, build variables, or deployment secrets.
Transactions and PKCE verifiers also live only in the current tab's `sessionStorage`. Preserve
only validated local return paths across the round trip. Keep callback bootstrap ahead of any
third-party scripts or analytics you add, and exclude callback queries and credentials from logs.

Within two minutes of expiry, the helper renews using a fresh top-level authorization round trip
with the original session/share mode. An expired credential rejected with 401 can also renew.
There is one renewal attempt with a loop guard; failed or immediately expiring renewals require
reopening from Pascal (or, for a session on a public project, show its public view as above). There is no refresh token or hidden iframe. A successful read with a
fresh credential permits a later renewal cycle. Signed storage URL renewal remains separate:
storage downloads omit cookies and never receive the Pascal bearer credential.

`VITE_PASCAL_TOKEN_URL`, when set, takes precedence and skips the handoff and registry lookup.
This remains an alternative for company login flows described below.

### Sign in with Pascal

What the visitor sees, what the site and project need, and the three helpers (`canSignIn`,
`signIn`, `SignInUnavailable`) are in [README.md](README.md#sign-in-with-pascal). Implementation
rules:

- `useSignIn` in `src/App.tsx` drives the button on the anonymous not-found and needs-access
  screens, the session reopen screen and the refused screen. Call `canSignIn` only there, never
  on a successful visit, and never with `VITE_PASCAL_TOKEN_URL` set.
- Each screen has two texts: one for when the button is shown and one that doesn't mention
  signing in. Show the second until `canSignIn` resolves `true`.
- `signIn` always starts a fresh session PKCE transaction with `interaction=sign_in` (share
  authorizes omit it) and returns to the current local path. Show "Opening Pascal…" while it
  navigates; on failure, show your own message in the `role="alert"` line, not the error's text.
- A validated error callback is consumed without an exchange and resolves access as
  `{ kind: 'refused' }`. Never display `error` or `error_description`, and never fall back to an
  anonymous read in the same page load; a reload may.
- Keep the copy neutral: Pascal does not reveal whether a project exists, is private or is
  linked to another viewer, and the screens must not imply it.

## Viewer settings

A project's managers customise how this viewer presents their project, from inside the viewer, and
every later visitor gets it. This template's one setting is the opening view.

- **Per project and viewer.** Saved by Pascal under (project, viewer), outside the scene graph and
  any version; duplicating a project does not copy them. Pascal's own `/viewer/<id>` has none.
- **Managers only, live on save.** Only someone who can manage the project saves, and a save is
  what visitors get on their next read: there is no publish step. The unsaved draft lives in the
  tab until Save or Discard.
- **Public with the project.** Anyone who can read the project through this viewer reads its
  settings. Never put a secret in them.
- **At most 256 KB**, a JSON object, nested at most 32 levels. Version it (`v: 1`).
- **Tolerate stale data.** Settings outlive the scene they were made on: ids of deleted rooms or
  items, another build's shape. Parse with fallbacks and drop what no longer exists; never crash.

**How a manager gets there.** Three ways, all ending with a configure credential (the read then
says `settings.canConfigure: true`):

- *From Pascal.* The Share popover's **Customize** (managers only, once the project is published
  and bound to this viewer) opens the entry URL with `configure=1`. The helper authorizes with
  `scope=configure` at once.
- *On arrival.* When a signed-in manager opens this viewer from Pascal or follows their own share
  link, the entry URL carries `configure=available` (any `access`). The hint grants nothing, so
  `resolveAccess` asks Pascal for the configure credential at once, before the first read, in
  place of the handoff the entry's `access` would start: session authorize with `scope=configure`
  and `interaction=sign_in`. The manager arrives holding it, with a collapsed **Customize** tab
  that opens the panel with no second trip. The viewer comes back to the address it arrived on,
  same `access`, hint removed, so the address stays one any visitor can open.
- *From the tab.* A manager who holds an ordinary session credential (they signed in here, or
  opened an address without the hint) gets `settings.configureAvailable: true` on the read, which
  shows the same collapsed tab. Pressing it calls `enterCustomize(projectId, baseUrl)`: the same
  authorize, back to the same address with the panel open.

If Pascal refuses either of the last two (a forged hint, a manager who lost access; Pascal may
show its own refusal page first), the callback's `error=access_denied` returns the visitor to the
exact address they left with the access they had (the transaction keeps it as `fallbackPath`; it
must be this project and viewer and never itself `configure=1`), and `customizeRefused()` keeps
the tab hidden, and the hint unused, for the rest of the browser tab. They never land on a refusal
screen. An exchange that does not grant `"scope": "configure"` counts as the same refusal; from a
`configure=1` link it asks to reopen, as before.

`configure=1` survives only the round trip of Pascal's Customize link, and any other `configure`
value is not a link Pascal makes (the page asks to reopen). A configure credential held in the tab
is kept whatever a later entry says, and renews as one, in place. The panel starts open only from
`configure=1` (`useViewerSettings().requested`); after that the tab remembers how it was left.
Leaving Customize changes no credential: collapse the panel and, with no draft, the manager sees
what visitors see. Everyone else makes the same requests as before and reads `settings` read-only.

**The read and the write.** The scene read carries
`settings: { viewerId, revision, data, canConfigure, configureAvailable? }`, or null when Pascal
can't tell which viewer is reading (an older server omits it: same thing; an older server also
omits `configureAvailable`, which then counts as false). Never saved is `revision: 0, data: null`.
`saveSettings(baseUrl, projectId, { token, revision, data })` sends
`PUT /api/projects/{id}/viewer-settings` with the configure credential and returns the new
settings. It throws `ViewerSettingsError`: `conflict` (someone saved since `revision`; `current`
holds theirs), `unauthorized` (the session ended or the manager lost access), `too_large`,
`network`, and the rest.

**In a template.** `useViewerSettings({ settings: scene.settings, token, baseUrl, projectId, parse,
defaults })` gives `value` (the draft for a manager, the saved settings for everyone else),
`saved`, `canConfigure` (in Customize mode now), `available` (show Customize: in it, or may enter
it, and not refused in this tab), `enter()` (with `entering` and `enterError`), `dirty`,
`set(updater)`, `save()`, `discard()`, `status` (`idle`, `saving`, `saved`, `conflict`, `expired`,
`error`) and `reloadLatest()`. The draft survives a reload and the credential's renewal round trip
(it is in `sessionStorage`, per issuer, viewer and project), saves against the revision it was
started from, and the tab warns before closing with it unsaved.

`<SettingsPanel settings={settings} description="…">` renders nothing unless `available`.
Collapsed, it is a **Customize** pill on the right edge; before configure mode, pressing it calls
`enter()`. In configure mode it toggles a panel on the right (a sheet across the bottom under
560 px): a header saying what is customised (pass `description`, e.g. "How visitors first see
<project> in this viewer."), your fields (`children`) in a scrolling body, and a footer with the
save state (Unsaved changes, Saving…, Saved, a conflict with **Load the latest**, an ended session,
errors), **Discard** and **Save**. Collapsing keeps the draft; the pill then shows a dot and reads
"Customize, unsaved changes". Open or closed is remembered for the tab; arriving in configure mode
for the first time opens it. Escape collapses it. Build fields from the blocks so every template's
read alike: `SettingsSection` (a titled group), `SettingsRow` (a labelled field whose `value` says
in words what Save stores, with its controls as children), `SettingsOptions` (a choice of one,
radio-group semantics, arrow keys) and buttons with `className="pascal-settings-button"` (plus
`pascal-settings-primary` for the main one). Theme it with the `--pascal-settings-*` properties
listed in `src/pascal-react/settings-panel.css` (set in `styles.css` here, placed clear of the
floor buttons), never with a backdrop blur over the canvas.

This template stores `{ "v": 1, "opening": { "camera": { "position": [x, y, z], "target": [x, y, z] } } }`
(`src/settings.ts`). The panel's **Opening view** section shows the camera as "Custom" or "Default
(frames the house)"; **Use current view** copies the camera into the draft and **Clear** drops
`opening`; the manager keeps navigating freely. The opening view is applied once, as the scene
opens: visitors, and the manager on reload, open there. Without one, or with an invalid one, the
camera frames the model as before.

### Adding a setting

A room tour, say: an ordered list of rooms, some hidden. Add it to the schema with its own
fallback, next to `opening`, keeping the top level a `looseObject` so keys another build saved
survive:

```ts
// src/settings.ts
const TourStopSchema = z.object({ room: z.string(), hidden: z.optional(z.boolean()) })
const ListingSettingsSchema = z.looseObject({
  v: z.literal(1),
  opening: /* as before */,
  tour: z.catch(z.optional(z.array(TourStopSchema)), undefined),
})
```

Read it against the graph, so rooms deleted since the tour was saved drop out (and go on the next
save), and edit it through `settings.set` in a section of its own in the panel:

```tsx
// src/App.tsx, in Scene: `settings` is the useViewerSettings result the opening view uses.
import { SettingsOptions, SettingsPanel, SettingsRow, SettingsSection } from './pascal-react'

const rooms = useMemo(() => Object.values(scene.graph.nodes).filter((node) => node.type === 'zone'), [scene.graph])
const roomIds = useMemo(() => new Set(rooms.map((room) => room.id)), [rooms])
const tour = (settings.value.tour ?? []).filter((stop) => roomIds.has(stop.room))
const editTour = (edit: (stops: typeof tour) => typeof tour) =>
  settings.set((current) => ({ ...current, tour: edit((current.tour ?? []).filter((stop) => roomIds.has(stop.room))) }))

<SettingsPanel settings={settings} description={`How visitors first see ${projectName(scene)} in this viewer.`}>
  <SettingsSection title="Opening view">{/* …the camera row… */}</SettingsSection>
  <SettingsSection title="Room tour" description="The rooms visitors step through, in order.">
    {rooms.map((room) => {
      const stop = tour.find((each) => each.room === room.id)
      const state = !stop ? 'off' : stop.hidden ? 'hidden' : 'shown'
      return (
        <SettingsRow key={room.id} label={room.name ?? 'Room'}
          value={stop ? `Stop ${tour.indexOf(stop) + 1}${stop.hidden ? ', hidden' : ''}` : 'Not in the tour'}>
          <SettingsOptions label={`${room.name ?? 'Room'} in the tour`} value={state}
            options={[{ value: 'off', label: 'Off' }, { value: 'shown', label: 'Shown' }, { value: 'hidden', label: 'Hidden' }]}
            onChange={(next) => editTour((stops) => next === 'off'
              ? stops.filter((each) => each.room !== room.id)
              : stop
                ? stops.map((each) => (each.room === room.id ? { ...each, hidden: next === 'hidden' } : each))
                : [...stops, { room: room.id, hidden: next === 'hidden' }])} />
        </SettingsRow>
      )
    })}
  </SettingsSection>
</SettingsPanel>
```

Visitors then walk `tour.filter((stop) => !stop.hidden)` in order. Give every field a row whose
`value` says what is set, so the manager always reads what Save stores; when a choice is something
a visitor sees, show it on screen as it is chosen. Never save on every change: the manager presses
Save. The panel is 320 px wide (a sheet on phones), so a long list scrolls inside it.

## Private projects with your own login

The read works without a credential for public projects. For a private project, your
server mints a short-lived viewer token from its Pascal API key and your viewer sends it
as `Authorization: Bearer <token>`:

1. Run a token endpoint next to your site; `examples/token-server.mjs` is a complete
   one. It holds `PASCAL_API_KEY`, applies your own login check, and calls
   `POST /api/projects/{id}/viewer-grants` with `{ origins: [your viewer origin] }`.
   The key's owner must be able to manage the project.
2. Set `VITE_PASCAL_TOKEN_URL` to that endpoint. The viewer asks it for a token on
   every read (tokens last an hour at most) and sends your site's own cookies to it.

A token reads only that project's published version, only from the origins it was
minted for. Revoking the API key, or its owner losing manage access, stops it.

## Deploy

`npm run build` writes a static site to `dist/`. There is one page and no client-side routing.

- **Vercel**: import the folder (framework preset Vite, build `npm run build`, output `dist`), set
  the variables above under Environment Variables, deploy. From the CLI: `vercel` then
  `vercel --prod`.
- **Cloudflare Pages**: build command `npm run build`, output directory `dist`, variables under
  Settings → Variables (they are read at build time). From the CLI:
  `npm run build && npx wrangler pages deploy dist`.
- **Pascal**: needs `@pascal-app/cli` newer than 1.1.1. Register under Settings → Viewers →
  **Host on Pascal**; Pascal assigns `https://<slug>.pascal-viewer.app`, registers the `<origin>/`
  callback and verifies the origin on first deploy (skip the challenge in Open from Pascal). Then:

  ```bash
  npm run build
  npx @pascal-app/cli viewer deploy dist --viewer <viewer id> --dry-run   # local checks; no key, no network
  PASCAL_API_KEY='sk_live_...' npx @pascal-app/cli viewer deploy dist --viewer <viewer id> --json
  ```

  Fix everything the dry run lists before deploying: hidden files, folders and symlinks are
  skipped (except top-level `.well-known/`); other symlinks and non-allowlisted extensions are
  errors. The key must manage the viewer's workspace; keep it in the shell, never in `.env`,
  `VITE_*` or the repo. The deploy ends with `Live at: https://<slug>.pascal-viewer.app/`;
  `--json` prints `schemaVersion`, `viewerId`, `deploymentId`, `status`, `fileCount`,
  `totalBytes`, `skipped` and `url` (the live address). A failed deploy leaves the previous build
  live; rerun it to start a fresh deployment. Exit code 75 means retry later. Pascal's header CSP limits `connect-src` to the site, `editor.pascal.app`, Supabase
  and the decoder CDNs, so `VITE_PASCAL_TOKEN_URL` or another `VITE_PASCAL_BASE_URL` host fails
  there; use Open from Pascal for private projects.

The CSP ships as a `<meta>` tag. A meta policy cannot set `frame-ancestors`; if you need to control
who embeds your page, send that as a header (`vercel.json` headers, or `public/_headers` on
Cloudflare Pages).

## Customise

- **Lighting and look**: `Viewer.tsx`. `StudioEnvironment` is the image-based light (three's
  `RoomEnvironment`, no download); `SUN` and `Stage` set the key light and its soft shadow, which
  falls on the site's own ground or on a shadow-only floor when the scene has none. To add
  post-processing, add `@react-three/postprocessing` inside the `Canvas`, and check the bundle
  size after.
- **UI**: `App.tsx` and `styles.css`. The floors control, hover label, header and hint are plain
  React over the canvas. Keep copy in sentence case and buttons fully rounded.
- **Semantics**: `semantics.ts`. `CUTAWAY_KINDS` are hidden while one floor is isolated so its rooms
  read from above; `roomAt` and `openableAt` decide what hover and click mean.
- **Large scenes**: hover raycasts every mesh. For very large files, add `three-mesh-bvh`.
- **WebGPU**: optional. The template uses WebGL 2 for reach; the loaders work with either renderer.
- **Another LOD**: `pickLod` in `src/pascal/client.ts` picks the most detailed level (lod0 when
  present). Pick a coarser level for phones if you need to.

## Rules

- Never put a Pascal API key or account session in the browser bundle. `VITE_*` variables and
  everything in `src/` ship to every visitor. Public projects read anonymously; private projects
  use the registered Pascal handoff or your own server's short-lived token endpoint.
- Keep the template installable from this folder using published npm dependencies. Import the
  Pascal runtime only inside the lazy live path, and use `@pascal-app/nodes/render`, not the
  editor entry.
- Keep `src/pascal/` free of React and three.js, and `src/pascal-react/` free of three.js and
  of anything template-specific. CI checks both are identical across the templates that have them.
- Keep the CSP in `vite.config.ts` in step with what the page loads. The decoders need
  `'wasm-unsafe-eval'`, `'unsafe-eval'` (the Basis transcoder's Emscripten bindings build functions
  at runtime inside its worker) and `worker-src blob:`; the reasons are in the file. KTX2 textures
  silently fail without them, and the model never finishes loading.
- The baked path's Basis transcoder is bundled from the installed `three` (no transcoder path is set), so it is
  served from your own origin and always matches the loader. Live keeps the viewer's default
  Draco/Basis decoder URLs; the CSP permits their gstatic/jsDelivr fetches.
- Watch the bundle: shared React/Three/R3F chunks are separate from the app and renderer entries.
  Live additionally loads the Pascal runtime and lazy node renderers; baked visitors must not
  fetch them. The baked KTX2 transcoder loads only when a file has KTX2 textures.
