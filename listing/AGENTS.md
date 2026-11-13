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
| `src/pascal/` | The API client: the contract schema (`contract.ts`), `getScene` / `fetchGlb` with typed errors and signed-URL renewal (`client.ts`), read helpers (`graph.ts`), and browser access resolution and PKCE (`access.ts`, `handoff.ts`). No React and no three.js in here; keep it that way so it can move into an SDK unchanged. |
| `src/useListing.ts` | Loading flow: choose a ready bake or live graph; poll while baking. |
| `src/App.tsx`, `src/styles.css` | Screens (loading, errors, access and Sign in with Pascal, no 3D file, WebGL unavailable) and the overlay UI. |
| `src/viewer/Viewer.tsx` | The canvas: environment light, key light and shadow, camera framing, orbit controls. |
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
Pascal supplies `project`, `viewer`, and `access=session|share|anonymous` in its entry URL.
The helper captures and immediately scrubs callback `code`, `error`, `error_description`,
`state`, and `iss` before loading the app or rendering React, validates the saved transaction
(including its ten-minute maximum age), then exchanges the code using S256 PKCE and `credentials: 'omit'`. No Pascal cookies are sent by API reads.

Access resolves in order: callback, matching unexpired tab credential, private entry authorization,
then anonymous published read. Direct links without private entry context can read public projects.
If descriptor discovery is unavailable, only public projects work. An invalid callback or a
rejected credential stops loading and shows “Reopen from Pascal” or “Reopen your share link”;
it never silently retries anonymously. Share readers should reopen their original Pascal share
link; the helper never stores or reconstructs that durable link.

Credentials are isolated by Pascal issuer, viewer, project, and browser origin in `sessionStorage`.
Never store tokens in `localStorage`, query parameters, build variables, or deployment secrets.
Transactions and PKCE verifiers also live only in the current tab's `sessionStorage`. Preserve
only validated local return paths across the round trip. Keep callback bootstrap ahead of any
third-party scripts or analytics you add, and exclude callback queries and credentials from logs.

Within two minutes of expiry, the helper renews using a fresh top-level authorization round trip
with the original session/share mode. An expired credential rejected with 401 can also renew.
There is one renewal attempt with a loop guard; failed or immediately expiring renewals require
reopening from Pascal. There is no refresh token or hidden iframe. A successful read with a
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
- Keep `src/pascal/` free of React and three.js.
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
