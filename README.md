# Pascal viewer templates

Starting points for building your own viewer of [Pascal](https://editor.pascal.app) projects. Each folder is a complete, standalone app: fork it, change the lighting, the post stack or the interface, and deploy it anywhere. None of them needs Pascal's editor packages.

| Template | What it shows | Source |
| --- | --- | --- |
| [`listing`](listing) | A published project's 3D file, with floors, room names and areas, and doors and windows that open | Baked 3D file |
| [`pascal`](pascal) | Pascal's hosted viewer: header, controls bar, 3D and 2D views, rooms, walkthrough and sounds | Baked 3D file with live parts, or a live rebuild |
| [`showcase`](showcase) | A project page with the look of Pascal's `/next` demo: a radial dial for views and time of day, a reveal intro, room and item discovery, a phone bottom bar | Same as `pascal` |
| [`minimal`](minimal) | A monochrome line drawing with no materials, turned between four axonometric corners and a plan | Baked 3D file, or a live rebuild |

Every template reads Pascal's public read, `GET https://editor.pascal.app/api/projects/{id}/scene`. It answers a project's published revision with the scene graph, its materials and short-lived links to the baked 3D file. Public projects need no key.

## Start from a template

```bash
npx degit pascalorg/viewer-templates/listing my-viewer
cd my-viewer
npm install
npm run dev
# open http://localhost:5173/?project=<published project id>
```

Replace `listing` with `pascal` to start from the hosted viewer, with `showcase` for the `/next` look, or with `minimal` for the line drawing.

Or deploy a copy straight away:

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fpascalorg%2Fviewer-templates%2Ftree%2Fmain%2Flisting&project-name=pascal-viewer&env=VITE_PASCAL_PROJECT_ID&envDescription=The%20id%20of%20a%20published%20Pascal%20project)

Or host the build on Pascal at `https://<slug>.pascal-viewer.app`: see [Deploy to Pascal](listing/README.md#deploy-to-pascal).

Pascal runs `showcase`, `listing` and `minimal` itself as official viewers that any project owner can pick in Pascal, without deploying anything: every merge to `main` deploys them to `showcase.pascal-viewer.app`, `listing.pascal-viewer.app` and `minimal.pascal-viewer.app`.

Each template's `AGENTS.md` explains the read, what the 3D file contains and how to customise it, for you and for your coding agent.

## Viewer settings

A project's managers can customise how a viewer presents their project, and every later visitor
gets it. A manager sees a **Customize** tab on the viewer's right edge (Pascal says who may: an
entry hint, `configure=available`, or the scene read's `configureAvailable`), or opens it from
Pascal's Share popover. Customize opens a panel with the template's fields and the save state; the
manager sets things up and presses Save. Settings are saved per project and viewer, readable by
anyone who can read the project (never put secrets in them), and at most 256 KB.

`showcase`, `listing` and `minimal` use it for the opening view: the camera (in `showcase` also
the time of day and the mode; in `minimal` the corner, plan and zoom). `src/pascal/settings.ts`
saves and `enterCustomize` enters Customize from inside the viewer; `src/pascal-react/` has the
`useViewerSettings` hook, the `SettingsPanel` and its field blocks to add your own settings. [listing's AGENTS.md](listing/AGENTS.md#viewer-settings) explains the model and walks
through adding one.

## Rules every template follows

- Never put a Pascal API key in the browser. Private projects need a server you control.
- Signed 3D file links last ten minutes; read the scene again to renew them.
- A template must build, typecheck and pass its smoke test in CI.

## License

MIT
