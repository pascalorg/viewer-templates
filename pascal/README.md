# Pascal viewer scaffold

S1 of the Pascal template: a standalone Vite page that renders a small local scene using
`@pascal-app/{core,viewer,nodes}@1.1.2`. It currently opens the fixture for every URL. Project
reads, hybrid baked/live assembly, optional plugin loading and hosted viewer chrome belong to
later slices and are not implemented here.

```bash
npm ci
npm run dev
```

Drag to orbit and scroll to zoom. The fixture is a reduced copy of the public editor's
`fixtures/viewer-live/scene.json`: site, building, level, four walls and one zone, with no remote
assets. It uses the public drei `OrbitControls`; the hosted camera/opening-camera components
await a later viewer/ui release. The fixture disables textures, daylight and post-processing
to provide a small, offline rendering check, as the public viewer-live fixture does.

```bash
npm run typecheck
npm run build
npm run check
npx playwright install chromium
npm run test:e2e
VIEWER_ID=viewer_Abc123DEF456ghi7 npm run deploy:dry
```

The production build prepends the CSP meta to `index.html`, serves matching Three decoders from
`/decoders/`, rejects editor/Next imports and emits `build-boundary.json` containing package
names and entry-chunk plugin checks. `check` validates the installed/locked/bundled packages,
hosting extensions and budgets: 20 MiB per file, 90 MiB total, 1,500 files. Vite's default lazy
chunking is sufficient; assets keep their default content-hashed names.

The six public plugins are pinned to Community's exact commits for the later allowlist. They
are not loaded by this fixture. `.npmrc` uses `legacy-peer-deps` because the plugins require
editor peers and several still declare core/viewer `<1`. Render peers are explicit dependencies.
When introducing the trees loader, TypeScript needs a type-only paths shim for its render entry:
its preset thumbnails assume Next image objects, while Vite imports URLs. The other five render
entries typecheck with `vite/client`. Never patch installed plugin source or import a package
name supplied by a scene graph. Trees remains opt-in (`VITE_PASCAL_PLUGIN_TREES=0`).

The public build-time variables in `.env.example` reserve the project's API/assets origin,
default project, source mode, trees flag and bake-poll flag for the later runtime. `config.ts`
also parses project/URL flags; the S1 page does not apply them. Only system light/dark mode is
active now. Never put a key or token into `VITE_*` variables. On Pascal hosting keep the API
origin `https://editor.pascal.app`; its header CSP blocks arbitrary asset/API origins regardless
of this page's meta policy. A meta policy cannot set `frame-ancestors`.

`src/pascal/` is byte-identical to listing's standalone API/access/handoff client and root CI
checks that equality. Callback capture and query scrubbing run before React renders; project
access resolution will be wired in a later slice. See [listing's contract and handoff rules](../listing/AGENTS.md).

The 13 viewer sound files and seven control icons are byte-for-byte copies from the public
editor's `apps/editor/public/`. The fixture configures their same-origin paths but does not
yet mount the hosted controls bar or interaction sounds.

The eventual template deliberately omits community likes/duplicate, collections, SEO text and
private plugin geometry on live scenes. This scaffold makes no hosted-viewer parity claim.

To validate a static build with Pascal's CLI (no key or upload):

```bash
npx @pascal-app/cli@1.1.2 viewer deploy dist --viewer viewer_Abc123DEF456ghi7 --dry-run
```

For an actual deployment follow [listing's deployment guide](../listing/README.md#deploy).
Keep deployment keys in your shell, never in this folder or the browser bundle.
