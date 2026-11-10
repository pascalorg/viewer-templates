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

[`AGENTS.md`](AGENTS.md) covers the API contract, what the 3D file contains, deployment,
customisation and the rules to keep (start with: never put a Pascal API key in the browser).

MIT licensed, like the rest of this repository.

Open from Pascal: register and verify your viewer origin with the root callback (`<origin>/`) to open private projects and share links without deployment secrets; see [AGENTS.md](AGENTS.md#open-from-pascal).

Private projects: run `examples/token-server.mjs` with your API key on your server and set `VITE_PASCAL_TOKEN_URL`. See AGENTS.md.
