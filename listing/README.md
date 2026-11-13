# Pascal listing viewer

A small, deployable web page that shows a published [Pascal](https://editor.pascal.app) project in 3D,
straight from Pascal's public scene read API. Floors you can isolate, room names and areas on
hover, doors and windows that open on click.

It is a template: a standalone Vite, React and three.js project, meant to be forked and restyled.
Ready bakes render as GLB files. Unbaked projects rebuild live from the published scene graph
using `@pascal-app/core`, `@pascal-app/viewer` and `@pascal-app/nodes` (`^1.1.0`), loaded on demand.

```bash
npm install
npm run dev
# open http://localhost:5173/?project=<project id>
```

The project must be published; direct anonymous links require it to be public. Set `VITE_PASCAL_BASE_URL` to read from another Pascal
instance (see `.env.example`).

`VITE_PASCAL_SOURCE` selects `auto` (default: ready GLB, otherwise live), `baked` (require a
ready GLB), or `live` (always rebuild). While baking, auto shows the live scene and checks every
30 seconds, switching to the GLB when ready. The listing UI stays the same for both sources.
The live view uses the runtime's untextured studio setup; relative assets resolve against
`VITE_PASCAL_BASE_URL`.

| Script | Does |
| --- | --- |
| `npm run dev` | Development server. |
| `npm run build` | Static site in `dist/`, ready for Vercel, Cloudflare Pages or any static host. |
| `npm run typecheck` | `tsc --noEmit`. |
| `npm run test:e2e` | Builds, then runs the Playwright smoke against a mocked API. |
| `npm run fixture` | Regenerates the test fixtures. |

## Deploy to Pascal

Pascal can host the built site at `https://<slug>.pascal-viewer.app`. This uses
`pascal viewer deploy`, in the next `@pascal-app/cli` release after 1.1.1.

1. Register the viewer in Pascal under Settings → Viewers → **Host on Pascal**. Pascal assigns
   the origin, verifies it on the first deploy and registers the root callback (`<origin>/`)
   this template uses.
2. Set any `VITE_*` variables, then run `npm run build`. They're read at build time.
3. Check the build, then deploy it with an API key that can manage the viewer's workspace:

   ```bash
   npx @pascal-app/cli viewer deploy dist --viewer <viewer id> --dry-run
   PASCAL_API_KEY='sk_live_...' npx @pascal-app/cli viewer deploy dist --viewer <viewer id>
   ```

   The dry run lists skipped hidden files and anything that would stop the deploy. The deploy
   ends with `Live at: https://<slug>.pascal-viewer.app/`.

4. Bind a published project to the viewer, then open it from Pascal or create a share link
   pinned to it.

Keep the key in your shell, never in `.env`. Pascal hosting sends its own Content-Security-Policy,
which allows connections only to the site, `editor.pascal.app`, Supabase storage and the decoder
CDNs. A `VITE_PASCAL_TOKEN_URL` or `VITE_PASCAL_BASE_URL` on another host is blocked there, so
private projects use Open from Pascal. Vercel, Cloudflare Pages and other static hosts work as
before; see [AGENTS.md](AGENTS.md#deploy).

## Sign in with Pascal

A visitor who opens a private project's address directly (`/?project=<id>`) sees "Project not
found" or "This project needs access" (or "Reopen from Pascal" once earlier access stops working)
with a **Sign in with Pascal** button. The button takes them
to Pascal, which signs them in if needed and sends them back to the same address. Then either the
project loads, or the page says "This account can't open this project" and offers to try another
account. Pascal never says whether a project exists, is private or is linked to another viewer,
so keep any copy you write just as neutral.

For the button to appear and the project to load:

- the site must be a registered Pascal viewer (Settings → Viewers, or Host on Pascal). On an
  unregistered address, such as an unregistered local port, the screens show no button and their
  text doesn't mention signing in;
- the project's manager must link it to this viewer (Share → choose the viewer) and publish it.

Nothing needs to be configured: the page asks Pascal whether its own address is registered. The
access Pascal returns is kept for the current tab only and lasts up to an hour; after that the page
renews it with another trip through Pascal. With `VITE_PASCAL_TOKEN_URL` set, the button is not
offered.

`src/pascal` exports the three pieces the screens in `src/App.tsx` use:

- `canSignIn(baseUrl?)` resolves to `true` when this site is a registered viewer. Call it only on
  an access screen, so public visits make no extra request.
- `signIn(projectId, baseUrl?)` leaves for Pascal and comes back to the current address.
- `SignInUnavailable` is what `signIn` throws, without leaving the page, when the site isn't
  registered.

[`AGENTS.md`](AGENTS.md) covers the API contract, what the 3D file contains, deployment,
customisation and the rules to keep (start with: never put a Pascal API key in the browser).

MIT licensed, like the rest of this repository.

Open from Pascal: register and verify your viewer origin with the root callback (`<origin>/`) to open private projects and share links without deployment secrets; see [AGENTS.md](AGENTS.md#open-from-pascal).

Private projects: run `examples/token-server.mjs` with your API key on your server and set `VITE_PASCAL_TOKEN_URL`. See AGENTS.md.
