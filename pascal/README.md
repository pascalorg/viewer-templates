# Pascal viewer

Pascal's hosted 3D viewer (`editor.pascal.app/viewer/<id>`) rebuilt as a static Vite and React
app on the public `@pascal-app/core`, `@pascal-app/viewer` and `@pascal-app/nodes` packages
(`1.1.4`). It has the hosted viewer's header, controls bar, 3D, 2D and split views, rooms,
walkthrough, drone, selection callouts and sounds, all from `@pascal-app/viewer/ui` and
`@pascal-app/viewer/sfx`.

It is a template: a standalone project, meant to be forked and restyled. It does not use
Pascal's editor package or Next.js.

```bash
npm install
npm run dev
# open http://localhost:5173/?project=<project id>
```

The project must be published; direct anonymous links require it to be public.

## Choosing a project

The page shows the project named in the address, `/?project=<id>`. Without one it uses
`VITE_PASCAL_PROJECT_ID`, and without that it asks for a project. When Pascal opens the viewer
(Open from Pascal), the project comes from Pascal's callback.

| Variable | Meaning |
| --- | --- |
| `VITE_PASCAL_BASE_URL` | Pascal instance to read from, default `https://editor.pascal.app`. |
| `VITE_PASCAL_ASSETS_URL` | Base URL the viewer resolves relative asset paths against, default `VITE_PASCAL_BASE_URL`. |
| `VITE_PASCAL_PROJECT_ID` | Project shown when the address has no `?project=`. |
| `VITE_PASCAL_SOURCE` | `auto` (default): ready bake, otherwise live; `baked`: require a ready bake; `live`: always rebuild. |
| `VITE_PASCAL_PLUGIN_TREES` | `1` adds the trees plugin to the allowlist. Off by default. |
| `VITE_PASCAL_POLL_BAKE` | `1` reads the scene again every 30 seconds while a bake is in progress, and switches to it when ready. Off by default, as on the hosted viewer. |

All of them are read at build time and are public: Vite inlines `VITE_*` values into the bundle.
Never put a key or token in them. See `.env.example`.

## URL flags

The flags match the hosted viewer. `1`, `true` and `yes` turn a flag on.

| Flag | Does |
| --- | --- |
| `embed=1` | For iframes: no owner line and no "Get started" prompt. When the scene is on screen, posts `{ type: 'pascal:viewer-ready', projectId }` to the parent frame. |
| `hideHeader=1` | Hides the scene header (top left). |
| `hideBottomBar=1` | Hides the controls bar (bottom center). |
| `camera=px,py,pz,tx,ty,tz[,fov]` | Opens on this camera position and target. `camera=saved` uses the camera saved on the site or building. The loader stays up until the pose is in place. |

`main[data-scene-ready="true"]` is set once the loader lifts, and `data-source` is `baked` or
`live`.

## How it renders

With a ready bake, the baked 3D file draws the building, and interactive items, scans, guides and
plugin parts marked for live replacement are rebuilt from the published scene graph on top of
it. Without a ready bake, the whole published graph is rebuilt live.

Before the scene mounts, the page resolves access, downloads the bake, registers the project's
library materials, sets up a read-only artifact store and loads the plugins the scene needs.
`src/viewer/ProjectViewer.tsx` is the assembly.

## Plugins

Plugins are loaded from an allowlist in `src/runtime/plugins.ts`. Each entry names a package, the
kind prefix it draws (`pool:`, `streetscape:` and so on) and a literal `import()` of its `/render`
entry. The packages are pinned to exact git commits in `package.json`.

| Package | Kinds | Default |
| --- | --- | --- |
| `@pascal-app/plugin-articraft` | `articraft:` | On |
| `@pascal-app/plugin-boots` | `boots:` | On |
| `@pascal-app/plugin-environment` | `environment:` | On |
| `@pascal-app/plugin-pool` | `pool:` | On |
| `@pascal-app/plugin-streetscape` | `streetscape:` | On |
| `@pascal-app/plugin-trees` | `trees:` | Off; `VITE_PASCAL_PLUGIN_TREES=1` |

A plugin loads only when the scene has one of its kinds and the scene lists it as installed
(scenes saved before install state existed enable all of them). Plugins are imported lazily and
never land in the entry chunk, so a visitor downloads only what the scene uses. The page waits up to 20 seconds for plugins; one
that arrives later redraws the scene. Kinds no plugin draws are skipped with one console warning
per kind.

To add a plugin, install it at an exact version or commit, add an entry to `renderSources` in
`src/runtime/plugins.ts` with a literal `import('<package>/render')`. `src/styles.css` already
scans `@pascal-app/plugin-*/src` for Tailwind classes; add an `@source` line for a package named
otherwise. To remove one, delete its entry and uninstall the package. Never import a package name that comes from scene data.

## Customise

- **Chrome**: `src/viewer/ViewerOverlay.tsx` (scene header and controls bar),
  `src/viewer/GuestPrompt.tsx` (the "Get started" card), `src/viewer/screens.tsx` (loading,
  error and access screens).
- **Scene**: `src/viewer/ProjectViewer.tsx`. It follows the hosted viewer's tree; the components
  come from `@pascal-app/viewer/ui`, so prefer their props to forking them.
- **Theme and type**: `src/styles.css`. It imports the viewer UI theme and Barlow; override its
  tokens rather than copying components. Light and dark follow the system setting.
- **Tab icon**: `public/favicon.ico`, linked from `index.html`.
- Keep copy in sentence case and buttons fully rounded.

## Scripts

| Script | Does |
| --- | --- |
| `npm run dev` | Development server. |
| `npm run build` | Static site in `dist/`, with the Content-Security-Policy and the three.js decoders. |
| `npm run typecheck` | TypeScript check (`scripts/typecheck.mjs`). |
| `npm run check` | Checks `dist/` against the hosting limits and the package boundary (`scripts/check-build.mjs`). |
| `npm run test:e2e` | Builds a test build, then runs the Playwright tests against a mocked API. |
| `npm run deploy:dry` | Dry run of `pascal viewer deploy` with `@pascal-app/cli@1.1.4`; needs `VIEWER_ID`. |

`npm run test:e2e` needs `npx playwright install chromium` once. It runs offline with software
WebGL. Its build includes test pages, so run `npm run build` again before `check` or a deploy;
`check` refuses a test build. Set `PASCAL_TEST_PORT` (default 4180) to run two copies at once.

## Deploy to Pascal

Pascal can host the built site at `https://<slug>.pascal-viewer.app`. This uses
`pascal viewer deploy` from `@pascal-app/cli` 1.1.4.

1. Register the viewer in Pascal under Settings → Viewers → **Host on Pascal**. Pascal assigns
   the origin, verifies it on the first deploy and registers the root callback (`<origin>/`)
   this template uses.
2. Set any `VITE_*` variables, then run `npm run build`. They're read at build time.
3. Check the build, then deploy it with an API key that can manage the viewer's workspace:

   ```bash
   npm run check
   npx @pascal-app/cli@1.1.4 viewer deploy dist --viewer <viewer id> --dry-run
   PASCAL_API_KEY='sk_live_...' npx @pascal-app/cli@1.1.4 viewer deploy dist --viewer <viewer id>
   ```

   The dry run lists skipped hidden files and anything that would stop the deploy. The deploy
   ends with `Live at: https://<slug>.pascal-viewer.app/`.

4. Bind a published project to the viewer, then open it from Pascal or create a share link
   pinned to it.

Keep the key in your shell, never in `.env`. Pascal hosting sends its own Content-Security-Policy,
which allows connections only to the site, `editor.pascal.app`, Supabase storage and the decoder
CDNs. A `VITE_PASCAL_BASE_URL` or `VITE_PASCAL_ASSETS_URL` on another host is blocked there.
Private projects use Open from Pascal; see
[listing's AGENTS.md](../listing/AGENTS.md#open-from-pascal). The build is a static site, so
Vercel, Cloudflare Pages and other static hosts work too.

## Known gaps

- Nodes from Pascal's private plugins (for example the home designer's procedural parts) are
  skipped and draw nothing when they are rebuilt live. There is no on-screen notice, only a
  console warning.
- Assets hosted on outside domains can be blocked by the hosting Content-Security-Policy.
- The public plugins need `legacy-peer-deps` (in `.npmrc`) until their peer ranges are updated.
- No likes, duplicate, collections or view counts.
- The owner is shown as a plain name with no profile link.

[`AGENTS.md`](AGENTS.md) covers the rules to keep and where things live. The read API and access
rules are in [listing's AGENTS.md](../listing/AGENTS.md).

MIT licensed, like the rest of this repository.
